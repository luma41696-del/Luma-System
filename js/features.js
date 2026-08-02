/**
 * Luma Agency — feature flags.
 *
 * One switch per capability that depends on external provisioning, so the app
 * degrades cleanly instead of throwing errors the user cannot act on.
 */

export const FEATURES = {
  /**
   * File & image uploads (Cloud Storage).
   *
   * Cloud Storage requires the Firebase **Blaze** plan. Until the project is
   * upgraded every upload entry point is hidden and `uploadFile()` refuses to
   * run, so nothing fails halfway through and leaves an orphaned record.
   *
   * ▶ To re-enable after subscribing: set this to `true`. Nothing else changes —
   *   the upload code, the Storage rules and the UI are all already in place.
   */
  uploads: false
};

/** Shown wherever an upload control used to be. */
export const UPLOADS_DISABLED_MSG =
  'رفع الملفات معطّل مؤقتاً — سيُفعَّل بعد ترقية خطة الاستضافة.';

/** Compact inline notice for cards and modals. */
export function uploadsDisabledNotice(extra = '') {
  return `
    <div class="security-note">
      <i data-lucide="cloud-off"></i>
      <div>
        ${UPLOADS_DISABLED_MSG}
        ${extra ? `<div class="fs-xs text-muted mt-2">${extra}</div>` : ''}
      </div>
    </div>`;
}

/** Guard for click handlers that would otherwise start an upload. */
export function uploadsEnabled() {
  return FEATURES.uploads === true;
}
