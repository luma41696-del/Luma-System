/**
 * Reading and changing which model provider the assistants use.
 *
 * The catalog is served rather than duplicated in the browser, so the settings
 * screen always reflects what this server can actually do — including which
 * providers have a key. Picking a provider with no key would otherwise look
 * fine until the next question failed.
 *
 * What is written is a provider id and a model name. Keys are never accepted
 * here, never stored in Firestore, and never returned: they belong to the
 * server environment, and this callable's whole job is to avoid needing a
 * redeploy to switch between them.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { REGION, db, FieldValue } = require('../lib/admin');
const { requireAuth, requirePermission, has } = require('../lib/permissions');
const { str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const {
  AI_SECRETS, CATALOG, isKnownProvider, isProviderConfigured, canGenerateImages,
  labelOf, envKeyOf, describeProviders
} = require('./catalog');
const { getAISettings, invalidateConfigCache } = require('./config');

const opts = { region: REGION, cors: true, secrets: AI_SECRETS };

/**
 * Readable by anyone signed in: which assistant is answering is useful to
 * whoever is asking it questions, and nothing here is a secret — the variable
 * names are already in .env.example, and whether one is set is not sensitive.
 * Changing the pick is a different matter and stays gated below.
 */
exports.getAIConfig = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  // What this caller actually gets, and what everyone gets by default — the
  // screen shows both, so someone can see they are overriding the company pick.
  const [mine, company] = await Promise.all([getAISettings(caller.uid), getAISettings(null)]);

  return {
    providers: describeProviders(),
    current: {
      provider: mine.provider,
      model: mine.model,
      configured: mine.configured,
      // 'personal' when this caller overrode the default, 'company' otherwise.
      source: mine.source,
      // Empty means "no preference" — the server picks by deadline.
      imageProvider: canGenerateImages(mine.imageProvider) ? mine.imageProvider : '',
      // True when the saved pick had no key and something else answered —
      // the screen says so instead of showing a selection that isn't real.
      fellBack: mine.fellBack
    },
    company: {
      provider: company.provider,
      model: company.model,
      configured: company.configured
    },
    canManage: has(caller, 'settings.manage')
  };
});

/**
 * Each person's own assistant, set from their own account.
 *
 * No permission beyond being signed in: this changes only who answers *this*
 * caller, and it grants nothing — the provider must already have a key on the
 * server, which only an operator can add. Passing no provider clears the
 * override and puts them back on the company default.
 */
exports.setMyAIProvider = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  const raw = str(request.data?.provider, { max: 40, field: 'المزوّد' });

  if (!raw) {
    await db.collection('users').doc(caller.uid).set({
      aiPrefs: { provider: FieldValue.delete() }
    }, { merge: true });
    invalidateConfigCache(caller.uid);
    return { provider: null, model: null, source: 'company' };
  }

  if (!isKnownProvider(raw)) throw new HttpsError('invalid-argument', 'مزوّد غير معروف.');
  if (!isProviderConfigured(raw)) {
    throw new HttpsError(
      'failed-precondition',
      `لا يمكن اختيار ${CATALOG[raw].label} — لم يتم ضبط مفتاح ${CATALOG[raw].envKey} على الخادم.`
    );
  }

  const model = str(request.data?.model, { max: 80, field: 'النموذج' }) || CATALOG[raw].defaultModel;

  await db.collection('users').doc(caller.uid).set({
    aiPrefs: { provider: raw, models: { [raw]: model } }
  }, { merge: true });
  invalidateConfigCache(caller.uid);

  return { provider: raw, model, source: 'personal' };
});

/**
 * Which provider draws this person's images.
 *
 * Separate from the conversation provider because they are separate models
 * with separate quotas: one running out says nothing about the other, and the
 * whole point of the setting is switching when one does. Passing nothing
 * clears it and hands the choice back to the server.
 */
exports.setMyImageProvider = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  const raw = str(request.data?.provider, { max: 40, field: 'المزوّد' });

  if (!raw) {
    await db.collection('users').doc(caller.uid).set({
      aiPrefs: { imageProvider: FieldValue.delete() }
    }, { merge: true });
    invalidateConfigCache(caller.uid);
    return { provider: null };
  }

  if (!isKnownProvider(raw)) throw new HttpsError('invalid-argument', 'مزوّد غير معروف.');
  if (!canGenerateImages(raw)) {
    throw new HttpsError(
      'failed-precondition',
      CATALOG[raw].imageModel
        ? `${labelOf(raw)} غير مُفعّل — لم يتم ضبط مفتاح ${envKeyOf(raw)} على الخادم.`
        : `${labelOf(raw)} لا يولّد الصور.`
    );
  }

  await db.collection('users').doc(caller.uid).set({
    aiPrefs: { imageProvider: raw }
  }, { merge: true });
  invalidateConfigCache(caller.uid);

  return { provider: raw };
});

exports.setAIConfig = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'settings.manage');

  const provider = str(request.data?.provider, { max: 40, required: true, field: 'المزوّد' });
  if (!isKnownProvider(provider)) {
    throw new HttpsError('invalid-argument', 'مزوّد غير معروف.');
  }
  if (!isProviderConfigured(provider)) {
    throw new HttpsError(
      'failed-precondition',
      `لا يمكن اختيار ${CATALOG[provider].label} — لم يتم ضبط مفتاح ${CATALOG[provider].envKey} على الخادم.`
    );
  }

  // Free-form on purpose: vendors ship models faster than this catalog is
  // updated, and an operator who knows the exact name should not have to wait
  // for a deploy to use it. An unknown name fails at the provider with a 404
  // that already says so.
  const model = str(request.data?.model, { max: 80, field: 'النموذج' })
    || CATALOG[provider].defaultModel;

  await db.collection('settings').doc('ai').set({
    provider,
    // A real nested map, not a "models.openai" dotted key — dotted paths are
    // only interpreted by update(); set() would take one literally and the
    // config reader would never find it. merge:true deep-merges maps, so the
    // model chosen for each provider survives switching between them.
    models: { [provider]: model },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid
  }, { merge: true });

  invalidateConfigCache();

  await writeAudit({
    action: 'ai.setProvider',
    caller,
    targetId: provider,
    meta: { provider, model }
  });

  return { provider, model };
});
