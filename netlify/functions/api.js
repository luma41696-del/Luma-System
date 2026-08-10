/**
 * Netlify Functions adapter for the Firebase callables.
 *
 * Cloud Functions require the Blaze plan, so on the free tier the same handlers
 * run here instead. Nothing in functions/ is rewritten: a `firebase-functions`
 * onCall export is an Express-style (req, res) handler, so this module builds
 * the request/response pair it expects and lets it do its own work — including
 * verifying the caller's Firebase ID token and mapping HttpsError codes.
 *
 * That matters for security: the permission checks, the privilege-escalation
 * guard and the audit log are the exact same code that would run on Firebase.
 *
 * Protocol (identical to the Firebase callable protocol, so the browser SDK
 * shape is preserved):
 *   POST /.netlify/functions/api/<name>
 *   Authorization: Bearer <firebase id token>
 *   { "data": { ... } }            ->  { "result": { ... } }
 *                                  ->  { "error": { "status": "...", "message": "..." } }
 */

'use strict';

/*
 * These requires are deliberately static string literals.
 * Netlify bundles functions with esbuild, which can only follow imports it can
 * see at build time — a computed `require(path.join(...))` is invisible to it,
 * so the handlers would be missing at runtime and every call would 500.
 *
 * Only the callables are pulled in; Firestore triggers and scheduled jobs
 * cannot be served over HTTP.
 */
const modules = [
  require('../../functions/auth'),
  require('../../functions/encryption'),
  require('../../functions/deletion'),
  require('../../functions/pdf'),
  // Static paths only — esbuild bundles what it can see, and a computed
  // require() would leave these out of the deployed function.
  require('../../functions/finance'),
  require('../../functions/finance/expenses'),
  require('../../functions/ai')
];

/** name -> onCall handler */
const registry = {};
for (const mod of modules) {
  for (const [name, value] of Object.entries(mod)) {
    // onCall/onRequest exports are functions; triggers carry a __trigger/__endpoint
    // marker for events we cannot serve over HTTP.
    if (typeof value !== 'function') continue;
    const endpoint = value.__endpoint || {};
    if (endpoint.eventTrigger || endpoint.scheduleTrigger) continue;
    registry[name] = value;
  }
}

const ALLOWED = new Set(Object.keys(registry));

/* -------------------------------------------------------------------------- */
/* Express shim                                                               */
/* -------------------------------------------------------------------------- */

function makeReq(event, bodyText) {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;

  let body = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { body = {}; }
  }

  const get = (name) => headers[String(name).toLowerCase()];

  return {
    method: event.httpMethod || 'POST',
    url: event.path || '/',
    originalUrl: event.path || '/',
    headers,
    body,
    rawBody: Buffer.from(bodyText || '', 'utf8'),
    // firebase-functions reads the bearer token through these.
    header: get,
    get,
    // The client IP ends up in the audit log; only ever taken from the edge.
    ip: headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || null,
    connection: { remoteAddress: headers['x-nf-client-connection-ip'] || null }
  };
}

function makeRes(resolve) {
  const state = { statusCode: 200, headers: {}, body: '', done: false };

  const finish = () => {
    if (state.done) return;
    state.done = true;
    resolve({ statusCode: state.statusCode, headers: state.headers, body: state.body });
  };

  const res = {
    get statusCode() { return state.statusCode; },
    set statusCode(code) { state.statusCode = code; },
    setHeader(name, value) { state.headers[name] = value; },
    getHeader(name) { return state.headers[name]; },
    removeHeader(name) { delete state.headers[name]; },
    set(name, value) { state.headers[name] = value; return res; },
    status(code) { state.statusCode = code; return res; },
    json(payload) {
      state.headers['Content-Type'] = 'application/json';
      state.body = JSON.stringify(payload);
      finish();
      return res;
    },
    send(payload) {
      if (payload === undefined || payload === null) state.body = '';
      else if (typeof payload === 'string') state.body = payload;
      else {
        state.headers['Content-Type'] = state.headers['Content-Type'] || 'application/json';
        state.body = JSON.stringify(payload);
      }
      finish();
      return res;
    },
    end(payload) {
      if (typeof payload === 'string') state.body = payload;
      finish();
      return res;
    },
    on() { return res; },
    once() { return res; },
    removeListener() { return res; },
    emit() { return false; },
    writeHead(code, headers) {
      state.statusCode = code;
      Object.assign(state.headers, headers || {});
      return res;
    }
  };
  return res;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': process.env.LUMA_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '3600'
};

