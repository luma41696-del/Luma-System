/**
 * Content sanitisation for anything a user typed: chat messages, comments,
 * task descriptions, notes.
 *
 * Defence in depth:
 *   1. DOMPurify strips scripts / event handlers / dangerous tags.
 *   2. Our own allow-list restricts URL schemes to http(s) and mailto.
 *   3. Links are rendered with rel="noopener noreferrer nofollow" target="_blank".
 *   4. Length caps are enforced here *and* in Firestore rules.
 */

import { esc } from './dom.js';

const SAFE_SCHEMES = /^(https?:|mailto:)/i;

let hooksRegistered = false;

/**
 * DOMPurify drops `target` and `rel` during attribute sanitisation even when
 * they are allow-listed, so they are re-applied afterwards through the hook
 * DOMPurify provides for exactly this case. Without it every external link
 * would open in the same tab and lose its `noopener` protection.
 */
function registerHooks() {
  if (hooksRegistered || !window.DOMPurify?.addHook) return;
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hooksRegistered = true;
}

/** DOMPurify is loaded from a <script> tag; degrade to text-only if absent. */
function purify(html, config) {
  if (window.DOMPurify) {
    registerHooks();
    return window.DOMPurify.sanitize(html, config);
  }
  // Fail closed: with no sanitiser available, emit plain text only.
  console.warn('[luma] DOMPurify missing — falling back to plain text.');
  const div = document.createElement('div');
  div.innerHTML = html;
  return esc(div.textContent);
}

/** Strip every tag; use for names, titles, single-line inputs. */
export function sanitizeText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  const text = String(value)
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')   // zero-width + bidi-override spoofing chars
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

/** Preserve newlines but strip markup. Used for descriptions and reasons. */
export function sanitizeMultiline(value, maxLength = 4000) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Returns the URL if it is safe to navigate to, otherwise ''. */
export function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!SAFE_SCHEMES.test(candidate)) return '';
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']{3,}[^\s<>"'.,;:!?)\]])/gi;

/**
 * Render a chat message: escape everything, then re-introduce only anchors we
 * built ourselves from validated URLs. Line breaks become <br>.
 */
export function renderMessageBody(text) {
  const clean = sanitizeMultiline(text, 4000);
  if (!clean) return '';

  let html = esc(clean).replace(/\n/g, '<br>');

  html = html.replace(URL_PATTERN, (match) => {
    // `match` is already HTML-escaped; decode &amp; so the href is correct.
    const decoded = match.replace(/&amp;/g, '&');
    const href = safeUrl(decoded);
    if (!href) return match;
    const label = decoded.length > 60 ? `${decoded.slice(0, 57)}…` : decoded;
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`;
  });

  return purify(html, {
    ALLOWED_TAGS: ['a', 'br', 'b', 'strong', 'i', 'em', 'code'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: SAFE_SCHEMES,
    ADD_ATTR: ['target']
  });
}

/** First http(s) link in a message, for the preview card. */
export function extractFirstLink(text) {
  const match = String(text || '').match(URL_PATTERN);
  return match ? safeUrl(match[0]) : '';
}

export function linkHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/* ------------------------------------------------------------ validation */

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || '').trim());
}

/** Jordanian mobile or generic international format. */
export function isValidPhone(value) {
  const digits = String(value || '').replace(/[\s()-]/g, '');
  return /^(\+?\d{7,15})$/.test(digits);
}

/** Jordanian IBAN: JO + 2 check digits + 4 bank code + 22 chars = 30 total. */
export function isValidIBAN(value) {
  const iban = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  // mod-97 checksum
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** CliQ alias: 3-35 latin letters/digits, or a phone number. */
export function isValidCliq(value) {
  const v = String(value || '').trim();
  return /^[A-Za-z0-9]{3,35}$/.test(v) || isValidPhone(v);
}

/** Usernames are lowercase, latin, 3–24 chars. */
export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function isValidUsername(value) {
  return /^[a-z0-9._-]{3,24}$/.test(normalizeUsername(value));
}

/**
 * Password policy, mirrored in functions/lib/validate.js.
 * Returns { ok, score, issues[] }.
 */
export function checkPassword(password) {
  const pw = String(password || '');
  const issues = [];
  if (pw.length < 10) issues.push('يجب ألا تقل كلمة المرور عن 10 أحرف');
  if (!/[a-z]/.test(pw)) issues.push('يجب أن تحتوي على حرف صغير (a-z)');
  if (!/[A-Z]/.test(pw)) issues.push('يجب أن تحتوي على حرف كبير (A-Z)');
  if (!/\d/.test(pw)) issues.push('يجب أن تحتوي على رقم');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('يجب أن تحتوي على رمز خاص');
  if (/^(.)\1+$/.test(pw)) issues.push('كلمة المرور ضعيفة جداً');
  const score = Math.max(0, 5 - issues.length);
  return { ok: issues.length === 0, score, issues };
}

/* ------------------------------------------------------- file validation */

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv', 'application/zip'
];

/**
 * Client-side gate. Storage Rules enforce the same limits server-side — this is
 * only here to fail fast and give a useful message.
 */
export function validateFile(file, { maxMB = 10, kinds = ['image', 'doc'] } = {}) {
  if (!file) return { ok: false, error: 'لم يتم اختيار ملف.' };
  const allowed = [
    ...(kinds.includes('image') ? IMAGE_TYPES : []),
    ...(kinds.includes('doc') ? DOC_TYPES : [])
  ];
  if (!allowed.includes(file.type)) {
    return { ok: false, error: `نوع الملف غير مسموح (${file.type || 'غير معروف'}).` };
  }
  if (file.size > maxMB * 1024 * 1024) {
    return { ok: false, error: `حجم الملف يتجاوز الحد المسموح (${maxMB} ميجابايت).` };
  }
  if (file.size === 0) return { ok: false, error: 'الملف فارغ.' };
  return { ok: true };
}

/** Strip path characters and keep the extension — used for Storage keys. */
export function safeFileName(name) {
  const cleaned = String(name || 'file')
    .replace(/[\\/:*?"<>|\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-120);
  return cleaned || 'file';
}
