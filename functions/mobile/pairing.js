/**
 * Signing in on a phone by scanning a QR code shown in the browser.
 *
 * Nobody types a password on a phone keyboard. The browser — already signed in
 * — asks for a short-lived pairing code, renders it as a QR, and the phone
 * scans it and trades it for a custom token.
 *
 * That trade has to happen before the phone has any identity, so `redeemPairing`
 * is the one callable here that accepts an unauthenticated caller. Everything
 * about the code's shape follows from that:
 *
 *   - 128 bits of randomness, so it cannot be guessed within its lifetime
 *   - two minutes to live, so a QR left on screen or in a screenshot stops
 *     working almost immediately
 *   - redeemed inside a transaction and deleted in the same step, so a code
 *     that two devices race for can only ever mint one token
 *
 * A scanned code grants exactly the claims the browser session already had.
 * It is a second device for the same person, never a way to become someone
 * else, so nothing about the identity is taken from the phone's request.
 */

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { REGION, db, auth, FieldValue, Timestamp } = require('../lib/admin');
const { requireAuth } = require('../lib/permissions');
const { str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const opts = { region: REGION, cors: true };

/** Long enough that guessing is hopeless, short enough to scan reliably. */
const CODE_BYTES = 16;
/** A QR on a screen is a credential lying in the open — it should expire fast. */
const TTL_MS = 2 * 60 * 1000;

const COLLECTION = 'pairingCodes';

/**
 * Asked for by a signed-in browser. The code identifies the session, not the
 * person: it carries a uid the server already verified.
 */
exports.createPairing = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  const code = crypto.randomBytes(CODE_BYTES).toString('hex');
  const expiresAt = Date.now() + TTL_MS;

  await db.collection(COLLECTION).doc(code).set({
    uid: caller.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAt),
    // Recorded so a person can see which browser authorised a phone.
    issuedFrom: request.rawRequest?.headers?.['user-agent']?.slice(0, 200) || null
  });

  return { code, expiresAt, ttlMs: TTL_MS };
});

/**
 * Traded by the phone for a token. Unauthenticated by necessity.
 */
exports.redeemPairing = onCall(opts, async (request) => {
  const code = str(request.data?.code, { max: 64, required: true, field: 'الرمز' });
  const device = str(request.data?.device, { max: 120, field: 'الجهاز' });

  const ref = db.collection(COLLECTION).doc(code);

  // The read, the expiry check and the delete are one transaction: two phones
  // scanning the same screen cannot both come away with a token.
  const uid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data();
    const expires = data.expiresAt?.toMillis?.() ?? 0;
    // Deleted either way — an expired code has no second chance.
    tx.delete(ref);
    if (Date.now() > expires) return null;
    return data.uid || null;
  });

  // One message for "wrong", "expired" and "already used". Telling them apart
  // would confirm to a guesser that a code had at least existed.
  if (!uid) {
    throw new HttpsError('permission-denied', 'رمز غير صالح أو منتهي. اعرض رمزاً جديداً وأعد المحاولة.');
  }

  const user = await auth.getUser(uid).catch(() => null);
  if (!user || user.disabled) {
    throw new HttpsError('permission-denied', 'الحساب غير متاح.');
  }

  const token = await auth.createCustomToken(uid);

  await writeAudit({
    action: 'mobile.pair',
    caller: { uid, name: user.displayName || '' },
    targetId: uid,
    meta: { device: device || 'unknown' },
    request
  });

  return { token };
});
