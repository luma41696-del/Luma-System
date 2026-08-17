/**
 * App theme: dark (default), light, and a cosmic "space" palette.
 *
 * The value is persisted to localStorage and restored before first paint by
 * the inline script in dashboard.html, so this module only needs to update
 * the live document and notify listeners once the app is running — Chart.js
 * re-themes itself on the `luma:theme` event (see utils/charts.js).
 */

export const THEMES = ['dark', 'light', 'space', 'ship'];

export const THEME_META = {
  dark:  { icon: 'moon',     labelKey: 'settings.appearance.theme.dark',  hintKey: 'settings.appearance.theme.dark.hint' },
  light: { icon: 'sun',      labelKey: 'settings.appearance.theme.light', hintKey: 'settings.appearance.theme.light.hint' },
  space: { icon: 'sparkles', labelKey: 'settings.appearance.theme.space', hintKey: 'settings.appearance.theme.space.hint' },
  ship:  { icon: 'rocket',   labelKey: 'settings.appearance.theme.ship',  hintKey: 'settings.appearance.theme.ship.hint' }
};

export function getTheme() {
  const current = document.documentElement.dataset.theme;
  return THEMES.includes(current) ? current : 'dark';
}

export function setTheme(next) {
  if (!THEMES.includes(next) || next === getTheme()) return;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('luma.theme', next); } catch { /* private browsing */ }
  window.dispatchEvent(new CustomEvent('luma:theme', { detail: next }));
}

/** Dark → light → space → ship → dark, for the single sidebar toggle button. */
export function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  setTheme(next);
  return next;
}

/* ------------------------------------------------------------ glass effect */

/**
 * Frosted surfaces are a setting rather than part of a theme, because the
 * cost is the user's to accept: `backdrop-filter` re-blurs on every scroll
 * and repaint, which a low-powered machine feels. On by default — it is what
 * the themes were designed against — and switched off in one place.
 */
export function glassEnabled() {
  return document.documentElement.dataset.glass !== 'off';
}

export function setGlass(on) {
  document.documentElement.dataset.glass = on ? 'on' : 'off';
  try { localStorage.setItem('luma.glass', on ? 'on' : 'off'); } catch { /* private browsing */ }
  window.dispatchEvent(new CustomEvent('luma:glass', { detail: on }));
}

/**
 * Strength of the effect, as two dials each 0 → 100:
 *   panel     how frosted the panels themselves are
 *   backdrop  how strongly the page behind a dialog is veiled
 *
 * Stored as percentages because that is what the sliders speak; the
 * stylesheet works in 0 → 1, so they are divided on the way out.
 */
export const GLASS_DEFAULTS = { panel: 60, backdrop: 50 };

const clampPercent = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

export function getGlassStrength() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('luma.glassStrength') || '{}'); } catch { /* corrupt */ }
  return {
    panel: clampPercent(stored.panel, GLASS_DEFAULTS.panel),
    backdrop: clampPercent(stored.backdrop, GLASS_DEFAULTS.backdrop)
  };
}

export function setGlassStrength({ panel, backdrop } = {}) {
  const next = getGlassStrength();
  if (panel !== undefined) next.panel = clampPercent(panel, next.panel);
  if (backdrop !== undefined) next.backdrop = clampPercent(backdrop, next.backdrop);

  applyGlassStrength(next);
  try { localStorage.setItem('luma.glassStrength', JSON.stringify(next)); } catch { /* private browsing */ }
  window.dispatchEvent(new CustomEvent('luma:glass', { detail: next }));
  return next;
}

/** Write the dials onto the document. Shared with the pre-paint restore. */
export function applyGlassStrength({ panel, backdrop }) {
  const style = document.documentElement.style;
  style.setProperty('--glass-panel', String(panel / 100));
  style.setProperty('--glass-backdrop', String(backdrop / 100));
}
