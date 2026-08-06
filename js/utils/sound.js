/**
 * Notification sound.
 *
 * Synthesised with the Web Audio API rather than shipped as a file: it is a few
 * lines, adds no asset to load, and cannot 404. The tone is a soft two-note
 * chime — the same idea as a messaging app, without being shrill.
 *
 * Browsers refuse to play audio until the user has interacted with the page, so
 * the context is created lazily on the first real click or keypress. Nothing is
 * ever heard before the employee has actually used the app.
 */

const PREF_KEY = 'luma.soundEnabled';

let context = null;
let unlocked = false;
let lastPlayed = 0;

/** Muting is per-device and survives reloads. */
export function soundEnabled() {
  try { return localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}

export function setSoundEnabled(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/**
 * Arm the audio context on the first user gesture.
 * Called once from the app shell.
 */
export function initSound() {
  const unlock = () => {
    if (unlocked) return;
    const ctx = ensureContext();
    if (!ctx) return;
    ctx.resume?.().catch(() => {});
    unlocked = true;
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: false });
  document.addEventListener('keydown', unlock, { once: false });
}

/**
 * Two descending notes, each a short sine with a soft attack and release so it
 * reads as a chime rather than a beep.
 */
function chime(ctx, startAt, frequency, duration, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Play the notification tone.
 * @param {{force?: boolean}} options force plays even when the tab is focused
 *        (used by the "test sound" button in settings).
 */
export function playNotificationSound({ force = false } = {}) {
  if (!soundEnabled() && !force) return false;
  if (!unlocked && !force) return false;

  // Never machine-gun the user when several notifications land together.
  const now = Date.now();
  if (!force && now - lastPlayed < 2500) return false;
  lastPlayed = now;

  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});

  const t = ctx.currentTime + 0.01;
  chime(ctx, t, 880, 0.16, 0.16);            // first note
  chime(ctx, t + 0.13, 1174.66, 0.22, 0.13); // a fourth above, softer
  return true;
}

/**
 * True when the employee is not looking at the app — another tab, another
 * window, or the app minimised. This is the condition for making a sound at all.
 */
export function isAway() {
  return document.visibilityState === 'hidden' || !document.hasFocus();
}
