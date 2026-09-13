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

/**
 * Delegated event listener.
 *
 * Returns a function that removes it. That matters when the root outlives the
 * page that bound to it: the router hands every route the same container
 * element and only replaces its contents, so a listener left on it survives
 * the page that added it and fires again — once more on every later visit.
 * A page that binds here should push the returned disposer into whatever it
 * tears down on the way out.
 */
export function on(root, event, selector, handler) {
  const listener = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, listener);
  return () => root.removeEventListener(event, listener);
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
/**
 * Colours people are told apart by.
 *
 * A fixed list rather than a hue computed from the name. Hues derived by
 * arithmetic drift into each other and into mud — and a sum of character codes
 * puts every Arabic name in the same narrow band of the wheel, because Arabic
 * letters share a code range, so half the company came out the same blue.
 *
 * All are dark enough to carry white initials.
 */
const PERSON_TINTS = [
  '#B91C1C', '#C2410C', '#B45309', '#4D7C0F', '#15803D',
  '#0F766E', '#0E7490', '#0369A1', '#1D4ED8', '#4338CA',
  '#6D28D9', '#A21CAF', '#BE185D', '#9F1239', '#57534E', '#3F6212'
];

/** Where a seed lands on the list on its own. FNV-1a, because neighbouring
 *  seeds have to fall far apart — a plain sum of character codes would put
 *  "أحمد" and "أحمر" side by side. */
function tintSlot(seed) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PERSON_TINTS.length;
}

/** Colours handed out by assignPersonTints, keyed by account id. */
const tintById = new Map();

/**
 * Give everyone in the directory a colour nobody else has.
 *
 * The hash alone does not manage it. It spreads evenly — sixteen slots take
 * an even sixteenth of the ids each, measured — but evenly is not the same as
 * without collisions: ten people over sixteen colours end up sharing one
 * about 98 times in a hundred, for the same reason two people in a small room
 * usually share a birthday. And "a colour of their own" has to mean nobody
 * else's.
 *
 * So each person keeps their hashed colour where it is free and takes the
 * next free one where it is not. Sorted by id, so the same roster always
 * produces the same assignment however the directory happened to arrive, and
 * so a new hire displaces at most the few people their own colour was already
 * shared with. Past sixteen people the list wraps and sharing resumes, which
 * is a better failure than a seventeenth colour nobody can tell from the
 * third.
 */
export function assignPersonTints(people = []) {
  tintById.clear();
  const taken = new Set();

  for (const person of [...people].filter((p) => p?.id).sort((a, b) => a.id.localeCompare(b.id))) {
    let slot = tintSlot(person.id);
    for (let step = 0; step < PERSON_TINTS.length && taken.has(slot); step++) {
      slot = (slot + 1) % PERSON_TINTS.length;
    }
    taken.add(slot);
    tintById.set(person.id, PERSON_TINTS[slot]);
  }
  return tintById;
}

/**
 * The colour that belongs to one person, and keeps belonging to them.
 *
 * Seeded by the account id where there is one: two people can share a name,
 * one person can change theirs, and a colour that moves when someone gets
 * married is not an identity. Falls back to the hash for anything not in the
 * directory — a client's logo stand-in, or an avatar drawn before the
 * directory has arrived.
 */
export function personTint(seed = '') {
  return tintById.get(seed) || PERSON_TINTS[tintSlot(seed)];
}

// The directory is loaded once and shared (see getDirectory), and it announces
// itself when it lands or changes. Reacting to that here keeps the data layer
// from having to know what a colour is.
if (typeof window !== 'undefined') {
  window.addEventListener('luma:directory', (e) => assignPersonTints(e.detail || []));
}

/**
 * @param {object} user
 * @param {string} size
 * @param {{photo?: boolean}} options
 *   `photo: false` asks for the colour block and initials even when there is a
 *   photograph. Somewhere small enough that a face is a smudge, the block says
 *   who at a glance and the photograph says nothing — particularly here, where
 *   most of the company is using the same stock portrait.
 */
export function avatarHTML(user = {}, size = '', { photo = true } = {}) {
  const name = user.displayName || user.name || '؟';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const tint = personTint(user.id || user.uid || name);
  const cls = size ? `avatar avatar--${size}` : 'avatar';
  // Published as a custom property as well as painted: a photo covers the
  // background, so anywhere that wants to show whose face it is — a ring, a
  // bar — needs the colour rather than the fill.
  const style = `--avatar-tint:${tint};background:${tint};color:#fff`;
  if (photo && user.photoURL) {
    // The initials travel with the photo so a dead URL can fall back to them
    // instead of leaving a broken-image glyph where a face should be.
    return `<span class="${cls}" style="${style}">` +
      `<img src="${attr(user.photoURL)}" alt="${attr(name)}" loading="lazy" ` +
      `data-initials="${attr(initials)}"></span>`;
  }
  return `<span class="${cls}" style="${style}" aria-label="${attr(name)}">${esc(initials)}</span>`;
}

/**
 * Replace images that fail to load.
 *
 * A deleted client logo or a stale photo URL used to leave the browser's
 * broken-image icon sitting in the layout — the one piece of a card nobody
 * designed. There is no per-image handler here because `error` does not
 * bubble: one capturing listener on the document catches every image in the
 * app, including ones rendered long after this runs.
 *
 * An image says what it wants instead: `data-initials` for a person,
 * `data-fallback` naming a lucide icon for anything else.
 */
function initImageFallbacks() {
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fellBack) return;
    img.dataset.fellBack = '1';

    const { initials, fallback } = img.dataset;

    if (initials) {
      const holder = img.parentElement;
      img.remove();
      if (holder) holder.textContent = initials;
      return;
    }

    if (fallback) {
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', fallback);
      icon.className = img.className;
      img.replaceWith(icon);
      refreshIcons(icon.parentElement || document);
      return;
    }

    img.remove();
  }, true);
}

initImageFallbacks();

/** Avatar with a live presence dot. */
export function avatarWithPresence(user = {}, state = 'offline', size = '') {
  return `<span class="avatar-wrap">${avatarHTML(user, size)}<span class="presence presence--${attr(state)}"></span></span>`;
}

export function avatarStack(users = [], max = 4, options = {}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return `<div class="avatar-stack">${
    shown.map((u) => avatarHTML(u, 'sm', options)).join('')
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
