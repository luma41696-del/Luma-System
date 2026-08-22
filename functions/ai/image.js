/**
 * Image generation — a picture from a description.
 *
 * Two providers can draw and one cannot: Claude has no image model, so the
 * caller is told that plainly instead of being handed a failure from an
 * endpoint that was never going to work.
 *
 * Which one draws is decided by the clock, not by who the person chats with.
 * The platform kills this handler at 26 seconds and not every image model
 * finishes in that time, so the fastest configured drawer goes first and the
 * answer reports which one produced the picture.
 *
 * The result is written to Storage and returned as a URL. Both providers hand
 * back base64, and a data URI that size cannot be put in a Firestore document,
 * pasted into a task, or opened in a new tab — so it becomes a real file the
 * rest of the system can treat like any other upload.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { REGION, storage } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const {
  AI_SECRETS, CATALOG, PROVIDER_IDS, canGenerateImages, imageModelOf, labelOf, envKeyOf
} = require('./catalog');
const { getAISettings } = require('./config');
const { enforceRateLimit } = require('./rate-limit');
const { providerError } = require('./errors');

const opts = { region: REGION, cors: true, secrets: AI_SECRETS };

/**
 * Netlify kills the handler at 26s (netlify.toml [functions.api]). Aborting at
 * 25 leaves just enough to write the audit entry and return a real error
 * instead of the platform's opaque one.
 */
const TIMEOUT_MS = Number(process.env.AI_IMAGE_TIMEOUT_MS) || 25_000;

/**
 * Who draws, fastest first.
 *
 * This is not a quality ranking — it is a deadline. OpenAI's image model
 * routinely takes longer than the 26s the platform allows, so asking it first
 * means the request is killed before any picture exists. Gemini's flash image
 * model finishes inside the window, so it leads. Which one actually drew is
 * reported back, and AI_IMAGE_PROVIDER pins a specific one.
 */
const BY_SPEED = ['gemini', 'openai'];

/**
 * gpt-image-1 spends most of its time on fidelity. Inside a 26s ceiling a
 * lower setting is the difference between a picture and a timeout, so that is
 * the default — raise it only if the platform budget grows.
 */
const OPENAI_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'low';

const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);

/* ------------------------------------------------------------- providers */

async function drawWithOpenAI({ apiKey, model, prompt, size }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, n: 1, quality: OPENAI_QUALITY }),
      signal: controller.signal
    });
    if (!response.ok) throw await failure(response, 'OpenAI', /sk-[A-Za-z0-9_*-]+/g, 'sk-***');

    const json = await response.json();
    const first = json.data?.[0];
    // gpt-image-1 returns base64; older models may return a URL instead.
    if (first?.b64_json) return { base64: first.b64_json, contentType: 'image/png' };
    if (first?.url) {
      const raw = await fetch(first.url);
      const buffer = Buffer.from(await raw.arrayBuffer());
      return { base64: buffer.toString('base64'), contentType: raw.headers.get('content-type') || 'image/png' };
    }
    throw new Error('OpenAI returned no image.');
  } finally {
    clearTimeout(timer);
  }
}

