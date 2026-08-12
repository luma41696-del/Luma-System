/**
 * App theme: dark (default), light, and a cosmic "space" palette.
 *
 * The value is persisted to localStorage and restored before first paint by
 * the inline script in dashboard.html, so this module only needs to update
 * the live document and notify listeners once the app is running — Chart.js
 * re-themes itself on the `luma:theme` event (see utils/charts.js).
 */

export const THEMES = ['dark', 'light', 'space'];

export const THEME_META = {
  dark:  { icon: 'moon',     labelKey: 'settings.appearance.theme.dark',  hintKey: 'settings.appearance.theme.dark.hint' },
  light: { icon: 'sun',      labelKey: 'settings.appearance.theme.light', hintKey: 'settings.appearance.theme.light.hint' },
  space: { icon: 'sparkles', labelKey: 'settings.appearance.theme.space', hintKey: 'settings.appearance.theme.space.hint' }
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

/** Dark → light → space → dark, for the single sidebar toggle button. */
export function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  setTheme(next);
  return next;
}
