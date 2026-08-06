/**
 * Luma Agency — feature flags.
 *
 * One switch per capability that depends on external provisioning, so the app
 * degrades cleanly instead of throwing errors the user cannot act on.
 */

export const FEATURES = {
  /** File & image uploads (avatars, chat images, task and client files). */
  uploads: true,

  /**
   * Fallback for when Cloud Storage is unavailable — it needs the Blaze plan.
   *
   * With this on, an image that Storage rejects is downscaled, re-encoded and
   * stored inline as a data URL on the document itself. Firestore caps a
   * document at 1 MB, so it only applies to images and only under the limit
   * below; documents and anything larger still need Storage.
   *
   * Set to false once Storage is enabled, to keep images out of the database.
   */
  inlineImageFallback: true,

  /** Largest inline image, in KB. Well under the 1 MB document ceiling. */
  inlineImageMaxKB: 420
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

export function inlineFallbackEnabled() {
  return FEATURES.uploads === true && FEATURES.inlineImageFallback === true;
}
