/**
 * Firebase Admin bootstrap. Initialised once and shared by every function.
 *
 * Uses the modular `firebase-admin/*` entry points rather than the legacy
 * `admin.firestore.FieldValue` namespace: the Functions Emulator wraps
 * `require('firebase-admin')` in a proxy that does not forward the static
 * members hanging off `admin.firestore`, so the namespaced form resolves to
 * `undefined` locally and crashes the runtime. The modular imports behave
 * identically in the emulator and in production.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');
const { getMessaging } = require('firebase-admin/messaging');

/**
 * Credentials.
 *
 * On Cloud Functions the runtime supplies them and `initializeApp()` needs no
 * arguments. Anywhere else — Netlify Functions, a container, a script — the
 * service-account JSON is passed in through FIREBASE_SERVICE_ACCOUNT so the
 * same code runs unchanged.
 */
function buildApp() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return initializeApp();

  let parsed;
  try {
    // Accept raw JSON or base64, since some dashboards mangle multi-line values.
    parsed = JSON.parse(
      raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    );
  } catch (err) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON (or base64 JSON): ' + err.message
    );
  }

  return initializeApp({
    credential: cert(parsed),
    projectId: parsed.project_id,
    databaseURL: process.env.FIREBASE_DATABASE_URL ||
      `https://${parsed.project_id}-default-rtdb.firebaseio.com`,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET ||
      `${parsed.project_id}.firebasestorage.app`
  });
}

const app = buildApp();

const db = getFirestore(app);
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch {
  // Already configured by an earlier import in the same runtime — harmless.
}

module.exports = {
  app,
  db,
  auth: getAuth(app),
  storage: getStorage(app),

  /** Messaging is only needed when a push is actually sent. */
  messaging: () => getMessaging(app),

  /**
   * Realtime Database, created on first access.
   * `getDatabase()` throws when no databaseURL is configured, and only the
   * presence/status code path needs it — so resolving it eagerly would take
   * every other function down with it.
   */
  get rtdb() {
    return getDatabase(app);
  },

  FieldValue,
  Timestamp,

  /** Cloud Functions region — must match FUNCTIONS_REGION in js/firebase-config.js. */
  REGION: 'europe-west1',
  /** Company timezone for scheduled jobs and day-boundary maths. */
  TIMEZONE: 'Asia/Amman'
};
