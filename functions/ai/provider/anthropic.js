/**
 * Anthropic provider — Claude, over the Messages API.
 *
 * Implements the same `answer()` contract as the OpenAI driver, so nothing
 * above the provider layer knows which model answered. The differences from
 * OpenAI that actually matter are handled here:
 *
 *   - Tools are `{name, description, input_schema}`, not the flat Responses
 *     shape, and a tool round-trip is `stop_reason: "tool_use"` → echo the
 *     assistant content back → reply with `tool_result` blocks.
 *   - `max_tokens` is required rather than optional.
 *   - Sampling parameters are gone. `temperature` returns a 400 on Opus 5,
 *     Sonnet 5 and the 4.7/4.8 family, so this driver never sends one — the
 *     determinism the finance assistant wants comes from its prompt and from
 *     answering out of tool results, not from a sampling knob.
 *   - Thinking is on by default on current models and its tokens count against
 *     `max_tokens`, so the ceiling here is well above the ~1200 tokens of
 *     answer we actually want back.
 *
 * Raw fetch rather than the SDK, matching the OpenAI driver beside it: these
 * functions are bundled by esbuild for Netlify's free tier, and Node 20's
 * global fetch keeps the bundle to the code that is actually ours.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Hard ceiling on tool round-trips for a single question. */
const MAX_TOOL_ROUNDS = 5;

/** Matches the OpenAI driver: Netlify kills the handler at 26s. */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20_000;

/**
 * Room for thinking plus the answer. Thinking is billed and counted inside
 * `max_tokens`, so the ~1200 tokens of Arabic we want back needs a much
 * larger ceiling or the reply is truncated mid-sentence.
 */
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096;

/**
 * Effort governs how much the model thinks before answering. `low` is the
 * default here deliberately: these assistants summarise data a tool already
 * computed, and the whole exchange has to finish inside the 20s budget above.
 */
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';

/**
 * Not every Claude model accepts the same request.
 *
 * `output_config.effort` and the dated 2026 search tool are only understood by
 * the current generation; Haiku 4.5 rejects the effort field outright and
 * takes the older search variant. Sending them regardless is a 400 on a
 * perfectly ordinary question — which is exactly what happened when this
 * driver shipped assuming every model in the picker behaved like Opus 5.
 *
 * An unrecognised name (someone typing their own model) gets the conservative
 * shape: no effort, basic search. Being slightly less tuned beats not working.
 */
const MODERN = /^claude-(?:fable-5|mythos-5|opus-(?:5|4-[678])|sonnet-(?:5|4-6))/;

function capabilities(model) {
  const modern = MODERN.test(String(model || ''));
  return {
    effort: modern,
    searchTool: process.env.ANTHROPIC_WEB_SEARCH_TOOL
      || (modern ? 'web_search_20260209' : 'web_search_20250305')
  };
}

class AnthropicProvider {
  constructor({ apiKey, model }) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
    this.apiKey = apiKey;
    this.model = model || 'claude-opus-5';
  }

  get name() { return 'anthropic'; }

  async call(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // Same guard as the OpenAI driver: this message reaches the audit log,
        // and a rejected key can be echoed back inside the provider's error.
        const safe = detail.replace(/sk-[A-Za-z0-9_*-]+/g, 'sk-***');
        const err = new Error(`Anthropic ${response.status}: ${safe.slice(0, 300)}`);
        err.status = response.status;
        err.providerMessage = reasonFrom(safe);
        throw err;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run one question to completion. Same signature and return shape as the
   * OpenAI provider — see its docblock for the contract.
   */
  async answer({ system, history, question, images = [], tools, runTool, webSearch = false }) {
    const userContent = images.length
      ? [
        { type: 'text', text: question },
        // Claude takes a URL source directly, so the image never has to be
        // pulled through this function and re-encoded.
        ...images.map((url) => ({ type: 'image', source: { type: 'url', url } }))
      ]
      : question;

    const messages = [
      ...history.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
      { role: 'user', content: userContent }
    ];

    const toolsUsed = [];
    let lastData = null;
    let citations = [];
    const steps = [];

    const caps = capabilities(this.model);
    const allTools = [
      ...(tools || []).map(toAnthropicTool),
      ...(webSearch ? [{ type: caps.searchTool, name: 'web_search', max_uses: 5 }] : [])
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await this.call({
        model: this.model,
        system,
        messages,
        max_tokens: MAX_TOKENS,
        ...(caps.effort ? { output_config: { effort: EFFORT } } : {}),
        ...(allTools.length ? { tools: allTools } : {})
      });

      const content = Array.isArray(result.content) ? result.content : [];

      citations = citations.concat(extractCitations(content));
      for (const block of content) {
        if (block.type !== 'server_tool_use' || block.name !== 'web_search') continue;
        if (!toolsUsed.includes('webSearch')) toolsUsed.push('webSearch');
        const q = block.input?.query || null;
        steps.push({ kind: 'search', label: q ? String(q).slice(0, 160) : null });
      }

      const calls = content.filter((block) => block.type === 'tool_use');
      if (!calls.length) {
        return { text: extractText(content), toolsUsed, data: lastData, citations: dedupe(citations), steps };
      }

      // Echoed back whole and unedited — thinking blocks included, which the
      // API requires when continuing a turn on the same model.
      messages.push({ role: 'assistant', content });

      const results = [];
      for (const call of calls) {
        let payload;
        let isError = false;
        try {
          payload = await runTool(call.name, call.input || {});
          toolsUsed.push(call.name);
          steps.push({ kind: 'tool', label: call.name });
          if (payload && typeof payload === 'object') lastData = payload;
        } catch (err) {
          payload = { error: err.message || 'tool failed' };
          isError = true;
        }
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(payload).slice(0, 12_000),
          ...(isError ? { is_error: true } : {})
        });
      }
      // Every result goes back in one user message; splitting them teaches the
      // model to stop asking for tools in parallel.
      messages.push({ role: 'user', content: results });
    }

    return {
      text: 'تعذّر إكمال الإجابة — تم تجاوز الحد المسموح من الاستعلامات لسؤال واحد. جرّب سؤالاً أكثر تحديداً.',
      toolsUsed,
      data: lastData,
      citations: dedupe(citations),
      steps
    };
  }
}

/** The shared flat tool shape → Claude's `input_schema` form. */
function toAnthropicTool(definition) {
  return {
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters || { type: 'object', properties: {} }
  };
}

/**
 * Pages the answer cited. Claude attaches these to the text blocks themselves
 * rather than returning a separate list.
 */
function extractCitations(content) {
  const found = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    for (const note of block.citations || []) {
      if (note.url) found.push({ url: note.url, title: note.title || note.url });
    }
  }
  return found;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 12);
}

function extractText(content) {
  const parts = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) parts.push(block.text);
  }
  return parts.join('\n').trim() || 'لم أتمكن من صياغة إجابة لهذا السؤال.';
}

/**
 * The provider's own description of what it disliked.
 *
 * Kept short and key-redacted, then handed to the caller so the person reading
 * the error learns the actual reason instead of a guess. "Try a smaller image"
 * is a poor answer to a text-only question that was rejected for an unsupported
 * parameter.
 */
function reasonFrom(detail) {
  try {
    const parsed = JSON.parse(detail);
    const message = parsed?.error?.message || parsed?.error?.[0]?.message || parsed?.message;
    if (message) return String(message).slice(0, 200);
  } catch { /* not JSON — fall through to the raw text */ }
  return String(detail || '').slice(0, 200);
}

module.exports = { AnthropicProvider };
