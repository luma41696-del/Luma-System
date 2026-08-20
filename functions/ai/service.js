/**
 * AIService — the seam between the finance assistant and whichever model
 * provider is configured.
 *
 * Nothing above this file knows about OpenAI: adding a Gemini provider later
 * means implementing the same `answer()` contract and registering it here, not
 * touching the accounting code.
 */

const { OpenAIProvider } = require('./provider/openai');
const { AnthropicProvider } = require('./provider/anthropic');
const { GeminiProvider } = require('./provider/gemini');
const { nowContext } = require('./context');
const { getAISettings } = require('./config');
const { CATALOG, isProviderConfigured } = require('./catalog');

const PROVIDERS = {
  openai: (config) => new OpenAIProvider(config),
  anthropic: (config) => new AnthropicProvider(config),
  gemini: (config) => new GeminiProvider(config)
};

/**
 * The assistant's standing instructions.
 *
 * The read-only rule is stated here so refusals read naturally, but it is not
 * what enforces it — there are simply no write tools to call, and every read
 * tool re-checks permissions. A prompt can be argued with; a missing capability
 * cannot.
 */
const SYSTEM_PROMPT = `أنت «المساعد المالي» داخل نظام إدارة وكالة لوما. مهمتك مساعدة المحاسب على فهم البيانات المالية للنظام.

قواعد صارمة:
- لا تخمّن أي رقم مالي أبداً. كل رقم يجب أن يأتي من نتيجة أداة استدعيتها. إن لم تستدعِ أداة، لا تذكر أرقاماً.
- إذا لم توجد بيانات كافية، قل ذلك صراحة، مثل: «لا توجد بيانات مالية كافية لهذه الفترة في النظام». لا تخترع بديلاً.
- أنت للقراءة والتحليل فقط. لا تستطيع إنشاء أو تعديل أو حذف أي سجل مالي. إذا طُلب منك ذلك أجب: «يمكنني مساعدتك في تحليل البيانات، لكن تعديل السجلات المالية غير مفعّل من خلال المساعد الذكي حالياً.»
- إذا رفضت أداةٌ الوصول لعدم توفر صلاحية، اشرح ذلك للمستخدم بوضوح ولا تحاول الالتفاف عليه.
- ميزانيات الإعلانات أموال العميل وليست إيراداً للوكالة — لا تدمجها في الإيرادات أو الأرباح.

أسلوب الإجابة:
- اكتب بلغة سؤال المستخدم (عربية أو إنجليزية).
- كن موجزاً. ابدأ بالرقم أو الخلاصة، ثم سطر أو سطران للشرح.
- العملة دائماً الدينار الأردني (د.أ).
- عند المقارنة اذكر الاتجاه (ارتفاع/انخفاض) والنسبة.
- لا تكرر الجداول التي ستُعرض للمستخدم أصلاً؛ اكتفِ بتفسيرها.`;

class AIService {
  /**
   * @param {object} config
   * @param {string} config.provider  key in PROVIDERS
   * @param {string} config.apiKey
   * @param {string} config.model
   */
  constructor({ provider = 'openai', apiKey, model } = {}) {
    const factory = PROVIDERS[provider];
    if (!factory) throw new Error(`مزوّد الذكاء الاصطناعي غير مدعوم: ${provider}`);
    this.provider = factory({ apiKey, model });
  }

  /** True when at least one provider has a key — something can answer. */
  static isConfigured() {
    return Object.keys(PROVIDERS).some(isProviderConfigured);
  }

  /**
   * Build the provider this caller should get.
   *
   * Async because the choice lives in Firestore rather than the environment:
   * the caller's own preference if they set one, else the company default.
   * Returns the resolved provider and model alongside the service so callers
   * can record in the audit log which model actually answered — with three
   * providers in play, "the AI said" is no longer specific enough to debug.
   *
   * @returns {Promise<{service: AIService, provider: string, model: string}>}
   */
  static async fromSettings(uid = null) {
    const { provider, model, envKey, configured } = await getAISettings(uid);
    if (!configured) {
      const err = new Error(`${envKey} is not configured.`);
      err.missingKey = envKey;
      err.provider = provider;
      throw err;
    }
    return {
      service: new AIService({ provider, apiKey: process.env[envKey], model }),
      provider,
      model
    };
  }

  /** Which environment variable the selected provider needs, for error text. */
  static async missingKeyName(uid = null) {
    const { envKey, provider } = await getAISettings(uid);
    return { envKey, label: CATALOG[provider]?.label || provider };
  }

  /**
   * @param {object} options
   * @param {string} [options.system]  overrides the finance instructions, for
   *                                   an assistant with a different job
   * @param {Array}  [options.images]  image URLs to show with the question
   */
  ask({ question, history = [], tools, runTool, system = SYSTEM_PROMPT, images = [], webSearch = false }) {
    return this.provider.answer({
      // Prepended here rather than in each assistant's prompt: a model with no
      // clock dates things from its training cutoff, and this is the one seam
      // every assistant already passes through, so none can forget it.
      system: `${nowContext()}\n\n${system}`,
      history,
      question,
      images,
      tools,
      runTool,
      webSearch
    });
  }
}

module.exports = { AIService, SYSTEM_PROMPT };
