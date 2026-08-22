/**
 * The management assistant — a chat over the tasks board for distributing
 * work, reading the team's load and reporting on one person.
 *
 * When it proposes a task it does not save one. The server returns a draft,
 * and this offers a button that opens the ordinary task form pre-filled, so a
 * person reviews and saves it. The assistant suggests; the human commits.
 */

import { $, $$, esc, attr, refreshIcons, setBusy } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { isTemplate, templateBody } from './ai-suggestions.js';
import { sanitizeMultiline, safeUrl } from './utils/sanitize.js';

const HISTORY_TURNS = 8;

/**
 * Fallback prompts, used only when a page passes nothing.
 *
 * Every real caller passes a function instead (see ai-suggestions.js), which
 * is resolved when the panel opens so the chips describe the data on screen
 * at that moment rather than whatever was true when the page loaded.
 */
const DEFAULT_SUGGESTIONS = [
  'من هو الأقل انشغالاً الآن؟',
  'لخّص حالة الفريق اليوم',
  'ما المهام المتوقفة منذ أسبوع؟',
  'من عنده أكثر مهام متأخرة؟'
];

/**
 * @param {HTMLElement} host
 * @param {(draft: object) => void} onDraft  a proposal — task or calendar event
 * @param {object} [options]
 * @param {string} [options.subtitle]     what it does in this context
 * @param {string[]} [options.suggestions] starter prompts for this page
 * @returns {Function} teardown
 */
