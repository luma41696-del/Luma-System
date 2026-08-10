/**
 * Monthly payroll: salaries, commissions, overtime, and advance recovery.
 *
 * A run is built once from the employee records, then edited as a draft,
 * approved, and finally paid out of a treasury account. Each stage is a
 * separate permission-checked step because they are separate decisions:
 * preparing a payroll is not the same as authorising it, and authorising it is
 * not the same as releasing the money.
 *
 * UNITS: salaries live in `users/{uid}/private/salary` in whole dinars, written
 * long before this module existed. Everything in finance is integer piastres.
 * The conversion happens once, here at the boundary, and is never re-applied —
 * getting this wrong would misstate payroll by a factor of a hundred.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { money, nextNumber } = require('./helpers');
const { postTransaction } = require('./treasury');

const opts = { region: REGION, cors: true };

/** Whole dinars (legacy salary records) -> piastres. */
const toMinor = (major) => Math.round((Number(major) || 0) * 100);

/** Recompute a line's net from its parts. Single source of the arithmetic. */
function netOf(line) {
  const earnings = (line.baseSalary || 0) + (line.allowances || 0)
    + (line.commission || 0) + (line.overtime || 0);
  const deductions = (line.advanceDeduction || 0) + (line.otherDeductions || 0);
  return Math.max(0, earnings - deductions);
}

/* ========================================================================== */
/* Build                                                                      */
/* ========================================================================== */

exports.createPayrollRun = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.payroll');

  const period = str(request.data?.period, { max: 7, required: true, field: 'الشهر' });
  assert(/^\d{4}-\d{2}$/.test(period), 'صيغة الشهر يجب أن تكون YYYY-MM.');

  // One run per month, or the same salary could be paid twice.
  const existing = await db.collection('payrollRuns').where('period', '==', period).limit(1).get();
  assert(existing.empty, `يوجد كشف رواتب لشهر ${period} بالفعل.`);

  const usersSnap = await db.collection('users').where('status', '==', 'active').get();
  const employees = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  assert(employees.length > 0, 'لا يوجد موظفون نشطون.');

  // Salary sits in a per-user subcollection, so it is read per employee.
  const salaries = await Promise.all(employees.map(async (e) => {
    const snap = await db.collection('users').doc(e.id).collection('private').doc('salary').get();
    return { id: e.id, salary: snap.exists ? snap.data() : null };
  }));
  const salaryById = Object.fromEntries(salaries.map((s) => [s.id, s.salary]));

  // Outstanding advances, so this run can recover an instalment.
  const advSnap = await db.collection('requests')
    .where('type', '==', 'advance').where('status', '==', 'approved').get();
  const advancesByUser = {};
  advSnap.docs.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    const total = toMinor(a.amount);
    const recovered = a.recoveredAmount || 0;
    if (recovered >= total) return;                       // already settled
    const perInstalment = Math.ceil(total / Math.max(1, a.installments || 1));
    (advancesByUser[a.employeeId] ||= []).push({
      id: a.id, total, recovered, due: Math.min(perInstalment, total - recovered)
    });
  });

  const runRef = db.collection('payrollRuns').doc();
  const lines = [];

  for (const employee of employees) {
    const salary = salaryById[employee.id];
    // Someone with no salary on file is listed at zero rather than skipped, so
    // the omission is visible on the sheet instead of silently missing.
    const baseSalary = toMinor(salary?.amount);
    const allowances = toMinor(salary?.allowances);
    const advances = advancesByUser[employee.id] || [];
    const advanceDeduction = advances.reduce((s, a) => s + a.due, 0);

    const line = {
      employeeId: employee.id,
      employeeName: employee.displayName || '',
      baseSalary,
      allowances,
      commission: 0,
      overtime: 0,
      advanceDeduction,
      advanceRefs: advances.map((a) => ({ requestId: a.id, amount: a.due })),
      otherDeductions: 0,
      hasSalaryOnFile: !!salary
    };
    line.net = netOf(line);
    lines.push(line);
  }

  const number = await db.runTransaction(async (tx) => {
    const allocated = await nextNumber(tx, 'payroll', 'PAY');
    tx.set(runRef, {
      payrollNo: allocated.formatted,
      period,
      status: 'draft',
      employeeCount: lines.length,
      totalGross: lines.reduce((s, l) => s + l.baseSalary + l.allowances, 0),
      totalDeductions: lines.reduce((s, l) => s + l.advanceDeduction + l.otherDeductions, 0),
      totalNet: lines.reduce((s, l) => s + l.net, 0),
      currency: 'JOD',
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    lines.forEach((line) => tx.set(runRef.collection('lines').doc(line.employeeId), line));
    return allocated.formatted;
  });

  await writeAudit({
    action: 'payroll.create', caller, targetId: runRef.id,
    meta: { payrollNo: number, period, employees: lines.length }
  });
  return { id: runRef.id, payrollNo: number, employeeCount: lines.length };
});

/* ========================================================================== */
/* Edit                                                                       */
/* ========================================================================== */

