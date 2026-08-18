/**
 * The task assistant — a small chat attached to one task, able to look at the
 * images already attached to it.
 *
 * The browser never talks to OpenAI. It sends the task id, the question and
 * which attachments to show; the server loads the task, re-checks that this
 * user may read it, resolves those attachments to URLs and makes the call.
 * Sending indexes rather than URLs is deliberate — see functions/ai/task-assistant.js.
 */

import { $, $$, esc, attr, refreshIcons, setBusy } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { reportError } from './utils/toast.js';
import { sanitizeMultiline } from './utils/sanitize.js';

/** Only the recent turns are sent, matching what the server keeps. */
const HISTORY_TURNS = 8;

/** Vision is billed per image; the server enforces this too. */
const MAX_IMAGES = 4;

/**
 * Mount the assistant into `host`.
 * @param {HTMLElement} host
 * @param {object} task  the task document (+ id)
 * @returns {Function} teardown
 */
export function mountTaskAssistant(host, task) {
  const images = (task.attachments || [])
    .map((file, index) => ({ ...file, index }))
    .filter((file) => String(file.type || '').startsWith('image/'));

  const selected = new Set();
  let messages = [];
  let busy = false;

  host.innerHTML = `
    <div class="card__head">
      <div class="card__title"><i data-lucide="sparkles"></i> مساعد ذكي</div>
      <span class="card__sub">يساعدك على إنجاز هذه المهمة</span>
    </div>

    <div id="tai-log" class="task-ai__log">
      <div class="task-ai__hint">
        اسأل عن أفكار، صياغة، تقسيم المهمة لخطوات، أو راجع التصميم المرفق.
      </div>
    </div>

    ${images.length ? `
      <div class="task-ai__images">
        <div class="fs-2xs text-muted mb-2">
          <i data-lucide="image" class="icon-sm"></i>
          أرسل صورة مرفقة مع سؤالك (حتى ${MAX_IMAGES})
        </div>
        <div class="task-ai__thumbs">
          ${images.map((file) => `
            <button type="button" class="task-ai__thumb" data-image="${file.index}"
                    title="${attr(file.name || '')}">
              <img src="${attr(file.url)}" alt="${attr(file.name || '')}" loading="lazy">
              <span class="task-ai__thumb-check"><i data-lucide="check"></i></span>
            </button>`).join('')}
        </div>
      </div>` : `
      <div class="task-ai__images">
        <div class="fs-2xs text-muted">
          <i data-lucide="image-off" class="icon-sm"></i>
          لا توجد صور مرفقة بالمهمة — ارفع صورة في «المرفقات» لتتمكن من إرسالها للمساعد.
        </div>
      </div>`}

    <div class="chat-composer">
      <textarea class="textarea" id="tai-input" rows="2"
                placeholder="اكتب سؤالك عن هذه المهمة…"></textarea>
      <button class="btn btn--primary btn--icon" id="tai-send" aria-label="إرسال">
        <i data-lucide="send"></i>
      </button>
    </div>`;

  refreshIcons(host);

  /* ------------------------------------------------------- image picker */
  $$('[data-image]', host).forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.image);
      if (selected.has(index)) {
        selected.delete(index);
      } else if (selected.size >= MAX_IMAGES) {
        return;                                    // the cap is silent, not an error
      } else {
        selected.add(index);
      }
      button.classList.toggle('is-on', selected.has(index));
    });
  });

  /* -------------------------------------------------------------- chat */
  const log = $('#tai-log', host);

  const paint = () => {
    if (!messages.length) return;
    log.innerHTML = messages.map(renderMessage).join('') + (busy ? thinking() : '');
    refreshIcons(log);
    log.scrollTop = log.scrollHeight;
  };

  async function send() {
    const input = $('#tai-input', host);
    const question = sanitizeMultiline(input.value, 1000);
    if (!question || busy) return;

    const imageIndexes = [...selected];
    messages.push({ role: 'user', content: question, images: imageIndexes.length });
    input.value = '';
    busy = true;
    paint();

    const button = $('#tai-send', host);
    setBusy(button, true);
    try {
      const result = await callFn('askTaskAssistant', {
        taskId: task.id,
        question,
        imageIndexes,
        // Only the text of prior turns travels — enough for a follow-up
        // without re-paying for the images every message.
        history: messages
          .slice(-HISTORY_TURNS)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
      });
      messages.push({ role: 'assistant', content: result.text });
    } catch (err) {
      messages.push({ role: 'assistant', content: friendlyError(err), error: true });
      // Surfaced in the thread above; the toast would just repeat it.
      if (err?.code !== 'functions/failed-precondition') reportError(err, 'task-ai');
    } finally {
      busy = false;
      setBusy(button, false);
      paint();
    }
  }

  $('#tai-send', host).addEventListener('click', send);
  $('#tai-input', host).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });

  return () => { messages = []; };
}

/* ------------------------------------------------------------ rendering */

function renderMessage(message) {
  if (message.role === 'user') {
    return `
      <div class="ai-msg ai-msg--user">
        <div class="ai-bubble">
          ${message.images ? `<div class="fs-2xs" style="opacity:.75">
            <i data-lucide="image" class="icon-sm"></i> ${message.images} صورة مرفقة
          </div>` : ''}
          ${esc(message.content)}
        </div>
      </div>`;
  }
  return `
    <div class="ai-msg ai-msg--bot">
      <span class="ai-msg__avatar"><i data-lucide="sparkles"></i></span>
      <div class="ai-bubble">
        ${message.error
          ? `<div class="ai-error"><i data-lucide="alert-triangle"></i> ${esc(message.content)}</div>`
          : `<div class="ai-text">${formatText(message.content)}</div>`}
      </div>
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

function friendlyError(err) {
  if (err?.code === 'functions/failed-precondition') {
    return 'المساعد الذكي غير مُفعّل على الخادم بعد.';
  }
  if (err?.code === 'functions/resource-exhausted') {
    return 'عدد كبير من الأسئلة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.';
  }
  if (err?.code === 'functions/permission-denied') {
    return 'لا تملك صلاحية استخدام المساعد على هذه المهمة.';
  }
  return err?.message || 'تعذّر الحصول على إجابة. حاول مرة أخرى.';
}
