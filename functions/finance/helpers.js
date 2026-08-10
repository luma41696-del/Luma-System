/**
 * Shared finance primitives, used by both the billing callables and the
 * expense / ad-budget ones.
 *
 * Money is stored as integer minor units (piastres) throughout. Binary floats
 * cannot represent 0.1 exactly, so totals accumulated from them drift and an
 * invoice ends up a piastre short of settled.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { db, FieldValue } = require('../lib/admin');

/** Whole minor units. Rejects NaN, negatives and absurd values. */
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
 * concurrent documents can never take the same one. The sequence restarts each
 * year, which is what the printed number implies.
 */
async function nextNumber(tx, series, prefix) {
  const ref = db.collection('counters').doc(series);
  const snap = await tx.get(ref);
  const year = new Date().getFullYear();
  const current = snap.exists && snap.data().year === year ? (snap.data().value || 0) : 0;
  const value = current + 1;
  tx.set(ref, { year, value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { value, formatted: `${prefix}-${year}-${String(value).padStart(4, '0')}` };
}

/** Invoice status implied by what has been paid, unless it was cancelled. */
function statusFor({ total, paid, dueDate, cancelled }) {
  if (cancelled) return 'cancelled';
  if (paid <= 0) {
    return dueDate && new Date(dueDate) < new Date(new Date().toDateString())
      ? 'overdue' : 'unpaid';
  }
  if (paid >= total) return 'paid';
  return 'partial';
}

const PAYMENT_METHODS = ['cash', 'bank', 'cliq', 'cheque', 'other'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly', 'one_time'];
const EXPENSE_CATEGORIES = [
  'rent', 'subscriptions', 'tools', 'transport', 'office',
  'salaries', 'marketing', 'freelancers', 'other'
];
const AD_PLATFORMS = ['meta', 'google', 'tiktok', 'snapchat', 'linkedin', 'other'];

module.exports = {
  money,
  nextNumber,
  statusFor,
  PAYMENT_METHODS,
  BILLING_CYCLES,
  EXPENSE_CATEGORIES,
  AD_PLATFORMS
};
