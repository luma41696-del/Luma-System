/**
 * Permanent deletion of employees, clients and administrative requests.
 *
 * Firestore does not cascade: deleting a document leaves its subcollections and
 * every reference to it behind. So each of these callables owns the full
 * clean-up, runs entirely server-side after re-checking the caller's claims,
 * and records what it removed in the audit log.
 *
 * Deletion is irreversible. Where a safer option exists it is offered first —
 * disabling an employee keeps their history and is what the UI recommends.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, auth, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const opts = { region: REGION, cors: true };

/* -------------------------------------------------------------- helpers */

/** Delete every document a query returns, in chunks Firestore can commit. */
async function deleteAll(query, label, counters) {
  let removed = 0;
  while (true) {
    const snap = await query.limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 300) break;
  }
  if (removed && counters) counters[label] = removed;
  return removed;
}

/** recursiveDelete removes the document *and* all of its subcollections. */
async function purgeDoc(ref) {
  await db.recursiveDelete(ref);
}

/* ========================================================================== */
/* Employee                                                                   */
/* ========================================================================== */

/**
 * Permanently remove an employee: the Auth account, the profile and its private
 * subtree, the username reservation, and every personal record they own.
 *
 * Tasks are deliberately kept — they belong to clients and projects, not to the
 * person — but the employee is unassigned from them so nothing points at a
 * missing user.
 */
exports.deleteEmployee = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'employees.delete');

  const uid = str(request.data?.uid, { max: 128, required: true, field: 'المعرّف' });
  assert(uid !== caller.uid, 'لا يمكنك حذف حسابك الخاص.', 'failed-precondition');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  assert(userSnap.exists, 'الموظف غير موجود.', 'not-found');
  const profile = userSnap.data();

  // Never leave the organisation without an administrator.
  if (profile.accountRole === 'admin') {
    const admins = await db.collection('users')
      .where('accountRole', '==', 'admin').where('status', '==', 'active').get();
    assert(admins.size > 1, 'لا يمكن حذف آخر مدير نظام في المؤسسة.', 'failed-precondition');
  }

  const removed = {};

  // 1 ── unassign from tasks (tasks themselves are preserved)
  const assigned = await db.collection('tasks').where('assignees', 'array-contains', uid).get();
  if (!assigned.empty) {
    const batch = db.batch();
    assigned.docs.forEach((doc) => batch.update(doc.ref, {
      assignees: FieldValue.arrayRemove(uid),
      watchers: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp()
    }));
    await batch.commit();
    removed.tasksUnassigned = assigned.size;
  }

  // 2 ── remove from every chat room they belong to
  const chats = await db.collection('chats').where('members', 'array-contains', uid).get();
  if (!chats.empty) {
    const batch = db.batch();
    chats.docs.forEach((doc) => batch.update(doc.ref, {
      members: FieldValue.arrayRemove(uid),
      [`memberNames.${uid}`]: FieldValue.delete(),
      [`unread.${uid}`]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }));
    await batch.commit();
    removed.chatsLeft = chats.size;
  }

  // 3 ── their own records
  const requests = await db.collection('requests').where('employeeId', '==', uid).get();
  for (const doc of requests.docs) await purgeDoc(doc.ref);   // includes the thread
  if (requests.size) removed.requests = requests.size;

  await deleteAll(db.collection('breakSessions').where('userId', '==', uid), 'breakSessions', removed);
  await deleteAll(db.collection('workSessions').where('userId', '==', uid), 'workSessions', removed);
  await deleteAll(db.collection('notifications').where('userId', '==', uid), 'notifications', removed);
  await deleteAll(db.collection('calendarEvents').where('createdBy', '==', uid), 'calendarEvents', removed);

  // 4 ── profile (with its private/ and stats/ subcollections) + username index
  await purgeDoc(userRef);
  if (profile.username) {
    await db.collection('usernames').doc(profile.username).delete().catch(() => {});
    await db.collection('loginAttempts').doc(`u_${profile.username}`).delete().catch(() => {});
  }

  // 5 ── presence node
  try {
    await require('../lib/admin').rtdb.ref(`status/${uid}`).remove();
  } catch { /* RTDB not configured — non-fatal */ }

  // 6 ── the Auth account last: if anything above failed we still have a way in
  await auth.deleteUser(uid).catch((err) => {
    if (err.code !== 'auth/user-not-found') throw err;
  });

  await writeAudit({
    action: 'employee.delete',
    caller,
    targetId: uid,
    targetType: 'user',
    meta: { username: profile.username, displayName: profile.displayName, ...removed },
    request
  });

  return { ok: true, removed };
});

/* ========================================================================== */
/* Client                                                                     */
/* ========================================================================== */

/**
 * Permanently remove a client with its social accounts, files, activity log and
 * every encrypted credential in the vault.
 *
 * Tasks are preserved: the work was really done and still counts towards each
 * employee's statistics. They are detached from the client instead, keeping the
 * client's name as plain text for history.
 */
