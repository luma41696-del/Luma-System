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
import { $, $$, esc, attr, refreshIcons } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { isTemplate, templateBody } from './ai-suggestions.js';
import { sanitizeMultiline, safeUrl } from './utils/sanitize.js';
import { formatTime } from './utils/format.js';
import { confirmDialog } from './utils/modal.js';
import { uploadFile, compressImage, pickFiles, paths } from './utils/upload.js';
import { uploadsEnabled } from './features.js';
import { toastError } from './utils/toast.js';
import { formatText, renderCitations, renderSteps, renderDraft } from './ai-render.js';

/** Vision is billed per image; the server enforces this cap too. */
const MAX_IMAGES = 4;

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
  /** Uploaded and waiting to be sent with the next message. */
  let pending = [];

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
      <div class="ai-suggests" role="list" aria-label="اقتراحات">
        ${SUGGESTIONS.map((s) => `
          <button type="button" class="ai-suggests__chip" role="listitem"
                  data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <div id="ai-attachments" class="ai-attachments" hidden></div>
      <div class="chat-composer">
        ${uploadsEnabled() ? `
        <button class="btn btn--ghost btn--icon" id="ai-attach" aria-label="إرفاق صورة"
                title="إرفاق صورة">
          <i data-lucide="image-plus"></i>
        </button>` : ''}
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
      chip.addEventListener('click', () => useSuggestion(chip.dataset.suggest));
    });
  }

  /* ---------------------------------------------------------- attachments */
  function paintPending() {
    const strip = $('#ai-attachments', panel);
    if (!strip) return;
    strip.hidden = !pending.length;
    strip.innerHTML = pending.map((img, i) => `
      <span class="ai-attachment${img.uploading ? ' is-uploading' : ''}">
        ${img.preview ? `<img src="${attr(img.preview)}" alt="">` : ''}
        ${img.uploading
          ? '<span class="ai-attachment__spinner"></span>'
          : `<button class="ai-attachment__x" data-drop="${i}" aria-label="إزالة">
               <i data-lucide="x"></i></button>`}
      </span>`).join('');
    refreshIcons(strip);
    $$('[data-drop]', strip).forEach((b) => b.addEventListener('click', () => {
      pending.splice(Number(b.dataset.drop), 1);
      paintPending();
    }));
  }

  $('#ai-attach', panel)?.addEventListener('click', async () => {
    if (pending.length >= MAX_IMAGES) return toastError(`حتى ${MAX_IMAGES} صور في الرسالة الواحدة.`);
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;

    // Shown immediately from the local file; the upload fills in the URL.
    const entry = { preview: URL.createObjectURL(file), uploading: true, url: null };
    pending.push(entry);
    paintPending();

    try {
      const compressed = await compressImage(file, { maxSize: 1200 });
      const uploaded = await uploadFile(compressed, paths.chat(LUMA_AI_ID, session.uid, file), { maxMB: 10 });
      entry.url = uploaded.url;
      entry.uploading = false;
    } catch (err) {
      pending = pending.filter((p) => p !== entry);
      toastError(err?.message || 'تعذّر رفع الصورة.');
    } finally {
      paintPending();
    }
  });

  /**
   * A finished question goes straight out; an unfinished one is handed to the
   * composer with the caret after it, because it is the person who knows what
   * they were going to search for.
   */
  function useSuggestion(text) {
    if (!isTemplate(text)) return send(text);
    const input = $('#ai-msg-input', panel);
    input.value = templateBody(text);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return undefined;
  }

  async function send(raw) {
    const input = $('#ai-msg-input', panel);
    const question = sanitizeMultiline(raw ?? input.value, 1000);
    if (!question || busy) return;
    if (pending.some((p) => p.uploading)) return toastError('انتظر انتهاء رفع الصورة.');

    const images = pending.map((p) => p.url).filter(Boolean);
    messages.push({ role: 'user', content: question, images: images.length, at: Date.now() });
    input.value = '';
    pending = [];
    paintPending();
    busy = true;
    paint();

    try {
      const result = await callFn('askManager', {
        question,
        images,
        history: messages
          .slice(-HISTORY_TURNS)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
      });
      messages.push({
        role: 'assistant', content: result.text, draft: result.draft || null,
        citations: result.citations || [], steps: result.steps || [], at: Date.now()
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

  // Built from real names and counts once the directory and clients load —
  // a chip naming an employee who does not exist is worse than no chip.
  (async () => {
    const [{ buildSuggestions }, { getDirectory, getMany, col, query, orderBy, limit }] =
      await Promise.all([import('./ai-suggestions.js'), import('./utils/api.js')]);
    const [directory, clients] = await Promise.all([
      getDirectory().catch(() => []),
      getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
    ]);
    SUGGESTIONS = buildSuggestions({ page: 'chat', directory, clients });

    const strip = $('.ai-suggests', panel);
    if (strip) {
      strip.innerHTML = SUGGESTIONS.map((s) => `
        <button type="button" class="ai-suggests__chip" role="listitem"
                data-suggest="${esc(s)}">${esc(s)}</button>`).join('');
      $$('.ai-suggests__chip', panel).forEach((chip) => {
        chip.addEventListener('click', () => useSuggestion(chip.dataset.suggest));
      });
    }
    // The greeting is only on screen while the conversation is empty.
    if (!messages.length) paint();
  })();

  // The greeting's chips are re-bound by paint(); these live in the footer,
  // outside the message log, so they are bound once here.
  $$('.ai-suggests__chip', panel).forEach((chip) => {
    chip.addEventListener('click', () => useSuggestion(chip.dataset.suggest));
  });

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
    pending = [];
    save(messages);
    paintPending();
    paint();
  });

  return () => { messages = []; pending = []; };
}

/* ------------------------------------------------------------ rendering */

/**
 * Filled from the directory and client list once they load. Until then the
 * strip renders empty rather than showing prompts that name nobody real.
 */
let SUGGESTIONS = [];

function emptyGreeting() {
  return `
    <div class="ai-greeting">
      <span class="chat-room__ai-avatar chat-room__ai-avatar--lg"><i data-lucide="sparkles"></i></span>
      <div class="fw-700 mt-3">Luma AI</div>
      <p class="fs-sm text-muted">اسألني عن حِمل الفريق، أو المهام المتأخرة، أو اطلب إنشاء مهمة.</p>
      <div class="tag-list" style="justify-content:center">
        ${SUGGESTIONS.slice(0, 4).map((s) => `
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
          ${message.images ? `<div class="fs-2xs" style="opacity:.75">
            <i data-lucide="image" class="icon-sm"></i> ${message.images} صورة مرفقة
          </div>` : ''}
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
        ${renderSteps(message.steps)}
        ${renderCitations(message.citations)}
        ${renderDraft(message.draft, index)}
        <div class="msg__meta">${esc(time)}</div>
      </div>
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
