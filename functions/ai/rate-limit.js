/**
 * Per-user sliding window for the AI callables.
 *
 * Shared rather than duplicated per assistant so the budget is the user's, not
 * the feature's: someone cannot spend twice as much by alternating between the
 * finance assistant and the task one.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue } = require('../lib/admin');

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;

/** @throws {HttpsError} resource-exhausted once the window is spent. */
async function enforceRateLimit(uid) {
  const ref = db.collection('aiUsage').doc(uid);
  const now = Date.now();

  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const windowStart = data.windowStart || 0;
    const count = data.count || 0;

    if (now - windowStart > WINDOW_MS) {
      tx.set(ref, { windowStart: now, count: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    }
    if (count >= MAX_REQUESTS) return false;
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });

  if (!allowed) {
    throw new HttpsError(
      'resource-exhausted',
      'عدد كبير من الطلبات خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.'
    );
  }
}

module.exports = { enforceRateLimit, WINDOW_MS, MAX_REQUESTS };
