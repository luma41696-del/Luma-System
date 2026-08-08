/**
 * Desktop (browser) notifications.
 *
 * The permission prompt must be triggered by a real user gesture. Asking on a
 * timer gets the prompt dismissed, and browsers count repeated dismissals as a
 * denial — once denied, the page can never prompt again and only the user can
 * undo it from the browser's own site settings. So every request here is
 * wired to a click, and the blocked state is surfaced rather than swallowed.
 */

const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;

/** @returns {'granted'|'denied'|'default'|'unsupported'} */
export function notifyPermission() {
  if (!SUPPORTED) return 'unsupported';
  return Notification.permission;
}

export function canShowNotifications() {
  return notifyPermission() === 'granted';
}

/**
 * Ask the browser for permission. Call this straight from a click handler —
 * anything async before it can cost the user-gesture context.
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestNotifyPermission() {
  if (!SUPPORTED) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Human-readable state, for the settings row and the banner. */
export function permissionLabel(permission = notifyPermission()) {
  return {
    granted: 'مفعّلة',
    denied: 'محظورة من المتصفح',
    unsupported: 'غير مدعومة في هذا المتصفح',
    default: 'لم تُفعّل بعد'
  }[permission] || permission;
}

/**
 * Show one notification. Silently does nothing unless permission is granted —
 * the caller does not have to re-check.
 */
export function showBrowserNotification({ title, body = '', tag = '', link = '' }) {
  if (!canShowNotifications()) return false;
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: 'assets/logo/favicon.png'
    });
    if (link) {
      notification.onclick = () => {
        window.focus();
        location.hash = link;
        notification.close();
      };
    }
    return true;
  } catch {
    // Some browsers only allow notifications via a service worker registration.
    return false;
  }
}
