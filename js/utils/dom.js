/**
 * Tiny DOM helpers. Everything that builds markup from user data goes through
 * `esc()` or the sanitizer in utils/sanitize.js — never raw innerHTML.
 */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML-escape a value for safe interpolation into a template string. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a value that will sit inside a quoted HTML attribute. */
export const attr = esc;

/**
 * createElement with props and children in one call.
 * el('div', { class: 'card', onclick: fn }, [child, 'text'])
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;    // caller guarantees safety
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace the children of a container. Accepts an HTML string or nodes. */
export function render(container, content) {
  if (!container) return container;
  container.innerHTML = '';
  if (typeof content === 'string') container.innerHTML = content;
  else container.append(...[].concat(content).filter(Boolean));
  refreshIcons(container);
  return container;
}

/**
 * Ask Lucide to swap every <i data-lucide> inside `root` for an SVG.
 *
 * The Lucide bundle is a deferred <script>, so a module can call this before
 * the library exists. Rather than silently doing nothing, queue the request and
 * replay it as soon as the library shows up.
 */
const pendingIconRoots = new Set();
let iconWatcher = null;

export function refreshIcons(root = document) {
  if (!window.lucide?.createIcons) {
    pendingIconRoots.add(root);
    startIconWatcher();
    return;
  }
  // createIcons() has no `root` option and defaults `icons` to an EMPTY map when
  // an options object is supplied — so the icon set must be passed explicitly.
  // It always scans the whole document, which is fine: already-replaced nodes no
  // longer carry the data-lucide attribute, so repeat calls are cheap.
  try {
    window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: 'data-lucide' });
  } catch {
    window.lucide.createIcons();
  }
}

function startIconWatcher() {
  if (iconWatcher) return;
  let attempts = 0;
  iconWatcher = setInterval(() => {
    if (window.lucide?.createIcons) {
      clearInterval(iconWatcher);
      iconWatcher = null;
      const roots = [...pendingIconRoots];
      pendingIconRoots.clear();
      roots.forEach((root) => {
        if (root === document || root.isConnected) refreshIcons(root);
      });
    } else if (++attempts > 80) {          // ~8s — the CDN is not coming
      clearInterval(iconWatcher);
      iconWatcher = null;
      pendingIconRoots.clear();
      console.warn('[luma] Lucide icons failed to load.');
    }
  }, 100);
}

/** Render the icons present in the initial HTML. Call once per page. */
export function bootIcons() {
  refreshIcons(document);
  window.addEventListener('load', () => refreshIcons(document), { once: true });
}

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function show(node, visible = true) {
  if (node) node.hidden = !visible;
}

export function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('is-loading', busy);
  button.disabled = busy;
}

export function debounce(fn, wait = 280) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 200) {
  let last = 0, pending = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) { last = now; fn(...args); }
    else {
      clearTimeout(pending);
      pending = setTimeout(() => { last = Date.now(); fn(...args); }, wait - (now - last));
    }
  };
}

/* ------------------------------------------------------------- fragments */

export function skeletonCards(count = 4, className = 'skeleton--card') {
  return `<div class="grid grid-4">${
    Array.from({ length: count }, () => `<div class="skeleton ${className}"></div>`).join('')
  }</div>`;
}

export function skeletonRows(count = 6) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton--row"></div>').join('');
}

export function emptyState({ icon = 'inbox', title = 'لا توجد بيانات', text = '', action = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon"><i data-lucide="${attr(icon)}"></i></div>
      <div class="empty-state__title">${esc(title)}</div>
      ${text ? `<p class="empty-state__text">${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

export function errorState(message, retryId = '') {
  return `
    <div class="empty-state error-state">
      <div class="empty-state__icon"><i data-lucide="alert-triangle"></i></div>
      <div class="empty-state__title">حدث خطأ</div>
      <p class="empty-state__text">${esc(message)}</p>
      ${retryId ? `<button class="btn btn--secondary" id="${attr(retryId)}">
        <i data-lucide="rotate-cw"></i> إعادة المحاولة</button>` : ''}
    </div>`;
}

/** Colour-stable initials avatar used when a user has no photo. */
export function avatarHTML(user = {}, size = '') {
  const name = user.displayName || user.name || '؟';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  const cls = size ? `avatar avatar--${size}` : 'avatar';
  if (user.photoURL) {
    return `<span class="${cls}"><img src="${attr(user.photoURL)}" alt="${attr(name)}" loading="lazy"></span>`;
  }
  return `<span class="${cls}" style="background:hsl(${hue} 62% 42%);color:#fff" aria-label="${attr(name)}">${esc(initials)}</span>`;
}

/** Avatar with a live presence dot. */
export function avatarWithPresence(user = {}, state = 'offline', size = '') {
  return `<span class="avatar-wrap">${avatarHTML(user, size)}<span class="presence presence--${attr(state)}"></span></span>`;
}

export function avatarStack(users = [], max = 4) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return `<div class="avatar-stack">${
    shown.map((u) => avatarHTML(u, 'sm')).join('')
  }${rest > 0 ? `<span class="avatar-stack__more">${rest}+</span>` : ''}</div>`;
}

/** Escape a string for use inside a CSS/JS selector attribute. */
export function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

/** Trap focus inside a container (used by modals). */
export function trapFocus(container) {
  const selector =
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = $$(selector, container).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
