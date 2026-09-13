/**
 * What each kind of notification is called and which icon it wears.
 *
 * Its own module because two places draw notifications now — the centre on
 * /notifications and the bell's popover in the topbar — and a copy in each
 * would drift the first time a kind is added.
 */
export const KINDS = {
  task_assigned:   { ar: 'إسناد مهمة',        icon: 'check-square' },
  task_due:        { ar: 'اقتراب موعد',       icon: 'clock' },
  task_overdue:    { ar: 'مهمة متأخرة',       icon: 'alert-triangle' },
  task_comment:    { ar: 'تعليق جديد',        icon: 'message-square' },
  request_decided: { ar: 'قرار على طلب',      icon: 'gavel' },
  request_new:     { ar: 'طلب جديد',          icon: 'inbox' },
  chat_message:    { ar: 'رسالة جديدة',       icon: 'message-circle' },
  chat_mention:    { ar: 'إشارة إليك',        icon: 'at-sign' },
  client_updated:  { ar: 'تحديث بيانات عميل', icon: 'briefcase' },
  announcement:    { ar: 'إعلان للفريق',      icon: 'megaphone' },
  system:          { ar: 'النظام',            icon: 'bell' }
};

/** Falls back to `system` for a kind written by a newer server than this app. */
export function kindOf(type) {
  return KINDS[type] || KINDS.system;
}
