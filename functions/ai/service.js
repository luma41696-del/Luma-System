/**
 * AIService — the seam between the finance assistant and whichever model
 * provider is configured.
 *
 * Nothing above this file knows about OpenAI: adding a Gemini provider later
 * means implementing the same `answer()` contract and registering it here, not
 * touching the accounting code.
 */

const { OpenAIProvider } = require('./provider/openai');

const PROVIDERS = {
  openai: (config) => new OpenAIProvider(config)
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

  static isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }

  /** Build from environment. Keeps key handling in exactly one place. */
  static fromEnv() {
    return new AIService({
      provider: process.env.AI_PROVIDER || 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    });
  }

  ask({ question, history = [], tools, runTool }) {
    return this.provider.answer({
      system: SYSTEM_PROMPT,
      history,
      question,
      tools,
      runTool
    });
  }
}

module.exports = { AIService, SYSTEM_PROMPT };
