/** Toast notifications. Text is inserted as textContent — never as HTML. */

import { el, refreshIcons } from './dom.js';

const ICONS = {
  success: 'check-circle-2',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info'
};

function host() {
  let node = document.querySelector('.toast-host');
  if (!node) {
    node = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  return node;
}

export function toast(message, { type = 'info', title = '', duration = 4200 } = {}) {
  const icon = el('i', { 'data-lucide': ICONS[type] || ICONS.info });
  const body = el('div', { class: 'toast__body' }, [
    title ? el('div', { class: 'toast__title', text: title }) : null,
    el('div', { class: title ? 'toast__msg' : 'toast__title', text: message })
  ]);
  const close = el('button', { class: 'icon-btn', 'aria-label': 'إغلاق' }, [
    el('i', { 'data-lucide': 'x' })
  ]);

  const node = el('div', { class: `toast toast--${type}`, role: 'alert' }, [
    el('span', { class: 'toast__icon' }, [icon]), body, close
  ]);

  const dismiss = () => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  close.addEventListener('click', dismiss);

  host().append(node);
  refreshIcons(node);
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

export const toastSuccess = (msg, title = 'تم بنجاح') => toast(msg, { type: 'success', title });
export const toastError = (msg, title = 'خطأ') => toast(msg, { type: 'error', title, duration: 6000 });
export const toastWarn = (msg, title = 'تنبيه') => toast(msg, { type: 'warning', title });
export const toastInfo = (msg, title = '') => toast(msg, { type: 'info', title });

/**
 * Turn a Firebase error into an Arabic message. Unknown codes fall back to a
 * generic message so raw internals never leak into the UI.
 */
const FIREBASE_ERRORS = {
  'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  'auth/wrong-password': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  'auth/user-not-found': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  'auth/invalid-email': 'اسم المستخدم غير صالح.',
  'auth/user-disabled': 'هذا الحساب معطّل. يرجى مراجعة الإدارة.',
  'auth/too-many-requests': 'تم حظر المحاولات مؤقتاً بسبب كثرة المحاولات الخاطئة. حاول لاحقاً.',
  'auth/network-request-failed': 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.',
  'auth/requires-recent-login': 'يرجى إعادة تسجيل الدخول للمتابعة.',
  'auth/weak-password': 'كلمة المرور ضعيفة جداً.',
  'permission-denied': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'unauthenticated': 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
  'not-found': 'العنصر المطلوب غير موجود.',
  'already-exists': 'هذا العنصر موجود مسبقاً.',
  'resource-exhausted': 'تم تجاوز الحد المسموح. حاول لاحقاً.',
  'failed-precondition': 'لا يمكن تنفيذ العملية في الوضع الحالي.',
  'unavailable': 'الخدمة غير متاحة حالياً. حاول مرة أخرى.',
  'storage/unauthorized': 'لا تملك صلاحية رفع هذا الملف.',
  'storage/canceled': 'تم إلغاء الرفع.',
  'storage/quota-exceeded': 'تم تجاوز مساحة التخزين المتاحة.'
};

export function errorMessage(error) {
  if (!error) return 'حدث خطأ غير متوقع.';
  const code = error.code || error?.details?.code || '';
  if (FIREBASE_ERRORS[code]) return FIREBASE_ERRORS[code];
  // Callable functions return Arabic messages we author ourselves.
  if (error.message && !/^Firebase:/i.test(error.message) && error.message.length < 200) {
    return error.message;
  }
  return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
}

export function reportError(error, context = '') {
  console.error(`[luma]${context ? ' ' + context : ''}`, error);
  toastError(errorMessage(error));
}
