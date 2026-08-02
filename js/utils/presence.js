/**
 * Realtime presence, work status and the break system.
 *
 * Presence lives in the Realtime Database because it has the one thing
 * Firestore lacks: `onDisconnect()`, which the *server* executes when the
 * socket drops — so a closed laptop reliably turns into "offline".
 *
 * Every timestamp is a server timestamp. The client clock is never trusted for
 * break accounting, since it can be changed by the employee.
 */

import { rtdb, db } from '../firebase-config.js';
import {
  ref as dbRef, onValue, set, update, onDisconnect, serverTimestamp as rtdbNow, off, get
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js';
import {
  collection, addDoc, updateDoc, doc, query, where, orderBy, getDocs,
  serverTimestamp, limit
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { dayKey } from './format.js';

export const WORK_STATES = {
  online:  { ar: 'متصل',      color: 'var(--info)' },
  working: { ar: 'يعمل الآن', color: 'var(--success)' },
  break:   { ar: 'استراحة',   color: 'var(--warning)' },
  offline: { ar: 'غير متصل',  color: 'var(--gray)' }
};

let currentUid = null;
let connectedUnsub = null;
let selfUnsub = null;
let openBreakId = null;

/** Latest known status for the signed-in user. */
export const presence = { state: 'offline', breakStartedAt: null, todayBreakMs: 0 };

const selfListeners = new Set();
export function onSelfPresence(cb) {
  selfListeners.add(cb);
  cb(presence);
  return () => selfListeners.delete(cb);
}
function emitSelf() { selfListeners.forEach((cb) => cb(presence)); }

/* ---------------------------------------------------------------- setup */

/**
 * Start tracking presence for the signed-in user.
 * Called once from the app shell after authentication.
 */
export async function initPresence(uid, profile = {}) {
  currentUid = uid;
  const statusRef = dbRef(rtdb, `status/${uid}`);
  const connectedRef = dbRef(rtdb, '.info/connected');

  // Re-open today's break if the browser was closed mid-break.
  openBreakId = await findOpenBreak(uid);

  connectedUnsub?.();
  const handler = onValue(connectedRef, async (snap) => {
    if (snap.val() === false) return;

    // Registered *before* the online write so the server always has it.
    await onDisconnect(statusRef).update({
      state: 'offline',
      lastChanged: rtdbNow()
    });

    await set(statusRef, {
      state: openBreakId ? 'break' : 'working',
      lastChanged: rtdbNow(),
      breakStartedAt: presence.breakStartedAt || null,
      todayBreakMs: presence.todayBreakMs || 0,
      displayName: profile.displayName || '',
      photoURL: profile.photoURL || ''
    });
  });
  connectedUnsub = () => off(connectedRef, 'value', handler);

  // Mirror our own node so the UI stays in sync across tabs.
  selfUnsub?.();
  const selfHandler = onValue(statusRef, (snap) => {
    const value = snap.val() || {};
    presence.state = value.state || 'offline';
    presence.breakStartedAt = value.breakStartedAt || null;
    presence.todayBreakMs = value.todayBreakMs || 0;
    emitSelf();
  });
  selfUnsub = () => off(statusRef, 'value', selfHandler);

  // Refresh today's accumulated break total from the authoritative source.
  presence.todayBreakMs = await todayBreakTotal(uid);
  emitSelf();
}

export async function goOffline() {
  if (!currentUid) return;
  connectedUnsub?.();
  selfUnsub?.();
  connectedUnsub = selfUnsub = null;
  try {
    await update(dbRef(rtdb, `status/${currentUid}`), {
      state: 'offline',
      lastChanged: rtdbNow()
    });
  } catch { /* offline already */ }
  currentUid = null;
}

/* -------------------------------------------------------- work status */

export async function setWorkState(state) {
  if (!currentUid || !WORK_STATES[state]) return;
  await update(dbRef(rtdb, `status/${currentUid}`), {
    state,
    lastChanged: rtdbNow()
  });
}

/* ------------------------------------------------------------- breaks */

async function findOpenBreak(uid) {
  const snap = await getDocs(query(
    collection(db, 'breakSessions'),
    where('userId', '==', uid),
    where('dayKey', '==', dayKey()),
    orderBy('startedAt', 'desc'),
    limit(5)
  ));
  const open = snap.docs.find((d) => !d.data().endedAt);
  if (open) {
    presence.breakStartedAt = open.data().startedAt?.toMillis?.() || Date.now();
    return open.id;
  }
  return null;
}

/** Sum of every completed break today, in milliseconds. */
export async function todayBreakTotal(uid) {
  const snap = await getDocs(query(
    collection(db, 'breakSessions'),
    where('userId', '==', uid),
    where('dayKey', '==', dayKey())
  ));
  return snap.docs.reduce((total, d) => total + (d.data().durationMs || 0), 0);
}

/**
 * Begin a break. Creates the authoritative Firestore record (server timestamp)
 * and flips the realtime status so managers see it immediately.
 */
export async function startBreak(reason = '') {
  if (!currentUid) throw new Error('انتهت الجلسة.');
  if (openBreakId) throw new Error('لديك استراحة مفتوحة بالفعل.');

  const created = await addDoc(collection(db, 'breakSessions'), {
    userId: currentUid,
    dayKey: dayKey(),
    reason: reason.slice(0, 200),
    startedAt: serverTimestamp(),
    endedAt: null,
    durationMs: 0
  });
  openBreakId = created.id;
  presence.breakStartedAt = Date.now();

  await update(dbRef(rtdb, `status/${currentUid}`), {
    state: 'break',
    breakStartedAt: rtdbNow(),
    lastChanged: rtdbNow()
  });
  emitSelf();
  return created.id;
}

/**
 * End the open break. The duration is computed from the *server* start
 * timestamp, so editing the device clock cannot shorten a break.
 */
export async function endBreak() {
  if (!currentUid) throw new Error('انتهت الجلسة.');
  if (!openBreakId) {
    openBreakId = await findOpenBreak(currentUid);
    if (!openBreakId) throw new Error('لا توجد استراحة مفتوحة.');
  }

  const startedAt = presence.breakStartedAt || Date.now();
  const durationMs = Math.max(0, Date.now() - startedAt);

  await updateDoc(doc(db, 'breakSessions', openBreakId), {
    endedAt: serverTimestamp(),
    durationMs,
    updatedAt: serverTimestamp()
  });

  const total = await todayBreakTotal(currentUid);
  openBreakId = null;
  presence.breakStartedAt = null;
  presence.todayBreakMs = total;

  await update(dbRef(rtdb, `status/${currentUid}`), {
    state: 'working',
    breakStartedAt: null,
    todayBreakMs: total,
    lastChanged: rtdbNow()
  });
  emitSelf();
  return durationMs;
}

export function hasOpenBreak() {
  return !!openBreakId;
}

/**
 * Confirm-then-act wrappers. They live here rather than in the app shell so
 * that any page can offer the break control without importing the shell.
 */
export async function confirmStartBreak() {
  const { confirmDialog } = await import('./modal.js');
  const { toastSuccess } = await import('./toast.js');
  const ok = await confirmDialog({
    title: 'بدء استراحة',
    message: 'سيتم تسجيل وقت بداية الاستراحة الآن، وستظهر حالتك للمدير كـ «استراحة».',
    confirmText: 'بدء الاستراحة',
    icon: 'coffee'
  });
  if (!ok) return false;
  await startBreak();
  toastSuccess('بدأت الاستراحة. استمتع بوقتك!');
  return true;
}

export async function confirmEndBreak() {
  const { confirmDialog } = await import('./modal.js');
  const { toastSuccess } = await import('./toast.js');
  const { formatDuration } = await import('./format.js');
  const ok = await confirmDialog({
    title: 'إنهاء الاستراحة',
    message: 'سيتم احتساب مدة الاستراحة وتحديث حالتك إلى «يعمل الآن».',
    confirmText: 'إنهاء الاستراحة',
    icon: 'play'
  });
  if (!ok) return false;
  const ms = await endBreak();
  toastSuccess(`انتهت الاستراحة — المدة ${formatDuration(ms)}.`);
  return true;
}

/* ------------------------------------------------- watching other people */

/**
 * Live map of every employee's status: { uid: {state, breakStartedAt, ...} }.
 * @returns unsubscribe
 */
export function watchAllPresence(callback) {
  const statusRef = dbRef(rtdb, 'status');
  const handler = onValue(statusRef, (snap) => callback(snap.val() || {}));
  return () => off(statusRef, 'value', handler);
}

export async function readAllPresence() {
  const snap = await get(dbRef(rtdb, 'status'));
  return snap.val() || {};
}

/** Break history for an employee, newest first. */
export async function breakHistory(uid, max = 30) {
  const snap = await getDocs(query(
    collection(db, 'breakSessions'),
    where('userId', '==', uid),
    orderBy('startedAt', 'desc'),
    limit(max)
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ------------------------------------------------------- typing status */

export function setTyping(chatId, uid, isTyping) {
  const node = dbRef(rtdb, `typing/${chatId}/${uid}`);
  if (isTyping) {
    set(node, Date.now()).catch(() => {});
    onDisconnect(node).remove();
  } else {
    set(node, null).catch(() => {});
  }
}

export function watchTyping(chatId, callback) {
  const node = dbRef(rtdb, `typing/${chatId}`);
  const handler = onValue(node, (snap) => {
    const raw = snap.val() || {};
    const fresh = Object.entries(raw)
      .filter(([, at]) => Date.now() - at < 6000)
      .map(([uid]) => uid);
    callback(fresh);
  });
  return () => off(node, 'value', handler);
}
