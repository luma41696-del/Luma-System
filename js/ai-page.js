/**
 * Luma AI as a full page — the assistant with room to work.
 *
 * Two states, and the whole design is the move between them. Empty, it is a
 * question in the middle of the screen and one composer under it: nothing to
 * read, nowhere to look but the box. Once you ask, the greeting lifts away and
 * the conversation takes the space.
 *
 * It talks to the same `askManager` callable as the dock and the chat panel,
 * so it inherits the same rule those do: the assistant reads and proposes, and
 * a person saves. A draft here opens the ordinary form with the fields filled
 * in — the model never writes to the system itself.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import { $, $$, esc, attr, refreshIcons } from './utils/dom.js';
import { callFn, getDirectory, getMany, col, query, orderBy, limit } from './utils/api.js';
import { sanitizeMultiline } from './utils/sanitize.js';
import { formatTime } from './utils/format.js';
import { confirmDialog } from './utils/modal.js';
import { uploadFile, compressImage, pickFiles, paths } from './utils/upload.js';
import { uploadsEnabled } from './features.js';
import { toastError } from './utils/toast.js';
import { formatText, renderCitations, renderSteps, renderDraft } from './ai-render.js';
import { buildSuggestions, isTemplate, templateBody } from './ai-suggestions.js';
import { openDraft } from './ai-draft.js';

/** Vision is billed per image; the server enforces this cap too. */
const MAX_IMAGES = 4;
/** Text pulled out of an attachment and pasted into the question. */
const MAX_TEXT_CHARS = 20_000;
const MAX_TEXT_BYTES = 1024 * 1024;
const HISTORY_TURNS = 8;
const KEEP_MESSAGES = 100;

/**
 * File types whose contents can actually be given to a model.
 *
 * Images go as images. Plain-text formats are read here and pasted into the
 * question. Anything else — PDF, Word, a zip — cannot be read by this client,
 * and attaching it silently would mean the model answering about a file it
 * never saw, so those are refused at the point of choosing rather than
 * accepted and quietly ignored.
 */
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|xml|html?|css|js|ts|sql)$/i;
export const isTextFile = (file) =>
  file.type.startsWith('text/') ||
  /^application\/(json|xml|x-yaml|javascript)$/.test(file.type) ||
  TEXT_EXTENSIONS.test(file.name);

const storageKey = () => `luma.aiPage.${session.uid}`;

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

