/**
 * Reading a web page on the assistant's behalf.
 *
 * Search gives the model titles and snippets; this gives it the page. That is
 * the difference between "three results mention Instagram sizes" and being
 * able to quote the one that actually lists them.
 *
 * The address comes from the model, which makes this the most dangerous tool
 * in the system: a server that fetches whatever a language model names can be
 * pointed at the metadata service, at localhost, or at anything else inside
 * the network that has no business being reachable. Every guard below exists
 * for that, and they are applied to each hop of a redirect chain rather than
 * only to the address we were first given.
 */

/** Enough of a page to answer from, without filling the model's context. */
const MAX_CHARS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.AI_FETCH_TIMEOUT_MS) || 8_000;
const MAX_REDIRECTS = 3;

/**
 * Addresses that are never fetched, whatever the model says.
 *
 * Loopback, link-local (which is where cloud metadata lives), and the private
 * ranges. A public name that resolves into one of these still gets through
 * this check — DNS is resolved by fetch, not here — which is why the deploy
 * target matters: on Netlify this runs outside any VPC, so there is no
 * private network for a rebinding trick to reach.
 */
const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal)$/i;
const BLOCKED_IP = new RegExp(
  '^(' +
  '127\\.|0\\.|10\\.|' +                       // loopback, this-network, private
  '169\\.254\\.|' +                            // link-local / cloud metadata
  '192\\.168\\.|' +                            // private
  '172\\.(1[6-9]|2\\d|3[01])\\.|' +            // private 172.16–172.31
  '::1$|^\\[?::1\\]?$|^f[cd]' +                // IPv6 loopback / unique-local
  ')'
);

function assertSafeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('عنوان غير صالح.'); }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('يُسمح بعناوين http/https فقط.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST.test(host) || BLOCKED_IP.test(host)) {
    throw new Error('لا يمكن قراءة عناوين داخلية.');
  }
  return url;
}

/**
 * Strip a document down to its words.
 *
 * Deliberately crude: script and style contents are removed outright rather
 * than parsed, because the goal is text for a model to read, not a faithful
 * rendering. Anything that survives is inert by the time it is returned.
 */
function extractText(html) {
  const withoutCode = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();

  const text = withoutCode
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return { title: title.slice(0, 200), text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
}

/**
 * Follow redirects by hand so every hop is checked.
 *
 * `redirect: 'follow'` would let a public URL bounce to an internal one with
 * nothing looking at the address in between — the check has to run on each
 * destination, not just the first.
 */
async function fetchChecked(startUrl, signal) {
  let url = assertSafeUrl(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url.href, {
      redirect: 'manual',
      signal,
      headers: {
        // Named honestly: a site that would rather not be read by a bot can
        // see what this is and block it.
        'User-Agent': 'LumaAgencyBot/1.0 (+https://luma-agency.internal)',
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5'
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next) throw new Error('إعادة توجيه بلا وجهة.');
      url = assertSafeUrl(new URL(next, url).href);
      continue;
    }
    return { response, finalUrl: url.href };
  }
  throw new Error('عدد كبير من عمليات إعادة التوجيه.');
}

/**
 * @param {string} rawUrl
 * @returns {Promise<{url,title,text,truncated,bytes}>}
 */
async function fetchPage(rawUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { response, finalUrl } = await fetchChecked(rawUrl, controller.signal);

    if (!response.ok) throw new Error(`تعذّر فتح الصفحة (${response.status}).`);

    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) {
      throw new Error('هذا العنوان ليس صفحة نصية.');
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > MAX_BYTES) throw new Error('الصفحة كبيرة جداً.');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('الصفحة كبيرة جداً.');

    const html = buffer.toString('utf8');
    const { title, text, truncated } = extractText(html);
    if (!text) throw new Error('لا يوجد نص قابل للقراءة في هذه الصفحة.');

    return { url: finalUrl, title, text, truncated, bytes: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchPage, assertSafeUrl, extractText };
