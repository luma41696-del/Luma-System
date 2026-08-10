/**
 * Finance: contracts, invoices and receipts.
 *
 * Three things here cannot be done safely from the browser, which is why they
 * are callables rather than direct Firestore writes:
 *
 *   1. Invoice and receipt numbers must be unique and gap-free. Two people
 *      billing at once would otherwise read the same counter and issue the
 *      same number, so allocation runs inside a transaction.
 *   2. Recording a payment touches two documents — the receipt and the
 *      invoice's paid total. Written separately, a failure between them leaves
 *      an invoice whose balance disagrees with its receipts.
 *   3. An invoice's paid amount and status are derived from its receipts. If
 *      the client could write them directly they could mark an unpaid invoice
 *      as settled, so those fields are server-owned.
 *
 * Money is stored in minor units (piastres) as integers. Floating point cannot
 * represent 0.1 exactly, and totals built from it drift.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue, REGION } = require('../lib/admin');
const { requireAuth, requirePermission } = require('../lib/permissions');
const { assert, str } = require('../lib/validate');
const { writeAudit } = require('../lib/audit');

const opts = { region: REGION, cors: true };

const PAYMENT_METHODS = ['cash', 'bank', 'cliq', 'cheque', 'other'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly', 'one_time'];

/* ---------------------------------------------------------------- helpers */

/** Whole minor units. Rejects NaN, negatives and fractional piastres. */
function money(value, { field = 'المبلغ', required = true, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpsError('invalid-argument', `${field} مطلوب.`);
    return 0;
  }
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount)) throw new HttpsError('invalid-argument', `${field} غير صالح.`);
  if (amount < min) throw new HttpsError('invalid-argument', `${field} لا يمكن أن يكون أقل من ${min}.`);
  if (amount > 1_000_000_000) throw new HttpsError('invalid-argument', `${field} كبير بشكل غير معقول.`);
  return amount;
}

/**
 * Next number in a series, allocated inside the caller's transaction so two
 * concurrent invoices can never take the same one.
 */
