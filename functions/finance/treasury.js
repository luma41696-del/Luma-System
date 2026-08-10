/**
 * Cash and bank accounts, and the ledger of movements between them.
 *
 * An account's balance is never written directly. Every change is a posted
 * transaction, and the balance is advanced inside the same Firestore
 * transaction that writes it — so the balance always equals the sum of the
 * movements behind it, and a failure part-way cannot leave the two disagreeing.
 *
 * Transactions are immutable once posted. A mistake is corrected by posting a
 * reversal, which stays in the ledger with its reason, because a cash trail
 * that can be quietly edited is not a cash trail.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');
const { money, nextNumber } = require('./helpers');

const opts = { region: REGION, cors: true };

const ACCOUNT_TYPES = ['cash', 'bank'];
const TX_TYPES = ['deposit', 'withdrawal'];

/**
 * Reading and writing are split because Firestore requires every read in a
 * transaction to happen before every write. A transfer touches two accounts, so
 * it must read both up front — calling a combined read-then-write helper twice
 * would put the second read after the first write and the transaction would be
 * rejected outright.
 */
async function readAccount(tx, accountId) {
  const ref = db.collection('accounts').doc(accountId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError('not-found', 'الحساب غير موجود.');
  const data = snap.data();
  if (data.archived) throw new HttpsError('failed-precondition', 'هذا الحساب مؤرشف.');
  return { ref, data };
}

/**
 * Write the movement and advance the balance together.
 * `account` comes from readAccount; its cached balance is updated in place so
 * two movements against the same account in one transaction still add up.
 */
function writeMovement(tx, account, {
  type, amount, date, description,
  refType = null, refId = null, refNo = null, actorId
}) {
  const delta = type === 'deposit' ? amount : -amount;
  const balance = (account.data.balance || 0) + delta;

  // An account may not be driven negative: in a real cash box or bank account
  // that money simply is not there, and allowing it would hide an error in
  // whatever posted the movement.
  if (balance < 0) {
    throw new HttpsError(
      'failed-precondition',
      `الرصيد لا يكفي في «${account.data.name}» — المتاح ${((account.data.balance || 0) / 100).toFixed(2)} د.أ.`
    );
  }

  const txRef = db.collection('transactions').doc();
  tx.set(txRef, {
    accountId: account.ref.id,
    accountName: account.data.name,
    type,
    amount,
    balanceAfter: balance,
    date,
    description,
    refType, refId, refNo,
    reconciled: false,
    currency: account.data.currency || 'JOD',
    createdBy: actorId,
    createdAt: FieldValue.serverTimestamp()
  });
  tx.update(account.ref, { balance, updatedAt: FieldValue.serverTimestamp() });

  account.data.balance = balance;
  return { transactionId: txRef.id, balance };
}

/**
 * Post a single movement. Exported so billing, expenses and payroll all go
 * through the same path instead of each inventing its own balance rule.
 *
 * Safe for callers that read other documents first, because its own read still
 * precedes its own write.
 *
 * @param {FirebaseFirestore.Transaction} tx  caller's transaction
 */
async function postTransaction(tx, options) {
  const account = await readAccount(tx, options.accountId);
  return writeMovement(tx, account, options);
}

/* ========================================================================== */
/* Accounts                                                                   */
/* ========================================================================== */

exports.saveAccount = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.treasury');

  const data = request.data || {};
  const accountId = str(data.accountId, { max: 128, required: false, field: 'الحساب' });
  const name = str(data.name, { max: 120, required: true, field: 'اسم الحساب' });
  const type = str(data.type, { max: 20, required: true, field: 'النوع' });
  assert(ACCOUNT_TYPES.includes(type), 'نوع الحساب غير صالح.');

  const payload = {
    name,
    type,
    bankName: str(data.bankName, { max: 120, required: false, field: 'اسم البنك' }),
    // Account numbers are reference data, not credentials, but only the tail is
    // ever needed to identify an account on screen.
    accountNo: str(data.accountNo, { max: 40, required: false, field: 'رقم الحساب' }),
    notes: str(data.notes, { max: 1000, required: false, field: 'الملاحظات' }),
    currency: 'JOD',
    updatedAt: FieldValue.serverTimestamp()
  };

  if (accountId) {
    const ref = db.collection('accounts').doc(accountId);
    assert((await ref.get()).exists, 'الحساب غير موجود.');
    // `balance` is deliberately absent: it moves only through postTransaction.
    await ref.update(payload);
    await writeAudit({ action: 'account.update', caller, targetId: accountId, meta: { name } });
    return { id: accountId };
  }

  const opening = money(data.openingBalance, { field: 'الرصيد الافتتاحي', required: false, min: 0 });
  const ref = db.collection('accounts').doc();
  await ref.set({
    ...payload,
    openingBalance: opening,
    balance: opening,
    archived: false,
    createdBy: caller.uid,
    createdAt: FieldValue.serverTimestamp()
  });

  // The opening balance is itself a movement, so the ledger explains the
  // account's starting position instead of it appearing from nowhere.
  if (opening > 0) {
    await db.runTransaction(async (tx) => {
      const accountRef = db.collection('accounts').doc(ref.id);
      const txRef = db.collection('transactions').doc();
      tx.set(txRef, {
        accountId: ref.id, accountName: name, type: 'deposit', amount: opening,
        balanceAfter: opening, date: new Date().toISOString().slice(0, 10),
        description: 'رصيد افتتاحي', refType: 'opening', refId: null, refNo: null,
        reconciled: true, currency: 'JOD',
        createdBy: caller.uid, createdAt: FieldValue.serverTimestamp()
      });
      tx.update(accountRef, { updatedAt: FieldValue.serverTimestamp() });
    });
  }

  await writeAudit({ action: 'account.create', caller, targetId: ref.id, meta: { name, type, opening } });
  return { id: ref.id };
});

