/**
 * Which provider is in use right now, and on which model.
 *
 * The choice is a setting, not a deploy: someone with `settings.manage` picks
 * it in the UI and the next question goes to the new provider. It lives in
 * `settings/ai` — a document holding two harmless strings. Keys are not part
 * of the record and never will be; they stay in the server environment, so a
 * leak of the settings document leaks a preference, not an account.
 *
 * Read on every AI call, so it is cached briefly: a Netlify instance handling
 * a burst of questions would otherwise re-read the same document for each one,
 * while a change still takes effect within a minute without a redeploy.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../lib/admin');
const { CATALOG, isKnownProvider, isProviderConfigured } = require('./catalog');

const CACHE_TTL_MS = 60_000;

let cache = { at: 0, value: null };

/** Drops the cache so a save is reflected immediately rather than in a minute. */
function invalidateConfigCache() {
  cache = { at: 0, value: null };
}

async function readSettings() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;

  let stored = {};
  try {
    const snap = await db.collection('settings').doc('ai').get();
    if (snap.exists) stored = snap.data() || {};
  } catch (err) {
    // A settings read failing should not take the assistant down with it —
    // fall back to the environment, which is what ran before this existed.
    console.error('[ai] could not read settings/ai, falling back to env', err);
  }

  cache = { at: now, value: stored };
  return stored;
}

/**
 * The provider actually in effect.
 *
 * Falls back rather than failing: a saved provider whose key was later removed
 * from the server would otherwise break every assistant at once, with an error
 * that points at the model instead of at the missing key. If anything is
 * usable, it is used, and `fellBack` records that the pick was overridden.
 */
function resolveProvider(requested) {
  const candidates = [requested, process.env.AI_PROVIDER, 'openai'];
  for (const id of candidates) {
    if (id && isKnownProvider(id) && isProviderConfigured(id)) {
      return { provider: id, fellBack: !!requested && id !== requested };
    }
  }
  // Nothing has a key. Report the requested one so the error names the
  // variable the operator actually has to set.
  const named = [requested, process.env.AI_PROVIDER].find(isKnownProvider) || 'openai';
  return { provider: named, fellBack: false };
}

/**
 * @returns {Promise<{provider: string, model: string, envKey: string,
 *                    configured: boolean, fellBack: boolean}>}
 */
async function getAISettings() {
  const stored = await readSettings();
  const { provider, fellBack } = resolveProvider(stored.provider);
  const entry = CATALOG[provider];

  const model = (stored.models && stored.models[provider])
    || process.env[entry.envModel]
    || entry.defaultModel;

  return {
    provider,
    model,
    envKey: entry.envKey,
    configured: isProviderConfigured(provider),
    fellBack
  };
}

/**
 * Refuse early, and name the variable an operator actually has to set.
 *
 * "المساعد الذكي غير مُفعّل" on its own sent people hunting through the wrong
 * dashboard once more than one provider existed — with Gemini selected, the
 * missing key is GEMINI_API_KEY, and saying OPENAI_API_KEY is worse than
 * saying nothing.
 *
 * @throws {HttpsError} failed-precondition when the selected provider has no key
 */
async function assertAIConfigured() {
  const { configured, envKey, provider } = await getAISettings();
  if (configured) return;

  const label = CATALOG[provider]?.label || provider;
  throw new HttpsError(
    'failed-precondition',
    `المساعد الذكي غير مُفعّل — المزوّد المختار هو ${label}، ولم يتم ضبط مفتاح ${envKey} على الخادم.`
  );
}

module.exports = { getAISettings, assertAIConfigured, invalidateConfigCache };
