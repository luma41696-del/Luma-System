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

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');
const { getMessaging } = require('firebase-admin/messaging');

const app = getApps().length ? getApps()[0] : initializeApp();

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
