/**
 * Shared rendering for anything Luma AI says.
 *
 * The chat panel, the page and the docks all show the same three things
 * underneath an answer — what it did, what it read, and what it is proposing —
 * and those have to look and behave identically wherever they appear. Kept
 * here so a change to how a draft is presented cannot land in one surface and
 * miss another.
 */

import { esc, attr } from './utils/dom.js';
import { safeUrl } from './utils/sanitize.js';

export const PRIORITIES = { urgent: 'عاجلة', high: 'مرتفعة', medium: 'متوسطة', low: 'منخفضة' };
export const EVENT_KINDS = {
  meeting: 'اجتماع', deadline: 'موعد تسليم', task: 'مهمة',
  leave: 'إجازة', event: 'حدث', birthday: 'عيد ميلاد'
};

export const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('ar', {
    dateStyle: 'medium', timeStyle: 'short'
  });
};

/** Escape first, then allow only bold and bullets back in. */
export function formatText(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^[-•*]\s+/.test(trimmed)) return `<div class="ai-bullet">${trimmed.replace(/^[-•*]\s+/, '')}</div>`;
      return `<p>${trimmed}</p>`;
    })
    .join('');
}

/** Pages the answer was built from — shown so a reader can check them. */
export function renderCitations(citations) {
  if (!citations?.length) return '';
  return `
    <div class="ai-sources">
      <div class="fs-2xs text-muted mb-1">
        <i data-lucide="link" class="icon-sm"></i> المصادر
      </div>
      ${citations.map((c) => {
        const href = safeUrl(c.url);
        return href
          ? `<a class="fs-2xs truncate" href="${attr(href)}" target="_blank"
                rel="noopener noreferrer nofollow">${esc(c.title || href)}</a>`
          : '';
      }).join('')}
    </div>`;
}

const TOOL_LABELS = {
  listEmployees: 'قرأ قائمة الموظفين',
  getTeamWorkload: 'حسب حِمل الفريق',
  getEmployeeReport: 'أعدّ تقرير موظف',
  getStaleTasks: 'بحث عن المهام المتوقفة',
  listCalendarEvents: 'قرأ التقويم',
  draftTask: 'جهّز مسودة مهمة',
  draftEvent: 'جهّز مسودة حدث',
  draftNote: 'جهّز مسودة ملاحظة'
};

/** What the assistant did, in order. Collapsed until opened. */
export function renderSteps(steps) {
  if (!steps?.length) return '';
  const row = (s) => {
    if (s.kind === 'search') {
      return `<li><i data-lucide="globe" class="icon-sm"></i>
        بحث في الإنترنت${s.label ? `: <span class="ai-steps__q">${esc(s.label)}</span>` : ''}</li>`;
    }
    // A note is the driver reporting something about the run itself — e.g.
    // that web search was unavailable and it carried on without it.
    if (s.kind === 'note') {
      return `<li><i data-lucide="info" class="icon-sm"></i> ${esc(s.label || '')}</li>`;
    }
    return `<li><i data-lucide="database" class="icon-sm"></i>
      ${esc(TOOL_LABELS[s.label] || s.label)}</li>`;
  };
  return `
    <details class="ai-steps">
      <summary>
        <i data-lucide="list-checks" class="icon-sm"></i>
        ماذا فعلت؟ (${steps.length})
      </summary>
      <ol class="ai-steps__list">${steps.map(row).join('')}</ol>
    </details>`;
}

/**
 * A proposal — task, event or note — with the action that commits it.
 *
 * Nothing here is saved. The button opens the ordinary form with the fields
 * filled in, and a person presses save, exactly as if they had typed it. That
 * gap between what the model suggests and what the system stores is the whole
 * safety property, so the wording never claims the thing already exists.
 */
export function renderDraft(draft, index) {
  if (!draft) return '';
  const isEvent = draft.kind === 'event';
  const isNote = draft.kind === 'note';

  const rows = isNote
    ? [
      ['العنوان', draft.title],
      ['الوسوم', draft.tags?.join('، ') || '—'],
      ['العميل', draft.clientName || '—'],
      ['المصادر', draft.sources?.length ? `${draft.sources.length} رابط` : '—']
    ]
    : isEvent
      ? [
        ['العنوان', draft.title],
        ['النوع', EVENT_KINDS[draft.type] || draft.type],
        ['البداية', when(draft.startAt)],
        ['النهاية', when(draft.endAt)],
        ['المشاركون', draft.participantNames?.join('، ') || '— لم يُحدَّد —'],
        ['العميل', draft.clientName || '—'],
        ['المكان', draft.location || '—']
      ]
      : [
        ['العنوان', draft.title],
        ['المسؤول', draft.assigneeNames?.join('، ') || '— لم يُحدَّد —'],
        ['العميل', draft.clientName || '—'],
        ['الأولوية', PRIORITIES[draft.priority] || draft.priority],
        ['الموعد', draft.dueAt || '—']
      ];

  return `
    <div class="ai-draft">
      <div class="fs-2xs text-muted mb-2">
        <i data-lucide="${isNote ? 'book-open' : isEvent ? 'calendar-plus' : 'file-plus'}" class="icon-sm"></i>
        ${isNote ? 'مسودة ملاحظة' : isEvent ? 'مسودة حدث' : 'مسودة مهمة'} — لم تُحفظ بعد
      </div>
      ${rows.map(([k, v]) => `
        <div class="kv"><span class="kv__k">${esc(k)}</span>
          <span class="kv__v">${esc(String(v ?? '—'))}</span></div>`).join('')}
      ${draft.unresolved?.length ? `
        <div class="fs-2xs mt-2" style="color:var(--warning)">
          <i data-lucide="alert-triangle" class="icon-sm"></i>
          تعذّر ربط: ${esc(draft.unresolved.join('، '))}
        </div>` : ''}
      <button class="btn btn--primary btn--sm btn--block mt-3" data-open-draft="${index}">
        <i data-lucide="pencil"></i> راجعها واحفظها
      </button>
    </div>`;
}
