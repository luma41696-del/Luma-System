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

/**
 * Give up before the platform does.
 *
 * On Netlify the handler is killed at 26s (netlify.toml [functions.api]); a
 * 45s ceiling here could therefore never fire, so a slow answer was killed
 * mid-flight and surfaced as an opaque platform error instead of the timeout
 * message this code takes care to produce. 20s leaves room for the auth
 * check, the task read and the audit write inside that budget.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20_000;

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
   * @param {boolean}  [options.webSearch]   let the model search the web
   * @returns {{text: string, toolsUsed: string[], data: object|null, citations: object[]}}
   */
  async answer({ system, history, question, images = [], tools, runTool, webSearch = false }) {
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
    let citations = [];

    // Web search is run by OpenAI, not by us: it comes back already folded
    // into the answer, so it needs no branch in the loop below — only to be
    // listed alongside our own tools.
    const allTools = [
      ...(tools || []),
      ...(webSearch ? [{ type: WEB_SEARCH_TOOL }] : [])
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await this.call({
        model: this.model,
        instructions: system,
        input,
        // Omitted entirely for a caller with no tools — sending `tool_choice`
        // with an empty tool list is rejected.
        ...(allTools.length ? { tools: allTools, tool_choice: 'auto' } : {}),
        // Deterministic-ish: this is a reporting assistant, not a writing one.
        temperature: 0.2,
        max_output_tokens: 1200
      });

      const output = Array.isArray(result.output) ? result.output : [];
      const calls = output.filter((item) => item.type === 'function_call');

      // Collected every round: a later round's answer can cite pages found in
      // an earlier one.
      citations = citations.concat(extractCitations(output));
      if (output.some((item) => String(item.type || '').startsWith('web_search'))) {
        if (!toolsUsed.includes('webSearch')) toolsUsed.push('webSearch');
      }

      if (!calls.length) {
        return { text: extractText(result, output), toolsUsed, data: lastData, citations: dedupe(citations) };
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
      data: lastData,
      citations: dedupe(citations)
    };
  }
}

/**
 * The built-in search tool's name.
 *
 * Kept configurable because OpenAI has renamed it before
 * (`web_search_preview` → `web_search`) and which one an account accepts
 * depends on its model. A rename should be an environment change, not a
 * redeploy of this file.
 */
const WEB_SEARCH_TOOL = process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search';

/**
 * Pages the answer was built from.
 *
 * Surfaced rather than kept internal: the whole point of showing sources is
 * that a person can check what the model actually read before they save it
 * into the system.
 */
function extractCitations(output) {
  const found = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const chunk of item.content || []) {
      for (const note of chunk.annotations || []) {
        if (note.url) found.push({ url: note.url, title: note.title || note.url });
      }
    }
  }
  return found;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 12);
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