async function drawWithGemini({ apiKey, model, prompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Gemini's image models must be told to return an image; left to
        // itself the model will happily reply with a description instead.
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw await failure(response, 'Gemini', /AIza[A-Za-z0-9_-]+/g, 'AIza***');

    const json = await response.json();
    const parts = json.candidates?.[0]?.content?.parts || [];
    const image = parts.find((p) => p.inlineData?.data);
    if (!image) {
      const blocked = json.promptFeedback?.blockReason;
      throw new Error(blocked ? `Gemini refused the prompt (${blocked}).` : 'Gemini returned no image.');
    }
    return {
      base64: image.inlineData.data,
      contentType: image.inlineData.mimeType || 'image/png'
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Shared error shaping — status preserved, key redacted, reason extracted. */
async function failure(response, vendor, keyPattern, mask) {
  const detail = (await response.text().catch(() => '')).replace(keyPattern, mask);
  const err = new Error(`${vendor} ${response.status}: ${detail.slice(0, 300)}`);
  err.status = response.status;
  try {
    const parsed = JSON.parse(detail);
    err.providerMessage = String(parsed?.error?.message || '').slice(0, 200);
  } catch { err.providerMessage = detail.slice(0, 200); }
  return err;
}

const DRIVERS = { openai: drawWithOpenAI, gemini: drawWithGemini };

/* -------------------------------------------------------------- callable */

exports.generateImage = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'tasks.ai');

  const prompt = str(request.data?.prompt, { max: 1000, required: true, field: 'الوصف' });
  assert(prompt.length >= 3, 'الوصف قصير جداً.');
  const size = SIZES.has(request.data?.size) ? request.data.size : '1024x1024';

  // An explicit choice wins. Someone whose usual provider is out of quota
  // needs a way to say "use the other one" without an operator changing an
  // environment variable, and only they know which they would rather spend.
  const requested = str(request.data?.provider, { max: 40, field: 'المزوّد' });
  if (requested && !canGenerateImages(requested)) {
    throw new HttpsError(
      'failed-precondition',
      CATALOG[requested]?.imageModel
        ? `${labelOf(requested)} غير مُفعّل — لم يتم ضبط مفتاح ${envKeyOf(requested)} على الخادم.`
        : `${labelOf(requested)} لا يولّد الصور.`
    );
  }

  const mine = await getAISettings(caller.uid);
  const forced = process.env.AI_IMAGE_PROVIDER;
  // Falls back by deadline only when nobody asked for anything — see BY_SPEED.
  const provider = requested
    || (forced && canGenerateImages(forced) ? forced : null)
    || BY_SPEED.find(canGenerateImages)
    || PROVIDER_IDS.find(canGenerateImages);

  if (!provider) {
    const drawers = PROVIDER_IDS.filter((id) => CATALOG[id].imageModel).map(labelOf);
    throw new HttpsError(
      'failed-precondition',
      `توليد الصور غير مُفعّل — يحتاج مفتاح ${drawers.join(' أو ')} على الخادم.`
    );
  }

  await enforceRateLimit(caller.uid);

  const model = imageModelOf(provider);
  const startedAt = Date.now();

  try {
    const { base64, contentType } = await DRIVERS[provider]({
      apiKey: process.env[envKeyOf(provider)], model, prompt, size
    });

    const buffer = Buffer.from(base64, 'base64');
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
    const path = `ai-images/${caller.uid}/${Date.now()}.${ext}`;
    const file = storage.bucket().file(path);

    await file.save(buffer, { contentType, resumable: false });
    await file.makePublic().catch(() => {});
    const url = `https://storage.googleapis.com/${file.bucket.name}/${path}`;

    await writeAudit({
      action: 'ai.image',
      caller,
      meta: {
        prompt: prompt.slice(0, 300), provider, model, size,
        bytes: buffer.length, durationMs: Date.now() - startedAt, success: true
      }
    });

    // `provider` travels back so the UI can say who drew it — the answer is
    // not always the provider the person picked.
    return { url, path, provider, model, usedFallback: provider !== mine.provider };
  } catch (err) {
    await writeAudit({
      action: 'ai.image',
      caller,
      meta: {
        prompt: prompt.slice(0, 300), provider, model,
        durationMs: Date.now() - startedAt, success: false,
        error: String(err.message || err).slice(0, 300)
      }
    });
    console.error('[ai] generateImage failed', err);

    // "Try a shorter question" is the wrong advice for a drawing that ran out
    // of wall-clock: the prompt length is not what made it slow.
    if (err?.name === 'AbortError') {
      const others = PROVIDER_IDS.filter((id) => id !== provider && canGenerateImages(id));
      throw new HttpsError(
        'deadline-exceeded',
        // The alternative is offered, not advertised: whichever provider is
        // left is not necessarily the faster one, and saying so when it is not
        // just sends the next attempt down the same dead end.
        `تجاوز ${labelOf(provider)} المهلة المسموحة لتوليد الصورة (${Math.round(TIMEOUT_MS / 1000)} ثانية).`
        + (others.length ? ` يمكنك تجربة ${others.map(labelOf).join(' أو ')} من الإعدادات.` : '')
      );
    }
    throw providerError(err, { label: labelOf(provider), envKey: envKeyOf(provider) });
  }
});