export async function render(container, ctx) {
  if (!can(session.claims, 'tasks.ai')) {
    container.innerHTML = `
      <div class="page__inner">
        <div class="card">لا تملك صلاحية استخدام المساعد الذكي.</div>
      </div>`;
    return () => {};
  }

  let messages = load();
  let busy = false;
  /** What the wait is for — a drawing takes far longer than a reply, and
   *  saying which is happening is most of what a spinner is for. */
  let busyKind = 'ask';
  /** Uploaded and waiting to go with the next question. */
  let pending = [];
  let suggestions = [];

  container.innerHTML = `
    <div class="ai-page">
      <div class="ai-page__glow" aria-hidden="true"></div>

      <header class="ai-page__bar">
        <div class="ai-page__brand">
          <span class="ai-page__mark"><i data-lucide="sparkles"></i></span>
          <span class="fw-700">Luma AI</span>
        </div>
        <button class="icon-btn" id="aip-clear" title="محادثة جديدة" aria-label="محادثة جديدة">
          <i data-lucide="square-pen"></i>
        </button>
      </header>

      <div class="ai-page__stage" id="aip-stage">
        <div class="ai-hero" id="aip-hero">
          <h1 class="ai-hero__title">من أين نبدأ؟</h1>
          <p class="ai-hero__sub">اسأل عن الفريق والمهام والمواعيد، أو اطلب إنشاء شيء جديد.</p>
        </div>
        <div class="ai-page__log" id="aip-log" role="log" aria-live="polite"></div>
      </div>

      <div class="ai-page__dock">
        <div class="ai-chips" id="aip-chips" role="list" aria-label="اقتراحات"></div>

        <div id="aip-files" class="ai-attachments" hidden></div>

        <form class="ai-bar" id="aip-form">
          <textarea class="ai-bar__input" id="aip-input" rows="1"
                    placeholder="اسأل Luma AI" aria-label="اسأل Luma AI"></textarea>

          <div class="ai-bar__tools">
            ${uploadsEnabled() ? `
            <button type="button" class="ai-bar__icon" id="aip-attach"
                    title="إرفاق صورة أو ملف" aria-label="إرفاق صورة أو ملف">
              <i data-lucide="plus"></i>
            </button>` : ''}

            <div class="ai-modes" role="tablist" aria-label="الوضع">
              <button type="button" class="ai-mode is-on" data-mode="ask" role="tab" aria-selected="true">
                <i data-lucide="message-circle"></i> محادثة
              </button>
              <button type="button" class="ai-mode" data-mode="image" role="tab" aria-selected="false">
                <i data-lucide="image"></i> توليد صورة
              </button>
            </div>

            <button type="submit" class="ai-bar__send" id="aip-send" aria-label="إرسال">
              <i data-lucide="arrow-up"></i>
            </button>
          </div>
        </form>
        <p class="ai-page__note">يقترح ولا يحفظ — أنت من يراجع ويؤكّد.</p>
      </div>
    </div>`;

  refreshIcons(container);

  const stage = $('#aip-stage', container);
  const log = $('#aip-log', container);
  const input = $('#aip-input', container);

  /* ------------------------------------------------------------- painting */

  const paint = () => {
    // The greeting only exists while the conversation does not.
    stage.classList.toggle('is-conversing', messages.length > 0 || busy);

    log.innerHTML = messages.map(renderMessage).join('') + (busy ? thinking(busyKind) : '');
    refreshIcons(log);
    log.scrollTop = log.scrollHeight;

    // Re-bound each paint: the markup above is replaced wholesale.
    $$('[data-open-draft]', log).forEach((button) => {
      button.addEventListener('click', () => {
        const draft = messages[Number(button.dataset.openDraft)]?.draft;
        if (draft) openDraft(draft);
      });
    });
  };

  const paintChips = () => {
    const host = $('#aip-chips', container);
    host.innerHTML = suggestions.map((s) => `
      <button type="button" class="ai-chip" role="listitem" data-suggest="${attr(s)}">
        ${esc(s)}
      </button>`).join('');
  };

  /* ---------------------------------------------------------- attachments */

  const paintFiles = () => {
    const strip = $('#aip-files', container);
    strip.hidden = !pending.length;
    strip.innerHTML = pending.map((f, i) => `
      <span class="ai-attachment${f.uploading ? ' is-uploading' : ''}"
            title="${attr(f.name || '')}">
        ${f.preview
          ? `<img src="${attr(f.preview)}" alt="">`
          : `<span class="ai-attachment__doc"><i data-lucide="file-text"></i></span>`}
        ${f.uploading
          ? '<span class="ai-attachment__spinner"></span>'
          : `<button type="button" class="ai-attachment__x" data-drop="${i}" aria-label="إزالة">
               <i data-lucide="x"></i></button>`}
      </span>`).join('');
    refreshIcons(strip);
    $$('[data-drop]', strip).forEach((b) => b.addEventListener('click', () => {
      pending.splice(Number(b.dataset.drop), 1);
      paintFiles();
    }));
  };

  $('#aip-attach', container)?.addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'image/*,text/*,.md,.csv,.json,.log,.yml,.yaml,.xml' });
    if (!file) return;

    const image = file.type.startsWith('image/');
    if (image && pending.filter((p) => p.kind === 'image').length >= MAX_IMAGES) {
      return toastError(`حتى ${MAX_IMAGES} صور في الرسالة الواحدة.`);
    }
    if (!image && !isTextFile(file)) {
      return toastError('يمكن قراءة الصور والملفات النصية فقط. ملفات PDF وWord غير مدعومة بعد.');
    }

    if (!image) {
      // Read here rather than upload: the model needs the words, and pushing a
      // file to Storage it can never open would be storage spent for nothing.
      if (file.size > MAX_TEXT_BYTES) return toastError('الملف النصي كبير جداً (الحد 1 ميغابايت).');
      try {
        const text = (await file.text()).slice(0, MAX_TEXT_CHARS);
        pending.push({ kind: 'text', name: file.name, text, uploading: false });
        paintFiles();
      } catch {
        toastError('تعذّر قراءة الملف.');
      }
      return;
    }

    const entry = {
      kind: 'image', name: file.name,
      preview: URL.createObjectURL(file), uploading: true, url: null
    };
    pending.push(entry);
    paintFiles();
    try {
      const compressed = await compressImage(file, { maxSize: 1200 });
      const uploaded = await uploadFile(compressed, paths.chat('__luma_ai__', session.uid, file), { maxMB: 10 });
      entry.url = uploaded.url;
      entry.uploading = false;
    } catch (err) {
      pending = pending.filter((p) => p !== entry);
      toastError(err?.message || 'تعذّر رفع الصورة.');
    } finally {
      paintFiles();
    }
  });

  /* ----------------------------------------------------------- conversing */

  /** 'ask' talks to the assistant; 'image' draws. */
  let mode = 'ask';

  async function drawImage(promptText) {
    messages.push({ role: 'user', content: promptText, at: Date.now() });
    input.value = '';
    autoGrow();
    busy = true;
    busyKind = 'image';
    paint();
    try {
      // Which provider draws is a setting, not a per-message choice — see
      // Settings → المساعد الذكي. The server reads it from the caller's prefs.
      const result = await callFn('generateImage', { prompt: promptText });
      messages.push({
        role: 'assistant', at: Date.now(),
        image: result.url,
        // Names the drawer without claiming why — the reason is a deadline,
        // not a missing capability, and asserting the wrong one is worse than
        // asserting none.
        content: result.usedFallback
          ? `رُسمت بواسطة ${result.provider === 'gemini' ? 'Gemini' : 'ChatGPT'}.`
          : ''
      });
    } catch (err) {
      messages.push({
        role: 'assistant', at: Date.now(), error: true,
        content: err?.message || 'تعذّر توليد الصورة.'
      });
      console.warn('[luma] ai-image', err?.code, err?.message);
    } finally {
      busy = false;
      save(messages);
      paint();
    }
  }

  async function send(raw) {
    const typed = sanitizeMultiline(raw ?? input.value, 1000);
    if (!typed || busy) return;
    if (mode === 'image') return drawImage(typed);
    if (pending.some((p) => p.uploading)) return toastError('انتظر انتهاء رفع الصورة.');

    const images = pending.filter((p) => p.kind === 'image').map((p) => p.url).filter(Boolean);
    const docs = pending.filter((p) => p.kind === 'text');

    // Attached text rides along inside the question, fenced and labelled, so
    // the model can tell the file apart from what the person actually asked.
    const question = docs.length
      ? `${typed}\n\n${docs.map((d) => `--- محتوى الملف: ${d.name} ---\n${d.text}`).join('\n\n')}`
      : typed;

    messages.push({
      role: 'user', content: typed, at: Date.now(),
      images: images.length, files: docs.map((d) => d.name)
    });
    input.value = '';
    autoGrow();
    pending = [];
    paintFiles();
    busy = true;
    busyKind = 'ask';
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
      // The server names the cause (functions/ai/errors.js); repeating it is
      // more use than a generic retry line.
      messages.push({
        role: 'assistant',
        content: err?.message || 'تعذّر الحصول على إجابة. حاول مرة أخرى.',
        error: true, at: Date.now()
      });
      console.warn('[luma] ai-page', err?.code, err?.message);
    } finally {
      busy = false;
      save(messages);
      paint();
    }
  }

  /** A finished question goes out; an unfinished one waits in the composer. */
  function useSuggestion(text) {
    if (!isTemplate(text)) return send(text);
    input.value = templateBody(text);
    autoGrow();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return undefined;
  }

  /** The bar grows with the text instead of scrolling a one-line box. */
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  /* ------------------------------------------------------------- wiring */

  $('#aip-form', container).addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  container.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-suggest]');
    if (chip) return useSuggestion(chip.dataset.suggest);

    const tab = e.target.closest('[data-mode]');
    if (!tab) return;
    mode = tab.dataset.mode;
    $$('.ai-mode', container).forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    // The placeholder is the only thing telling you what the box will do now.
    input.placeholder = mode === 'image' ? 'صف الصورة التي تريدها' : 'اسأل Luma AI';
    $('#aip-chips', container).hidden = mode === 'image';
    input.focus();
  });

  $('#aip-clear', container).addEventListener('click', async () => {
    if (!messages.length) return;
    if (!await confirmDialog({
      title: 'محادثة جديدة',
      message: 'سيُمسح سجل هذه المحادثة من هذا المتصفح.',
      confirmText: 'ابدأ من جديد'
    })) return;
    messages = [];
    save(messages);
    paint();
    input.focus();
  });

  paint();
  input.focus();

  // Suggestions describe real people and real counts, so they wait for the
  // data rather than shipping names that may match nobody.
  (async () => {
    const [tasks, directory, clients] = await Promise.all([
      getMany(query(col('tasks'), orderBy('createdAt', 'desc'), limit(200))).catch(() => []),
      getDirectory().catch(() => []),
      can(session.claims, 'clients.view')
        ? getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
        : []
    ]);
    suggestions = buildSuggestions({ page: 'chat', tasks, directory, clients, max: 8 });
    paintChips();

  })();

  return () => { messages = []; pending = []; };
}

