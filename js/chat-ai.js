/**
 * Luma AI as a conversation in the chat section — pinned above the people.
 *
 * It renders into the same panel with the same message markup as a real
 * conversation, so it reads as another contact rather than a widget bolted
 * onto the page.
 *
 * The history lives in localStorage, not Firestore. It is one person talking
 * to a model — nobody else can be in the room, so there is nothing to sync,
 * and keeping it out of the database means no rules, no reads and no rows
 * accumulating for something only this browser will ever show.
 */

import { session } from './auth.js';
import { $, $$, esc, refreshIcons } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { sanitizeMultiline } from './utils/sanitize.js';
import { formatTime } from './utils/format.js';
import { confirmDialog } from './utils/modal.js';

/** Id of the virtual room. Not a Firestore document. */
export const LUMA_AI_ID = '__luma_ai__';

const HISTORY_TURNS = 8;
/** Trimmed on save so one long-running conversation cannot fill the quota. */
const KEEP_MESSAGES = 100;

const storageKey = () => `luma.aiChat.${session.uid}`;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function save(messages) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(messages.slice(-KEEP_MESSAGES)));
  } catch { /* quota or private browsing — the conversation just won't persist */ }
}

/**
 * One line of the last reply for the list. The markdown the bubble renders is
 * stripped rather than shown raw — `**` in a preview is noise.
 */
function preview(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** The row shown in the conversation list. */
export function aiRoomRow({ active }) {
  const last = load().filter((m) => m.role === 'assistant').pop();
  return `
    <button class="chat-room chat-room--ai${active ? ' is-active' : ''}" data-chat="${LUMA_AI_ID}">
      <span class="chat-room__ai-avatar"><i data-lucide="sparkles"></i></span>
      <div class="chat-room__body">
        <div class="chat-room__name">Luma AI</div>
        <div class="chat-room__last">${esc(last ? preview(last.content) : 'اسأل عن المهام والفريق')}</div>
      </div>
      <span class="badge badge--brand fs-2xs">AI</span>
    </button>`;
}

/**
 * Render the conversation into the chat panel.
 * @param {HTMLElement} panel
 * @param {(draft: object) => void} onDraft  a proposed task, for review
 * @returns {Function} teardown
 */
export function openAiChat(panel, onDraft) {
  let messages = load();
  let busy = false;

  panel.innerHTML = `
    <header class="chat-panel__head">
      <button class="icon-btn chat-panel__back" id="chat-back" aria-label="رجوع">
        <i data-lucide="arrow-right"></i>
      </button>
      <span class="chat-room__ai-avatar"><i data-lucide="sparkles"></i></span>
      <div class="flex-1" style="min-width:0">
        <div class="fw-700">Luma AI</div>
        <div class="fs-2xs text-muted">مساعدك في المهام والفريق</div>
      </div>
      <button class="icon-btn" id="ai-clear" title="مسح المحادثة" aria-label="مسح المحادثة">
        <i data-lucide="trash-2"></i>
      </button>
    </header>
    <div class="chat-panel__body" id="ai-messages"></div>
    <footer class="chat-panel__foot">
      <div class="chat-composer">
        <textarea class="textarea" id="ai-msg-input" rows="1"
                  placeholder="اسأل Luma AI…"></textarea>
        <button class="btn btn--primary btn--icon" id="ai-send-btn" aria-label="إرسال">
          <i data-lucide="send"></i>
        </button>
      </div>
    </footer>`;

  refreshIcons(panel);

  const log = $('#ai-messages', panel);

  function paint() {
    log.innerHTML = messages.length
      ? messages.map(renderMessage).join('') + (busy ? thinking() : '')
      : (busy ? thinking() : emptyGreeting());
    refreshIcons(log);
    log.scrollTop = log.scrollHeight;

    // Re-bound each paint: the markup above is replaced wholesale.
    $$('[data-open-draft]', log).forEach((button) => {
      button.addEventListener('click', () => {
        const draft = messages[Number(button.dataset.openDraft)]?.draft;
        if (draft) onDraft?.(draft);
      });
    });
    $$('[data-suggest]', log).forEach((chip) => {
      chip.addEventListener('click', () => send(chip.dataset.suggest));
    });
  }

  async function send(raw) {
    const input = $('#ai-msg-input', panel);
    const question = sanitizeMultiline(raw ?? input.value, 1000);
    if (!question || busy) return;

    messages.push({ role: 'user', content: question, at: Date.now() });
    input.value = '';
    busy = true;
    paint();

    try {
      const result = await callFn('askManager', {
        question,
        history: messages
          .slice(-HISTORY_TURNS)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
      });
      messages.push({
        role: 'assistant', content: result.text, draft: result.draft || null, at: Date.now()
      });
    } catch (err) {
      // The server names the cause (functions/ai/errors.js), so it is repeated
      // rather than replaced with a generic retry line.
      messages.push({
        role: 'assistant',
        content: err?.message || 'تعذّر الحصول على إجابة. حاول مرة أخرى.',
        error: true,
        at: Date.now()
      });
      console.warn('[luma] chat-ai', err?.code, err?.message);
    } finally {
      busy = false;
      save(messages);
      paint();
    }
  }

  paint();

  $('#ai-send-btn', panel).addEventListener('click', () => send());
  $('#ai-msg-input', panel).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#ai-clear', panel).addEventListener('click', async () => {
    if (!messages.length) return;
    const ok = await confirmDialog({
      title: 'مسح المحادثة',
      message: 'سيتم حذف محادثتك مع Luma AI من هذا الجهاز.',
      confirmText: 'مسح',
      danger: true
    });
    if (!ok) return;
    messages = [];
    save(messages);
    paint();
  });

  return () => { messages = []; };
}

