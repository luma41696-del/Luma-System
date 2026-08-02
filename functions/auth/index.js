/**
 * Authentication & account lifecycle.
 *
 * Everything privileged lives here rather than in the browser:
 *   • username → auth-account resolution (with lockout)
 *   • employee account creation / access changes / status / password reset
 *   • salary & banking writes (separately permissioned, always audited)
 *
 * Passwords are never stored in Firestore or the Realtime Database — Firebase
 * Authentication is the only place a credential exists.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, auth, FieldValue, REGION } = require('../lib/admin');
const {
  requireAuth, requirePermission, requireAdmin, assertCanGrant, buildClaims,
  ACCOUNT_ROLES, JOB_ROLES, DEPARTMENTS, codesToPerms, ALL_PERMISSIONS
} = require('../lib/permissions');
const {
  assert, str, num, arr, normalizeUsername, isValidUsername, isValidEmail,
  isValidPhone, isValidIBAN, authEmailFor, generateTempPassword, checkPasswordPolicy
} = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const opts = { region: REGION, cors: true, enforceAppCheck: false };

/* ========================================================================== */
/* Login                                                                      */
/* ========================================================================== */

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function attemptRef(username) {
  return db.collection('loginAttempts').doc(`u_${username}`);
}

/**
 * Resolve a username to the internal auth address.
 *
 * The response is deliberately uniform: it never reveals whether a username
 * exists. A non-existent username still returns a syntactically valid address,
 * so the subsequent signIn fails with the same generic error either way.
 */
exports.resolveUsername = onCall(opts, async (request) => {
  const username = normalizeUsername(request.data?.username);
  assert(isValidUsername(username), 'اسم المستخدم أو كلمة المرور غير صحيحة.');

  const snap = await attemptRef(username).get();
  const record = snap.exists ? snap.data() : null;

  if (record?.lockedUntil && record.lockedUntil.toMillis() > Date.now()) {
    const minutes = Math.ceil((record.lockedUntil.toMillis() - Date.now()) / 60000);
    throw new HttpsError(
      'resource-exhausted',
      `تم إيقاف المحاولات مؤقتاً بسبب كثرة المحاولات الخاطئة. حاول بعد ${minutes} دقيقة.`
    );
  }

  const indexed = await db.collection('usernames').doc(username).get();
  return { email: indexed.exists ? indexed.data().authEmail : authEmailFor(username) };
});

/**
 * Record the outcome of a sign-in attempt. Called by the client immediately
 * after Firebase Auth answers, so the lockout counter reflects reality without
 * needing Identity Platform blocking functions.
 */
exports.reportLoginResult = onCall(opts, async (request) => {
  const username = normalizeUsername(request.data?.username);
  if (!isValidUsername(username)) return { ok: true };
  const success = request.data?.success === true;
  const ref = attemptRef(username);

  if (success) {
    await ref.set({
      failures: 0,
      lockedUntil: null,
      lastSuccessAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true };
  }

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const failures = (snap.exists ? snap.data().failures || 0 : 0) + 1;
    const locked = failures >= MAX_ATTEMPTS;
    tx.set(ref, {
      failures: locked ? 0 : failures,
      lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
      lastFailureAt: FieldValue.serverTimestamp(),
      lastIp: request.rawRequest?.ip || null
    }, { merge: true });
    return { failures, locked };
  });

  if (result.locked) {
    await writeAudit({
      action: 'auth.login_locked',
      caller: { uid: null, name: username },
      targetId: username,
      targetType: 'username',
      meta: { attempts: MAX_ATTEMPTS, lockoutMinutes: LOCKOUT_MS / 60000 },
      request
    });
  }
  return { ok: true, remaining: Math.max(0, MAX_ATTEMPTS - result.failures) };
});

/**
 * Email a password-reset link to the recovery address on the profile.
 * Always resolves successfully so the response cannot be used to enumerate
 * accounts. Delivery uses the `mail` collection consumed by the Firebase
 * "Trigger Email" extension (see README §Email).
 */