async function nextNumber(tx, series, prefix) {
  const ref = db.collection('counters').doc(series);
  const snap = await tx.get(ref);
  const year = new Date().getFullYear();
  // The sequence restarts each year, which is what the printed number implies.
  const current = snap.exists && snap.data().year === year ? (snap.data().value || 0) : 0;
  const value = current + 1;
  tx.set(ref, { year, value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { value, formatted: `${prefix}-${year}-${String(value).padStart(4, '0')}` };
}

/** Status implied by what has been paid, unless the invoice was cancelled. */
function statusFor({ total, paid, dueDate, cancelled }) {
  if (cancelled) return 'cancelled';
  if (paid <= 0) {
    return dueDate && new Date(dueDate) < new Date(new Date().toDateString())
      ? 'overdue' : 'unpaid';
  }
  if (paid >= total) return 'paid';
  return 'partial';
}

/* ========================================================================== */
/* Invoices                                                                   */
/* ========================================================================== */

exports.createInvoice = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const data = request.data || {};
  const clientId = str(data.clientId, { max: 128, required: true, field: 'العميل' });
  const issueDate = str(data.issueDate, { max: 10, required: true, field: 'تاريخ الإصدار' });
  const dueDate = str(data.dueDate, { max: 10, required: false, field: 'تاريخ الاستحقاق' });
  const contractId = str(data.contractId, { max: 128, required: false, field: 'العقد' });
  const notes = str(data.notes, { max: 2000, required: false, field: 'الملاحظات' });

  const items = Array.isArray(data.items) ? data.items : [];
  assert(items.length > 0, 'أضف بنداً واحداً على الأقل للفاتورة.');
  assert(items.length <= 50, 'عدد البنود كبير جداً.');

  const lines = items.map((item, index) => {
    const description = str(item.description, {
      max: 300, required: true, field: `وصف البند ${index + 1}`
    });
    const quantity = Number(item.quantity);
    assert(Number.isFinite(quantity) && quantity > 0, `كمية البند ${index + 1} غير صالحة.`);
    const unitPrice = money(item.unitPrice, { field: `سعر البند ${index + 1}` });
    return { description, quantity, unitPrice, total: Math.round(quantity * unitPrice) };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const taxRate = Number(data.taxRate) || 0;
  assert(taxRate >= 0 && taxRate <= 100, 'نسبة الضريبة غير صالحة.');
  const tax = Math.round(subtotal * (taxRate / 100));
  const discount = money(data.discount, { field: 'الخصم', required: false });
  assert(discount <= subtotal, 'الخصم أكبر من قيمة الفاتورة.');
  const total = subtotal + tax - discount;
  assert(total > 0, 'إجمالي الفاتورة يجب أن يكون أكبر من صفر.');

  const clientSnap = await db.collection('clients').doc(clientId).get();
  assert(clientSnap.exists, 'العميل غير موجود.');

  const invoiceRef = db.collection('invoices').doc();
  const number = await db.runTransaction(async (tx) => {
    const allocated = await nextNumber(tx, 'invoices', 'INV');
    tx.set(invoiceRef, {
      invoiceNo: allocated.formatted,
      invoiceSeq: allocated.value,
      clientId,
      clientName: clientSnap.data().name || '',
      contractId: contractId || null,
      issueDate,
      dueDate: dueDate || null,
      items: lines,
      subtotal,
      taxRate,
      tax,
      discount,
      total,
      paid: 0,
      balance: total,
      status: statusFor({ total, paid: 0, dueDate, cancelled: false }),
      currency: 'JOD',
      notes,
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return allocated.formatted;
  });

  await writeAudit({
    action: 'invoice.create',
    caller,
    targetId: invoiceRef.id,
    meta: { invoiceNo: number, clientId, total }
  });

  return { id: invoiceRef.id, invoiceNo: number, total };
});

/**
 * Record a receipt against an invoice.
 * The receipt and the invoice's running total are written together, so the
 * balance can never disagree with the receipts behind it.
 */
exports.recordPayment = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const data = request.data || {};
  const invoiceId = str(data.invoiceId, { max: 128, required: true, field: 'الفاتورة' });
  const amount = money(data.amount, { field: 'المبلغ', min: 1 });
  const method = str(data.method, { max: 20, required: true, field: 'طريقة الدفع' });
  assert(PAYMENT_METHODS.includes(method), 'طريقة الدفع غير صالحة.');
  const paidAt = str(data.paidAt, { max: 10, required: true, field: 'تاريخ الدفع' });
  const reference = str(data.reference, { max: 120, required: false, field: 'المرجع' });
  const notes = str(data.notes, { max: 1000, required: false, field: 'الملاحظات' });

  const invoiceRef = db.collection('invoices').doc(invoiceId);
  const receiptRef = db.collection('payments').doc();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists) throw new HttpsError('not-found', 'الفاتورة غير موجودة.');
    const invoice = snap.data();

    if (invoice.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'لا يمكن تحصيل فاتورة ملغاة.');
    }
    const paid = (invoice.paid || 0) + amount;
    if (paid > invoice.total) {
      throw new HttpsError(
        'failed-precondition',
        `المبلغ يتجاوز المتبقي على الفاتورة (${((invoice.total - (invoice.paid || 0)) / 100).toFixed(2)} د.أ).`
      );
    }

    const allocated = await nextNumber(tx, 'payments', 'REC');
    tx.set(receiptRef, {
      receiptNo: allocated.formatted,
      receiptSeq: allocated.value,
      invoiceId,
      invoiceNo: invoice.invoiceNo,
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      amount,
      method,
      reference,
      notes,
      paidAt,
      currency: invoice.currency || 'JOD',
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(invoiceRef, {
      paid,
      balance: invoice.total - paid,
      status: statusFor({
        total: invoice.total, paid, dueDate: invoice.dueDate, cancelled: false
      }),
      updatedAt: FieldValue.serverTimestamp()
    });

    return { receiptNo: allocated.formatted, paid, balance: invoice.total - paid };
  });

  await writeAudit({
    action: 'payment.record',
    caller,
    targetId: receiptRef.id,
    meta: { invoiceId, amount, method, receiptNo: result.receiptNo }
  });

  return { id: receiptRef.id, ...result };
});

/**
 * Reverse a receipt. Receipts are never edited or deleted — a correction is
 * itself a recorded event, so the money trail stays auditable.
 */
exports.voidPayment = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.void');

  const paymentId = str(request.data?.paymentId, { max: 128, required: true, field: 'السند' });
  const reason = str(request.data?.reason, { max: 500, required: true, field: 'سبب الإلغاء' });

  const paymentRef = db.collection('payments').doc(paymentId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists) throw new HttpsError('not-found', 'السند غير موجود.');
    const payment = snap.data();
    if (payment.voided) throw new HttpsError('failed-precondition', 'السند ملغى مسبقاً.');

    const invoiceRef = db.collection('invoices').doc(payment.invoiceId);
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) throw new HttpsError('not-found', 'الفاتورة غير موجودة.');
    const invoice = invoiceSnap.data();

    const paid = Math.max(0, (invoice.paid || 0) - payment.amount);
    tx.update(paymentRef, {
      voided: true,
      voidedBy: caller.uid,
      voidReason: reason,
      voidedAt: FieldValue.serverTimestamp()
    });
    tx.update(invoiceRef, {
      paid,
      balance: invoice.total - paid,
      status: statusFor({
        total: invoice.total, paid, dueDate: invoice.dueDate,
        cancelled: invoice.status === 'cancelled'
      }),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { paid, balance: invoice.total - paid };
  });

  await writeAudit({
    action: 'payment.void', caller, targetId: paymentId, meta: { reason }
  });
  return result;
});

