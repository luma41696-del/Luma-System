/**
 * Modal / confirm / drawer primitives.
 * `bodyHTML` is trusted markup produced by the app; anything derived from user
 * input must be escaped by the caller (utils/dom.js `esc`) before it gets here.
 */

import { el, refreshIcons, trapFocus, $ } from './dom.js';

let openCount = 0;

export function openModal({
  title = '',
  subtitle = '',
  bodyHTML = '',
  bodyNode = null,
  footerHTML = '',
  size = '',
  closeOnBackdrop = true,
  onMount = null,
  onClose = null
} = {}) {
  const backdrop = el('div', { class: 'modal-backdrop', role: 'presentation' });
  const modal = el('div', {
    class: `modal${size ? ' modal--' + size : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title
  });

  modal.innerHTML = `
    <div class="modal__head">
      <div>
        <div class="modal__title">${title}</div>
        ${subtitle ? `<div class="modal__sub">${subtitle}</div>` : ''}
      </div>
      <button class="icon-btn" data-modal-close aria-label="إغلاق"><i data-lucide="x"></i></button>
    </div>
    <div class="modal__body"></div>
    ${footerHTML ? `<div class="modal__foot">${footerHTML}</div>` : ''}`;

  const body = $('.modal__body', modal);
  if (bodyNode) body.append(bodyNode);
  else body.innerHTML = bodyHTML;

  backdrop.append(modal);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  openCount++;

  refreshIcons(backdrop);
  const releaseFocus = trapFocus(modal);

  function close(result) {
    if (!backdrop.isConnected) return;
    releaseFocus();
    backdrop.remove();
    if (--openCount <= 0) { openCount = 0; document.body.style.overflow = ''; }
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  }

  function onKey(e) { if (e.key === 'Escape') close(undefined); }
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('mousedown', (e) => {
    if (closeOnBackdrop && e.target === backdrop) close(undefined);
  });
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-close]')) close(undefined);
  });

  const api = { close, root: modal, body, backdrop, $: (sel) => $(sel, modal) };
  onMount?.(api);

  // Focus the first meaningful control.
  setTimeout(() => {
    const first = modal.querySelector('input:not([type=hidden]), textarea, select, button:not([data-modal-close])');
    first?.focus();
  }, 60);

  return api;
}

/** Promise-based confirmation dialog. Resolves true / false. */
export function confirmDialog({
  title = 'تأكيد الإجراء',
  message = 'هل أنت متأكد؟',
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  danger = false,
  icon = danger ? 'alert-triangle' : 'help-circle'
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const modal = openModal({
      title,
      size: 'sm',
      bodyHTML: `
        <div class="flex gap-3 items-start">
          <span class="stat__icon ${danger ? 'stat__icon--danger' : 'stat__icon--brand'}">
            <i data-lucide="${icon}"></i>
          </span>
          <div class="flex-1" style="padding-top:6px">${message}</div>
        </div>`,
      footerHTML: `
        <button class="btn btn--ghost" data-cancel>${cancelText}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${confirmText}</button>`,
      onClose: () => finish(false),
      onMount: (api) => {
        api.$('[data-confirm]').addEventListener('click', () => { finish(true); api.close(); });
        api.$('[data-cancel]').addEventListener('click', () => { finish(false); api.close(); });
        setTimeout(() => api.$('[data-confirm]').focus(), 60);
      }
    });
    return modal;
  });
}

/** Prompt for a single line of text. Resolves the string or null. */
export function promptDialog({
  title = '',
  label = '',
  placeholder = '',
  value = '',
  type = 'text',
  confirmText = 'حفظ',
  required = true,
  multiline = false
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    openModal({
      title,
      size: 'sm',
      bodyHTML: `
        <div class="field">
          ${label ? `<label class="field__label" for="prompt-input">${label}</label>` : ''}
          ${multiline
            ? `<textarea class="textarea" id="prompt-input" placeholder="${placeholder}">${value}</textarea>`
            : `<input class="input" id="prompt-input" type="${type}" placeholder="${placeholder}" value="${value}">`}
          <div class="field__error" hidden data-err></div>
        </div>`,
      footerHTML: `
        <button class="btn btn--ghost" data-modal-close>إلغاء</button>
        <button class="btn btn--primary" data-ok>${confirmText}</button>`,
      onClose: () => finish(null),
      onMount: (api) => {
        const input = api.$('#prompt-input');
        const err = api.$('[data-err]');
        const submit = () => {
          const v = input.value.trim();
          if (required && !v) {
            err.textContent = 'هذا الحقل مطلوب';
            err.hidden = false;
            input.classList.add('has-error');
            return;
          }
          finish(v);
          api.close();
        };
        api.$('[data-ok]').addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); submit(); }
        });
      }
    });
  });
}

/** Full-screen image viewer for chat / attachments. */
export function lightbox(src, alt = '') {
  const node = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': alt || 'صورة' }, [
    el('img', { src, alt })
  ]);
  const close = () => { node.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  node.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(node);
}