export function mountManagerAssistant(host, onDraft, {
  subtitle = 'توزيع المهام ومتابعة الفريق',
  suggestions = DEFAULT_SUGGESTIONS,
  placeholder = 'اسأل Luma AI…',
  onClose = null
} = {}) {
  let messages = [];
  let busy = false;

  // Resolved here, not at import: a function reads the page's data as it
  // stands when the panel is opened, so the counts in the chips are current.
  const prompts = (typeof suggestions === 'function' ? suggestions() : suggestions) || [];

  // A docked panel rather than a card in the page flow: inline, it stretched
  // to the full width and shoved the filters down the page, which made a chat
  // read like a form. Floating keeps the board visible behind it — the thing
  // you are usually asking about.
  host.classList.add('ai-dock');
  host.innerHTML = `
    <header class="ai-dock__head">
      <span class="chat-room__ai-avatar"><i data-lucide="sparkles"></i></span>
      <div class="flex-1" style="min-width:0">
        <div class="fw-700">Luma AI</div>
        <div class="fs-2xs text-muted truncate">${esc(subtitle)}</div>
      </div>
      <button class="icon-btn" id="mai-close" aria-label="إغلاق" title="إغلاق">
        <i data-lucide="x"></i>
      </button>
    </header>

    <div id="mai-log" class="ai-dock__log">
      <div class="ai-greeting">
        <span class="chat-room__ai-avatar chat-room__ai-avatar--lg"><i data-lucide="sparkles"></i></span>
        <div class="fw-700 mt-3">كيف أساعدك؟</div>
        <p class="fs-sm text-muted">اسألني عن حِمل العمل، أو اطلب توزيع مهمة، أو تقريراً عن موظف.</p>
        <div class="tag-list" style="justify-content:center">
          ${prompts.slice(0, 4).map((s) => `
            <button type="button" class="badge" data-suggest="${esc(s)}"
                    style="cursor:pointer">${esc(s)}</button>`).join('')}
        </div>
      </div>
    </div>

    <footer class="ai-dock__foot">
      <div class="ai-suggests" role="list" aria-label="اقتراحات">
        ${prompts.map((s) => `
          <button type="button" class="ai-suggests__chip" role="listitem"
                  data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <div class="chat-composer">
        <textarea class="textarea" id="mai-input" rows="1"
                  placeholder="${esc(placeholder)}"></textarea>
        <button class="btn btn--primary btn--icon" id="mai-send" aria-label="إرسال">
          <i data-lucide="send"></i>
        </button>
      </div>
    </footer>`;

  refreshIcons(host);

  const log = $('#mai-log', host);

  const paint = () => {
    if (!messages.length) return;
    log.innerHTML = messages.map(renderMessage).join('') + (busy ? thinking() : '');
    refreshIcons(log);
    log.scrollTop = log.scrollHeight;

    // Re-bound on every paint: the markup above is replaced wholesale.
    $$('[data-open-draft]', log).forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.openDraft);
        const draft = messages[index]?.draft;
        if (draft) onDraft(draft);
      });
    });
  };

  /**
   * A finished question goes straight out; an unfinished one is handed to the
   * composer with the caret after it, because it is the person who knows what
   * they were going to search for.
   */
  /**
   * A suggestion is a head start on writing, not a message.
   *
   * It loads the composer and puts the caret at the end so the sentence can be
   * finished, trimmed or replaced before it goes anywhere. Sending on click
   * meant a half-right prompt was already spent by the time you read it.
   */
  function useSuggestion(text) {
    const input = $('#mai-input', host);
    input.value = isTemplate(text) ? templateBody(text) : text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  async function send(raw) {
    const question = sanitizeMultiline(raw ?? $('#mai-input', host).value, 1000);
    if (!question || busy) return;

    messages.push({ role: 'user', content: question });
    $('#mai-input', host).value = '';
    busy = true;
    paint();

    const button = $('#mai-send', host);
    setBusy(button, true);
    try {
      const result = await callFn('askManager', {
        question,
        history: messages
          .slice(-HISTORY_TURNS)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
      });
      messages.push({
        role: 'assistant', content: result.text,
        draft: result.draft || null, citations: result.citations || [],
        steps: result.steps || []
      });
    } catch (err) {
      // The server names the cause (functions/ai/errors.js); repeating it is
      // more use than a generic retry line.
      messages.push({
        role: 'assistant',
        content: err?.message || 'تعذّر الحصول على إجابة. حاول مرة أخرى.',
        error: true
      });
      console.warn('[luma] manager-ai', err?.code, err?.message);
    } finally {
      busy = false;
      setBusy(button, false);
      paint();
    }
  }

  host.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-suggest]');
    if (chip) useSuggestion(chip.dataset.suggest);
  });
  $('#mai-send', host).addEventListener('click', () => send());
  // Enter sends, Shift+Enter breaks the line — what a chat window does.
  $('#mai-input', host).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#mai-close', host).addEventListener('click', () => onClose?.());

  $('#mai-input', host).focus();

  return () => { messages = []; };
}

/**
 * Wire a toggle button to the assistant.
 *
 * The three screens that offer it were each repeating the same open/close
 * bookkeeping — mount once, flip `hidden`, flip `is-on`, remember the
 * teardown. That belongs here, not copied per page.
 *
 * @param {object} options
 * @param {HTMLElement} options.button  the trigger
 * @param {HTMLElement} options.host    the empty element to become the dock
 * @param {(draft: object) => void} options.onDraft
 * @param {object} [options.panel]      subtitle / suggestions / placeholder
 * @returns {Function} teardown
 */
export function attachManagerAssistant({ button, host, onDraft, panel = {} }) {
  if (!button || !host) return () => {};
  let teardown = null;

  const close = () => {
    host.hidden = true;
    button.classList.remove('is-on');
  };

  button.addEventListener('click', () => {
    if (!host.hidden) return close();
    host.hidden = false;
    button.classList.add('is-on');
    // Mounted on first open: most visits to a page are not to talk to it.
    if (!teardown) teardown = mountManagerAssistant(host, onDraft, { ...panel, onClose: close });
    else $('#mai-input', host)?.focus();
  });

  // Escape closes it, like every other overlay in the app.
  const onKey = (e) => { if (e.key === 'Escape' && !host.hidden) close(); };
  document.addEventListener('keydown', onKey);

  return () => {
    document.removeEventListener('keydown', onKey);
    teardown?.();
  };
}

/* ------------------------------------------------------------ rendering */

function renderMessage(message, index) {
  if (message.role === 'user') {
    return `<div class="ai-msg ai-msg--user"><div class="ai-bubble">${esc(message.content)}</div></div>`;
  }
  return `
    <div class="ai-msg ai-msg--bot">
      <span class="ai-msg__avatar"><i data-lucide="sparkles"></i></span>
      <div class="ai-bubble">
        ${message.error
          ? `<div class="ai-error"><i data-lucide="alert-triangle"></i> ${esc(message.content)}</div>`
          : `<div class="ai-text">${formatText(message.content)}</div>`
            + renderSteps(message.steps) + renderCitations(message.citations)
            + renderDraft(message.draft, index)}
      </div>
    </div>`;
}

const PRIORITIES = { urgent: 'عاجلة', high: 'مرتفعة', medium: 'متوسطة', low: 'منخفضة' };
const EVENT_KINDS = {
  meeting: 'اجتماع', deadline: 'موعد تسليم', task: 'مهمة',
  leave: 'إجازة', event: 'حدث', birthday: 'عيد ميلاد'
};

const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('ar', {
    dateStyle: 'medium', timeStyle: 'short'
  });
};

/** The proposal, with the one action that turns it into a real record. */
function renderDraft(draft, index) {
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
    <div class="card card--pad-sm mt-3" style="background:var(--bg-inset)">
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

function thinking() {
  return `
    <div class="ai-msg ai-msg--bot">
      <span class="ai-msg__avatar"><i data-lucide="sparkles"></i></span>
      <div class="ai-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>
    </div>`;
}

/** Escape first, then allow only bold and bullets back in. */
function formatText(text) {
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
function renderCitations(citations) {
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
function renderSteps(steps) {
  if (!steps?.length) return '';
  return `
    <details class="ai-steps">
      <summary>
        <i data-lucide="list-checks" class="icon-sm"></i>
        ماذا فعلت؟ (${steps.length})
      </summary>
      <ol class="ai-steps__list">
        ${steps.map((s) => s.kind === 'search'
          ? `<li><i data-lucide="globe" class="icon-sm"></i>
               بحث في الإنترنت${s.label ? `: <span class="ai-steps__q">${esc(s.label)}</span>` : ''}</li>`
          : `<li><i data-lucide="database" class="icon-sm"></i>
               ${esc(TOOL_LABELS[s.label] || s.label)}</li>`).join('')}
      </ol>
    </details>`;
}