/** Cancel an invoice. Refused once money has been taken against it. */
exports.cancelInvoice = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.void');

  const invoiceId = str(request.data?.invoiceId, { max: 128, required: true, field: 'الفاتورة' });
  const reason = str(request.data?.reason, { max: 500, required: true, field: 'سبب الإلغاء' });
  const invoiceRef = db.collection('invoices').doc(invoiceId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists) throw new HttpsError('not-found', 'الفاتورة غير موجودة.');
    const invoice = snap.data();
    if ((invoice.paid || 0) > 0) {
      throw new HttpsError(
        'failed-precondition',
        'الفاتورة عليها سندات قبض — ألغِ السندات أولاً حتى يبقى سجل التحصيل متطابقاً.'
      );
    }
    tx.update(invoiceRef, {
      status: 'cancelled',
      cancelReason: reason,
      cancelledBy: caller.uid,
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await writeAudit({
    action: 'invoice.cancel', caller, targetId: invoiceId, meta: { reason }
  });
  return { ok: true };
});

/* ========================================================================== */
/* Contracts                                                                  */
/* ========================================================================== */

/**
 * Contracts are plain documents the rules could accept directly, but the
 * number is allocated here for the same reason invoices' are, and the client
 * name is denormalised server-side so a listing never needs a second read.
 */
exports.saveContract = onCall(opts, async (request) => {
  const caller = requireAuth(request);
  requirePermission(caller, 'finance.manage');

  const data = request.data || {};
  const contractId = str(data.contractId, { max: 128, required: false, field: 'العقد' });
  const clientId = str(data.clientId, { max: 128, required: true, field: 'العميل' });
  const title = str(data.title, { max: 200, required: true, field: 'اسم الباقة' });
  const startDate = str(data.startDate, { max: 10, required: true, field: 'تاريخ البداية' });
  const endDate = str(data.endDate, { max: 10, required: true, field: 'تاريخ النهاية' });
  const billingCycle = str(data.billingCycle, { max: 20, required: true, field: 'دورة الدفع' });
  assert(BILLING_CYCLES.includes(billingCycle), 'دورة الدفع غير صالحة.');
  assert(new Date(endDate) > new Date(startDate), 'تاريخ النهاية يجب أن يكون بعد البداية.');

  const value = money(data.value, { field: 'قيمة الباقة', min: 1 });
  const services = (Array.isArray(data.services) ? data.services : [])
    .slice(0, 30)
    .map((s) => str(s, { max: 120, required: true, field: 'الخدمة' }));

  const clientSnap = await db.collection('clients').doc(clientId).get();
  assert(clientSnap.exists, 'العميل غير موجود.');

  const payload = {
    clientId,
    clientName: clientSnap.data().name || '',
    title,
    value,
    currency: 'JOD',
    services,
    startDate,
    endDate,
    billingCycle,
    notes: str(data.notes, { max: 2000, required: false, field: 'الملاحظات' }),
    updatedAt: FieldValue.serverTimestamp()
  };

  if (contractId) {
    const ref = db.collection('contracts').doc(contractId);
    const snap = await ref.get();
    assert(snap.exists, 'العقد غير موجود.');
    await ref.update(payload);
    await writeAudit({
      action: 'contract.update', caller, targetId: contractId, meta: { clientId }
    });
    return { id: contractId, contractNo: snap.data().contractNo };
  }

  const ref = db.collection('contracts').doc();
  const number = await db.runTransaction(async (tx) => {
    const allocated = await nextNumber(tx, 'contracts', 'CON');
    tx.set(ref, {
      ...payload,
      contractNo: allocated.formatted,
      contractSeq: allocated.value,
      status: 'active',
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp()
    });
    return allocated.formatted;
  });

  await writeAudit({
    action: 'contract.create', caller, targetId: ref.id,
    meta: { contractNo: number, clientId, value }
  });
  return { id: ref.id, contractNo: number };
});
