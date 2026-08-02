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

const DASHBOARD = 'dashboard.html';

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
  alertBox('تم تعطيل هذا الحساب. يرجى مراجعة مدير النظام.');
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
  $('#toggle-password').setAttribute('aria-label', isText ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
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
  if (!username) { fieldError('username', 'اسم المستخدم مطلوب'); invalid = true; }
  else if (!isValidUsername(username)) {
    fieldError('username', 'اسم المستخدم يجب أن يتكون من 3-24 حرفاً لاتينياً');
    invalid = true;
  }
  if (!password) { fieldError('password', 'كلمة المرور مطلوبة'); invalid = true; }
  if (invalid) return;

  const button = $('#login-submit');
  setBusy(button, true);
  try {
    await signInWithUsername(username, password, remember);
    setRememberedUsername(remember ? username : '');

    const profile = await loadProfileOnce(session.user.uid);
    if (profile?.status === 'disabled') {
      await signOutUser();
      alertBox('تم تعطيل هذا الحساب. يرجى مراجعة مدير النظام.');
      return;
    }

    if (profile?.mustChangePassword) {
      $('#current-password').value = password;
      showStep('change');
      $('#new-password').focus();
      return;
    }

    toastSuccess(`أهلاً بك ${profile?.displayName || ''}`);
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
  { test: (p) => p.length >= 10, label: '10 أحرف على الأقل' },
  { test: (p) => /[a-z]/.test(p), label: 'حرف إنجليزي صغير (a-z)' },
  { test: (p) => /[A-Z]/.test(p), label: 'حرف إنجليزي كبير (A-Z)' },
  { test: (p) => /\d/.test(p), label: 'رقم واحد على الأقل' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'رمز خاص (@ # $ ! ...)' }
];

function paintRules(password) {
  $('#pw-rules').innerHTML = RULES.map((rule) => {
    const ok = rule.test(password);
    return `<li style="color:${ok ? 'var(--success)' : 'var(--text-muted)'}">
      ${ok ? '✓' : '○'} ${esc(rule.label)}</li>`;
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
    errorNode.textContent = 'كلمتا المرور غير متطابقتين';
    errorNode.hidden = false;
    return;
  }

  const button = $('#change-submit');
  setBusy(button, true);
  try {
    await changeOwnPassword(current, next);
    toastSuccess('تم تغيير كلمة المرور بنجاح.');
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
  if (!username) { toastError('يرجى إدخال اسم المستخدم.'); return; }

  const button = $('#forgot-submit');
  setBusy(button, true);
  try {
    await requestPasswordReset(username);
    // Deliberately generic: the response must not reveal whether the account exists.
    toastSuccess('إذا كان اسم المستخدم صحيحاً فسيصلك رابط الاستعادة على البريد المسجّل.');
    showStep('login');
  } catch (err) {
    toastError(errorMessage(err));
  } finally {
    setBusy(button, false);
  }
});