/* ---------------------------------------------------------------- markup */

function renderMessage(message, index) {
  const time = message.at ? formatTime(new Date(message.at)) : '';

  if (message.role === 'user') {
    const chips = [
      ...(message.images ? [`<i data-lucide="image" class="icon-sm"></i> ${message.images} صورة`] : []),
      ...(message.files || []).map((f) => `<i data-lucide="file-text" class="icon-sm"></i> ${esc(f)}`)
    ];
    return `
      <div class="ai-turn ai-turn--me">
        <div class="ai-turn__body">
          ${chips.length ? `<div class="ai-turn__files">${chips.join('')}</div>` : ''}
          <div class="ai-turn__text">${esc(message.content)}</div>
        </div>
      </div>`;
  }

  return `
    <div class="ai-turn">
      <span class="ai-page__mark ai-page__mark--sm"><i data-lucide="sparkles"></i></span>
      <div class="ai-turn__body">
        ${message.error
          ? `<div class="ai-error"><i data-lucide="alert-triangle"></i> ${esc(message.content)}</div>`
          : `${message.image ? `
              <figure class="ai-image">
                <img src="${attr(message.image)}" alt="صورة مولّدة" loading="lazy">
                <figcaption>
                  <a href="${attr(message.image)}" target="_blank"
                     rel="noopener noreferrer" download>
                    <i data-lucide="download" class="icon-sm"></i> فتح / تنزيل
                  </a>
                </figcaption>
              </figure>` : ''}
             ${message.content ? `<div class="ai-turn__text ai-text">${formatText(message.content)}</div>` : ''}`}
        ${renderSteps(message.steps)}
        ${renderCitations(message.citations)}
        ${renderDraft(message.draft, index)}
        <div class="ai-turn__meta">${esc(time)}</div>
      </div>
    </div>`;
}

function thinking(kind = 'ask') {
  // A drawing gets a canvas-shaped placeholder rather than three dots: it is
  // slower, and it lands as a picture, so the wait is shown at the size and
  // shape of the thing being waited for and nothing jumps when it arrives.
  const body = kind === 'image'
    ? `<figure class="ai-image-loading" role="img" aria-label="جارٍ رسم الصورة">
         <span class="ai-image-loading__wash" aria-hidden="true"></span>
         <span class="ai-image-loading__sheen" aria-hidden="true"></span>
         <figcaption class="ai-image-loading__label">
           <i data-lucide="sparkles"></i> يرسم الصورة…
         </figcaption>
       </figure>`
    : '<div class="ai-typing"><span></span><span></span><span></span></div>';

  return `
    <div class="ai-turn">
      <span class="ai-page__mark ai-page__mark--sm is-thinking"><i data-lucide="sparkles"></i></span>
      <div class="ai-turn__body">${body}</div>
    </div>`;
}
