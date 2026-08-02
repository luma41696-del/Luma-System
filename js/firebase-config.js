/**
 * Luma Agency — Firebase bootstrap.
 *
 * Every Firebase service the app uses is initialised here exactly once and
 * re-exported, so no other module ever calls initializeApp().
 *
 * Note on secrets: the values below are *public* client identifiers. They are
 * not credentials — access is controlled by Security Rules, custom claims and
 * App Check. Real secrets (encryption keys, service accounts) live only in
 * Cloud Functions / Secret Manager. See .env.example.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-functions.js';
import { getAnalytics, isSupported as analyticsSupported }
  from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-analytics.js';

/* -------------------------------------------------------------------------- */
/* Project configuration                                                      */
/* -------------------------------------------------------------------------- */

export const firebaseConfig = {
  apiKey: 'AIzaSyCkSJwy2lBbgQJD9W6mdDPuV15nttJhIwk',
  authDomain: 'luma-web-d3550.firebaseapp.com',
  databaseURL: 'https://luma-web-d3550-default-rtdb.firebaseio.com',
  projectId: 'luma-web-d3550',
  storageBucket: 'luma-web-d3550.firebasestorage.app',
  messagingSenderId: '1005101836242',
  appId: '1:1005101836242:web:42f3e19d5b4534a2c1ca0b',
  measurementId: 'G-V3Z5HFHX0Q'
};

/** Cloud Functions region — must match functions/index.js. */
export const FUNCTIONS_REGION = 'europe-west1';

/** Company timezone used for every day-boundary calculation. */
export const TIMEZONE = 'Asia/Amman';

/**
 * reCAPTCHA v3 site key for App Check. Site keys are public by design.
 * Create one at: Firebase Console → App Check → Apps → Web → reCAPTCHA v3.
 * Leave empty to run without App Check (local development only).
 */
export const APP_CHECK_SITE_KEY = window.__LUMA_APPCHECK_SITE_KEY__ || '';

/** VAPID public key for Web Push (Console → Cloud Messaging → Web configuration). */
export const FCM_VAPID_KEY = window.__LUMA_FCM_VAPID_KEY__ || '';

const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

/* -------------------------------------------------------------------------- */
/* Initialisation                                                             */
/* -------------------------------------------------------------------------- */

export const app = initializeApp(firebaseConfig);

/* --- App Check ------------------------------------------------------------ */
/* During local development set a debug token in the console before loading:
     window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;                              */
export let appCheck = null;
if (APP_CHECK_SITE_KEY) {
  if (isLocalhost && window.FIREBASE_APPCHECK_DEBUG_TOKEN === undefined) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (err) {
    console.warn('[luma] App Check could not start:', err.message);
  }
} else if (!isLocalhost) {
  console.warn(
    '[luma] App Check is not configured. Set window.__LUMA_APPCHECK_SITE_KEY__ ' +
    'before loading the app — see README §Security.'
  );
}

/* --- Auth ----------------------------------------------------------------- */
export const auth = getAuth(app);

/**
 * "Remember me" maps to local persistence; otherwise the session dies with the
 * tab. Never store tokens ourselves — the SDK owns them.
 */
export function applyPersistence(remember) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

/* --- Firestore ------------------------------------------------------------ */
/* Offline cache makes the dashboard usable on a flaky connection and cuts
   read cost; multi-tab manager keeps several open tabs consistent. */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true
});

/* --- Realtime Database (presence, typing) --------------------------------- */
export const rtdb = getDatabase(app);

/* --- Storage -------------------------------------------------------------- */
export const storage = getStorage(app);

/* --- Callable functions --------------------------------------------------- */
export const functions = getFunctions(app, FUNCTIONS_REGION);

/* --- Analytics ------------------------------------------------------------ */
export let analytics = null;
analyticsSupported()
  .then((ok) => { if (ok) analytics = getAnalytics(app); })
  .catch(() => { /* blocked by the browser — not fatal */ });

/* --- Emulators ------------------------------------------------------------ */
/* Opt-in with ?emulator=1 so a normal localhost session still hits production.
   The choice is remembered for the tab, because the app navigates between
   index.html and dashboard.html and would otherwise lose the query string. */
function emulatorRequested() {
  if (!isLocalhost) return false;
  const asked = new URLSearchParams(location.search).has('emulator');
  try {
    if (asked) sessionStorage.setItem('luma.emulator', '1');
    return asked || sessionStorage.getItem('luma.emulator') === '1';
  } catch {
    return asked;
  }
}

export const usingEmulators = emulatorRequested();

if (usingEmulators) {
  const [{ connectAuthEmulator }, { connectFirestoreEmulator }, { connectDatabaseEmulator },
         { connectStorageEmulator }, { connectFunctionsEmulator }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js'),
    import('https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js'),
    import('https://www.gstatic.com/firebasejs/12.17.0/firebase-functions.js')
  ]);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  console.info('[luma] Connected to Firebase emulators.');
}
