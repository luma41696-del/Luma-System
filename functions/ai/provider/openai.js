/**
 * OpenAI provider — the only place in the codebase that knows OpenAI exists.
 *
 * Speaks the Responses API and drives the tool-calling loop: the model asks for
 * a tool, we run it, hand back the result, and repeat until it answers. The
 * loop is bounded — a model that keeps requesting tools would otherwise spend
 * money indefinitely.
 *
 * Node 20 has global fetch, so this needs no SDK and nothing extra to bundle.
 */

const ENDPOINT = 'https://api.openai.com/v1/responses';

/** Hard ceiling on tool round-trips for a single question. */
const MAX_TOOL_ROUNDS = 5;
const REQUEST_TIMEOUT_MS = 45_000;

class OpenAIProvider {
  constructor({ apiKey, model }) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
  }

  get name() { return 'openai'; }

  async call(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // The key must never reach a log or a client. OpenAI masks the middle
        // of it in auth errors but still echoes the first and last characters
        // ("sk-abcd****wxyz"), and this message ends up in the audit trail —
        // so anything key-shaped is stripped before it travels any further.
        const safe = detail.replace(/sk-[A-Za-z0-9_*-]+/g, 'sk-***');
        const err = new Error(`OpenAI ${response.status}: ${safe.slice(0, 300)}`);
        err.status = response.status;
        throw err;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run one question to completion.
   *
   * @param {object}   options
   * @param {string}   options.system        system instructions
   * @param {Array}    options.history       prior turns [{role, content}]
   * @param {string}   options.question
   * @param {Array}    [options.images]      image URLs to show alongside the question
   * @param {Array}    [options.tools]       Responses-API tool definitions
   * @param {Function} [options.runTool]     (name, args) => Promise<any>
   * @returns {{text: string, toolsUsed: string[], data: object|null}}
   */
  async answer({ system, history, question, images = [], tools, runTool }) {
    // With images the question becomes a content array rather than a string;
    // without them it stays a plain string, so the text-only callers are
    // untouched.
    const userContent = images.length
      ? [
        { type: 'input_text', text: question },
        ...images.map((url) => ({ type: 'input_image', image_url: url }))
      ]
      : question;

    const input = [
      ...history.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
      { role: 'user', content: userContent }
    ];

    const toolsUsed = [];
    // The payload behind the last tool call is handed to the UI so figures are
    // rendered from computed data rather than re-read out of the model's prose.
    let lastData = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await this.call({
        model: this.model,
        instructions: system,
        input,
        // Omitted entirely for a caller with no tools — sending `tool_choice`
        // with an empty tool list is rejected.
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
        // Deterministic-ish: this is a reporting assistant, not a writing one.
        temperature: 0.2,
        max_output_tokens: 1200
      });

      const output = Array.isArray(result.output) ? result.output : [];
      const calls = output.filter((item) => item.type === 'function_call');

      if (!calls.length) {
        return { text: extractText(result, output), toolsUsed, data: lastData };
      }

      // Echo the calls back, then append each result, exactly as the
      // Responses API expects for the next turn.
      input.push(...calls);

      for (const call of calls) {
        let payload;
        try {
          const args = call.arguments ? JSON.parse(call.arguments) : {};
          payload = await runTool(call.name, args);
          toolsUsed.push(call.name);
          if (payload && typeof payload === 'object') lastData = payload;
        } catch (err) {
          payload = { error: err.message || 'tool failed' };
        }
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(payload).slice(0, 12_000)
        });
      }
    }

    return {
      text: 'تعذّر إكمال الإجابة — تم تجاوز الحد المسموح من الاستعلامات لسؤال واحد. جرّب سؤالاً أكثر تحديداً.',
      toolsUsed,
      data: lastData
    };
  }
}

/** The Responses API exposes `output_text`, but not on every shape. */
function extractText(result, output) {
  if (typeof result.output_text === 'string' && result.output_text.trim()) {
    return result.output_text.trim();
  }
  const parts = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const chunk of item.content || []) {
      if (chunk.type === 'output_text' && chunk.text) parts.push(chunk.text);
    }
  }
  return parts.join('\n').trim() || 'لم أتمكن من صياغة إجابة لهذا السؤال.';
}

module.exports = { OpenAIProvider };
