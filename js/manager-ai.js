/**
 * The management assistant — a chat over the tasks board for distributing
 * work, reading the team's load and reporting on one person.
 *
 * When it proposes a task it does not save one. The server returns a draft,
 * and this offers a button that opens the ordinary task form pre-filled, so a
 * person reviews and saves it. The assistant suggests; the human commits.
 */

import { $, $$, esc, refreshIcons, setBusy } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { sanitizeMultiline } from './utils/sanitize.js';

const HISTORY_TURNS = 8;

const DEFAULT_SUGGESTIONS = [
  'من هو الأقل انشغالاً الآن؟',
  'وزّع المهام المتأخرة على الفريق',
  'تقرير أداء الفريق هذا الشهر',
  'ما المهام المتوقفة منذ أسبوع؟'
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
  placeholder = 'مثال: أنشئ مهمة تصميم بوست لعميل PRALINE وأسندها للأقل انشغالاً'
} = {}) {
  let messages = [];
  let busy = false;

  host.innerHTML = `
    <div class="card__head">
      <div class="card__title"><i data-lucide="sparkles"></i> Luma AI</div>
      <span class="card__sub">${esc(subtitle)}</span>
    </div>

    <div id="mai-log" class="task-ai__log">
      <div class="task-ai__hint">
        اسألني عن حِمل العمل، أو اطلب توزيع مهمة، أو تقريراً عن موظف.
        <div class="tag-list mt-3">
          ${suggestions.map((s) => `
            <button type="button" class="badge" data-suggest="${esc(s)}"
                    style="cursor:pointer">${esc(s)}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="chat-composer">
      <textarea class="textarea" id="mai-input" rows="2"
                placeholder="${esc(placeholder)}"></textarea>
      <button class="btn btn--primary btn--icon" id="mai-send" aria-label="إرسال">
        <i data-lucide="send"></i>
      </button>
    </div>`;

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
      messages.push({ role: 'assistant', content: result.text, draft: result.draft || null });
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
    if (chip) send(chip.dataset.suggest);
  });
  $('#mai-send', host).addEventListener('click', () => send());
  $('#mai-input', host).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });

  return () => { messages = []; };
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
          : `<div class="ai-text">${formatText(message.content)}</div>${renderDraft(message.draft, index)}`}
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

  const rows = isEvent
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
        <i data-lucide="${isEvent ? 'calendar-plus' : 'file-plus'}" class="icon-sm"></i>
        ${isEvent ? 'مسودة حدث' : 'مسودة مهمة'} — لم تُحفظ بعد
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
