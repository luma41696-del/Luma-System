/**
 * Encrypted credential vault for client social-media accounts.
 *
 * Design:
 *   • AES-256-GCM with a random 96-bit IV per record and an authentication tag,
 *     so a tampered ciphertext fails to decrypt rather than decrypting to junk.
 *   • The key lives in Google Secret Manager (`VAULT_ENCRYPTION_KEY`) and is
 *     injected into the function at runtime — never in Firestore, never in the
 *     browser bundle, never in git.
 *   • Firestore rules deny all client access to `clientCredentials`, so the
 *     ciphertext itself is unreachable from a browser.
 *   • Reveal requires `clients.viewCredentials` *and* a token minted less than
 *     five minutes ago (the client re-authenticates first), and is audited.
 *
 * Reminder for operators: prefer Meta Business Manager / platform invitations /
 * OAuth over storing a password at all. This vault is the fallback.
 */

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const VAULT_ENCRYPTION_KEY = defineSecret('VAULT_ENCRYPTION_KEY');

const opts = {
  region: REGION,
  cors: true,
  secrets: [VAULT_ENCRYPTION_KEY]
};

const ALGORITHM = 'aes-256-gcm';
/** How fresh the caller's sign-in must be before a secret is released. */
const REAUTH_WINDOW_MS = 5 * 60 * 1000;

function key() {
  const raw = VAULT_ENCRYPTION_KEY.value();
  if (!raw) {
    throw new HttpsError('failed-precondition',
      'خزنة التشفير غير مهيأة. راجع إعداد VAULT_ENCRYPTION_KEY.');
  }
  // Accept either a 64-char hex string or a 44-char base64 string (32 bytes).
  const buffer = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buffer.length !== 32) {
    throw new HttpsError('failed-precondition', 'مفتاح التشفير يجب أن يكون 32 بايت.');
  }
  return buffer;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  return {
    iv: iv.toString('base64'),
    ct: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    v: 1
  };
}

function decrypt(payload) {
  if (!payload?.ct || !payload?.iv || !payload?.tag) return '';
  const decipher = crypto.createDecipheriv(
    ALGORITHM, key(), Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function requireFreshAuth(request) {
  const authTime = Number(request.auth?.token?.auth_time || 0) * 1000;
  if (!authTime || Date.now() - authTime > REAUTH_WINDOW_MS) {
    throw new HttpsError(
      'permission-denied',
      'انتهت صلاحية التحقق. أعد إدخال كلمة المرور ثم حاول مرة أخرى.'
    );
  }
}

async function assertClientExists(clientId) {
  const snap = await db.collection('clients').doc(clientId).get();
  assert(snap.exists, 'العميل غير موجود.', 'not-found');
  return snap;
}

/* ========================================================================== */
/* List — metadata only, never ciphertext                                     */
/* ========================================================================== */

exports.vaultList = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.viewCredentials');

  const clientId = str(request.data?.clientId, { max: 128, required: true, field: 'العميل' });
  await assertClientExists(clientId);

  const snap = await db.collection('clientCredentials')
    .where('clientId', '==', clientId)
    .where('deleted', '==', false)
    .get();

  const items = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      clientId: data.clientId,
      platform: data.platform,
      label: data.label,
      username: data.username,
      notes: data.notes || '',
      hasPassword: !!data.secret,
      createdAt: data.createdAt?.toMillis?.() || null,
      updatedAt: data.updatedAt?.toMillis?.() || null,
      lastViewedAt: data.lastViewedAt?.toMillis?.() || null,
      lastViewedBy: data.lastViewedBy || null
    };
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return { items };
});

/* ========================================================================== */
/* Add / update / delete                                                      */
/* ========================================================================== */

