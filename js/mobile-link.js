/**
 * Linking the phone app to this account.
 *
 * The browser is already signed in, so it — not the phone — is the thing that
 * proves who you are. It asks the server for a short-lived pairing code, draws
 * it as a QR, and the phone trades the scan for its own token.
 *
 * The code on screen is a credential for the two minutes it lives, which is
 * what the rest of this module is about: it is not drawn until asked for, it
 * counts down in the open so nobody is surprised by it, and it stops being
 * shown the moment it stops working.
 */

import { callFn } from './utils/api.js';
import { $, esc, refreshIcons } from './utils/dom.js';
import { reportError } from './utils/toast.js';
import { qrSvg } from './utils/qr.js';
import { FUNCTIONS_REGION, firebaseConfig } from './firebase-config.js';

/** Scheme the phone app registers. Deliberately not a URL: a stray scan by a
 *  passer-by's camera should open nothing at all. */
const SCHEME = 'luma-pair:1:';

/**
 * Where the phone should send its calls.
 *
 * The app ships with no server address configured, on purpose. This deployment
 * might be on Netlify, on Firebase Hosting, or on a laptop on the office
 * network, and asking someone to type a URL into a phone is exactly the
 * friction the QR exists to remove — so the code carries the answer.
 *
 * It is whatever *this* page already uses, made absolute, so the phone can
 * never end up talking to a different backend than the browser that paired it.
 */
function apiBase() {
  const configured = (typeof window !== 'undefined' && window.__LUMA_API_BASE__) || '';
  if (configured) return new URL(configured, location.origin).href.replace(/\/$/, '');
  return `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net`;
}

/** Redraw a little before the server's own expiry so a scan in flight still lands. */
const SAFETY_MS = 3000;

export function mobileTab(host) {
  host.innerHTML = `
    <div class="grid grid-main mt-4">
      <div class="card">
        <div class="card__head">
          <div class="card__title"><i data-lucide="smartphone"></i> ربط الهاتف</div>
        </div>
        <p class="fs-sm text-muted mb-4">
          افتح تطبيق لوما على هاتفك، اضغط زر المسح في الأسفل، ثم وجّه الكاميرا إلى الرمز.
          يبقى الرمز صالحاً لدقيقتين فقط.
        </p>
        <div id="pair-stage" class="pair-stage"></div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title"><i data-lucide="shield" ></i> ما الذي يمنحه الرمز؟</div>
        </div>
        <p class="fs-sm text-muted">
          الهاتف يحصل على نفس صلاحياتك بالضبط — لا أكثر. الرمز يُستهلك مرة واحدة:
          أول جهاز يمسحه يأخذه، وأي محاولة بعده تفشل.
        </p>
        <div class="list-divider"></div>
        <p class="fs-xs text-muted">
          لا تُشارك صورة الرمز مع أحد ولا تعرضه في اجتماع مصوّر. من يمسحه يدخل بحسابك.
        </p>
      </div>
    </div>`;

  refreshIcons(host);
  idle($('#pair-stage'));
}

/** Nothing on screen until it is asked for. */
function idle(stage) {
  stage.innerHTML = `
    <div class="pair-stage__idle">
      <div class="pair-stage__placeholder"><i data-lucide="qr-code"></i></div>
      <button class="btn btn--primary" id="pair-show">
        <i data-lucide="scan-line"></i> إظهار رمز الاقتران
      </button>
    </div>`;
  refreshIcons(stage);
  $('#pair-show').addEventListener('click', () => show(stage));
}

async function show(stage) {
  stage.innerHTML = `<div class="pair-stage__idle"><div class="skeleton pair-qr__pending"></div></div>`;

  let pairing;
  try {
    pairing = await callFn('createPairing');
  } catch (err) {
    reportError(err, 'تعذّر إنشاء رمز الاقتران.');
    idle(stage);
    return;
  }

  const svg = qrSvg(`${SCHEME}${pairing.code}:${apiBase()}`, { scale: 6, quiet: 3 });

  stage.innerHTML = `
    <div class="pair-stage__live">
      <div class="pair-qr">${svg}</div>
      <div class="pair-countdown">
        <span class="pair-countdown__time" id="pair-time">--:--</span>
        <span class="fs-xs text-muted">حتى انتهاء الصلاحية</span>
      </div>
      <button class="btn btn--ghost btn--sm" id="pair-cancel">
        <i data-lucide="x"></i> إخفاء
      </button>
    </div>`;
  refreshIcons(stage);

  const label = $('#pair-time');
  const deadline = pairing.expiresAt - SAFETY_MS;

  // Stops on its own once the node leaves the document, so switching tabs or
  // navigating away cannot leave a timer redrawing a detached tree.
  const timer = setInterval(() => {
    if (!document.contains(label)) return clearInterval(timer);

    const left = deadline - Date.now();
    if (left <= 0) {
      clearInterval(timer);
      expired(stage);
      return;
    }
    const seconds = Math.ceil(left / 1000);
    label.textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    label.classList.toggle('is-urgent', seconds <= 20);
  }, 250);

  $('#pair-cancel').addEventListener('click', () => {
    clearInterval(timer);
    idle(stage);
  });
}

/** The code is gone from the screen before it is gone from the server. */
function expired(stage) {
  stage.innerHTML = `
    <div class="pair-stage__idle">
      <div class="pair-stage__placeholder pair-stage__placeholder--dim">
        <i data-lucide="timer-off"></i>
      </div>
      <p class="fs-sm text-muted">${esc('انتهت صلاحية الرمز.')}</p>
      <button class="btn btn--primary" id="pair-show">
        <i data-lucide="refresh-cw"></i> عرض رمز جديد
      </button>
    </div>`;
  refreshIcons(stage);
  $('#pair-show').addEventListener('click', () => show(stage));
}