/* ========================================================================== */
/* Movements                                                                  */
/* ========================================================================== */

exports.recordTransaction = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.treasury');

  const data = request.data || {};
  const accountId = str(data.accountId, { max: 128, required: true, field: 'الحساب' });
  const type = str(data.type, { max: 20, required: true, field: 'النوع' });
  assert(TX_TYPES.includes(type), 'نوع الحركة غير صالح.');
  const amount = money(data.amount, { field: 'المبلغ', min: 1 });
  const date = str(data.date, { max: 10, required: true, field: 'التاريخ' });
  const description = str(data.description, { max: 300, required: true, field: 'البيان' });

  const result = await db.runTransaction((tx) => postTransaction(tx, {
    accountId, type, amount, date, description,
    refType: 'manual', actorId: caller.uid
  }));

  await writeAudit({
    action: `treasury.${type}`, caller, targetId: result.transactionId,
    meta: { accountId, amount, description }
  });
  return result;
});

/**
 * Move money between two accounts.
 *
 * Both legs are posted in one transaction: a transfer that debited one account
 * without crediting the other would invent or destroy money.
 */
exports.transferFunds = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.treasury');

  const data = request.data || {};
  const fromId = str(data.fromAccountId, { max: 128, required: true, field: 'الحساب المحوّل منه' });
  const toId = str(data.toAccountId, { max: 128, required: true, field: 'الحساب المحوّل إليه' });
  assert(fromId !== toId, 'لا يمكن التحويل إلى نفس الحساب.');
  const amount = money(data.amount, { field: 'المبلغ', min: 1 });
  const date = str(data.date, { max: 10, required: true, field: 'التاريخ' });
  const note = str(data.note, { max: 300, required: false, field: 'الملاحظة' });

  const result = await db.runTransaction(async (tx) => {
    // Both accounts are read first — Firestore rejects any read that follows a
    // write in the same transaction.
    const fromAccount = await readAccount(tx, fromId);
    const toAccount = await readAccount(tx, toId);

    const description = note || 'تحويل بين الحسابات';
    const out = writeMovement(tx, fromAccount, {
      type: 'withdrawal', amount, date, description,
      refType: 'transfer', actorId: caller.uid
    });
    const incoming = writeMovement(tx, toAccount, {
      type: 'deposit', amount, date, description,
      refType: 'transfer', refId: out.transactionId, actorId: caller.uid
    });
    return { from: out, to: incoming };
  });

  await writeAudit({
    action: 'treasury.transfer', caller, targetId: result.from.transactionId,
    meta: { fromId, toId, amount }
  });
  return result;
});

/**
 * Reverse a posted movement. The original stays; the reversal is its own entry.
 */
exports.reverseTransaction = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.treasury');

  const transactionId = str(request.data?.transactionId, { max: 128, required: true, field: 'الحركة' });
  const reason = str(request.data?.reason, { max: 500, required: true, field: 'السبب' });

  const result = await db.runTransaction(async (tx) => {
    const original = await tx.get(db.collection('transactions').doc(transactionId));
    if (!original.exists) throw new HttpsError('not-found', 'الحركة غير موجودة.');
    const entry = original.data();
    if (entry.reversed) throw new HttpsError('failed-precondition', 'الحركة معكوسة مسبقاً.');

    const posted = await postTransaction(tx, {
      accountId: entry.accountId,
      type: entry.type === 'deposit' ? 'withdrawal' : 'deposit',
      amount: entry.amount,
      date: new Date().toISOString().slice(0, 10),
      description: `عكس حركة — ${reason}`,
      refType: 'reversal', refId: transactionId, refNo: entry.refNo,
      actorId: caller.uid
    });
    tx.update(original.ref, {
      reversed: true, reversedBy: caller.uid, reversedAt: FieldValue.serverTimestamp(), reverseReason: reason
    });
    return posted;
  });

  await writeAudit({
    action: 'treasury.reverse', caller, targetId: transactionId, meta: { reason }
  });
  return result;
});

/** Tick a movement off against a statement. Reconciliation only — no amounts. */
exports.reconcileTransactions = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.treasury');

  const ids = Array.isArray(request.data?.transactionIds) ? request.data.transactionIds : [];
  assert(ids.length > 0 && ids.length <= 200, 'حدد حركة واحدة على الأقل (وحتى 200).');
  const reconciled = request.data?.reconciled !== false;

  const batch = db.batch();
  ids.forEach((id) => batch.update(db.collection('transactions').doc(String(id)), {
    reconciled,
    reconciledBy: reconciled ? caller.uid : null,
    reconciledAt: reconciled ? FieldValue.serverTimestamp() : null
  }));
  await batch.commit();

  await writeAudit({
    action: 'treasury.reconcile', caller, meta: { count: ids.length, reconciled }
  });
  return { count: ids.length };
});

module.exports.postTransaction = postTransaction;
