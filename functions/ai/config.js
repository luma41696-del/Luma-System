/**
 * Which provider answers this person, on which model.
 *
 * Two layers. Everyone may pick their own assistant from their own account —
 * stored on their user document as `aiPrefs`, the same class of personal
 * preference as `theme`. Whoever has not picked gets the company default,
 * which someone with `settings.manage` sets in `settings/ai`.
 *
 * Neither layer holds a key. Both hold a provider name and a model name; the
 * keys stay in the server environment, so a preference someone writes cannot
 * grant them anything — at worst it names a provider this server cannot use,
 * and the resolver falls back rather than failing.
 *
 * Read on every AI call, so both layers are cached briefly: a burst of
 * questions would otherwise re-read the same two documents each time, while a
 * change still takes effect within a minute.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../lib/admin');
const { CATALOG, isKnownProvider, isProviderConfigured } = require('./catalog');

const CACHE_TTL_MS = 60_000;

let companyCache = { at: 0, value: null };
/** uid -> {at, value}. Bounded below so one busy instance cannot grow forever. */
const userCache = new Map();
const USER_CACHE_MAX = 200;

function invalidateConfigCache(uid = null) {
  if (uid) userCache.delete(uid);
  else { companyCache = { at: 0, value: null }; userCache.clear(); }
}

async function readCompany() {
  const now = Date.now();
  if (companyCache.value && now - companyCache.at < CACHE_TTL_MS) return companyCache.value;

  let stored = {};
  try {
    const snap = await db.collection('settings').doc('ai').get();
    if (snap.exists) stored = snap.data() || {};
  } catch (err) {
    // A settings read failing should not take the assistants down with it —
    // fall back to the environment, which is what ran before this existed.
    console.error('[ai] could not read settings/ai, falling back to env', err);
  }

  companyCache = { at: now, value: stored };
  return stored;
}

async function readUser(uid) {
  if (!uid) return {};
  const now = Date.now();
  const hit = userCache.get(uid);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;

  let prefs = {};
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) prefs = snap.data()?.aiPrefs || {};
  } catch (err) {
    // Someone's preference failing to load just means they get the company
    // default for this call, which is the same as not having set one.
    console.error('[ai] could not read aiPrefs', uid, err);
  }

  if (userCache.size >= USER_CACHE_MAX) userCache.clear();
  userCache.set(uid, { at: now, value: prefs });
  return prefs;
}

/**
 * The image model for whichever layer supplied the image provider.
 *
 * A personal pick brings its own model; falling back to the company provider
 * means falling back to the company's model for it too, so nobody inherits a
 * model that was chosen for a different vendor.
 */
function imageModelFor(personal, company) {
  if (personal.imageProvider) {
    return personal.imageModels?.[personal.imageProvider]
      || company.imageModels?.[personal.imageProvider]
      || null;
  }
  if (company.imageProvider) return company.imageModels?.[company.imageProvider] || null;
  return null;
}

/**
 * First provider in the chain that this server can actually use.
 *
 * Falls back rather than failing at every level: a provider someone chose
 * before its key was removed would otherwise break their assistant with an
 * error naming the model instead of the missing key.
 */
function resolveProvider(chain) {
  for (const id of chain) {
    if (id && isKnownProvider(id) && isProviderConfigured(id)) return id;
  }
  return null;
}

/**
 * @param {string|null} uid  whose preference to honour; null for the company default
 * @returns {Promise<{provider, model, envKey, configured, source, fellBack}>}
 *          `source` is 'personal' or 'company' — which layer supplied the pick.
 */
async function getAISettings(uid = null) {
  const [company, personal] = await Promise.all([readCompany(), readUser(uid)]);

  const wanted = personal.provider || company.provider || process.env.AI_PROVIDER || 'openai';
  const provider = resolveProvider([
    personal.provider, company.provider, process.env.AI_PROVIDER, 'openai'
  ]);

  // Nothing has a key. Report what was asked for, so the error names the
  // variable an operator actually has to set.
  if (!provider) {
    const named = isKnownProvider(wanted) ? wanted : 'openai';
    return {
      provider: named, model: CATALOG[named].defaultModel, envKey: CATALOG[named].envKey,
      configured: false,
      imageProvider: personal.imageProvider || company.imageProvider || null,
      companyImageProvider: company.imageProvider || null,
      imageModel: imageModelFor(personal, company),
      source: personal.provider ? 'personal' : 'company', fellBack: false
    };
  }

  const entry = CATALOG[provider];
  const source = personal.provider === provider ? 'personal' : 'company';

  // The model follows whichever layer supplied the provider, so a personal
  // pick does not silently inherit the company's model for a different vendor.
  const model = (source === 'personal' && personal.models?.[provider])
    || company.models?.[provider]
    || process.env[entry.envModel]
    || entry.defaultModel;

  return {
    provider,
    model,
    envKey: entry.envKey,
    configured: true,
    // Drawing is a separate choice from conversing — different models, and
    // often a different quota. Personal overrides company, same as the chat
    // pick. Returned raw; image.js decides whether either is usable.
    imageProvider: personal.imageProvider || company.imageProvider || null,
    companyImageProvider: company.imageProvider || null,
    imageModel: imageModelFor(personal, company),
    source,
    // True when a saved pick could not be honoured and something else answered.
    fellBack: !!wanted && wanted !== provider
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
 * @throws {HttpsError} failed-precondition when no usable provider has a key
 */
async function assertAIConfigured(uid = null) {
  const { configured, envKey, provider } = await getAISettings(uid);
  if (configured) return;

  const label = CATALOG[provider]?.label || provider;
  throw new HttpsError(
    'failed-precondition',
    `المساعد الذكي غير مُفعّل — المزوّد المختار هو ${label}، ولم يتم ضبط مفتاح ${envKey} على الخادم.`
  );
}

module.exports = { getAISettings, assertAIConfigured, invalidateConfigCache };