/* ------------------------------------------------------------ rendering */

const SUGGESTIONS = [
  'من هو الأقل انشغالاً؟',
  'ما المهام المتأخرة؟',
  'تقرير أداء الفريق',
  'أنشئ مهمة جديدة'
];

function emptyGreeting() {
  return `
    <div class="ai-greeting">
      <span class="chat-room__ai-avatar chat-room__ai-avatar--lg"><i data-lucide="sparkles"></i></span>
      <div class="fw-700 mt-3">Luma AI</div>
      <p class="fs-sm text-muted">اسألني عن حِمل الفريق، أو المهام المتأخرة، أو اطلب إنشاء مهمة.</p>
      <div class="tag-list" style="justify-content:center">
        ${SUGGESTIONS.map((s) => `
          <button type="button" class="badge" data-suggest="${esc(s)}"
                  style="cursor:pointer">${esc(s)}</button>`).join('')}
      </div>
    </div>`;
}

function renderMessage(message, index) {
  const time = message.at ? formatTime(new Date(message.at)) : '';
  if (message.role === 'user') {
    return `
      <div class="msg is-own">
        <div class="msg__bubble">
          <div class="msg__text">${esc(message.content)}</div>
          <div class="msg__meta">${esc(time)}</div>
        </div>
      </div>`;
  }
  return `
    <div class="msg">
      <span class="chat-room__ai-avatar"><i data-lucide="sparkles"></i></span>
      <div class="msg__bubble">
        <div class="msg__author">Luma AI</div>
        ${message.error
          ? `<div class="ai-error"><i data-lucide="alert-triangle"></i> ${esc(message.content)}</div>`
          : `<div class="msg__text ai-text">${formatText(message.content)}</div>`}
        ${renderDraft(message.draft, index)}
        <div class="msg__meta">${esc(time)}</div>
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

/** A proposal — task or calendar event — with the action that commits it. */
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
    <div class="ai-draft">
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
    <div class="msg">
      <span class="chat-room__ai-avatar"><i data-lucide="sparkles"></i></span>
      <div class="msg__bubble">
        <div class="ai-typing"><span></span><span></span><span></span></div>
      </div>
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
