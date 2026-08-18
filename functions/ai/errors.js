/**
 * Turning a provider failure into something the user can act on.
 *
 * "حاول مرة أخرى" is the wrong answer to an expired key or an exhausted quota:
 * retrying cannot fix either, and the person reading it has no way to learn
 * which it was. The upstream status is mapped to a message that names the
 * problem — without ever quoting the provider's own text, which can echo the
 * key back.
 */

const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Recognise an already-shaped callable error by its shape rather than with
 * `instanceof`.
 *
 * The repository carries two copies of firebase-functions — one at the root
 * for the Netlify bundle, one under functions/ — and an error built by one is
 * not an `instanceof` the other's class. Under `instanceof` a deliberate
 * "permission-denied" would be swallowed and re-reported as a generic
 * failure, depending only on which copy the bundler happened to resolve.
 */
function isHttpsError(err) {
  return !!err && typeof err.code === 'string' && !!err.httpErrorCode;
}

/**
 * @param {Error & {status?: number, name?: string}} err
 * @returns {HttpsError}
 */
function providerError(err) {
  if (isHttpsError(err)) return err;

  // AbortController fires this when REQUEST_TIMEOUT_MS is reached.
  if (err?.name === 'AbortError') {
    return new HttpsError('deadline-exceeded',
      'انتهت مهلة الانتظار قبل أن يردّ المساعد الذكي. جرّب سؤالاً أقصر أو أعد المحاولة.');
  }

  switch (err?.status) {
    case 401:
    case 403:
      return new HttpsError('failed-precondition',
        'مفتاح OpenAI مرفوض — غير صالح أو انتهت صلاحيته. راجع OPENAI_API_KEY على الخادم.');
    case 429:
      return new HttpsError('resource-exhausted',
        'تم تجاوز حصة OpenAI أو معدّل الطلبات المسموح. راجع الرصيد والحدود في حساب OpenAI.');
    case 400:
      return new HttpsError('invalid-argument',
        'رفض المساعد الذكي الطلب. إن كنت أرسلت صوراً، جرّب صورة أقل أو أصغر.');
    case 404:
      return new HttpsError('failed-precondition',
        'النموذج المطلوب غير متاح لهذا الحساب. راجع قيمة OPENAI_MODEL على الخادم.');
    default:
      break;
  }

  // 5xx and anything unrecognised: upstream trouble, retrying is reasonable.
  if (typeof err?.status === 'number' && err.status >= 500) {
    return new HttpsError('unavailable',
      'خدمة المساعد الذكي غير متاحة مؤقتاً من المزوّد. أعد المحاولة بعد قليل.');
  }
  return new HttpsError('internal',
    'تعذّر الحصول على إجابة من المساعد الذكي. حاول مرة أخرى.');
}

module.exports = { providerError };
