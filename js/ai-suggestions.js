/**
 * Starter prompts built from what is actually on the screen.
 *
 * A fixed list reads as decoration: it offers "تقرير عن أحمد" at an agency
 * with no Ahmad, and "٣ مهام متأخرة" whether there are three or none. These
 * are assembled from the page's own live data — real names, real counts — so
 * a chip is worth pressing, and the ones that describe nothing real are not
 * offered at all.
 *
 * The order is shuffled per open, so the strip does not read as the same
 * fixed menu every time.
 */

import { AR_MONTHS } from './utils/format.js';
import { isOverdue, isOpen } from './utils/task-model.js';

/**
 * A chip ending in an ellipsis is a sentence to finish, not a question to ask.
 *
 * "ابحث في الإنترنت عن…" sent as it stands asks the model to search for
 * nothing. Those load the composer and wait for the rest; every other chip is
 * a complete question and goes straight out.
 */
export const isTemplate = (text) => /(?:…|\.\.\.)\s*$/.test(String(text || ''));

/** The chip's text with the trailing ellipsis traded for a space to type after. */
export const templateBody = (text) =>
  `${String(text || '').replace(/\s*(?:…|\.\.\.)\s*$/, '')} `;

/** Fisher–Yates on a copy — the caller's array is not ours to reorder. */
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sample = (list, n = 1) => shuffle(list).slice(0, n);
const nameOf = (u) => (u?.displayName || '').trim();

/**
 * Arabic counts one, two and many differently — "الـ1 مهام" is not a sentence
 * anyone would write. Each phrase is supplied per form rather than patched
 * together from a number and a noun.
 */
function plural(n, { one, two, many }) {
  if (n === 1) return one;
  if (n === 2) return two;
  return typeof many === 'function' ? many(n) : many;
}

/**
 * @param {object} ctx
 * @param {'tasks'|'calendar'|'knowledge'|'chat'} ctx.page
 * @param {Array} [ctx.tasks]      live task documents
 * @param {Array} [ctx.directory]  active employees
 * @param {Array} [ctx.clients]
 * @param {Array} [ctx.events]     calendar events
 * @param {number} [ctx.max]
 * @returns {string[]}
 */
export function buildSuggestions({
  page = 'tasks', tasks = [], directory = [], clients = [], events = [], max = 12
} = {}) {
  const people = directory.filter((u) => u.status !== 'disabled' && nameOf(u));
  const named = clients.filter((c) => (c.name || '').trim());

  const open = tasks.filter(isOpen);
  const overdue = tasks.filter(isOverdue);
  const unassigned = open.filter((t) => !(t.assignees || []).length);

  const now = new Date();
  const month = AR_MONTHS[now.getMonth()];
  const year = now.getFullYear();

  // Grounded in a real count, so the chip is only shown when it describes
  // something that exists.
  const counted = [];
  if (overdue.length) {
    counted.push(plural(overdue.length, {
      one: 'وزّع المهمة المتأخرة على الفريق',
      two: 'وزّع المهمتين المتأخرتين على الفريق',
      many: (n) => `وزّع الـ${n} مهام المتأخرة على الفريق`
    }));
  }
  if (unassigned.length) {
    counted.push(plural(unassigned.length, {
      one: 'هناك مهمة بلا مسؤول — اقترح من يأخذها',
      two: 'هناك مهمتان بلا مسؤول — اقترح توزيعهما',
      many: (n) => `${n} مهام بلا مسؤول — اقترح توزيعها`
    }));
  }
  if (open.length) {
    counted.push(plural(open.length, {
      one: 'لخّص المهمة المفتوحة',
      two: 'لخّص المهمتين المفتوحتين',
      many: (n) => `لخّص الـ${n} مهام المفتوحة`
    }));
  }

  const withPerson = (template) => sample(people, 2).map((u) => template(nameOf(u)));
  const withClient = (template) => sample(named, 2).map((c) => template(c.name.trim()));

  const byPage = {
    tasks: [
      ...counted,
      'من هو الأقل انشغالاً الآن؟',
      'من عنده أكثر مهام متأخرة؟',
      'لخّص حالة الفريق اليوم',
      'أي موظف أنجز أكثر هذا الشهر؟',
      'ما المهام المتوقفة منذ أسبوع؟',
      ...withPerson((n) => `تقرير أداء ${n}`),
      ...withClient((c) => `أنشئ مهمة تصميم لعميل ${c}`)
    ],
    calendar: [
      `ما جدول ${month}؟`,
      'ما مواعيد هذا الأسبوع؟',
      'هل يوجد تعارض في المواعيد؟',
      ...(events.length ? [plural(events.length, {
        one: 'لخّص الحدث القادم',
        two: 'لخّص الحدثين القادمين',
        many: (n) => `لخّص الـ${n} أحداث القادمة`
      })] : []),
      ...withPerson((n) => `أضف اجتماعاً مع ${n} غداً`),
      ...withClient((c) => `سجّل موعد تسليم لعميل ${c}`),
      'أضف عيد ميلاد لموظف',
      'أضف إجازة الأسبوع القادم'
    ],
    knowledge: [
      `ابحث عن اتجاهات التصميم في ${year}`,
      'أفضل أوقات النشر على إنستغرام في الأردن؟',
      'لخّص أسعار إعلانات Meta واحفظها',
      'ابحث عن أحدث مقاسات منشورات السوشيال ميديا',
      ...withClient((c) => `ابحث عن منافسي عميل ${c}`),
      ...withClient((c) => `ابحث عن جمهور ${c} المستهدف`)
    ],
    chat: [
      ...counted,
      'من هو الأقل انشغالاً؟',
      'ما جدول هذا الأسبوع؟',
      'لخّص حالة الفريق اليوم',
      ...withPerson((n) => `تقرير أداء ${n}`),
      ...withClient((c) => `أنشئ مهمة لعميل ${c}`),
      'ابحث في الإنترنت عن…',
      'أضف اجتماعاً غداً'
    ]
  };

  // The counted ones lead — they are the only chips describing something that
  // is true right now — and the rest are shuffled in behind them.
  const list = byPage[page] || byPage.tasks;
  const lead = list.slice(0, counted.length);
  const rest = shuffle(list.slice(counted.length));
  return [...lead, ...rest].filter(Boolean).slice(0, max);
}