function fail(statusCode, status, message) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { status, message } })
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // /.netlify/functions/api/<name>  — or  ?fn=<name>
  const segments = String(event.path || '').split('/').filter(Boolean);
  const name = (event.queryStringParameters && event.queryStringParameters.fn) ||
    segments[segments.length - 1];

  // Diagnostics endpoint — reachable with a plain GET from a browser.
  if (name === '__health') {
    const report = await exports.health();
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(report, null, 2)
    };
  }

  if (event.httpMethod !== 'POST') {
    return fail(405, 'INVALID_ARGUMENT', 'يجب استخدام POST.');
  }

  if (!name || !ALLOWED.has(name)) {
    return fail(404, 'NOT_FOUND', 'الدالة المطلوبة غير موجودة.');
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('[api] FIREBASE_SERVICE_ACCOUNT is not configured');
    return fail(500, 'INTERNAL', 'الخادم غير مهيأ. راجع إعدادات البيئة.');
  }

  const bodyText = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  try {
    const result = await new Promise((resolve, reject) => {
      const req = makeReq(event, bodyText);
      const res = makeRes(resolve);
      // A handler that throws synchronously must not hang the request.
      try {
        const returned = registry[name](req, res);
        if (returned && typeof returned.catch === 'function') returned.catch(reject);
      } catch (err) {
        reject(err);
      }
    });

    return {
      statusCode: result.statusCode,
      headers: { ...CORS, ...result.headers },
      body: result.body
    };
  } catch (err) {
    console.error(`[api] ${name} failed`, err);

    // Map the handful of failures that are really *configuration* problems to a
    // message that says what to fix. A bare "server error" sends you to the logs
    // for something the response can answer directly.
    const text = `${err?.code || ''} ${err?.message || ''}`;
    let hint = 'حدث خطأ في الخادم.';

    if (/Cannot find module/i.test(text)) {
      hint = 'ملفات الخادم غير مكتملة في النشر. تحقق من included_files في netlify.toml.';
    } else if (/NOT_FOUND|database \(default\) does not exist|5 NOT_FOUND/i.test(text)) {
      hint = 'قاعدة بيانات Firestore غير مُنشأة في مشروع Firebase. أنشئها من الـ Console ثم أعد المحاولة.';
    } else if (/PERMISSION_DENIED|permission_denied|IAM/i.test(text)) {
      hint = 'مفتاح الخدمة لا يملك صلاحية كافية، أو واجهة Firestore غير مفعّلة في المشروع.';
    } else if (/credential|Invalid JWT|invalid_grant|DECODER/i.test(text)) {
      hint = 'مفتاح الخدمة (FIREBASE_SERVICE_ACCOUNT) غير صالح أو مقصوص. أعد لصقه كاملاً.';
    } else if (/UNAUTHENTICATED/i.test(text)) {
      hint = 'تعذّرت مصادقة الخادم مع Firebase. راجع مفتاح الخدمة.';
    }

    return fail(500, 'INTERNAL', hint);
  }
};

/**
 * Health check: GET /api/__health
 * Reports whether the environment and the Firebase connection are usable,
 * without exposing any secret value.
 */
exports.health = async () => {
  const report = {
    serviceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    vaultKey: !!process.env.VAULT_ENCRYPTION_KEY,
    callables: Object.keys(registry).length,
    firestore: 'unknown'
  };
  try {
    const { db } = require('../../functions/lib/admin');
    await db.collection('_health').limit(1).get();
    report.firestore = 'ok';
  } catch (err) {
    report.firestore = `error: ${(err.message || '').slice(0, 160)}`;
  }
  return report;
};

/** Exposed for the self-test. */
exports._registry = registry;
