/**
 * Cash and bank accounts, and the ledger behind them.
 *
 * Balances are never edited here — they are the running total of posted
 * movements, advanced server-side. This module shows them and asks the server
 * to post deposits, withdrawals, transfers and reversals.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal } from './utils/modal.js';
import { col, query, orderBy, limit, onSnapshot, callFn } from './utils/api.js';
import { formatMinor, toMinor, toDateInput } from './utils/format.js';
import { sanitizeText } from './utils/sanitize.js';

export const ACCOUNT_TYPES = { cash: 'صندوق نقدي', bank: 'حساب بنكي' };
const TX_LABEL = { deposit: 'إيداع', withdrawal: 'سحب' };
const REF_LABEL = {
  manual: 'يدوي', transfer: 'تحويل', reversal: 'عكس حركة',
  opening: 'رصيد افتتاحي', payroll: 'رواتب', invoice: 'تحصيل فاتورة', expense: 'مصروف'
};

export function paintTreasury(host, unsubs) {
  const canManage = can(session.claims, 'finance.treasury');
  let accounts = [];
  let accountFilter = 'all';
  const selected = new Set();

  host.innerHTML = `
    ${canManage ? `
      <div class="flex gap-2 mt-4" style="flex-wrap:wrap">
        <button class="btn btn--secondary" id="tr-account"><i data-lucide="plus"></i> حساب جديد</button>
        <button class="btn btn--ghost" id="tr-deposit"><i data-lucide="arrow-down-left"></i> إيداع</button>
        <button class="btn btn--ghost" id="tr-withdraw"><i data-lucide="arrow-up-right"></i> سحب</button>
        <button class="btn btn--ghost" id="tr-transfer"><i data-lucide="arrow-left-right"></i> تحويل</button>
      </div>` : ''}

    <div id="tr-accounts" class="mt-4">${'<div class="skeleton skeleton--card"></div>'.repeat(2)}</div>

    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="list"></i> سجل الحركات المالية</div>
        <div class="flex gap-2 items-center">
          <select class="select" id="tr-filter" style="max-width:200px;height:34px">
            <option value="all">كل الحسابات</option>
          </select>
          ${canManage ? '<button class="btn btn--ghost btn--sm" id="tr-reconcile" disabled>تسوية المحدد</button>' : ''}
        </div>
      </div>
      <div id="tr-ledger">${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div>
    </div>`;
  refreshIcons(host);

  $('#tr-account')?.addEventListener('click', () => openAccountModal());
  $('#tr-deposit')?.addEventListener('click', () => openMovementModal('deposit', accounts));
  $('#tr-withdraw')?.addEventListener('click', () => openMovementModal('withdrawal', accounts));
  $('#tr-transfer')?.addEventListener('click', () => openTransferModal(accounts));
  $('#tr-filter').addEventListener('change', (e) => { accountFilter = e.target.value; paintLedger(); });

  $('#tr-reconcile')?.addEventListener('click', async () => {
    if (!selected.size) return;
    try {
      await callFn('reconcileTransactions', { transactionIds: [...selected], reconciled: true });
      toastSuccess(`تمت تسوية ${selected.size} حركة.`);
      selected.clear();
    } catch (err) { reportError(err, 'reconcile'); }
  });

  /* ---------------------------------------------------------- accounts */
  unsubs.push(onSnapshot(
    query(col('accounts'), orderBy('name'), limit(100)),
    (snap) => {
      accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const node = $('#tr-accounts');
      if (!node) return;

      const total = accounts.reduce((s, a) => s + (a.balance || 0), 0);
      node.innerHTML = accounts.length ? `
        <div class="grid grid-auto">
          ${accounts.map((a) => `
            <div class="card">
              <div class="flex justify-between items-start gap-2">
                <div style="min-width:0">
                  <div class="fw-700 truncate">${esc(a.name)}</div>
                  <div class="fs-xs text-muted">
                    ${esc(ACCOUNT_TYPES[a.type] || a.type)}
                    ${a.bankName ? ` · ${esc(a.bankName)}` : ''}
                    ${a.accountNo ? ` · ${esc(String(a.accountNo).slice(-4).padStart(8, '•'))}` : ''}
                  </div>
                </div>
                <span class="stat__icon stat__icon--${a.type === 'bank' ? 'info' : 'success'}"
                      style="width:36px;height:36px">
                  <i data-lucide="${a.type === 'bank' ? 'landmark' : 'wallet'}"></i></span>
              </div>
              <div class="stat__value num mt-3" style="font-size:var(--fs-xl)">
                ${esc(formatMinor(a.balance))}</div>
              ${canManage ? `
                <button class="btn btn--ghost btn--sm btn--block mt-2" data-edit-account="${attr(a.id)}">
                  <i data-lucide="pencil"></i> تعديل</button>` : ''}
            </div>`).join('')}
        </div>
        <div class="stat mt-4">
          <span class="stat__icon stat__icon--brand"><i data-lucide="layers"></i></span>
          <div class="stat__body">
            <div class="stat__value num">${esc(formatMinor(total))}</div>
            <div class="stat__label">إجمالي السيولة المتاحة</div>
          </div>
        </div>`
        : emptyState({
            icon: 'wallet', title: 'لا توجد حسابات',
            text: 'أضف الصندوق النقدي والحسابات البنكية لتتبّع السيولة والحركات.'
          });

      refreshIcons(node);
      on(node, 'click', '[data-edit-account]', (e, n) => {
        const account = accounts.find((a) => a.id === n.dataset.editAccount);
        if (account) openAccountModal(account);
      });

      // keep the ledger filter in step with the accounts that exist
      const sel = $('#tr-filter');
      if (sel) {
        const current = sel.value;
        sel.innerHTML = `<option value="all">كل الحسابات</option>${
          accounts.map((a) => `<option value="${attr(a.id)}">${esc(a.name)}</option>`).join('')}`;
        sel.value = accounts.some((a) => a.id === current) ? current : 'all';
      }
    },
    (err) => mount($('#tr-accounts'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل الحسابات', text: err.message
    }))
  ));

  /* ------------------------------------------------------------ ledger */
  let ledger = [];
  unsubs.push(onSnapshot(
    query(col('transactions'), orderBy('date', 'desc'), limit(300)),
    (snap) => { ledger = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paintLedger(); },
    (err) => mount($('#tr-ledger'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل السجل', text: err.message
    }))
  ));

  function paintLedger() {
    const node = $('#tr-ledger');
    if (!node) return;
    const rows = accountFilter === 'all' ? ledger : ledger.filter((t) => t.accountId === accountFilter);

    if (!rows.length) {
      mount(node, emptyState({ icon: 'list', title: 'لا حركات مسجّلة' }));
      return;
    }

    node.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            ${canManage ? '<th style="width:34px"></th>' : ''}
            <th>التاريخ</th><th>الحساب</th><th>البيان</th><th>المرجع</th>
            <th>مدين</th><th>دائن</th><th>الرصيد بعدها</th><th></th>
          </tr></thead>
          <tbody>${rows.map((t) => `
            <tr class="${t.reversed ? 'is-muted' : ''}">
              ${canManage ? `<td>${t.reconciled || t.reversed ? '' :
                `<input type="checkbox" data-pick="${attr(t.id)}" ${selected.has(t.id) ? 'checked' : ''}>`}</td>` : ''}
              <td class="num">${esc(t.date)}</td>
              <td>${esc(t.accountName || '—')}</td>
              <td>${esc(t.description)}
                ${t.reversed ? '<span class="badge badge--danger">معكوسة</span>' : ''}
                ${t.reconciled ? '<span class="badge badge--success">مسوّاة</span>' : ''}</td>
              <td class="fs-xs text-muted">${esc(REF_LABEL[t.refType] || t.refType || '—')}</td>
              <td class="num" style="color:var(--danger)">
                ${t.type === 'withdrawal' ? esc(formatMinor(t.amount)) : ''}</td>
              <td class="num" style="color:var(--success)">
                ${t.type === 'deposit' ? esc(formatMinor(t.amount)) : ''}</td>
              <td class="num fw-700">${esc(formatMinor(t.balanceAfter))}</td>
              <td>${canManage && !t.reversed && t.refType !== 'opening'
                ? `<button class="btn btn--ghost btn--sm" data-reverse="${attr(t.id)}">عكس</button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    $$('[data-pick]', node).forEach((box) => box.addEventListener('change', () => {
      if (box.checked) selected.add(box.dataset.pick); else selected.delete(box.dataset.pick);
      const button = $('#tr-reconcile');
      if (button) button.disabled = selected.size === 0;
    }));

    on(node, 'click', '[data-reverse]', (e, n) => openReverseModal(n.dataset.reverse));
  }
}

/* ------------------------------------------------------------- modals */

function openAccountModal(account = null) {
  const isEdit = !!account;
  openModal({
    title: isEdit ? 'تعديل الحساب' : 'حساب جديد',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="a-name">اسم الحساب <span class="req">*</span></label>
        <input class="input" id="a-name" maxlength="120" value="${attr(account?.name || '')}"
               placeholder="الصندوق الرئيسي">
      </div>
      <div class="field">
        <label class="field__label" for="a-type">النوع <span class="req">*</span></label>
        <select class="select" id="a-type" ${isEdit ? 'disabled' : ''}>
          ${Object.entries(ACCOUNT_TYPES).map(([k, v]) =>
            `<option value="${k}" ${account?.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="a-bank">اسم البنك</label>
        <input class="input" id="a-bank" maxlength="120" value="${attr(account?.bankName || '')}">
      </div>
      <div class="field">
        <label class="field__label" for="a-no">رقم الحساب</label>
        <input class="input ltr" id="a-no" maxlength="40" value="${attr(account?.accountNo || '')}">
      </div>
      ${isEdit ? `
        <div class="security-note">
          <i data-lucide="lock"></i>
          <div>الرصيد الحالي <strong class="num">${esc(formatMinor(account.balance))}</strong> —
            لا يُعدَّل يدوياً، بل يتغيّر بتسجيل حركة إيداع أو سحب.</div>
        </div>` : `
        <div class="field">
          <label class="field__label" for="a-opening">الرصيد الافتتاحي (د.أ)</label>
          <input class="input ltr" id="a-opening" type="number" min="0" step="0.01" value="0">
          <div class="field__hint">يُسجَّل كحركة إيداع في السجل حتى يكون مصدر الرصيد واضحاً.</div>
        </div>`}`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="a-save">حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#a-save').addEventListener('click', async () => {
        const name = sanitizeText(api.$('#a-name').value, 120);
        if (!name) return toastError('اسم الحساب مطلوب.');
        const button = api.$('#a-save');
        setBusy(button, true);
        try {
          await callFn('saveAccount', {
            accountId: account?.id || '',
            name,
            type: api.$('#a-type').value,
            bankName: sanitizeText(api.$('#a-bank').value, 120),
            accountNo: sanitizeText(api.$('#a-no').value, 40),
            openingBalance: isEdit ? 0 : toMinor(api.$('#a-opening').value)
          });
          toastSuccess(isEdit ? 'تم حفظ الحساب.' : 'تم إنشاء الحساب.');
          api.close();
        } catch (err) { reportError(err, 'save-account'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

function openMovementModal(type, accounts) {
  if (!accounts.length) return toastError('أضف حساباً أولاً.');
  openModal({
    title: type === 'deposit' ? 'تسجيل إيداع' : 'تسجيل سحب',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="m-account">الحساب <span class="req">*</span></label>
        <select class="select" id="m-account">
          ${accounts.map((a) => `<option value="${attr(a.id)}">${esc(a.name)} — ${esc(formatMinor(a.balance))}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="m-amount">المبلغ (د.أ) <span class="req">*</span></label>
        <input class="input ltr" id="m-amount" type="number" min="0.01" step="0.01">
      </div>
      <div class="field">
        <label class="field__label" for="m-date">التاريخ <span class="req">*</span></label>
        <input class="input" id="m-date" type="date" value="${toDateInput(new Date())}">
      </div>
      <div class="field">
        <label class="field__label" for="m-desc">البيان <span class="req">*</span></label>
        <input class="input" id="m-desc" maxlength="300" placeholder="وصف الحركة">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="m-save">تسجيل</button>`,
    onMount: (api) => {
      api.$('#m-save').addEventListener('click', async () => {
        const amount = toMinor(api.$('#m-amount').value);
        const description = sanitizeText(api.$('#m-desc').value, 300);
        if (!(amount > 0)) return toastError('أدخل مبلغاً صحيحاً.');
        if (!description) return toastError('البيان مطلوب.');
        const button = api.$('#m-save');
        setBusy(button, true);
        try {
          await callFn('recordTransaction', {
            accountId: api.$('#m-account').value, type, amount,
            date: api.$('#m-date').value, description
          });
          toastSuccess('تم تسجيل الحركة.');
          api.close();
        } catch (err) { reportError(err, 'record-transaction'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

function openTransferModal(accounts) {
  if (accounts.length < 2) return toastError('التحويل يحتاج حسابين على الأقل.');
  const options = (exclude) => accounts
    .filter((a) => a.id !== exclude)
    .map((a) => `<option value="${attr(a.id)}">${esc(a.name)} — ${esc(formatMinor(a.balance))}</option>`).join('');

  openModal({
    title: 'تحويل بين الحسابات',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="t-from">من حساب <span class="req">*</span></label>
        <select class="select" id="t-from">${options(null)}</select>
      </div>
      <div class="field">
        <label class="field__label" for="t-to">إلى حساب <span class="req">*</span></label>
        <select class="select" id="t-to">${options(accounts[0].id)}</select>
      </div>
      <div class="field">
        <label class="field__label" for="t-amount">المبلغ (د.أ) <span class="req">*</span></label>
        <input class="input ltr" id="t-amount" type="number" min="0.01" step="0.01">
      </div>
      <div class="field">
        <label class="field__label" for="t-date">التاريخ <span class="req">*</span></label>
        <input class="input" id="t-date" type="date" value="${toDateInput(new Date())}">
      </div>
      <div class="field">
        <label class="field__label" for="t-note">ملاحظة</label>
        <input class="input" id="t-note" maxlength="300">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="t-save">تحويل</button>`,
    onMount: (api) => {
      // Keep the destination list free of whichever account is the source.
      api.$('#t-from').addEventListener('change', (e) => {
        api.$('#t-to').innerHTML = options(e.target.value);
      });
      api.$('#t-save').addEventListener('click', async () => {
        const amount = toMinor(api.$('#t-amount').value);
        if (!(amount > 0)) return toastError('أدخل مبلغاً صحيحاً.');
        const button = api.$('#t-save');
        setBusy(button, true);
        try {
          await callFn('transferFunds', {
            fromAccountId: api.$('#t-from').value,
            toAccountId: api.$('#t-to').value,
            amount, date: api.$('#t-date').value,
            note: sanitizeText(api.$('#t-note').value, 300)
          });
          toastSuccess('تم التحويل.');
          api.close();
        } catch (err) { reportError(err, 'transfer'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

function openReverseModal(transactionId) {
  openModal({
    title: 'عكس الحركة',
    size: 'sm',
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="info"></i>
        <div>لا تُحذف الحركة الأصلية. يُسجَّل قيد معاكس يعيد الرصيد، ويبقى الاثنان في السجل.</div>
      </div>
      <div class="field">
        <label class="field__label" for="rv-reason">السبب <span class="req">*</span></label>
        <textarea class="textarea" id="rv-reason" rows="3" maxlength="500"></textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--danger" id="rv-go">عكس الحركة</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#rv-go').addEventListener('click', async () => {
        const reason = sanitizeText(api.$('#rv-reason').value, 500);
        if (!reason) return toastError('السبب مطلوب.');
        const button = api.$('#rv-go');
        setBusy(button, true);
        try {
          await callFn('reverseTransaction', { transactionId, reason });
          toastSuccess('تم عكس الحركة.');
          api.close();
        } catch (err) { reportError(err, 'reverse'); }
        finally { setBusy(button, false); }
      });
    }
  });
}
