/**
 * Interface language: Arabic (default, RTL) or English (LTR).
 *
 * The whole UI is authored with logical CSS properties (see css/rtl.css), so
 * flipping `dir` is enough for layout — no per-page mirroring needed.
 *
 * Switching language reloads the page rather than re-rendering live: every
 * page module already re-renders its own DOM from scratch on each route
 * change, so a reload reaches the same end state with far less code than
 * teaching every render function to react to a language-change event.
 */

import { STRINGS } from '../i18n/strings.js';

const LANG_KEY = 'luma.lang';
const DEFAULT_LANG = 'ar';

export function getLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* private mode */ }
  return DEFAULT_LANG;
}

export function isRTL(lang = getLang()) {
  return lang !== 'en';
}

/** Set `lang`/`dir` on <html>. Called on every page before first paint. */
export function applyLangAttrs(lang = getLang()) {
  document.documentElement.lang = lang;
  document.documentElement.dir = isRTL(lang) ? 'rtl' : 'ltr';
}

export function setLang(lang) {
  if (lang !== 'ar' && lang !== 'en') return;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
  location.reload();
}

/**
 * Translate a key for the current language. Falls back to Arabic, then to
 * the key itself — so a missing English string shows up as a readable stub
 * instead of a blank space.
 * `vars` fills in `{placeholders}` for the handful of dynamic strings.
 */
export function t(key, vars) {
  const lang = getLang();
  let str = STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG]?.[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) str = str.replaceAll(`{${name}}`, value);
  }
  return str;
}

/**
 * Apply translations to static markup via data-i18n attributes:
 *   data-i18n="key"              → textContent
 *   data-i18n-html="key"         → innerHTML (only for the handful of strings with a <br>)
 *   data-i18n-placeholder="key"  → placeholder
 *   data-i18n-aria-label="key"   → aria-label
 *   data-i18n-title="key"        → title
 * This covers index.html / dashboard.html, which ship as plain HTML with no
 * render pass of their own.
 */
export function applyStaticI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((node) => { node.innerHTML = t(node.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.dataset.i18nTitle));
  });
}
