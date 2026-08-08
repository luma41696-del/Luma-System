/**
 * Thin wrapper around callable Cloud Functions plus a few Firestore helpers.
 * Every privileged operation in the app goes through `callFn` — the function
 * re-validates the caller's claims server-side before doing anything.
 */

import { functions, db } from '../firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-functions.js';
import {
  collection, doc, getDoc, getDocs, query, where, limit as qLimit,
  orderBy, serverTimestamp, addDoc, updateDoc, setDoc, deleteDoc,
  onSnapshot, startAfter, documentId, arrayUnion
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const cache = new Map();

/**
 * Where the privileged backend lives.
 *
 * Cloud Functions need the Blaze plan, so the same handlers can instead be
 * served by Netlify Functions on the free tier. Set the base URL and every
 * `callFn` goes there over the identical callable protocol:
 *
 *   <script>window.__LUMA_API_BASE__ = "/.netlify/functions/api";</script>
 *
 * Leave it unset to use Firebase Cloud Functions.
 */
const API_BASE = (typeof window !== 'undefined' && window.__LUMA_API_BASE__) || '';

/** CALLABLE_STATUS → the hyphenated codes the UI already maps to Arabic. */
function toErrorCode(status) {
  return String(status || 'INTERNAL').toLowerCase().replace(/_/g, '-');
}

async function callViaHttp(name, payload) {
  const { auth } = await import('../firebase-config.js');
  const user = auth.currentUser;

  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;

  let response;
  try {
    response = await fetch(`${API_BASE}/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: payload })
    });
  } catch {
    const err = new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت.');
    err.code = 'unavailable';
    throw err;
  }

  let body = {};
  try { body = await response.json(); } catch { /* empty or non-JSON */ }

  if (!response.ok || body.error) {
    const err = new Error(body.error?.message || 'حدث خطأ في الخادم.');
    err.code = toErrorCode(body.error?.status);
    err.details = body.error?.details;
    throw err;
  }
  return body.result;
}

/**
 * @param {string} name    exported callable name
 * @param {object} payload plain JSON payload
 */
export async function callFn(name, payload = {}) {
  if (API_BASE) return callViaHttp(name, payload);
  if (!cache.has(name)) cache.set(name, httpsCallable(functions, name, { timeout: 60_000 }));
  const result = await cache.get(name)(payload);
  return result.data;
}

/* ------------------------------------------------------- firestore sugar */

export const ts = serverTimestamp;

export function col(...segments) {
  return collection(db, ...segments);
}

export function ref(...segments) {
  return doc(db, ...segments);
}

export async function getOne(...segments) {
  const snap = await getDoc(doc(db, ...segments));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function snapToArray(snapshot) {
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMany(q) {
  return snapToArray(await getDocs(q));
}

/**
 * Firestore `in` queries are capped at 30 values — chunk transparently.
 */
export async function getByIds(collectionName, ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
  const results = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, collectionName), where(documentId(), 'in', chunk))))
  );
  return results.flatMap(snapToArray);
}

export {
  collection, doc, getDoc, getDocs, query, where, qLimit as limit,
  orderBy, addDoc, updateDoc, setDoc, deleteDoc, onSnapshot, startAfter, documentId,
  arrayUnion
};

/* ------------------------------------------------------------ user cache */

/**
 * Small in-memory directory cache. Employee records change rarely and are read
 * constantly (task assignees, chat authors, comments), so this saves a lot of
 * reads without risking stale security decisions — it holds display data only.
 */
const userCache = new Map();
let directoryPromise = null;

export async function getUser(uid) {
  if (!uid) return null;
  if (userCache.has(uid)) return userCache.get(uid);
  const user = await getOne('users', uid);
  if (user) userCache.set(uid, user);
  return user;
}

export async function getUsers(uids = []) {
  const missing = uids.filter((id) => id && !userCache.has(id));
  if (missing.length) {
    const fetched = await getByIds('users', missing);
    fetched.forEach((u) => userCache.set(u.id, u));
  }
  return uids.map((id) => userCache.get(id)).filter(Boolean);
}

let directoryUnsub = null;
let directoryRows = null;

/**
 * The employee directory, used by every picker, the team page and chat.
 *
 * Backed by a live listener rather than a one-shot read: a promise cached for
 * the lifetime of the page meant a deleted (or newly created) employee kept
 * showing up in assignee pickers and chat member lists until a hard refresh.
 * With a snapshot the list corrects itself everywhere the moment it changes.
 */
export async function getDirectory(force = false) {
  if (force) {
    directoryUnsub?.();
    directoryUnsub = null;
    directoryPromise = null;
    directoryRows = null;
  }
  if (directoryRows) return directoryRows;

  if (!directoryPromise) {
    directoryPromise = new Promise((resolve, reject) => {
      let settled = false;
      directoryUnsub = onSnapshot(
        query(collection(db, 'users'), orderBy('displayName')),
        (snap) => {
          const rows = snapToArray(snap);
          const present = new Set(rows.map((u) => u.id));
          rows.forEach((u) => userCache.set(u.id, u));
          // Drop anyone who no longer exists so stale names cannot resurface.
          [...userCache.keys()].forEach((id) => {
            if (!present.has(id)) userCache.delete(id);
          });
          directoryRows = rows;
          if (!settled) { settled = true; resolve(rows); }
          window.dispatchEvent(new CustomEvent('luma:directory', { detail: rows }));
        },
        (err) => {
          directoryUnsub = null;
          directoryPromise = null;
          if (!settled) { settled = true; reject(err); }
        }
      );
    });
  }
  return directoryPromise;
}

export function primeUserCache(users = []) {
  users.forEach((u) => u?.id && userCache.set(u.id, u));
}

export function invalidateDirectory() {
  directoryUnsub?.();
  directoryUnsub = null;
  directoryPromise = null;
  directoryRows = null;
  userCache.clear();
}
