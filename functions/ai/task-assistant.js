/**
 * The task assistant callable — help with the work on one task, including
 * looking at the images attached to it.
 *
 * Two access questions are answered separately, because they are separate:
 * `tasks.ai` says the caller may use the assistant at all, and the ownership
 * check below says they may use it on *this* task. Holding the permission
 * does not open up every task in the company.
 *
 * Images are chosen by index into the task's own attachments, never by a URL
 * from the browser. A client that could name the URL could point the model at
 * anything reachable on the internet and have the agency's key pay for it.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, REGION } = require('../lib/admin');
const { requireAuth, requirePermission, has } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { AIService } = require('./service');
const { AI_SECRETS } = require('./catalog');
const { assertAIConfigured } = require('./config');
const { enforceRateLimit } = require('./rate-limit');
const { providerError } = require('./errors');

const opts = { region: REGION, cors: true, secrets: AI_SECRETS };

/** Vision costs per image, so a single question cannot ship an album. */
const MAX_IMAGES = 4;

const SYSTEM_PROMPT = `أنت مساعد ذكي داخل نظام إدارة وكالة لوما، تساعد الموظف على إنجاز مهمة محددة معروضة أمامه.

ما تفعله:
- تساعد في التنفيذ: أفكار، صياغة نصوص، مراجعة تصميم أو فيديو، تقسيم المهمة لخطوات، اقتراح قائمة تحقق.
- إذا أُرفقت صور، افحصها فعلياً وأعطِ ملاحظات محددة عليها (تكوين، ألوان، نص، وضوح، أخطاء إملائية) بدل كلام عام.

قواعد:
- اعتمد على تفاصيل المهمة المعطاة لك. لا تخترع معلومات عن العميل أو المواعيد أو الميزانية لم تُذكر لك.
- إذا نقصتك معلومة لازمة، اطلبها بسؤال واحد قصير.
- لا تدّعي أنك تستطيع تعديل المهمة أو حفظ شيء في النظام — أنت للمساعدة والاقتراح فقط.

الأسلوب:
- اكتب بلغة سؤال المستخدم (عربية أو إنجليزية).
- كن موجزاً وعملياً: نقاط قصيرة قابلة للتنفيذ، لا مقدمات ولا مجاملات.`;

const WORK_TYPES = { design: 'تصميم جرافيك', video: 'إنتاج فيديو', other: 'أخرى' };
const STATUSES = {
  new: 'جديدة', assigned: 'مُسندة', inprogress: 'قيد التنفيذ',
  waiting: 'بانتظار', review: 'قيد المراجعة', completed: 'مكتملة', cancelled: 'ملغاة'
};

/** The task, flattened into the few lines the model actually needs. */
function describeTask(task) {
  const lines = [
    `العنوان: ${task.title || '—'}`,
    `الحالة: ${STATUSES[task.status] || task.status || '—'}`
  ];
  if (task.description) lines.push(`الوصف: ${String(task.description).slice(0, 2000)}`);
  if (task.clientName) lines.push(`العميل: ${task.clientName}`);
  if (task.project) lines.push(`المشروع: ${task.project}`);
  if (task.workType && task.workType !== 'other') {
    lines.push(`نوع العمل: ${WORK_TYPES[task.workType] || task.workType}`);
  }
  if (task.imageCount) lines.push(`عدد الصور المطلوبة: ${task.imageCount}`);
  if (task.videoCount) lines.push(`عدد الفيديوهات: ${task.videoCount}`);
  if (task.videoDuration) lines.push(`مدة الفيديو: ${task.videoDuration}`);

  const checklist = Array.isArray(task.checklist) ? task.checklist.slice(0, 20) : [];
  if (checklist.length) {
    lines.push('قائمة التحقق:');
    checklist.forEach((item) => {
      lines.push(`  - [${item.done ? 'x' : ' '}] ${String(item.text || '').slice(0, 200)}`);
    });
  }
  return lines.join('\n');
}

exports.askTaskAssistant = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'tasks.ai');

  const taskId = str(request.data?.taskId, { max: 128, required: true, field: 'المهمة' });
  const question = str(request.data?.question, { max: 1000, required: true, field: 'السؤال' });
  assert(question.length >= 2, 'السؤال قصير جداً.');

  const snap = await db.collection('tasks').doc(taskId).get();
  assert(snap.exists, 'المهمة غير موجودة.');
  const task = snap.data();

  // Re-checked here rather than trusted from the caller: the browser deciding
  // it may read a task is a UI convenience, not an authorisation.
  const mayRead = (task.assignees || []).includes(caller.uid)
    || task.createdBy === caller.uid
    || has(caller, 'tasks.editAll');
  if (!mayRead) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية الوصول إلى هذه المهمة.');
  }

  // Resolved from the stored attachments, so only images already on this task
  // can ever be sent.
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  const requested = Array.isArray(request.data?.imageIndexes) ? request.data.imageIndexes : [];
  const images = requested
    .slice(0, MAX_IMAGES)
    .map((i) => attachments[Number(i)])
    .filter((a) => a && typeof a.url === 'string' && String(a.type || '').startsWith('image/'))
    .map((a) => a.url);

  const rawHistory = Array.isArray(request.data?.history) ? request.data.history : [];
  const history = rawHistory
    .slice(-8)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  // Checked here rather than at the top: someone denied this task should be
  // told that, not that the assistant is unconfigured. Cheap, specific
  // rejections first; the one about server setup last.
  await assertAIConfigured();

  await enforceRateLimit(caller.uid);

  const startedAt = Date.now();
  try {
    const { service, provider, model } = await AIService.fromSettings();
    const result = await service.ask({
      system: SYSTEM_PROMPT,
      history,
      question: `تفاصيل المهمة:\n${describeTask(task)}\n\nسؤال الموظف:\n${question}`,
      images
    });

    await writeAudit({
      action: 'ai.task',
      caller,
      targetId: taskId,
      meta: {
        question: question.slice(0, 300),
        images: images.length,
        provider,
        model,
        durationMs: Date.now() - startedAt,
        success: true
      }
    });

    return { text: result.text, images: images.length, model };
  } catch (err) {
    await writeAudit({
      action: 'ai.task',
      caller,
      targetId: taskId,
      meta: {
        question: question.slice(0, 300),
        images: images.length,
        durationMs: Date.now() - startedAt,
        success: false,
        error: String(err.message || err).slice(0, 300)
      }
    });

    // Provider detail stays in the logs — it can echo back the request.
    console.error('[ai] askTaskAssistant failed', err);
    throw providerError(err);
  }
});
