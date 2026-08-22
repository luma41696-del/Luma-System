/**
 * Image generation — a picture from a description.
 *
 * Two providers can draw and one cannot: Claude has no image model, so the
 * caller is told that plainly instead of being handed a failure from an
 * endpoint that was never going to work. If the person's own provider cannot
 * draw, a configured one that can is used and the answer says which.
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

/** Generation is slower than a chat reply, but Netlify still kills us at 26s. */
const TIMEOUT_MS = Number(process.env.AI_IMAGE_TIMEOUT_MS) || 22_000;

const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);

/* ------------------------------------------------------------- providers */

async function drawWithOpenAI({ apiKey, model, prompt, size }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
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

  // The caller's own provider first; otherwise any configured one that draws.
  const mine = await getAISettings(caller.uid);
  const provider = canGenerateImages(mine.provider)
    ? mine.provider
    : PROVIDER_IDS.find(canGenerateImages);

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
    throw providerError(err, { label: labelOf(provider), envKey: envKeyOf(provider) });
  }
});
