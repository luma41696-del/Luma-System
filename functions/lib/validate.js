/**
 * Input validation and small helpers shared by the callables.
 * Everything crossing the trust boundary is validated here, not in the browser.
 */

const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');

/** Internal auth address derived from the username. */
const AUTH_EMAIL_DOMAIN = 'users.luma-agency.internal';

function assert(condition, message, code = 'invalid-argument') {
  if (!condition) throw new HttpsError(code, message);
  return true;
}

function str(value, { max = 500, min = 0, field = 'الحقل', required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    assert(!required, `${field} مطلوب.`);
    return '';
  }
  assert(typeof value === 'string', `${field} يجب أن يكون نصاً.`);
  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // zero-width, bidi-override and control chars
    .trim();
  assert(cleaned.length >= min, `${field} قصير جداً.`);
  return cleaned.slice(0, max);
}

function num(value, { min = -Infinity, max = Infinity, field = 'القيمة' } = {}) {
  const parsed = Number(value);
  assert(Number.isFinite(parsed), `${field} يجب أن يكون رقماً.`);
  assert(parsed >= min && parsed <= max, `${field} خارج النطاق المسموح.`);
  return parsed;
}

function arr(value, { max = 50, field = 'القائمة' } = {}) {
  if (value === undefined || value === null) return [];
  assert(Array.isArray(value), `${field} يجب أن تكون قائمة.`);
  assert(value.length <= max, `${field} تتجاوز الحد المسموح.`);
  return value;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function isValidUsername(value) {
  return /^[a-z0-9._-]{3,24}$/.test(normalizeUsername(value));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || '').trim());
}

function isValidPhone(value) {
  return !value || /^\+?\d[\d\s()-]{6,18}$/.test(String(value).trim());
}

function isValidIBAN(value) {
  const iban = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!iban) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** Map a username to its internal Firebase Auth address. */
function authEmailFor(username) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

/**
 * Cryptographically strong temporary password that always satisfies the
 * password policy (upper, lower, digit, symbol, ≥ 12 chars).
 */
function generateTempPassword(length = 14) {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*?-_+='
  ];
  const all = sets.join('');
  const pick = (chars) => chars[crypto.randomInt(0, chars.length)];

  const characters = sets.map(pick);
  while (characters.length < length) characters.push(pick(all));

  // Fisher–Yates with a CSPRNG so the guaranteed characters are not positional.
  for (let i = characters.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}

/** Mirror of the client-side policy in js/utils/sanitize.js. */
function checkPasswordPolicy(password) {
  const pw = String(password || '');
  return pw.length >= 10 &&
    /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

/** "2026-08-01" in the company timezone. */
function dayKey(date = new Date(), timeZone = 'Asia/Amman') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

module.exports = {
  AUTH_EMAIL_DOMAIN,
  assert,
  str,
  num,
  arr,
  normalizeUsername,
  isValidUsername,
  isValidEmail,
  isValidPhone,
  isValidIBAN,
  authEmailFor,
  generateTempPassword,
  checkPasswordPolicy,
  dayKey
};
