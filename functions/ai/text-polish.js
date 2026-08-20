/**
 * Text-polish callable — fix spelling and improve the wording of a task's
 * title or description while the form is still open.
 *
 * Deliberately not a conversation: no history, no tools, one field's text in,
 * one corrected string back. The result replaces the field in place; nothing
 * is saved until the person presses "إنشاء المهمة" themselves, same as if
 * they had retyped it by hand.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { AIService } = require('./service');
const { AI_SECRETS } = require('./catalog');
const { assertAIConfigured } = require('./config');
const { enforceRateLimit } = require('./rate-limit');
const { providerError } = require('./errors');

const opts = { region: REGION, cors: true, secrets: AI_SECRETS };

const FIELDS = {
  title: { label: 'العنوان', max: 200 },
  description: { label: 'الوصف', max: 4000 }
};

const SYSTEM_PROMPT = `أنت أداة تصحيح وصياغة نصوص داخل نموذج إنشاء مهمة في نظام إدارة وكالة لوما.

قواعد صارمة:
- تُعطى نص حقل واحد فقط ليُصحَّح (عنوان مهمة أو وصفها)، وأحياناً نص الحقل الآخر كسياق إضافي لا أكثر.
- صحّح الأخطاء الإملائية والنحوية، وحسّن الصياغة لتكون واضحة ومهنية.
- لا تغيّر المعنى، ولا تخترع تفاصيل غير موجودة في النص الأصلي — لا عميل ولا تاريخ ولا رقم لم يُذكر.
- إن كان النص عنواناً: أعده عبارة قصيرة واحدة (أقل من 15 كلمة)، بلا نقطة في النهاية، وبلا علامات اقتباس حوله.
- إن كان النص وصفاً: أعده بنفس الطول تقريباً، منظّماً بجمل أو نقاط قصيرة إن كان طويلاً بما يكفي لذلك.
- إن كان النص بلغة غير العربية، صحّحه بنفس تلك اللغة.
- أعد النص المُصحّح فقط، سطراً أو أكثر حسب الحاجة، بلا شرح وبلا مقدمة.`;

exports.polishTaskText = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'tasks.ai');

  const field = request.data?.field === 'description' ? 'description' : 'title';
  const spec = FIELDS[field];
  const text = str(request.data?.text, { max: spec.max, field: spec.label });

  // Nothing worth sending to the model — hand the text straight back rather
  // than spend a request correcting one word or an empty field.
  if (text.trim().length < 2) return { text };

  const otherField = field === 'title' ? 'description' : 'title';
  const otherSpec = FIELDS[otherField];
  const other = str(request.data?.[otherField], { max: otherSpec.max, field: otherSpec.label });

  await assertAIConfigured();

  await enforceRateLimit(caller.uid);

  const startedAt = Date.now();
  try {
    const { service, provider, model } = await AIService.fromSettings();
    const question = other
      ? `الحقل المطلوب تصحيحه (${spec.label}):\n${text}\n\nالحقل الآخر كسياق فقط، لا تُصحّحه (${otherSpec.label}):\n${other}`
      : `الحقل المطلوب تصحيحه (${spec.label}):\n${text}`;

    const result = await service.ask({ system: SYSTEM_PROMPT, question });
    // Models tend to wrap a "corrected title" in quotes even when told not to.
    const polished = result.text.trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, spec.max);

    await writeAudit({
      action: 'ai.polishText',
      caller,
      meta: { field, length: text.length, provider, model, durationMs: Date.now() - startedAt, success: true }
    });

    return { text: polished || text };
  } catch (err) {
    await writeAudit({
      action: 'ai.polishText',
      caller,
      meta: {
        field, length: text.length, durationMs: Date.now() - startedAt,
        success: false, error: String(err.message || err).slice(0, 300)
      }
    });
    console.error('[ai] polishTaskText failed', err);
    throw providerError(err);
  }
});
