/**
 * Arabic-first formatting: dates, durations, money, relative times.
 * Every day-boundary calculation is done in the company timezone (Asia/Amman)
 * rather than the browser's, so "today" means the same thing for everyone.
 */

import { TIMEZONE } from '../firebase-config.js';

export const AR_MONTHS = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
];

export const AR_MONTHS_SHORT = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

/** Week starts on Sunday, as is standard in Jordan. */
export const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const AR_DAYS_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

/* --------------------------------------------------------- date coercion */

/** Accepts a Firestore Timestamp, Date, millis number or ISO string. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(value);
  return isNaN(parsed) ? null : parsed;
}

export function toMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

/* ----------------------------------------------------- timezone helpers */

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

/** "2026-08-01" in company time — the key used for daily aggregation. */
export function dayKey(value = new Date()) {
  const date = toDate(value) || new Date();
  return dayKeyFmt.format(date);
}

export function isSameDay(a, b) {
  const da = toDate(a), dbv = toDate(b);
  return !!da && !!dbv && dayKey(da) === dayKey(dbv);
}

export function isToday(value) {
  return isSameDay(value, new Date());
}

/** Local midnight for the given date (browser tz — used for calendar grids). */
export function startOfDay(value = new Date()) {
  const date = new Date(toDate(value) || Date.now());
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value = new Date()) {
  const date = startOfDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/** Sunday-based week start. */
export function startOfWeek(value = new Date()) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

export function endOfWeek(value = new Date()) {
  const date = startOfWeek(value);
  date.setDate(date.getDate() + 6);
  return endOfDay(date);
}

export function startOfMonth(value = new Date()) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

export function endOfMonth(value = new Date()) {
  const date = startOfMonth(value);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return endOfDay(date);
}

export function startOfYear(value = new Date()) {
  const date = startOfDay(value);
  date.setMonth(0, 1);
  return date;
}

export function addDays(value, days) {
  const date = new Date(toDate(value) || Date.now());
  date.setDate(date.getDate() + days);
  return date;
}

/* ------------------------------------------------------------ formatting */

/** "١ آب ٢٠٢٦" style but with latin digits: "1 آب 2026". */
export function formatDate(value, { withYear = true, short = false } = {}) {
  const date = toDate(value);
  if (!date) return '—';
  const months = short ? AR_MONTHS_SHORT : AR_MONTHS;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const day = get('day'), month = get('month'), year = get('year');
  return `${day} ${months[month - 1]}${withYear ? ` ${year}` : ''}`;
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDate(date)} · ${formatTime(date)}`;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' });

/** Weekday index (0 = Sunday) in company time. */
export function weekdayIndex(value) {
  const date = toDate(value);
  if (!date) return 0;
  return WEEKDAY_INDEX[weekdayFmt.format(date)] ?? date.getDay();
}

export function formatDayName(value, short = false) {
  const date = toDate(value);
  if (!date) return '—';
  return (short ? AR_DAYS_SHORT : AR_DAYS)[weekdayIndex(date)];
}

/** Value for <input type="date">. */
export function toDateInput(value) {
  const date = toDate(value);
  if (!date) return '';
  return dayKey(date);
}

/** Value for <input type="datetime-local"> in company time. */
export function toDateTimeInput(value) {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const RELATIVE_UNITS = [
  [60_000, 'ثانية', 1000],
  [3_600_000, 'دقيقة', 60_000],
  [86_400_000, 'ساعة', 3_600_000],
  [604_800_000, 'يوم', 86_400_000]
];

/** "قبل 5 دقائق" / "بعد 3 أيام" */
export function timeAgo(value) {
  const date = toDate(value);
  if (!date) return '—';
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff >= 0 ? 'الآن' : 'بعد لحظات';

  let amount, unit;
  const found = RELATIVE_UNITS.find(([limit]) => abs < limit);
  if (found) { amount = Math.round(abs / found[2]); unit = found[1]; }
  else if (abs < 2_592_000_000) { amount = Math.round(abs / 604_800_000); unit = 'أسبوع'; }
  else if (abs < 31_536_000_000) { amount = Math.round(abs / 2_592_000_000); unit = 'شهر'; }
  else { amount = Math.round(abs / 31_536_000_000); unit = 'سنة'; }

  const plural = pluralAr(amount, unit);
  return diff >= 0 ? `قبل ${plural}` : `بعد ${plural}`;
}

/** Arabic dual/plural agreement for the small set of units we use. */
export function pluralAr(count, unit) {
  const forms = {
    'ثانية': ['ثانية', 'ثانيتين', 'ثوانٍ', 'ثانية'],
    'دقيقة': ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'],
    'ساعة':  ['ساعة', 'ساعتين', 'ساعات', 'ساعة'],
    'يوم':   ['يوم', 'يومين', 'أيام', 'يوماً'],
    'أسبوع': ['أسبوع', 'أسبوعين', 'أسابيع', 'أسبوعاً'],
    'شهر':   ['شهر', 'شهرين', 'أشهر', 'شهراً'],
    'سنة':   ['سنة', 'سنتين', 'سنوات', 'سنة'],
    'مهمة':  ['مهمة', 'مهمتين', 'مهام', 'مهمة'],
    'موظف':  ['موظف', 'موظفين', 'موظفين', 'موظفاً']
  };
  const f = forms[unit] || [unit, unit, unit, unit];
  if (count === 1) return f[0];
  if (count === 2) return f[1];
  if (count >= 3 && count <= 10) return `${count} ${f[2]}`;
  return `${count} ${f[3]}`;
}

/** "2 س 35 د" — compact duration for break timers and time-spent. */
export function formatDuration(ms, { compact = true } = {}) {
  if (!ms || ms < 0) return compact ? '0 د' : '00:00';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!compact) {
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (hours && minutes) return `${hours} س ${minutes} د`;
  if (hours) return `${hours} س`;
  return `${minutes} د`;
}

/** Live stopwatch display HH:MM:SS. */
export function formatStopwatch(ms) {
  return formatDuration(ms, { compact: false });
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export function formatMoney(value, currency = 'JOD') {
  const amount = Number(value) || 0;
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(amount)} ${currency === 'JOD' ? 'د.أ' : currency}`;
}

export function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Mask all but the last 4 characters — for IBANs shown without permission. */
export function maskTail(value, visible = 4) {
  const str = String(value || '');
  if (str.length <= visible) return '•'.repeat(str.length);
  return '•'.repeat(Math.min(str.length - visible, 16)) + str.slice(-visible);
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('');
}

/** Days between two dates, inclusive of both ends. */
export function daysBetween(from, to) {
  const a = startOfDay(from), b = startOfDay(to);
  if (!a || !b) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}
