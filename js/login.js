/**
 * Login page controller.
 *
 * Three steps live in one page: sign in → forced password change (only when the
 * account still carries a temporary password) → forgot password.
 */

import {
  signInWithUsername, signOutUser, changeOwnPassword, requestPasswordReset,
  authReady, session, rememberedUsername, setRememberedUsername, loadProfileOnce
} from './auth.js';
import { $, setBusy, refreshIcons, bootIcons, esc } from './utils/dom.js';
import { toastSuccess, toastError, errorMessage } from './utils/toast.js';
import { checkPassword, isValidUsername, normalizeUsername } from './utils/sanitize.js';
import { t, applyStaticI18n } from './utils/i18n.js';

const DASHBOARD = 'dashboard.html';

applyStaticI18n();
document.title = `${t('login.pageTitle')} · ${t('app.name')}`;

const steps = {
  login: $('#step-login'),
  change: $('#step-change'),
  forgot: $('#step-forgot')
};

function showStep(name) {
  Object.entries(steps).forEach(([key, node]) => { node.hidden = key !== name; });
  refreshIcons(document.body);
}

function alertBox(message) {
  const box = $('#login-alert');
  const text = $('#login-alert-text');
  if (!message) { box.hidden = true; return; }
  text.textContent = message;
  box.hidden = false;
}

function fieldError(id, message) {
  const node = $(`#${id}-error`);
  const input = $(`#${id}`);
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
  input?.classList.toggle('has-error', !!message);
}

function nextTarget() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('#') ? `${DASHBOARD}${next}` : DASHBOARD;
}

/* ------------------------------------------------------------- bootstrap */

bootIcons();
$('#year').textContent = new Date().getFullYear();

const remembered = rememberedUsername();
if (remembered) {
  $('#username').value = remembered;
  $('#remember').checked = true;
  $('#password').focus();
}

if (new URLSearchParams(location.search).has('disabled')) {
  alertBox(t('login.accountDisabled'));
}

/* Already signed in? Skip straight through — unless a password change is due. */
authReady.then(async () => {
  if (!session.user) return;
  const profile = session.profile || await loadProfileOnce(session.user.uid);
  if (profile?.mustChangePassword) {
    showStep('change');
    $('#current-password')?.focus();
  } else {
    location.replace(nextTarget());
  }
});

/* ------------------------------------------------------------ sign in */

$('#toggle-password').addEventListener('click', () => {
  const input = $('#password');
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  $('#toggle-password').innerHTML = `<i data-lucide="${isText ? 'eye' : 'eye-off'}"></i>`;
  $('#toggle-password').setAttribute('aria-label', isText ? t('login.showPassword') : t('login.hidePassword'));
  refreshIcons($('#toggle-password'));
  input.focus();
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  alertBox('');
  fieldError('username', '');
  fieldError('password', '');

  const username = normalizeUsername($('#username').value);
  const password = $('#password').value;
  const remember = $('#remember').checked;

  let invalid = false;
  if (!username) { fieldError('username', t('login.usernameRequired')); invalid = true; }
  else if (!isValidUsername(username)) {
    fieldError('username', t('login.usernameInvalid'));
    invalid = true;
  }
  if (!password) { fieldError('password', t('login.passwordRequired')); invalid = true; }
  if (invalid) return;

  const button = $('#login-submit');
  setBusy(button, true);
  try {
    await signInWithUsername(username, password, remember);
    setRememberedUsername(remember ? username : '');

    const profile = await loadProfileOnce(session.user.uid);
    if (profile?.status === 'disabled') {
      await signOutUser();
      alertBox(t('login.accountDisabled'));
      return;
    }

    if (profile?.mustChangePassword) {
      $('#current-password').value = password;
      showStep('change');
      $('#new-password').focus();
      return;
    }

    toastSuccess(t('login.welcomeToast', { name: profile?.displayName || '' }));
    location.replace(nextTarget());
  } catch (err) {
    console.error('[luma] login failed', err);
    alertBox(errorMessage(err));
    $('#password').value = '';
    $('#password').focus();
  } finally {
    setBusy(button, false);
  }
});

/* -------------------------------------------------- forced password change */

const RULES = [
  { test: (p) => p.length >= 10, key: 'login.rule.length' },
  { test: (p) => /[a-z]/.test(p), key: 'login.rule.lower' },
  { test: (p) => /[A-Z]/.test(p), key: 'login.rule.upper' },
  { test: (p) => /\d/.test(p), key: 'login.rule.digit' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), key: 'login.rule.symbol' }
];

function paintRules(password) {
  $('#pw-rules').innerHTML = RULES.map((rule) => {
    const ok = rule.test(password);
    return `<li style="color:${ok ? 'var(--success)' : 'var(--text-muted)'}">
      ${ok ? '✓' : '○'} ${esc(t(rule.key))}</li>`;
  }).join('');

  const score = RULES.filter((r) => r.test(password)).length;
  const bar = $('#pw-strength');
  bar.style.width = `${(score / RULES.length) * 100}%`;
  bar.className = 'progress__bar' +
    (score <= 2 ? ' progress__bar--danger' : score < RULES.length ? '' : ' progress__bar--success');
}

paintRules('');
$('#new-password').addEventListener('input', (e) => paintRules(e.target.value));

document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = $(`#${button.dataset.toggle}`);
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    button.innerHTML = `<i data-lucide="${isText ? 'eye' : 'eye-off'}"></i>`;
    refreshIcons(button);
  });
});

$('#change-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const current = $('#current-password').value;
  const next = $('#new-password').value;
  const confirm = $('#confirm-password').value;

  const errorNode = $('#confirm-error');
  errorNode.hidden = true;

  const policy = checkPassword(next);
  if (!policy.ok) { toastError(policy.issues[0]); return; }
  if (next !== confirm) {
    errorNode.textContent = t('login.passwordMismatch');
    errorNode.hidden = false;
    return;
  }

  const button = $('#change-submit');
  setBusy(button, true);
  try {
    await changeOwnPassword(current, next);
    toastSuccess(t('login.passwordChanged'));
    setTimeout(() => location.replace(nextTarget()), 700);
  } catch (err) {
    toastError(errorMessage(err));
  } finally {
    setBusy(button, false);
  }
});

$('#change-cancel').addEventListener('click', async () => {
  await signOutUser();
  showStep('login');
  $('#password').value = '';
});

/* ---------------------------------------------------------- forgot flow */

$('#forgot-link').addEventListener('click', () => {
  $('#forgot-username').value = $('#username').value;
  showStep('forgot');
  $('#forgot-username').focus();
});

$('#forgot-back').addEventListener('click', () => showStep('login'));

$('#forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = normalizeUsername($('#forgot-username').value);
  if (!username) { toastError(t('login.usernameRequiredToast')); return; }

  const button = $('#forgot-submit');
  setBusy(button, true);
  try {
    await requestPasswordReset(username);
    // Deliberately generic: the response must not reveal whether the account exists.
    toastSuccess(t('login.resetSent'));
    showStep('login');
  } catch (err) {
    toastError(errorMessage(err));
  } finally {
    setBusy(button, false);
  }
});