exports.deleteClient = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'clients.delete');

  const clientId = str(request.data?.clientId, { max: 128, required: true, field: 'المعرّف' });
  const confirmed = request.data?.confirmed === true;

  const clientRef = db.collection('clients').doc(clientId);
  const clientSnap = await clientRef.get();
  assert(clientSnap.exists, 'العميل غير موجود.', 'not-found');
  const client = clientSnap.data();

  const tasks = await db.collection('tasks').where('clientId', '==', clientId).get();
  const credentials = await db.collection('clientCredentials').where('clientId', '==', clientId).get();

  // First call reports the impact; the UI shows it and calls again with confirmed.
  if (!confirmed) {
    return {
      needsConfirmation: true,
      name: client.name,
      taskCount: tasks.size,
      credentialCount: credentials.size
    };
  }

  const removed = {};

  // Detach tasks, keep the client name for the record.
  if (!tasks.empty) {
    const batch = db.batch();
    tasks.docs.forEach((doc) => batch.update(doc.ref, {
      clientId: null,
      clientName: client.name,
      updatedAt: FieldValue.serverTimestamp()
    }));
    await batch.commit();
    removed.tasksDetached = tasks.size;
  }

  // Encrypted credentials are destroyed outright — no tombstone keeps ciphertext.
  if (!credentials.empty) {
    const batch = db.batch();
    credentials.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    removed.credentials = credentials.size;
  }

  await deleteAll(db.collection('calendarEvents').where('clientId', '==', clientId), 'calendarEvents', removed);

  // The client document plus social/, files/ and activity/.
  await purgeDoc(clientRef);

  await writeAudit({
    action: 'client.delete',
    caller,
    targetId: clientId,
    targetType: 'client',
    meta: { name: client.name, ...removed },
    request
  });

  return { ok: true, removed };
});

/* ========================================================================== */
/* Chat                                                                       */
/* ========================================================================== */

/**
 * Delete a conversation together with its messages.
 *
 * A direct chat belongs to the two people in it, so either of them may remove
 * it. Group, department and manager rooms are shared workspace, so removing one
 * requires `chat.manage`.
 *
 * Note this deletes for *everyone* — it is not a per-user "hide". The dialog in
 * the UI says so explicitly.
 */
exports.deleteChat = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  const chatId = str(request.data?.chatId, { max: 128, required: true, field: 'المعرّف' });
  const ref = db.collection('chats').doc(chatId);
  const snap = await ref.get();
  assert(snap.exists, 'المحادثة غير موجودة.', 'not-found');
  const chat = snap.data();

  const isMember = Array.isArray(chat.members) && chat.members.includes(caller.uid);
  const canManage = caller.isAdmin ||
    (Array.isArray(caller.perms) && caller.perms.includes('cm'));

  if (chat.type === 'direct') {
    assert(isMember || canManage, 'لا تملك صلاحية حذف هذه المحادثة.', 'permission-denied');
  } else {
    assert(canManage, 'حذف المجموعات متاح لمن يملك صلاحية إدارة الدردشة.', 'permission-denied');
  }

  // Count first — recursiveDelete gives no total back.
  const messages = await ref.collection('messages').count().get();
  const messageCount = messages.data().count;

  await purgeDoc(ref);   // chat + messages/

  // Clear the typing indicators so a deleted room leaves nothing behind.
  try {
    await require('../lib/admin').rtdb.ref(`typing/${chatId}`).remove();
  } catch { /* RTDB not configured — non-fatal */ }

  await writeAudit({
    action: 'chat.delete',
    caller,
    targetId: chatId,
    targetType: 'chat',
    meta: { type: chat.type, name: chat.name || '(محادثة خاصة)', messageCount,
            memberCount: (chat.members || []).length },
    request
  });

  return { ok: true, messageCount };
});

/* ========================================================================== */
/* Request                                                                    */
/* ========================================================================== */

/**
 * Delete an administrative request and its private manager thread.
 *
 * The requester may remove their own request only while it is still a draft or
 * already cancelled — an approved leave has consequences (a deducted balance)
 * and must go through management.
 */
exports.deleteRequest = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  const requestId = str(request.data?.requestId, { max: 128, required: true, field: 'المعرّف' });
  const ref = db.collection('requests').doc(requestId);
  const snap = await ref.get();
  assert(snap.exists, 'الطلب غير موجود.', 'not-found');
  const data = snap.data();

  const isApprover = caller.isAdmin ||
    (Array.isArray(caller.perms) && caller.perms.includes('ra'));
  const isOwner = data.employeeId === caller.uid;
  const ownerMayDelete = isOwner && ['draft', 'cancelled', 'rejected'].includes(data.status);

  assert(
    isApprover || ownerMayDelete,
    isOwner
      ? 'لا يمكن حذف طلب تمت الموافقة عليه أو قيد المراجعة — يمكنك سحبه بدلاً من ذلك.'
      : 'لا تملك صلاحية حذف هذا الطلب.',
    'permission-denied'
  );

  // Approving a leave deducts days; deleting it afterwards must give them back.
  if (data.status === 'approved' && ['leave', 'sick'].includes(data.type) && data.days > 0) {
    const userRef = db.collection('users').doc(data.employeeId);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return;
      const leave = userSnap.data().leave || { annualQuota: 14, used: 0 };
      const used = Math.max(0, (leave.used || 0) - data.days);
      tx.set(userRef, {
        leave: {
          ...leave,
          used,
          remaining: Math.max(0, (leave.annualQuota || 14) - used),
          usedThisMonth: Math.max(0, (leave.usedThisMonth || 0) - data.days)
        },
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  await purgeDoc(ref);   // request + thread/

  await writeAudit({
    action: 'request.delete',
    caller,
    targetId: requestId,
    targetType: 'request',
    meta: {
      type: data.type,
      status: data.status,
      requestNo: data.requestNo,
      employeeId: data.employeeId,
      leaveDaysRestored: data.status === 'approved' ? (data.days || 0) : 0
    },
    request
  });

  return { ok: true, leaveRestored: data.status === 'approved' ? (data.days || 0) : 0 };
});
