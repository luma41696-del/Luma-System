/**
 * The public WhatsApp webhook.
 *
 * Its own Netlify function rather than a route on the callable adapter: Meta
 * verifies the endpoint with a GET, and that adapter answers everything but
 * POST with 405. It also speaks the callable protocol, which Meta does not.
 *
 * Endpoint: /.netlify/functions/whatsapp
 *   GET   — the one-time verification handshake
 *   POST  — inbound messages, signature-checked before anything is parsed
 */

'use strict';

const {
  verifySignature, handleVerification, extractMessages
} = require('../../functions/whatsapp/webhook');
const { storeIncoming } = require('../../functions/whatsapp/store');

const text = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  body
});

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const { status, body } = handleVerification(event.queryStringParameters || {});
    return text(status, body);
  }

  if (event.httpMethod !== 'POST') return text(405, 'Method not allowed.');

  // Exactly the bytes Meta signed. Re-serialising parsed JSON would change
  // key order and whitespace, and the signature would never match.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;

  if (!verifySignature(raw, headers['x-hub-signature-256'])) {
    console.warn('[whatsapp] rejected an unsigned or mis-signed delivery');
    return text(401, 'Invalid signature.');
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('[whatsapp] FIREBASE_SERVICE_ACCOUNT is not configured');
    return text(500, 'Server not configured.');
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return text(400, 'Malformed payload.'); }

  try {
    const messages = extractMessages(payload);
    const result = await storeIncoming(messages);
    console.log('[whatsapp] stored', result.stored, 'message(s) across', result.chats.length, 'chat(s)');
  } catch (err) {
    // Meta retries anything that is not a 2xx, and a retry of a message we
    // already stored is harmless — the message id is the document id. Failing
    // loudly here is better than swallowing a write error silently.
    console.error('[whatsapp] failed to store delivery', err);
    return text(500, 'Storage failed.');
  }

  // Meta only needs to know it was received; anything slower than a prompt
  // 200 gets retried.
  return text(200, 'OK');
};
