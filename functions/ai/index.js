/**
 * The AI Accountant callable.
 *
 * Flow: auth → permission → rate limit → validate → AIService (which drives
 * the tool loop) → audit. The browser never talks to OpenAI, and the API key
 * exists only in this process's environment.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { AIService } = require('./service');
const { DEFINITIONS, runTool } = require('./tools');
const { enforceRateLimit } = require('./rate-limit');
const { providerError } = require('./errors');

// The key is read from the environment, never from source. Declaring it in
// `secrets` makes Cloud Functions mount it and keeps it out of the build.
const opts = { region: REGION, cors: true, secrets: ['OPENAI_API_KEY'] };

exports.askAccountant = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.ai');

  if (!AIService.isConfigured()) {
    throw new HttpsError(
      'failed-precondition',
      'المساعد الذكي غير مُفعّل — لم يتم ضبط مفتاح OPENAI_API_KEY على الخادم.'
    );
  }

  const question = str(request.data?.question, { max: 1000, required: true, field: 'السؤال' });
  assert(question.length >= 2, 'السؤال قصير جداً.');

  // Only the recent turns travel, and only their text — enough for follow-ups
  // like "ومتى أقرب فاتورة؟" without shipping the whole conversation.
  const rawHistory = Array.isArray(request.data?.history) ? request.data.history : [];
  const history = rawHistory
    .slice(-8)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  await enforceRateLimit(caller.uid);

  const startedAt = Date.now();
  let toolsUsed = [];

  try {
    const service = AIService.fromEnv();
    const result = await service.ask({
      question,
      history,
      tools: DEFINITIONS,
      runTool: (name, args) => runTool(caller, name, args)
    });
    toolsUsed = result.toolsUsed || [];

    await writeAudit({
      action: 'ai.query',
      caller,
      meta: {
        // The question is recorded for review; the key never is.
        question: question.slice(0, 300),
        tools: toolsUsed,
        toolCount: toolsUsed.length,
        durationMs: Date.now() - startedAt,
        success: true
      }
    });

    return {
      text: result.text,
      toolsUsed,
      data: result.data || null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    };
  } catch (err) {
    await writeAudit({
      action: 'ai.query',
      caller,
      meta: {
        question: question.slice(0, 300),
        tools: toolsUsed,
        durationMs: Date.now() - startedAt,
        success: false,
        error: String(err.message || err).slice(0, 300)
      }
    });

    // Upstream detail (including anything echoed back by the provider) stays
    // in the logs rather than going to the browser.
    console.error('[ai] askAccountant failed', err);
    throw providerError(err);
  }
});
