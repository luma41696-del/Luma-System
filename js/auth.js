/**
 * Luma Agency — authentication & session.
 *
 * Login is presented as *username* + password, but Firebase Authentication is
 * still doing the password verification. The username → auth-account mapping is
 * resolved by a Cloud Function (`resolveUsername`) which:
 *   • reads the private `usernames/{lowercase}` index the browser cannot read,
 *   • enforces per-username and per-IP lockout after repeated failures,
 *   • returns only the internal auth address, never anything about the account.
 *
 * Nothing sensitive is ever cached in localStorage: only the username the user
 * chose to remember and the UI theme.
 */

import { auth, db, applyPersistence } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onIdTokenChanged
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import { doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { callFn } from './utils/api.js';
import { normalizeUsername, checkPassword } from './utils/sanitize.js';
import { codesToPerms } from './permissions.js';

const REMEMBER_KEY = 'luma.rememberedUsername';

/* -------------------------------------------------------------- session */

export const session = {
  user: null,       // Firebase User
  claims: null,     // { role, perms:[codes], status }
  profile: null,    // users/{uid} document
  ready: false,
  /** Full permission names, derived from the claim codes (for readability). */
  get permissions() { return codesToPerms(this.claims?.perms || []); },
  get uid() { return this.user?.uid || null; },
  get displayName() { return this.profile?.displayName || this.user?.displayName || ''; }
};

const listeners = new Set();
let profileUnsub = null;

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onSession(callback) {
  listeners.add(callback);
  if (session.ready) callback(session);
  return () => listeners.delete(callback);
}

function emit() {
  listeners.forEach((cb) => {
    try { cb(session); } catch (err) { console.error('[luma] session listener', err); }
  });
}

/* ---------------------------------------------------------------- login */

/**
 * @param {string} username    as typed
 * @param {string} password
 * @param {boolean} remember   persist the session across browser restarts
 */
export async function signInWithUsername(username, password, remember = false) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('يرجى إدخال اسم المستخدم.');
  if (!password) throw new Error('يرجى إدخال كلمة المرور.');

  // Server resolves the username and applies the lockout policy.
  const { email } = await callFn('resolveUsername', { username: normalized });
  if (!email) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');

  await applyPersistence(remember);

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // Reset the failure counter for this username.
    callFn('reportLoginResult', { username: normalized, success: true }).catch(() => {});
    await refreshClaims(true);
    return credential.user;
  } catch (err) {
    // Record the miss so the server-side lockout can do its job.
    callFn('reportLoginResult', { username: normalized, success: false }).catch(() => {});
    throw err;
  }
}

export async function signOutUser() {
  try {
    const { goOffline } = await import('./utils/presence.js');
    await goOffline();
  } catch { /* presence is best-effort */ }
  profileUnsub?.();
  profileUnsub = null;
  await signOut(auth);
}

/** Ask the backend to email a reset link to the account's recovery address. */
export async function requestPasswordReset(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('يرجى إدخال اسم المستخدم.');
  // Always resolves successfully — the response must not reveal whether the
  // username exists.
  await callFn('requestPasswordReset', { username: normalized });
  return true;
}

/* ------------------------------------------------------------- password */

/**
 * Change the signed-in user's password. Firebase requires a recent login for
 * this, so we re-authenticate with the current password first.
 */
export async function changeOwnPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.');

  const policy = checkPassword(newPassword);
  if (!policy.ok) throw new Error(policy.issues[0]);
  if (currentPassword === newPassword) {
    throw new Error('كلمة المرور الجديدة يجب أن تختلف عن الحالية.');
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);

  // Clears mustChangePassword and writes an audit entry.
  await callFn('completePasswordChange', {});
  await refreshClaims(true);
  return true;
}

/**
 * Re-authenticate for a sensitive action (viewing a client credential).
 * Returns true on success; throws on a wrong password.
 */
export async function reauthenticate(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('انتهت الجلسة.');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  return true;
}

/* --------------------------------------------------------------- claims */

export async function refreshClaims(force = false) {
  const user = auth.currentUser;
  if (!user) { session.claims = null; return null; }
  const token = await user.getIdTokenResult(force);
  session.claims = {
    role: token.claims.role || 'employee',
    perms: Array.isArray(token.claims.perms) ? token.claims.perms : [],
    status: token.claims.status || 'active'
  };
  return session.claims;
}

/* -------------------------------------------------------------- profile */

function watchProfile(uid) {
  profileUnsub?.();
  profileUnsub = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      session.profile = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      emit();
    },
    (err) => {
      console.error('[luma] profile listener', err);
      session.profile = null;
      emit();
    }
  );
}

export async function loadProfileOnce(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ----------------------------------------------------------- lifecycle */

let readyResolve;
export const authReady = new Promise((resolve) => { readyResolve = resolve; });

onAuthStateChanged(auth, async (user) => {
  session.user = user;
  if (user) {
    await refreshClaims(true);
    watchProfile(user.uid);
  } else {
    profileUnsub?.();
    profileUnsub = null;
    session.claims = null;
    session.profile = null;
  }
  session.ready = true;
  emit();
  readyResolve(session);
});

/* Claims can change while the user is signed in (a manager grants a
   permission). Keep the in-memory copy in step with the refreshed token. */
onIdTokenChanged(auth, async (user) => {
  if (user && session.ready) {
    const before = JSON.stringify(session.claims);
    await refreshClaims(false);
    if (JSON.stringify(session.claims) !== before) emit();
  }
});

/* --------------------------------------------------------------- guards */

/** Redirect to the login page unless a session exists. */
export async function requireAuth(loginUrl = 'index.html') {
  await authReady;
  if (!session.user) {
    location.replace(`${loginUrl}?next=${encodeURIComponent(location.hash || '#/')}`);
    return false;
  }
  if (session.claims?.status === 'disabled') {
    await signOutUser();
    location.replace(`${loginUrl}?disabled=1`);
    return false;
  }
  return true;
}

/* ------------------------------------------------------- remembered name */

export function rememberedUsername() {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; }
}

export function setRememberedUsername(username) {
  try {
    if (username) localStorage.setItem(REMEMBER_KEY, normalizeUsername(username));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* private browsing */ }
}
