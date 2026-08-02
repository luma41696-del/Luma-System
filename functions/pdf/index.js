/**
 * Document services for administrative requests.
 *
 * `assignRequestNumber` issues a sequential, human-readable reference number
 * (LR-2026-0001) inside a transaction, so two simultaneous submissions can
 * never collide.
 *
 * `decideRequest` is the approval workflow: only a holder of `requests.approve`
 * may move a request to approved/rejected, the leave balance is adjusted
 * server-side, and the decision is audited.
 *
 * `getRequestDocument` returns a *server-verified* payload for PDF rendering,
 * so the exported document reflects the database rather than whatever the
 * browser happens to have in memory.
 *
 * The PDF itself is produced in the browser (js/utils/pdf.js): the browser is
 * the only place with a correct Arabic shaping + bidi engine, so rendering there
 * avoids the disconnected / reversed letters that server-side PDF libraries
 * produce with Arabic text.
 */

const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission, has } = require('../lib/permissions');
const { assert, str, dayKey } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const region = { region: REGION };
const opts = { region: REGION, cors: true };

const PREFIX = { leave: 'LR', departure: 'DR', advance: 'AR', sick: 'SR' };

/* ------------------------------------------------------- request numbering */

exports.assignRequestNumber = onDocumentCreated(
  { ...region, document: 'requests/{requestId}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const request = snap.data();
    if (request.requestNo) return;

    const year = new Date().getFullYear();
    const counterRef = db.collection('counters').doc(`requests_${year}`);

    const sequence = await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = (counter.exists ? counter.data().value || 0 : 0) + 1;
      tx.set(counterRef, { value: next, year, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return next;
    });

    const requestNo = `${PREFIX[request.type] || 'RQ'}-${year}-${String(sequence).padStart(4, '0')}`;
    await snap.ref.set({ requestNo }, { merge: true });
  }
);

/* --------------------------------------------------------------- decisions */

exports.decideRequest = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'requests.approve');

  const requestId = str(request.data?.requestId, { max: 128, required: true, field: 'المعرّف' });
  const status = request.data?.status;
  assert(['approved', 'rejected', 'review'].includes(status), 'حالة غير صالحة.');
  const response = str(request.data?.response, { max: 2000 });

  const ref = db.collection('requests').doc(requestId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assert(snap.exists, 'الطلب غير موجود.', 'not-found');
    const data = snap.data();
    assert(
      ['submitted', 'review'].includes(data.status),
      'لا يمكن اتخاذ قرار على طلب في هذه الحالة.',
      'failed-precondition'
    );
    assert(data.employeeId !== caller.uid || caller.isAdmin,
      'لا يمكنك اعتماد طلبك الخاص.', 'permission-denied');

    const patch = {
      status,
      managerResponse: response,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (status === 'review') {
      patch.reviewedAt = FieldValue.serverTimestamp();
    } else {
      patch.decidedAt = FieldValue.serverTimestamp();
      patch.decidedBy = caller.uid;
    }

    tx.set(ref, patch, { merge: true });

    // Approving a leave consumes days from the employee's balance.
    if (status === 'approved' && ['leave', 'sick'].includes(data.type) && data.days > 0) {
      const userRef = db.collection('users').doc(data.employeeId);
      const userSnap = await tx.get(userRef);
      if (userSnap.exists) {
        const leave = userSnap.data().leave || { annualQuota: 14, used: 0 };
        const used = (leave.used || 0) + data.days;
        tx.set(userRef, {
          leave: {
            ...leave,
            used,
            remaining: Math.max(0, (leave.annualQuota || 14) - used),
            usedThisMonth: (leave.usedThisMonth || 0) + data.days
          },
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    return { type: data.type, employeeId: data.employeeId, days: data.days || 0 };
  });

  await writeAudit({
    action: 'request.decide',
    caller,
    targetId: requestId,
    targetType: 'request',
    meta: { status, type: outcome.type, employeeId: outcome.employeeId, days: outcome.days },
    request
  });

  return { ok: true, status };
});

/* --------------------------------------------------- verified PDF payload */

/**
 * Returns the data the printable request sheet needs, assembled and authorised
 * on the server. The caller must be the requester or hold `requests.approve`.
 */
exports.getRequestDocument = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  const requestId = str(request.data?.requestId, { max: 128, required: true, field: 'المعرّف' });

  const snap = await db.collection('requests').doc(requestId).get();
  assert(snap.exists, 'الطلب غير موجود.', 'not-found');
  const data = snap.data();

  assert(
    data.employeeId === caller.uid || has(caller, 'requests.approve'),
    'لا تملك صلاحية عرض هذا الطلب.',
    'permission-denied'
  );

  const [employeeSnap, deciderSnap] = await Promise.all([
    db.collection('users').doc(data.employeeId).get(),
    data.decidedBy ? db.collection('users').doc(data.decidedBy).get() : Promise.resolve(null)
  ]);

  const publicProfile = (doc) => {
    if (!doc?.exists) return {};
    const profile = doc.data();
    return {
      displayName: profile.displayName,
      username: profile.username,
      roles: profile.roles || [],
      department: profile.department,
      phone: profile.phone || '',
      personalEmail: profile.personalEmail || ''
    };
  };

  return {
    request: {
      ...data,
      id: snap.id,
      createdAt: data.createdAt?.toMillis?.() || null,
      decidedAt: data.decidedAt?.toMillis?.() || null,
      submittedAt: data.submittedAt?.toMillis?.() || null
    },
    employee: publicProfile(employeeSnap),
    manager: publicProfile(deciderSnap),
    issuedAt: Date.now(),
    issuedBy: caller.uid,
    dayKey: dayKey()
  };
});
