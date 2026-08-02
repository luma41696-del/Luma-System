#!/usr/bin/env node
/**
 * Secure initial-administrator seed.
 *
 * Run ONCE, from a trusted machine, with Admin SDK credentials.
 * The temporary password is read from the environment — it is never written
 * into any source file, and the account is flagged `mustChangePassword` so it
 * has to be replaced at first login.
 *
 *   # PowerShell
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
 *   $env:LUMA_ADMIN_TEMP_PASSWORD="<the temporary password>"
 *   node scripts/seed-admin.js
 *
 *   # bash
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   LUMA_ADMIN_TEMP_PASSWORD='<the temporary password>' node scripts/seed-admin.js
 *
 * Optional overrides: LUMA_ADMIN_USERNAME (default "admin"),
 * LUMA_ADMIN_NAME, LUMA_ADMIN_EMAIL, LUMA_PROJECT_ID.
 */

'use strict';

try { require('dotenv').config(); } catch { /* dotenv is optional */ }

const admin = require('firebase-admin');

const PERMISSION_CODES = require('../lib/permissions').PERMISSION_CODES;
const AUTH_EMAIL_DOMAIN = 'users.luma-agency.internal';

const USERNAME = (process.env.LUMA_ADMIN_USERNAME || 'admin').trim().toLowerCase();
const PASSWORD = process.env.LUMA_ADMIN_TEMP_PASSWORD;
const NAME = process.env.LUMA_ADMIN_NAME || 'مدير النظام';
const EMAIL = process.env.LUMA_ADMIN_EMAIL || '';
const PROJECT_ID = process.env.LUMA_PROJECT_ID || 'luma-web-d3550';

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

if (!PASSWORD) {
  fail(
    'LUMA_ADMIN_TEMP_PASSWORD is not set.\n' +
    '   Set it in your shell (or functions/.env) to the temporary password you\n' +
    '   intend to hand over, then run this script again.\n' +
    '   It is deliberately not stored in the repository.'
  );
}
if (PASSWORD.length < 6) {
  fail('The temporary password must be at least 6 characters (Firebase minimum).');
}
if (!/^[a-z0-9._-]{3,24}$/.test(USERNAME)) {
  fail('LUMA_ADMIN_USERNAME must be 3-24 lowercase latin characters.');
}

/* When the Auth/Firestore emulator host variables are present the Admin SDK
   talks to the local emulators, which accept any project and need no
   credentials — so asking for a service-account key there would be wrong. */
const USING_EMULATORS = !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (!admin.apps.length) {
  admin.initializeApp(
    USING_EMULATORS
      ? { projectId: PROJECT_ID }
      : { credential: admin.credential.applicationDefault(), projectId: PROJECT_ID }
  );
}
if (USING_EMULATORS) console.log('   ⚙  Emulator mode — writing to the local Firebase emulators.\n');

const db = admin.firestore();
const auth = admin.auth();
const authEmail = `${USERNAME}@${AUTH_EMAIL_DOMAIN}`;

async function main() {
  console.log(`\n🔧 Seeding administrator "${USERNAME}" into project ${PROJECT_ID}…\n`);

  // 1 ── Auth account -------------------------------------------------------
  let user;
  try {
    user = await auth.getUserByEmail(authEmail);
    console.log(`   ℹ  Auth account already exists (${user.uid}) — updating password & claims.`);
    await auth.updateUser(user.uid, { password: PASSWORD, displayName: NAME, disabled: false });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({
      email: authEmail,
      password: PASSWORD,
      displayName: NAME,
      emailVerified: false,
      disabled: false
    });
    console.log(`   ✔  Created Auth account ${user.uid}`);
  }

  // 2 ── Custom claims ------------------------------------------------------
  // Admin implies every permission, so `perms` stays empty and small.
  await auth.setCustomUserClaims(user.uid, {
    role: 'admin',
    perms: [],
    status: 'active'
  });
  console.log('   ✔  Custom claims set: role=admin');

  // 3 ── Username index -----------------------------------------------------
  await db.collection('usernames').doc(USERNAME).set({
    uid: user.uid,
    authEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log(`   ✔  Username index reserved: /usernames/${USERNAME}`);

  // 4 ── Profile ------------------------------------------------------------
  await db.collection('users').doc(user.uid).set({
    uid: user.uid,
    username: USERNAME,
    usernameLower: USERNAME,
    displayName: NAME,
    displayNameLower: NAME.toLowerCase(),
    personalEmail: EMAIL,
    phone: '',
    department: 'admin',
    roles: ['account_manager', 'it'],
    accountRole: 'admin',
    perms: [],
    photoURL: null,
    status: 'active',
    mustChangePassword: true,          // forced change at first login
    joinDate: new Date().toISOString().slice(0, 10),
    managerId: null,
    leave: { annualQuota: 21, used: 0, remaining: 21, usedThisMonth: 0 },
    notifPrefs: {},
    notes: 'الحساب الإداري الأول — أُنشئ عبر سكربت التهيئة الآمن.',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection('users').doc(user.uid).collection('private').doc('salary')
    .set({ amount: 0, allowances: 0, currency: 'JOD',
           updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('users').doc(user.uid).collection('private').doc('banking')
    .set({ iban: '', bankName: '', cliq: '',
           updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  console.log('   ✔  Profile document written');

  // 5 ── Baseline system settings ------------------------------------------
  await db.collection('settings').doc('app').set({
    agencyName: 'وكالة لوما',
    defaultLeaveQuota: 14,
    dailyBreakLimitMin: 60,
    workdayHours: 8,
    timezone: 'Asia/Amman',
    seededAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // 6 ── Company-wide chat room --------------------------------------------
  const generalChat = await db.collection('chats')
    .where('type', '==', 'group').where('name', '==', 'الفريق العام').limit(1).get();
  if (generalChat.empty) {
    await db.collection('chats').add({
      type: 'group',
      name: 'الفريق العام',
      members: [user.uid],
      memberNames: { [user.uid]: NAME },
      unread: {},
      createdBy: user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: ''
    });
    console.log('   ✔  Created the company-wide chat room');
  }

  // 7 ── Audit trail --------------------------------------------------------
  await db.collection('auditLogs').add({
    action: 'system.seed_admin',
    actorId: user.uid,
    actorName: NAME,
    actorRole: 'admin',
    targetId: user.uid,
    targetType: 'user',
    meta: { username: USERNAME, via: 'seed-admin.js' },
    at: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`
✅ Done.

   Sign in at:  index.html
   Username:    ${USERNAME}
   Password:    (the value of LUMA_ADMIN_TEMP_PASSWORD — not printed here)

   The account is flagged as temporary: the system will force a password
   change on the first successful login.

   Next: clear LUMA_ADMIN_TEMP_PASSWORD from your shell history/environment.
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Seeding failed:', err.message);
    if (err.code === 'app/invalid-credential' || /credential/i.test(err.message)) {
      console.error('   Check GOOGLE_APPLICATION_CREDENTIALS points at a valid service-account JSON.');
    }
    process.exit(1);
  });