/** Adjust one employee's line while the run is still a draft. */
exports.updatePayrollLine = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.payroll');

  const runId = str(request.data?.runId, { max: 128, required: true, field: 'الكشف' });
  const employeeId = str(request.data?.employeeId, { max: 128, required: true, field: 'الموظف' });

  const commission = money(request.data?.commission, { field: 'العمولة', required: false, min: 0 });
  const overtime = money(request.data?.overtime, { field: 'الإضافي', required: false, min: 0 });
  const otherDeductions = money(request.data?.otherDeductions, { field: 'الخصومات', required: false, min: 0 });

  const runRef = db.collection('payrollRuns').doc(runId);
  const lineRef = runRef.collection('lines').doc(employeeId);

  const totals = await db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) throw new HttpsError('not-found', 'الكشف غير موجود.');
    if (runSnap.data().status !== 'draft') {
      throw new HttpsError('failed-precondition', 'لا يمكن تعديل كشف معتمد أو مدفوع.');
    }
    const lineSnap = await tx.get(lineRef);
    if (!lineSnap.exists) throw new HttpsError('not-found', 'الموظف غير مدرج في هذا الكشف.');

    const updated = { ...lineSnap.data(), commission, overtime, otherDeductions };
    updated.net = netOf(updated);
    tx.set(lineRef, updated);

    // The run totals are recomputed from the lines rather than adjusted by a
    // delta, so they cannot drift away from the rows they summarise.
    const allLines = await runRef.collection('lines').get();
    const rows = allLines.docs.map((d) => (d.id === employeeId ? updated : d.data()));
    const sums = {
      totalGross: rows.reduce((s, l) => s + (l.baseSalary || 0) + (l.allowances || 0)
        + (l.commission || 0) + (l.overtime || 0), 0),
      totalDeductions: rows.reduce((s, l) => s + (l.advanceDeduction || 0) + (l.otherDeductions || 0), 0),
      totalNet: rows.reduce((s, l) => s + netOf(l), 0),
      updatedAt: FieldValue.serverTimestamp()
    };
    tx.update(runRef, sums);
    return sums;
  });

  await writeAudit({
    action: 'payroll.line', caller, targetId: runId,
    meta: { employeeId, commission, overtime, otherDeductions }
  });
  return { net: totals.totalNet };
});

/* ========================================================================== */
/* Approve and pay                                                            */
/* ========================================================================== */

/** Lock the sheet and record the advance instalments it recovers. */
exports.approvePayrollRun = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.approve');

  const runId = str(request.data?.runId, { max: 128, required: true, field: 'الكشف' });
  const runRef = db.collection('payrollRuns').doc(runId);

  const runSnap = await runRef.get();
  assert(runSnap.exists, 'الكشف غير موجود.');
  assert(runSnap.data().status === 'draft', 'تم اعتماد هذا الكشف مسبقاً.');

  const lines = (await runRef.collection('lines').get()).docs.map((d) => d.data());

  // Advance recovery is recorded at approval, not at creation: a draft can be
  // rebuilt or abandoned, and a discarded draft must not have consumed an
  // instalment the employee still owes.
  const batch = db.batch();
  for (const line of lines) {
    for (const ref of line.advanceRefs || []) {
      batch.update(db.collection('requests').doc(ref.requestId), {
        recoveredAmount: FieldValue.increment(ref.amount),
        lastRecoveredIn: runId
      });
    }
  }
  batch.update(runRef, {
    status: 'approved',
    approvedBy: caller.uid,
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  await batch.commit();

  await writeAudit({
    action: 'payroll.approve', caller, targetId: runId,
    meta: { period: runSnap.data().period, totalNet: runSnap.data().totalNet }
  });
  return { ok: true };
});

/** Release the money: one withdrawal from a treasury account for the net total. */
exports.payPayrollRun = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.payroll');

  const runId = str(request.data?.runId, { max: 128, required: true, field: 'الكشف' });
  const accountId = str(request.data?.accountId, { max: 128, required: true, field: 'الحساب' });
  const date = str(request.data?.date, { max: 10, required: true, field: 'التاريخ' });
  const runRef = db.collection('payrollRuns').doc(runId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) throw new HttpsError('not-found', 'الكشف غير موجود.');
    const run = snap.data();
    if (run.status !== 'approved') {
      throw new HttpsError('failed-precondition', 'يجب اعتماد الكشف قبل صرفه.');
    }
    if (!(run.totalNet > 0)) throw new HttpsError('failed-precondition', 'صافي الكشف صفر.');

    const posted = await postTransaction(tx, {
      accountId,
      type: 'withdrawal',
      amount: run.totalNet,
      date,
      description: `رواتب ${run.period}`,
      refType: 'payroll', refId: runId, refNo: run.payrollNo,
      actorId: caller.uid
    });

    tx.update(runRef, {
      status: 'paid',
      paidFromAccount: accountId,
      paidAt: FieldValue.serverTimestamp(),
      paymentTransactionId: posted.transactionId,
      updatedAt: FieldValue.serverTimestamp()
    });
    return posted;
  });

  await writeAudit({
    action: 'payroll.pay', caller, targetId: runId, meta: { accountId, date }
  });
  return result;
});
