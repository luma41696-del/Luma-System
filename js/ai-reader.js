/**
 * The in-app reader for a page the assistant cited.
 *
 * A source used to be a link out: you left the app to check whether the answer
 * was sound, and came back to find your place. This fetches the page through
 * the same guarded server-side fetcher the assistant uses and shows its text
 * beside the conversation.
 *
 * Text, not the page. Almost every site refuses to be framed, and the ones
 * that allow it would be running their own scripts inside this app — so what
 * arrives here is prose that has already had its markup stripped on the
 * server, rendered as inert text. The original is one click away for anyone
 * who wants the real thing.
 */

import { $, $$, esc, attr, refreshIcons } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { safeUrl } from './utils/sanitize.js';

let host = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.className = 'reader';
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

const close = () => { if (host) host.hidden = true; };

/**
 * Open a page in the side reader.
 * @param {string} rawUrl
 */
export async function openReader(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) return;

  const panel = ensureHost();
  panel.hidden = false;
  panel.innerHTML = `
    <div class="reader__scrim" data-reader-close></div>
    <aside class="reader__panel" role="dialog" aria-label="قارئ الصفحة">
      <header class="reader__head">
        <button class="icon-btn" data-reader-close aria-label="إغلاق">
          <i data-lucide="x"></i>
        </button>
        <div class="reader__title" id="reader-title">جارٍ الفتح…</div>
        <a class="icon-btn" id="reader-out" href="${attr(url)}" target="_blank"
           rel="noopener noreferrer nofollow" title="افتح في المتصفح">
          <i data-lucide="external-link"></i>
        </a>
      </header>
      <div class="reader__body" id="reader-body">
        <div class="skeleton skeleton--row"></div>
        <div class="skeleton skeleton--row"></div>
        <div class="skeleton skeleton--row"></div>
      </div>
    </aside>`;
  refreshIcons(panel);

  $$('[data-reader-close]', panel).forEach((el) => el.addEventListener('click', close));

  try {
    const page = await callFn('readPage', { url });
    $('#reader-title', panel).textContent = page.title || page.url;
    // Split into paragraphs and escape every one — the server stripped the
    // markup, and nothing here puts any of it back.
    $('#reader-body', panel).innerHTML = `
      <div class="reader__url ltr">${esc(page.url)}</div>
      ${page.text.split('\n').filter((line) => line.trim())
        .map((line) => `<p>${esc(line.trim())}</p>`).join('')}
      ${page.truncated ? `
        <p class="fs-2xs text-muted mt-3">
          <i data-lucide="scissors" class="icon-sm"></i>
          عُرض جزء من الصفحة فقط — افتح الأصل لقراءتها كاملة.
        </p>` : ''}`;
    refreshIcons(panel);
  } catch (err) {
    $('#reader-title', panel).textContent = 'تعذّر الفتح';
    $('#reader-body', panel).innerHTML = `
      <div class="ai-error">
        <i data-lucide="alert-triangle"></i> ${esc(err?.message || 'تعذّر فتح الصفحة.')}
      </div>
      <p class="fs-2xs text-muted mt-3">يمكنك فتحها في المتصفح من الزر أعلاه.</p>`;
    refreshIcons(panel);
  }
}

/**
 * Bound once for the whole app.
 *
 * Citations are re-rendered on every repaint in three different surfaces, so
 * a delegated listener on the document is the only binding that cannot go
 * stale or be forgotten by a new one.
 */
export function initReader() {
  document.addEventListener('click', (e) => {
    const source = e.target.closest('[data-read-url]');
    if (source) { e.preventDefault(); openReader(source.dataset.readUrl); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host && !host.hidden) close();
  });
}
