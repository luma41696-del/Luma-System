/**
 * Which model providers the system can talk to, and what each one needs.
 *
 * The catalog lives only on the server. The browser never gets a copy to keep
 * in sync — it asks `getAIConfig` and renders whatever comes back, so adding a
 * provider here is the whole change.
 *
 * API keys are NOT here and never reach Firestore or the browser. A key is an
 * environment variable on the server; this file only records which variable to
 * look in, so the settings screen can say "Gemini has no key yet" instead of
 * letting someone pick a provider that will fail on the next question.
 */

const CATALOG = {
  openai: {
    label: 'ChatGPT',
    vendor: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    // Image generation is a separate endpoint and a separate model from the
    // one that answers questions, so it is named separately.
    imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini — سريع واقتصادي' },
      { id: 'gpt-4o', label: 'GPT-4o — أقوى' }
    ]
  },

  anthropic: {
    label: 'Claude',
    vendor: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-opus-5',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5 — الأقوى' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — متوازن' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — الأسرع والأرخص' }
    ]
  },

  gemini: {
    label: 'Gemini',
    vendor: 'Google',
    envKey: 'GEMINI_API_KEY',
    envModel: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    imageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — سريع واقتصادي' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — أقوى' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
    ]
  }
};

const PROVIDER_IDS = Object.keys(CATALOG);

/** Every secret name the AI callables may need, for the v2 `secrets` option. */
const AI_SECRETS = PROVIDER_IDS.map((id) => CATALOG[id].envKey);

/** Display name / key name for a provider id, for error messages. */
const labelOf = (id) => CATALOG[id]?.label || id || 'المساعد الذكي';
const envKeyOf = (id) => CATALOG[id]?.envKey || '';

const isKnownProvider = (id) => Object.prototype.hasOwnProperty.call(CATALOG, id);

/**
 * Can this provider draw?
 *
 * Claude does not generate images, and pretending otherwise would surface a
 * button that always fails. The picker asks this rather than assuming every
 * configured provider can do everything.
 */
const canGenerateImages = (id) => !!CATALOG[id]?.imageModel && isProviderConfigured(id);
const imageModelOf = (id) => CATALOG[id]?.imageModel || null;

/** A provider is usable only if its key is actually set on this server. */
function isProviderConfigured(id) {
  const entry = CATALOG[id];
  return !!entry && !!process.env[entry.envKey];
}

/**
 * The catalog as the settings screen needs it — labels, model choices, and
 * whether each provider has a key. Never includes the keys themselves.
 */
function describeProviders() {
  return PROVIDER_IDS.map((id) => ({
    id,
    label: CATALOG[id].label,
    vendor: CATALOG[id].vendor,
    envKey: CATALOG[id].envKey,
    configured: isProviderConfigured(id),
    images: canGenerateImages(id),
    defaultModel: CATALOG[id].defaultModel,
    models: CATALOG[id].models
  }));
}

module.exports = {
  CATALOG,
  PROVIDER_IDS,
  AI_SECRETS,
  isKnownProvider,
  isProviderConfigured,
  labelOf,
  envKeyOf,
  canGenerateImages,
  imageModelOf,
  describeProviders
};