exports.vaultAdd = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.viewCredentials');

  const clientId = str(request.data?.clientId, { max: 128, required: true, field: 'العميل' });
  const label = str(request.data?.label, { max: 120, required: true, field: 'الوصف' });
  const password = String(request.data?.password || '');
  assert(password.length > 0 && password.length <= 512, 'كلمة المرور مطلوبة.');

  await assertClientExists(clientId);

  const created = await db.collection('clientCredentials').add({
    clientId,
    platform: str(request.data?.platform, { max: 40 }) || 'other',
    label,
    username: str(request.data?.username, { max: 140 }),
    notes: str(request.data?.notes, { max: 600 }),
    secret: encrypt(password),
    deleted: false,
    createdBy: caller.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAudit({
    action: 'vault.add', caller, targetId: created.id, targetType: 'credential',
    meta: { clientId, label, platform: request.data?.platform }, request
  });

  return { id: created.id };
});

exports.vaultUpdate = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.viewCredentials');

  const credId = str(request.data?.credId, { max: 128, required: true, field: 'المعرّف' });
  const ref = db.collection('clientCredentials').doc(credId);
  const snap = await ref.get();
  assert(snap.exists && !snap.data().deleted, 'السجل غير موجود.', 'not-found');

  const patch = {
    platform: str(request.data?.platform, { max: 40 }) || snap.data().platform,
    label: str(request.data?.label, { max: 120 }) || snap.data().label,
    username: str(request.data?.username, { max: 140 }),
    notes: str(request.data?.notes, { max: 600 }),
    updatedBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp()
  };

  // An empty password field means "keep the existing secret".
  const password = String(request.data?.password || '');
  if (password) {
    assert(password.length <= 512, 'كلمة المرور طويلة جداً.');
    patch.secret = encrypt(password);
  }

  await ref.set(patch, { merge: true });

  await writeAudit({
    action: 'vault.update', caller, targetId: credId, targetType: 'credential',
    meta: { clientId: snap.data().clientId, passwordChanged: !!password }, request
  });

  return { ok: true };
});

exports.vaultDelete = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.viewCredentials');

  const credId = str(request.data?.credId, { max: 128, required: true, field: 'المعرّف' });
  const ref = db.collection('clientCredentials').doc(credId);
  const snap = await ref.get();
  assert(snap.exists, 'السجل غير موجود.', 'not-found');

  // Hard-delete the secret material, keep a tombstone for the audit trail.
  await ref.set({
    secret: FieldValue.delete(),
    deleted: true,
    deletedBy: caller.uid,
    deletedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAudit({
    action: 'vault.delete', caller, targetId: credId, targetType: 'credential',
    meta: { clientId: snap.data().clientId, label: snap.data().label }, request
  });

  return { ok: true };
});

/* ========================================================================== */
/* Reveal — the only path that returns plaintext                              */
/* ========================================================================== */

exports.vaultReveal = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.viewCredentials');
  requireFreshAuth(request);

  const credId = str(request.data?.credId, { max: 128, required: true, field: 'المعرّف' });
  const ref = db.collection('clientCredentials').doc(credId);
  const snap = await ref.get();
  assert(snap.exists && !snap.data().deleted, 'السجل غير موجود.', 'not-found');

  const data = snap.data();
  let password = '';
  try {
    password = decrypt(data.secret);
  } catch (err) {
    console.error('[vault] decryption failed', credId, err.message);
    throw new HttpsError('internal', 'تعذّر فك تشفير البيانات. راجع مدير النظام.');
  }

  await ref.set({
    lastViewedAt: FieldValue.serverTimestamp(),
    lastViewedBy: caller.uid,
    viewCount: FieldValue.increment(1)
  }, { merge: true });

  // The audit entry is the point of the whole flow — record it before returning.
  await writeAudit({
    action: 'vault.reveal', caller, targetId: credId, targetType: 'credential',
    meta: { clientId: data.clientId, label: data.label, platform: data.platform }, request
  });

  return {
    id: credId,
    label: data.label,
    username: data.username || '',
    password,
    notes: data.notes || ''
  };
});
