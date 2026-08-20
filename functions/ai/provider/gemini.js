/**
 * Google provider — Gemini, over the Generative Language API.
 *
 * Same `answer()` contract as the other two drivers. Gemini diverges more than
 * Claude does, and each difference is handled here rather than leaking upward:
 *
 *   - Turns are `contents: [{role, parts}]` with the assistant's role spelled
 *     `model`, not `assistant`.
 *   - Tools are `functionDeclarations`, and its schema dialect rejects
 *     `additionalProperties` — which every shared tool definition carries — so
 *     schemas are cleaned on the way out.
 *   - There is no `stop_reason`; a tool call is simply a `functionCall` part.
 *   - It will not fetch an image URL for you. The other two take a URL; here
 *     the bytes have to be pulled and inlined, which is why images cost an
 *     extra round trip on this provider.
 *
 * The key travels in the `x-goog-api-key` header rather than the `?key=` query
 * parameter the quickstarts use, so it cannot be captured by anything that
 * logs URLs.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_TOOL_ROUNDS = 5;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20_000;

/** Images are inlined into the request body, so they need a sane ceiling. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Room for thinking plus the answer.
 *
 * The 2.5 models think before replying and those tokens count against this
 * same budget, so a ceiling sized for the visible answer alone can be spent
 * entirely on thinking — the call succeeds and comes back with no text in it.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 4096;

class GeminiProvider {
  constructor({ apiKey, model }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
    this.apiKey = apiKey;
    this.model = model || 'gemini-2.5-flash';
  }

  get name() { return 'gemini'; }

  async call(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // Google keys are AIza-prefixed; strip anything key-shaped before this
        // message reaches the audit log.
        const safe = detail.replace(/AIza[A-Za-z0-9_-]+/g, 'AIza***');
        const err = new Error(`Gemini ${response.status}: ${safe.slice(0, 300)}`);
        err.status = response.status;
        err.providerMessage = reasonFrom(safe);
        throw err;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async answer({ system, history, question, images = [], tools, runTool, webSearch = false }) {
    const parts = [{ text: question }];
    for (const url of images) {
      const inline = await fetchInlineImage(url).catch(() => null);
      if (inline) parts.push(inline);
    }

    const contents = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '').slice(0, 4000) }]
      })),
      { role: 'user', parts }
    ];

    const toolsUsed = [];
    let lastData = null;
    let citations = [];
    const steps = [];

    const declarations = (tools || []).map(toGeminiDeclaration);
    let allTools = [
      ...(declarations.length ? [{ functionDeclarations: declarations }] : []),
      ...(webSearch ? [{ googleSearch: {} }] : [])
    ];

    /**
     * Grounding alongside function declarations is not accepted everywhere,
     * and when it is refused the refusal takes the whole answer with it. As on
     * the Claude driver, one 400 with search present is retried without it:
     * losing web results is a far smaller loss than losing the reply.
     */
    const send = () => this.call({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(allTools.length ? { tools: allTools } : {}),
      generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS }
    });

    const hasSearch = () => allTools.some((t) => t.googleSearch);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let result;
      try {
        result = await send();
      } catch (err) {
        if (err?.status !== 400 || !hasSearch()) throw err;
        allTools = allTools.filter((t) => !t.googleSearch);
        steps.push({ kind: 'note', label: 'البحث في الإنترنت غير متاح مع الأدوات لهذا النموذج — تم المتابعة بدونه' });
        result = await send();
      }

      const candidate = result.candidates?.[0];
      const responseParts = candidate?.content?.parts || [];

      const grounding = candidate?.groundingMetadata;
      if (grounding) {
        citations = citations.concat(extractCitations(grounding));
        for (const q of grounding.webSearchQueries || []) {
          if (!toolsUsed.includes('webSearch')) toolsUsed.push('webSearch');
          steps.push({ kind: 'search', label: String(q).slice(0, 160) });
        }
      }

      const calls = responseParts.filter((p) => p.functionCall).map((p) => p.functionCall);
      if (!calls.length) {
        return {
          text: extractText(responseParts, candidate, result), toolsUsed, data: lastData,
          citations: dedupe(citations), steps
        };
      }

      contents.push({ role: 'model', parts: responseParts });

      const replies = [];
      for (const call of calls) {
        let payload;
        try {
          payload = await runTool(call.name, call.args || {});
          toolsUsed.push(call.name);
          steps.push({ kind: 'tool', label: call.name });
          if (payload && typeof payload === 'object') lastData = payload;
        } catch (err) {
          payload = { error: err.message || 'tool failed' };
        }
        replies.push({
          functionResponse: {
            name: call.name,
            // Must be an object; a bare array or scalar is rejected.
            response: { result: truncate(payload) }
          }
        });
      }
      contents.push({ role: 'user', parts: replies });
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

/** Keeps one tool result inside the same budget the other drivers use. */
function truncate(payload) {
  const json = JSON.stringify(payload ?? null);
  if (json.length <= 12_000) return payload;
  return { truncated: true, preview: json.slice(0, 12_000) };
}

/**
 * Gemini's schema dialect is a subset of JSON Schema and rejects unknown
 * keywords outright — `additionalProperties`, which every shared tool
 * definition sets, is a 400 rather than something it ignores.
 */
function cleanSchema(node) {
  if (Array.isArray(node)) return node.map(cleanSchema);
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' || key === '$schema') continue;
    out[key] = cleanSchema(value);
  }
  return out;
}

function toGeminiDeclaration(definition) {
  const schema = cleanSchema(definition.parameters || {});
  const declaration = { name: definition.name, description: definition.description };
  // A parameter-less tool must omit `parameters` entirely — an object schema
  // with no properties is rejected.
  if (schema.properties && Object.keys(schema.properties).length) {
    declaration.parameters = schema;
  }
  return declaration;
}

/**
 * Pull an image and inline it. Only ever called with URLs the callable has
 * already validated as belonging to our own storage bucket.
 */
async function fetchInlineImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!mimeType.startsWith('image/')) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return null;

    return { inlineData: { mimeType, data: buffer.toString('base64') } };
  } finally {
    clearTimeout(timer);
  }
}

function extractCitations(grounding) {
  const found = [];
  for (const chunk of grounding.groundingChunks || []) {
    const web = chunk.web;
    if (web?.uri) found.push({ url: web.uri, title: web.title || web.uri });
  }
  return found;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 12);
}

/**
 * Gemini can return HTTP 200 with nothing in it — the prompt was blocked, or
 * the whole token budget went on thinking. Saying "I could not answer" hides
 * which of those happened, so the reason is named when there is one.
 */
function extractText(parts, candidate = null, result = null) {
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  if (text) return text;

  const blocked = result?.promptFeedback?.blockReason;
  if (blocked) return `رفض النموذج الإجابة على هذا السؤال (${blocked}).`;

  const finish = candidate?.finishReason;
  if (finish === 'MAX_TOKENS') {
    return 'انقطعت الإجابة قبل أن تكتمل — استُهلك حد الإخراج. جرّب سؤالاً أقصر.';
  }
  if (finish && finish !== 'STOP') return `توقّف النموذج قبل الإجابة (${finish}).`;

  return 'لم أتمكن من صياغة إجابة لهذا السؤال.';
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

module.exports = { GeminiProvider };
