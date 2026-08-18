/**
 * The "now" every assistant needs.
 *
 * A model has no clock. Without being told, it answers "غداً" and "هذا
 * الأسبوع" from whenever its training data ended — which is how a meeting
 * gets drafted for the wrong year. The date is therefore stated explicitly,
 * in the agency's own timezone, on every single call.
 */

const TIMEZONE = 'Asia/Amman';

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** YYYY-MM-DD as it reads in Amman, not in UTC. */
function localISODate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function localTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

/** Weekday index in Amman — not the server's, which may be a day off. */
function localWeekday(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * A block prepended to every system prompt.
 *
 * Tomorrow and the week boundaries are spelled out rather than left to the
 * model to work out, because that arithmetic is exactly where it slips.
 */
function nowContext(date = new Date()) {
  const today = localISODate(date);
  const weekday = localWeekday(date);
  // The working week starts on Sunday here.
  const weekStart = addDays(today, -weekday);

  return `التاريخ والوقت الآن (توقيت عمّان، ${TIMEZONE}):
- اليوم: ${AR_DAYS[weekday]} ${today}
- الساعة: ${localTime(date)}
- أمس: ${addDays(today, -1)} — غداً: ${addDays(today, 1)} — بعد غد: ${addDays(today, 2)}
- هذا الأسبوع: من ${weekStart} إلى ${addDays(weekStart, 6)}
- الأسبوع القادم: من ${addDays(weekStart, 7)} إلى ${addDays(weekStart, 13)}

قواعد التاريخ:
- اعتمد على التواريخ أعلاه وحدها. لا تعتمد على معرفتك المسبقة بالتاريخ فهي قديمة.
- عند كتابة تاريخ في أداة، استخدم الصيغة المطلوبة بالضبط (YYYY-MM-DD أو YYYY-MM-DDTHH:MM).
- إذا كان الطلب غامضاً زمنياً («الأسبوع الجاي»، «آخر الشهر») فاذكر التاريخ الذي فهمته صراحة في ردّك.`;
}

module.exports = { nowContext, localISODate, TIMEZONE };