exports.requestPasswordReset = onCall(opts, async (request) => {
  const username = normalizeUsername(request.data?.username);
  if (!isValidUsername(username)) return { ok: true };

  try {
    const indexed = await db.collection('usernames').doc(username).get();
    if (!indexed.exists) return { ok: true };

    const { uid } = indexed.data();
    const profile = await db.collection('users').doc(uid).get();
    const recovery = profile.data()?.personalEmail;
    if (!recovery || !isValidEmail(recovery)) return { ok: true };

    const link = await auth.generatePasswordResetLink(indexed.data().authEmail);

    await db.collection('mail').add({
      to: [recovery],
      message: {
        subject: 'استعادة كلمة المرور — نظام إدارة لوما',
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9;color:#171B22">
            <h2 style="color:#071A2F">استعادة كلمة المرور</h2>
            <p>مرحباً ${profile.data()?.displayName || ''}،</p>
            <p>تم طلب إعادة تعيين كلمة المرور لحساب <strong>${username}</strong> في نظام إدارة وكالة لوما.</p>
            <p style="margin:24px 0">
              <a href="${link}" style="background:#FFC928;color:#12100A;padding:12px 24px;
                 border-radius:8px;text-decoration:none;font-weight:bold">إعادة تعيين كلمة المرور</a>
            </p>
            <p style="color:#7F8998;font-size:13px">
              إذا لم تطلب ذلك، تجاهل هذه الرسالة ولن يتغير شيء. الرابط صالح لفترة محدودة.
            </p>
          </div>`
      },
      createdAt: FieldValue.serverTimestamp()
    });

    await writeAudit({
      action: 'auth.password_reset_requested',
      caller: { uid, name: username },
      targetId: uid,
      targetType: 'user',
      request
    });
  } catch (err) {
    console.error('[auth] password reset failed', err);
  }
  return { ok: true };
});

/** Clears the temporary-password flag after the user changed it themselves. */
exports.completePasswordChange = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  await db.collection('users').doc(caller.uid).set({
    mustChangePassword: false,
    passwordChangedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAudit({
    action: 'auth.password_changed', caller, targetId: caller.uid, targetType: 'user', request
  });
  return { ok: true };
});

/* ========================================================================== */
/* Employee lifecycle                                                         */
/* ========================================================================== */

exports.createEmployee = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.create');

  const data = request.data || {};
  const displayName = str(data.displayName, { max: 120, min: 2, field: 'الاسم', required: true });
  const username = normalizeUsername(data.username);
  const email = str(data.email, { max: 160, field: 'البريد الإلكتروني', required: true });
  const phone = str(data.phone, { max: 32, field: 'رقم الهاتف' });
  const department = DEPARTMENTS.includes(data.department) ? data.department : 'admin';
  const roles = arr(data.roles, { max: 7, field: 'المسميات' }).filter((r) => JOB_ROLES.includes(r));
  const permissions = arr(data.permissions, { max: 40, field: 'الصلاحيات' })
    .filter((p) => ALL_PERMISSIONS.includes(p));
  const accountRole = ACCOUNT_ROLES.includes(data.accountRole) ? data.accountRole : 'employee';

  assert(isValidUsername(username), 'اسم المستخدم غير صالح (3-24 حرفاً لاتينياً).');
  assert(isValidEmail(email), 'البريد الإلكتروني غير صالح.');
  assert(isValidPhone(phone), 'رقم الهاتف غير صالح.');
  assert(roles.length > 0, 'اختر مسمى وظيفياً واحداً على الأقل.');

  assertCanGrant(caller, { accountRole, permissions });

  // Reserve the username first: this transaction is what makes usernames unique.
  const usernameRef = db.collection('usernames').doc(username);
  const existing = await usernameRef.get();
  assert(!existing.exists, 'اسم المستخدم مستخدم مسبقاً.', 'already-exists');

  const authEmail = authEmailFor(username);
  const tempPassword = generateTempPassword();

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email: authEmail,
      emailVerified: false,
      password: tempPassword,
      displayName,
      disabled: false
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'اسم المستخدم مستخدم مسبقاً.');
    }
    console.error('[auth] createUser failed', err);
    throw new HttpsError('internal', 'تعذّر إنشاء الحساب.');
  }

  const uid = userRecord.uid;

  try {
    await auth.setCustomUserClaims(uid, buildClaims({ accountRole, permissions, status: 'active' }));

    const batch = db.batch();

    batch.set(usernameRef, {
      uid,
      authEmail,
      createdAt: FieldValue.serverTimestamp()
    });

    batch.set(db.collection('users').doc(uid), {
      uid,
      username,
      usernameLower: username,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      personalEmail: email,
      phone,
      department,
      roles,
      accountRole,
      perms: buildClaims({ accountRole, permissions }).perms,
      photoURL: null,
      status: 'active',
      mustChangePassword: true,
      joinDate: str(data.joinDate, { max: 10 }) || null,
      managerId: str(data.managerId, { max: 64 }) || caller.uid,
      leave: {
        annualQuota: num(data.annualQuota ?? 14, { min: 0, max: 60, field: 'رصيد الإجازات' }),
        used: 0,
        remaining: num(data.annualQuota ?? 14, { min: 0, max: 60 }),
        usedThisMonth: 0
      },
      notifPrefs: {},
      notes: '',
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Empty private documents so the rules-gated reads resolve cleanly.
    batch.set(db.collection('users').doc(uid).collection('private').doc('salary'), {
      amount: 0, allowances: 0, currency: 'JOD', updatedAt: FieldValue.serverTimestamp()
    });
    batch.set(db.collection('users').doc(uid).collection('private').doc('banking'), {
      iban: '', bankName: '', cliq: '', updatedAt: FieldValue.serverTimestamp()
    });

    await batch.commit();
  } catch (err) {
    // Roll back the Auth user so a failed write cannot orphan an account.
    await auth.deleteUser(uid).catch(() => {});
    await usernameRef.delete().catch(() => {});
    console.error('[auth] employee provisioning failed', err);
    throw new HttpsError('internal', 'تعذّر إكمال إنشاء الحساب.');
  }

  await writeAudit({
    action: 'employee.create',
    caller,
    targetId: uid,
    targetType: 'user',
    meta: { username, displayName, accountRole, roles, permissionCount: permissions.length },
    request
  });

  // The plaintext password is returned exactly once and never persisted.
  return { uid, username, tempPassword };
});

/** Change job roles, account role and granular permissions. */
exports.updateEmployeeAccess = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.edit');

  const uid = str(request.data?.uid, { max: 128, field: 'المعرّف', required: true });
  const roles = arr(request.data?.roles, { max: 7 }).filter((r) => JOB_ROLES.includes(r));
  const permissions = arr(request.data?.permissions, { max: 40 })
    .filter((p) => ALL_PERMISSIONS.includes(p));
  const accountRole = ACCOUNT_ROLES.includes(request.data?.accountRole)
    ? request.data.accountRole : 'employee';

  assertCanGrant(caller, { accountRole, permissions });

  const userDoc = await db.collection('users').doc(uid).get();
  assert(userDoc.exists, 'الموظف غير موجود.', 'not-found');

  // Guard against removing the last administrator.
  if (userDoc.data().accountRole === 'admin' && accountRole !== 'admin') {
    const admins = await db.collection('users')
      .where('accountRole', '==', 'admin').where('status', '==', 'active').get();
    assert(admins.size > 1, 'لا يمكن إزالة آخر مدير نظام في المؤسسة.', 'failed-precondition');
  }

  const claims = buildClaims({ accountRole, permissions, status: userDoc.data().status || 'active' });
  await auth.setCustomUserClaims(uid, claims);
  // Force the next token refresh to pick up the new claims.
  await auth.revokeRefreshTokens(uid);

  await db.collection('users').doc(uid).set({
    roles, accountRole, perms: claims.perms, updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAudit({
    action: 'employee.access',
    caller, targetId: uid, targetType: 'user',
    meta: { accountRole, roles, permissions },
    request
  });

  return { ok: true };
});

exports.setEmployeeStatus = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.delete');

  const uid = str(request.data?.uid, { max: 128, required: true, field: 'المعرّف' });
  const status = request.data?.status === 'disabled' ? 'disabled' : 'active';
  assert(uid !== caller.uid, 'لا يمكنك تعطيل حسابك الخاص.', 'failed-precondition');

  const userDoc = await db.collection('users').doc(uid).get();
  assert(userDoc.exists, 'الموظف غير موجود.', 'not-found');

  if (status === 'disabled' && userDoc.data().accountRole === 'admin') {
    const admins = await db.collection('users')
      .where('accountRole', '==', 'admin').where('status', '==', 'active').get();
    assert(admins.size > 1, 'لا يمكن تعطيل آخر مدير نظام.', 'failed-precondition');
  }

  const current = userDoc.data();
  const claims = buildClaims({
    accountRole: current.accountRole || 'employee',
    permissions: codesToPerms(current.perms || []),
    status
  });

  await auth.updateUser(uid, { disabled: status === 'disabled' });
  await auth.setCustomUserClaims(uid, claims);
  await auth.revokeRefreshTokens(uid);

  await db.collection('users').doc(uid).set({
    status, updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  // Clear presence so a disabled account never shows as "working".
  await require('../lib/admin').rtdb.ref(`status/${uid}`)
    .update({ state: 'offline', lastChanged: Date.now() }).catch(() => {});

  await writeAudit({
    action: 'employee.status', caller, targetId: uid, targetType: 'user',
    meta: { status }, request
  });

  return { ok: true, status };
});

exports.resetEmployeePassword = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.edit');

  const uid = str(request.data?.uid, { max: 128, required: true, field: 'المعرّف' });
  const userDoc = await db.collection('users').doc(uid).get();
  assert(userDoc.exists, 'الموظف غير موجود.', 'not-found');

  const tempPassword = generateTempPassword();
  await auth.updateUser(uid, { password: tempPassword });
  await auth.revokeRefreshTokens(uid);

  await db.collection('users').doc(uid).set({
    mustChangePassword: true, updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAudit({
    action: 'employee.password_reset', caller, targetId: uid, targetType: 'user', request
  });

  return { tempPassword };
});

/* ========================================================================== */
/* Financial data                                                             */
/* ========================================================================== */

/** Salary and/or banking, written by management. Separately permissioned. */
exports.updateEmployeeFinance = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  const uid = str(request.data?.uid, { max: 128, required: true, field: 'المعرّف' });
  const { salary, banking } = request.data || {};
  assert(salary || banking, 'لا توجد بيانات للتحديث.');

  const userRef = db.collection('users').doc(uid);
  assert((await userRef.get()).exists, 'الموظف غير موجود.', 'not-found');

  if (salary) {
    requirePermission(caller, 'employees.editSalary');
    await userRef.collection('private').doc('salary').set({
      amount: num(salary.amount, { min: 0, max: 1_000_000, field: 'الراتب' }),
      allowances: num(salary.allowances ?? 0, { min: 0, max: 1_000_000, field: 'البدلات' }),
      currency: str(salary.currency, { max: 8 }) || 'JOD',
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await writeAudit({
      action: 'employee.salary', caller, targetId: uid, targetType: 'user',
      meta: { changed: 'salary' }, request
    });
  }

  if (banking) {
    requirePermission(caller, 'employees.viewBanking');
    const iban = str(banking.iban, { max: 34 }).replace(/\s+/g, '').toUpperCase();
    assert(isValidIBAN(iban), 'رقم IBAN غير صالح.');
    await userRef.collection('private').doc('banking').set({
      iban,
      bankName: str(banking.bankName, { max: 80 }),
      cliq: str(banking.cliq, { max: 40 }),
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await writeAudit({
      action: 'employee.banking', caller, targetId: uid, targetType: 'user',
      meta: { changed: 'banking' }, request
    });
  }

  return { ok: true };
});

/** An employee maintaining their own IBAN / CliQ through the protected form. */
exports.updateOwnBanking = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  const iban = str(request.data?.iban, { max: 34 }).replace(/\s+/g, '').toUpperCase();
  assert(isValidIBAN(iban), 'رقم IBAN غير صالح.');

  await db.collection('users').doc(caller.uid)
    .collection('private').doc('banking').set({
      iban,
      bankName: str(request.data?.bankName, { max: 80 }),
      cliq: str(request.data?.cliq, { max: 40 }),
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

  await writeAudit({
    action: 'employee.banking', caller, targetId: caller.uid, targetType: 'user',
    meta: { changed: 'banking', self: true }, request
  });

  return { ok: true };
});

exports.updateLeaveBalance = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.edit');

  const uid = str(request.data?.uid, { max: 128, required: true, field: 'المعرّف' });
  const annualQuota = num(request.data?.annualQuota, { min: 0, max: 60, field: 'الرصيد السنوي' });
  const used = num(request.data?.used, { min: 0, max: 366, field: 'الأيام المستخدمة' });

  await db.collection('users').doc(uid).set({
    leave: { annualQuota, used, remaining: Math.max(0, annualQuota - used) },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await writeAudit({
    action: 'employee.leave', caller, targetId: uid, targetType: 'user',
    meta: { annualQuota, used }, request
  });

  return { ok: true };
});

/* ========================================================================== */
/* Push tokens                                                                */
/* ========================================================================== */

exports.registerPushToken = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  const token = str(request.data?.token, { max: 400, required: true, field: 'رمز الجهاز' });

  await db.collection('users').doc(caller.uid).set({
    fcmTokens: FieldValue.arrayUnion(token),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true };
});
