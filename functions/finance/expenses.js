/**
 * Expenses and client advertising budgets — stage two of the finance module.
 *
 * Two rules shape the design here:
 *
 *   1. An expense only counts once someone with `finance.approve` signs it
 *      off, so `status` and the approval fields are server-owned and never
 *      part of the submitted payload.
 *   2. Advertising money a client hands over is *not* revenue. It is their
 *      money passing through the agency, and counting it as income would
 *      inflate profit by the entire ad spend. It lives in its own collection
 *      with `received` and `spent` tracked separately, so the remaining
 *      balance is always visibly the client's.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { money, nextNumber, EXPENSE_CATEGORIES, AD_PLATFORMS } = require('./helpers');

const opts = { region: REGION, cors: true };

/* ========================================================================== */
/* Expenses                                                                   */
/* ========================================================================== */

exports.saveExpense = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const data = request.data || {};
  const expenseId = str(data.expenseId, { max: 128, required: false, field: 'المصروف' });
  const category = str(data.category, { max: 30, required: true, field: 'التصنيف' });
  assert(EXPENSE_CATEGORIES.includes(category), 'تصنيف المصروف غير صالح.');

  const amount = money(data.amount, { field: 'المبلغ', min: 1 });
  const spentAt = str(data.spentAt, { max: 10, required: true, field: 'التاريخ' });
  const description = str(data.description, { max: 300, required: true, field: 'الوصف' });
  const vendor = str(data.vendor, { max: 160, required: false, field: 'الجهة' });
  const clientId = str(data.clientId, { max: 128, required: false, field: 'العميل' });
  const notes = str(data.notes, { max: 2000, required: false, field: 'الملاحظات' });

  // Tying an expense to a client is what makes per-client profit meaningful,
  // so the link is validated rather than trusted.
  let clientName = '';
  if (clientId) {
    const snap = await db.collection('clients').doc(clientId).get();
    assert(snap.exists, 'العميل غير موجود.');
    clientName = snap.data().name || '';
  }

  const payload = {
    category,
    amount,
    spentAt,
    description,
    vendor,
    clientId: clientId || null,
    clientName,
    notes,
    currency: 'JOD',
    updatedAt: FieldValue.serverTimestamp()
  };

  if (expenseId) {
    const ref = db.collection('expenses').doc(expenseId);
    const snap = await ref.get();
    assert(snap.exists, 'المصروف غير موجود.');
    // Editing an approved expense would change a figure someone already signed
    // off on; the correction is a new entry, which keeps the trail intact.
    assert(snap.data().status !== 'approved',
      'المصروف معتمد ولا يمكن تعديله — سجّل مصروفاً معاكساً بدلاً من ذلك.');
    await ref.update(payload);
    await writeAudit({ action: 'expense.update', caller, targetId: expenseId, meta: { amount } });
    return { id: expenseId };
  }

  const ref = db.collection('expenses').doc();
  const number = await db.runTransaction(async (tx) => {
    const allocated = await nextNumber(tx, 'expenses', 'EXP');
    tx.set(ref, {
      ...payload,
      expenseNo: allocated.formatted,
      expenseSeq: allocated.value,
      status: 'pending',
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp()
    });
    return allocated.formatted;
  });

  await writeAudit({
    action: 'expense.create',
    caller,
    targetId: ref.id,
    meta: { expenseNo: number, amount, category, clientId: clientId || null }
  });
  return { id: ref.id, expenseNo: number };
});

/** Approve or reject. A different permission from raising the expense. */
exports.decideExpense = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.approve');

  const expenseId = str(request.data?.expenseId, { max: 128, required: true, field: 'المصروف' });
  const decision = str(request.data?.decision, { max: 20, required: true, field: 'القرار' });
  assert(['approved', 'rejected'].includes(decision), 'القرار غير صالح.');
  const note = str(request.data?.note, { max: 500, required: false, field: 'الملاحظة' });

  const ref = db.collection('expenses').doc(expenseId);
  const snap = await ref.get();
  assert(snap.exists, 'المصروف غير موجود.');
  assert(snap.data().status === 'pending', 'تم البت في هذا المصروف مسبقاً.');

  await ref.update({
    status: decision,
    decisionNote: note,
    decidedBy: caller.uid,
    decidedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAudit({
    action: `expense.${decision}`,
    caller,
    targetId: expenseId,
    meta: { amount: snap.data().amount, note }
  });
  return { ok: true, status: decision };
});

/* ========================================================================== */
/* Ad budgets                                                                 */
/* ========================================================================== */

exports.saveAdBudget = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const data = request.data || {};
  const clientId = str(data.clientId, { max: 128, required: true, field: 'العميل' });
  const platform = str(data.platform, { max: 20, required: true, field: 'المنصة' });
  assert(AD_PLATFORMS.includes(platform), 'المنصة غير صالحة.');
  const period = str(data.period, { max: 7, required: true, field: 'الشهر' });
  assert(/^\d{4}-\d{2}$/.test(period), 'صيغة الشهر يجب أن تكون YYYY-MM.');
  const received = money(data.received, { field: 'المبلغ المستلم', min: 0 });

  const clientSnap = await db.collection('clients').doc(clientId).get();
  assert(clientSnap.exists, 'العميل غير موجود.');

  // One budget per client, platform and month. A deterministic id makes
  // re-saving a top-up rather than a duplicate that would double the balance.
  const budgetId = `${clientId}_${platform}_${period}`;
  const ref = db.collection('adBudgets').doc(budgetId);
  const existing = await ref.get();

  assert(!existing.exists || received >= (existing.data().spent || 0),
    'المبلغ المستلم أقل مما تم صرفه فعلاً على هذه الميزانية.');

  await ref.set({
    clientId,
    clientName: clientSnap.data().name || '',
    platform,
    period,
    received,
    spent: existing.exists ? (existing.data().spent || 0) : 0,
    currency: 'JOD',
    notes: str(data.notes, { max: 1000, required: false, field: 'الملاحظات' }),
    updatedBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdBy: caller.uid, createdAt: FieldValue.serverTimestamp() })
  }, { merge: true });

  await writeAudit({
    action: existing.exists ? 'adBudget.update' : 'adBudget.create',
    caller,
    targetId: budgetId,
    meta: { clientId, platform, period, received }
  });
  return { id: budgetId };
});

/** Record spend against a budget. Never more than the client provided. */
exports.recordAdSpend = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const budgetId = str(request.data?.budgetId, { max: 200, required: true, field: 'الميزانية' });
  const amount = money(request.data?.amount, { field: 'المبلغ', min: 1 });
  const note = str(request.data?.note, { max: 300, required: false, field: 'الملاحظة' });

  const ref = db.collection('adBudgets').doc(budgetId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'الميزانية غير موجودة.');
    const budget = snap.data();
    const spent = (budget.spent || 0) + amount;
    if (spent > budget.received) {
      throw new HttpsError(
        'failed-precondition',
        `المبلغ يتجاوز الرصيد المتبقي (${((budget.received - (budget.spent || 0)) / 100).toFixed(2)} د.أ).`
      );
    }
    tx.update(ref, { spent, updatedAt: FieldValue.serverTimestamp() });
    tx.set(ref.collection('entries').doc(), {
      amount, note, spentBy: caller.uid, at: FieldValue.serverTimestamp()
    });
    return { spent, remaining: budget.received - spent };
  });

  await writeAudit({
    action: 'adBudget.spend', caller, targetId: budgetId, meta: { amount, note }
  });
  return result;
});
