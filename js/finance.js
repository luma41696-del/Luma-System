/**
 * Finance — phase one: contracts, invoices and receipts.
 *
 * Everything that carries a figure is written by Cloud Functions
 * (functions/finance): numbers are allocated without collisions, and an
 * invoice's paid total is kept in step with its receipts inside a transaction.
 * This module reads, and asks the server to write.
 *
 * Amounts arrive as integer minor units (piastres) and are only converted at
 * the edges — `formatMinor` to show, `toMinor` to send.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, getOne, getMany, callFn
} from './utils/api.js';
import {
  formatDate, formatDateTime, formatMinor, toMinor, timeAgo, toDateInput, daysBetween
} from './utils/format.js';
import { sanitizeText } from './utils/sanitize.js';
import { createPagedFeed, mountLoadMore } from './utils/paging.js';

const VIEW_KEY = 'luma.financeTab';

export const INVOICE_STATUS = {
  unpaid:    { ar: 'غير مدفوعة', badge: 'warning' },
  partial:   { ar: 'مدفوعة جزئياً', badge: 'info' },
  paid:      { ar: 'مدفوعة',     badge: 'success' },
  overdue:   { ar: 'متأخرة',     badge: 'danger' },
  cancelled: { ar: 'ملغاة',      badge: '' }
};

export const PAYMENT_METHODS = {
  cash:   'نقداً',
  bank:   'حوالة بنكية',
  cliq:   'CliQ',
  cheque: 'شيك',
  other:  'أخرى'
};

export const BILLING_CYCLES = {
  monthly:   'شهري',
  quarterly: 'ربع سنوي',
  yearly:    'سنوي',
  one_time:  'دفعة واحدة'
};

/** Days before expiry at which a contract starts warning. */
const RENEWAL_WINDOW = 30;

export async function render(container, ctx) {
  if (ctx.params.id) return renderInvoice(container, ctx.params.id);
  return renderBoard(container, ctx);
}

/* ========================================================================== */
/* Board                                                                      */
/* ========================================================================== */

async function renderBoard(container, ctx) {
  const unsubs = [];
  const canManage = can(session.claims, 'finance.manage');
  let tab = ctx.query.tab || localStorage.getItem(VIEW_KEY) || 'invoices';
  let statusFilter = 'all';

  const clients = await getMany(query(col('clients'), orderBy('name'), limit(300))).catch(() => []);

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">المالية</div>
          <div class="page-head__sub" id="fin-sub">العقود والفواتير وسندات القبض</div>
        </div>
        <div class="page-head__actions">
          ${canManage ? `
            <button class="btn btn--secondary" id="new-contract"><i data-lucide="file-signature"></i> عقد جديد</button>
            <button class="btn btn--primary" id="new-invoice"><i data-lucide="receipt"></i> فاتورة جديدة</button>` : ''}
        </div>
      </div>

      <div class="grid grid-4" id="fin-stats"></div>

      <div class="tabs mt-4" id="fin-tabs">
        <button class="tab" data-tab="invoices"><i data-lucide="receipt"></i> الفواتير</button>
        <button class="tab" data-tab="contracts"><i data-lucide="file-signature"></i> العقود</button>
        <button class="tab" data-tab="receipts"><i data-lucide="hand-coins"></i> سندات القبض</button>
      </div>

      <div id="fin-body"></div>
    </div>`;

  refreshIcons(container);

  $('#new-invoice')?.addEventListener('click', () => openInvoiceModal(clients));
  $('#new-contract')?.addEventListener('click', () => openContractModal(clients));

  $('#fin-tabs').addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button) return;
    tab = button.dataset.tab;
    localStorage.setItem(VIEW_KEY, tab);
    history.replaceState(null, '', `#/finance?tab=${tab}`);
    paintTab();
  });

  /* ------------------------------------------------------------- data */
  // The stats band always reflects every invoice, not just the loaded page,
  // so the headline figures cannot silently exclude older billing.
  let invoices = [];
  unsubs.push(onSnapshot(
    query(col('invoices'), orderBy('issueDate', 'desc'), limit(1000)),
    (snap) => { invoices = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paintStats(); },
    (err) => console.warn('[luma] invoices', err.code)
  ));

  function paintStats() {
    const host = $('#fin-stats');
    if (!host) return;
    const live = invoices.filter((i) => i.status !== 'cancelled');
    const billed = live.reduce((sum, i) => sum + (i.total || 0), 0);
    const collected = live.reduce((sum, i) => sum + (i.paid || 0), 0);
    const overdue = live.filter((i) => i.status === 'overdue');

    host.innerHTML = `
      ${stat('receipt', 'brand', formatMinor(billed), 'إجمالي الفواتير')}
      ${stat('hand-coins', 'success', formatMinor(collected), 'المحصّل')}
      ${stat('wallet', 'warning', formatMinor(billed - collected), 'المتبقي')}
      ${stat('alert-triangle', 'danger', `${overdue.length}`, 'فواتير متأخرة')}`;
    refreshIcons(host);
  }

  function paintTab() {
    $$('#fin-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
    const host = $('#fin-body');
    unsubs.forEach((fn) => { try { fn(); } catch {} });
    unsubs.length = 0;

    // The stats listener is shared across tabs, so it is re-opened here.
    unsubs.push(onSnapshot(
      query(col('invoices'), orderBy('issueDate', 'desc'), limit(1000)),
      (snap) => { invoices = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paintStats(); },
      () => {}
    ));

    if (tab === 'invoices') paintInvoices(host, unsubs, () => statusFilter, (v) => { statusFilter = v; });
    else if (tab === 'contracts') paintContracts(host, unsubs, clients, canManage);
    else paintReceipts(host, unsubs);
  }

  paintTab();
  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ------------------------------------------------------------- invoices */

function paintInvoices(host, unsubs, getFilter, setFilter) {
  host.innerHTML = `
    <div class="filter-bar mt-4">
      <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
      <select class="select" id="i-status" style="max-width:200px">
        <option value="all">كل الحالات</option>
        ${Object.entries(INVOICE_STATUS).map(([k, v]) =>
          `<option value="${k}">${esc(v.ar)}</option>`).join('')}
      </select>
    </div>
    <div id="inv-list" class="mt-4">${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div>`;
  refreshIcons(host);

  $('#i-status').value = getFilter();
  $('#i-status').addEventListener('change', (e) => { setFilter(e.target.value); paint(); });

  let rows = [];
  let detach = null;

  const feed = createPagedFeed({
    pageSize: 25,
    buildQuery: (max) => query(col('invoices'), orderBy('issueDate', 'desc'), limit(max)),
    subscribe: (q, onRows, onErr) => onSnapshot(q,
      (snap) => onRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr),
    onData: (data) => { rows = data; paint(); },
    onError: (err) => mount($('#inv-list'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل الفواتير', text: err.message
    }))
  });
  unsubs.push(feed.stop);

  function paint() {
    const list = $('#inv-list');
    if (!list) return;
    detach?.();
    const filter = getFilter();
    const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

    if (!shown.length) {
      mount(list, emptyState({
        icon: 'receipt', title: 'لا توجد فواتير',
        text: feed.state.hasMore ? 'لا نتائج ضمن المحمّل — حمّل المزيد.' : 'ابدأ بإصدار فاتورة للعميل.'
      }));
      detach = mountLoadMore(list, feed);
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>رقم الفاتورة</th><th>العميل</th><th>الإصدار</th><th>الاستحقاق</th>
            <th>الإجمالي</th><th>المحصّل</th><th>المتبقي</th><th>الحالة</th>
          </tr></thead>
          <tbody>${shown.map((inv) => `
            <tr data-invoice="${attr(inv.id)}" style="cursor:pointer">
              <td class="is-strong ltr">${esc(inv.invoiceNo || '—')}</td>
              <td>${esc(inv.clientName || '—')}</td>
              <td class="num">${esc(inv.issueDate || '—')}</td>
              <td class="num" style="${inv.status === 'overdue' ? 'color:var(--danger)' : ''}">
                ${esc(inv.dueDate || '—')}</td>
              <td class="num">${esc(formatMinor(inv.total))}</td>
              <td class="num">${esc(formatMinor(inv.paid || 0))}</td>
              <td class="num fw-700">${esc(formatMinor(inv.balance ?? inv.total))}</td>
              <td><span class="badge badge--${attr(INVOICE_STATUS[inv.status]?.badge || '')}">
                ${esc(INVOICE_STATUS[inv.status]?.ar || inv.status)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    on(list, 'click', '[data-invoice]', (e, node) => {
      location.hash = `#/finance/${node.dataset.invoice}`;
    });
    detach = mountLoadMore(list, feed);
  }
}

/* ------------------------------------------------------------ contracts */

function paintContracts(host, unsubs, clients, canManage) {
  host.innerHTML = `<div id="con-list" class="mt-4">
    ${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>`;

  unsubs.push(onSnapshot(
    query(col('contracts'), orderBy('startDate', 'desc'), limit(200)),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = $('#con-list');
      if (!list) return;

      if (!rows.length) {
        mount(list, emptyState({
          icon: 'file-signature', title: 'لا توجد عقود',
          text: 'أضف عقد العميل لتتمكن من ربط الفواتير به.'
        }));
        return;
      }

      list.innerHTML = `<div class="grid grid-auto">${rows.map((c) => {
        const daysLeft = c.endDate ? daysBetween(new Date(), new Date(c.endDate)) : null;
        const expired = daysLeft !== null && new Date(c.endDate) < new Date();
        const expiring = !expired && daysLeft !== null && daysLeft <= RENEWAL_WINDOW;
        return `
          <div class="card">
            <div class="flex justify-between items-start gap-2">
              <div style="min-width:0">
                <div class="fw-700 truncate">${esc(c.title)}</div>
                <a class="fs-sm text-brand" href="#/clients/${attr(c.clientId)}">${esc(c.clientName || '')}</a>
              </div>
              <span class="badge badge--${expired ? 'danger' : expiring ? 'warning' : 'success'}">
                ${expired ? 'منتهٍ' : expiring ? `${daysLeft} يوم` : 'ساري'}
              </span>
            </div>
            <div class="list-divider"></div>
            <div class="kv"><span class="kv__k">قيمة الباقة</span>
              <span class="kv__v num fw-700">${esc(formatMinor(c.value))}</span></div>
            <div class="kv"><span class="kv__k">دورة الدفع</span>
              <span class="kv__v">${esc(BILLING_CYCLES[c.billingCycle] || c.billingCycle)}</span></div>
            <div class="kv"><span class="kv__k">المدة</span>
              <span class="kv__v num">${esc(c.startDate)} ← ${esc(c.endDate)}</span></div>
            <div class="kv"><span class="kv__k">رقم العقد</span>
              <span class="kv__v ltr">${esc(c.contractNo || '—')}</span></div>
            ${c.services?.length ? `<div class="tag-list mt-3">
              ${c.services.slice(0, 6).map((s) => `<span class="badge">${esc(s)}</span>`).join('')}
            </div>` : ''}
            ${canManage ? `
              <div class="flex gap-2 mt-3">
                <button class="btn btn--secondary btn--sm flex-1" data-edit-contract="${attr(c.id)}">
                  <i data-lucide="pencil"></i> تعديل</button>
                <button class="btn btn--primary btn--sm flex-1" data-bill-contract="${attr(c.id)}">
                  <i data-lucide="receipt"></i> إصدار فاتورة</button>
              </div>` : ''}
          </div>`;
      }).join('')}</div>`;

      refreshIcons(list);

      on(list, 'click', '[data-edit-contract]', (e, node) => {
        const contract = rows.find((r) => r.id === node.dataset.editContract);
        if (contract) openContractModal(clients, contract);
      });
      on(list, 'click', '[data-bill-contract]', (e, node) => {
        const contract = rows.find((r) => r.id === node.dataset.billContract);
        if (contract) openInvoiceModal(clients, contract);
      });
    },
    (err) => mount($('#con-list'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل العقود', text: err.message
    }))
  ));
}

/* ------------------------------------------------------------- receipts */

function paintReceipts(host, unsubs) {
  host.innerHTML = `<div id="rec-list" class="mt-4">
    ${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>`;

  unsubs.push(onSnapshot(
    query(col('payments'), orderBy('paidAt', 'desc'), limit(200)),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = $('#rec-list');
      if (!list) return;

      if (!rows.length) {
        mount(list, emptyState({
          icon: 'hand-coins', title: 'لا توجد سندات قبض',
          text: 'تُنشأ السندات عند تسجيل دفعة على فاتورة.'
        }));
        return;
      }

      list.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>رقم السند</th><th>الفاتورة</th><th>العميل</th>
              <th>التاريخ</th><th>الطريقة</th><th>المبلغ</th>
            </tr></thead>
            <tbody>${rows.map((p) => `
              <tr class="${p.voided ? 'is-muted' : ''}"
                  onclick="location.hash='#/finance/${attr(p.invoiceId)}'" style="cursor:pointer">
                <td class="is-strong ltr">${esc(p.receiptNo || '—')}
                  ${p.voided ? '<span class="badge badge--danger">ملغى</span>' : ''}</td>
                <td class="ltr">${esc(p.invoiceNo || '—')}</td>
                <td>${esc(p.clientName || '—')}</td>
                <td class="num">${esc(p.paidAt || '—')}</td>
                <td>${esc(PAYMENT_METHODS[p.method] || p.method)}</td>
                <td class="num fw-700" style="${p.voided ? 'text-decoration:line-through' : ''}">
                  ${esc(formatMinor(p.amount))}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    },
    (err) => mount($('#rec-list'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل السندات', text: err.message
    }))
  ));
}

/* ========================================================================== */
/* Invoice detail                                                             */
/* ========================================================================== */

async function renderInvoice(container, invoiceId) {
  const unsubs = [];
  const canManage = can(session.claims, 'finance.manage');
  const canVoid = can(session.claims, 'finance.void');

  container.innerHTML = `<div class="page__inner" id="inv-root">
    <div class="skeleton" style="height:320px;border-radius:var(--radius-lg)"></div></div>`;
  const root = $('#inv-root', container);

  unsubs.push(onSnapshot(ref('invoices', invoiceId), (snap) => {
    if (!snap.exists()) {
      mount(root, emptyState({ icon: 'file-x', title: 'الفاتورة غير موجودة' }));
      return;
    }
    paint({ id: snap.id, ...snap.data() });
  }, (err) => mount(root, emptyState({
    icon: 'shield-alert', title: 'لا تملك صلاحية عرض هذه الفاتورة', text: err.message
  }))));

  function paint(inv) {
    const meta = INVOICE_STATUS[inv.status] || {};
    const balance = inv.balance ?? (inv.total - (inv.paid || 0));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="flex items-center gap-3" style="flex-wrap:wrap">
            <div class="page-head__title ltr">${esc(inv.invoiceNo || '')}</div>
            <span class="badge badge--${attr(meta.badge || '')}">${esc(meta.ar || inv.status)}</span>
          </div>
          <div class="page-head__sub">
            <a href="#/clients/${attr(inv.clientId)}">${esc(inv.clientName || '')}</a>
            · صدرت ${esc(inv.issueDate || '')}
            ${inv.dueDate ? ` · تستحق ${esc(inv.dueDate)}` : ''}
          </div>
        </div>
        <div class="page-head__actions">
          <a class="btn btn--ghost" href="#/finance"><i data-lucide="arrow-right"></i> رجوع</a>
          <button class="btn btn--secondary" id="print-invoice"><i data-lucide="printer"></i> طباعة</button>
          ${canManage && balance > 0 && inv.status !== 'cancelled'
            ? '<button class="btn btn--primary" id="add-payment"><i data-lucide="hand-coins"></i> تسجيل دفعة</button>' : ''}
          ${canVoid && (inv.paid || 0) === 0 && inv.status !== 'cancelled'
            ? '<button class="btn btn--outline-danger" id="cancel-invoice"><i data-lucide="x-circle"></i> إلغاء</button>' : ''}
        </div>
      </div>

      <div class="grid grid-3">
        ${stat('receipt', 'brand', formatMinor(inv.total), 'إجمالي الفاتورة')}
        ${stat('hand-coins', 'success', formatMinor(inv.paid || 0), 'المحصّل')}
        ${stat('wallet', balance > 0 ? 'warning' : 'success', formatMinor(balance), 'المتبقي')}
      </div>

      <div class="grid grid-main mt-4">
        <div class="flex-col gap-4">
          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="list"></i> بنود الفاتورة</div></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>${(inv.items || []).map((it) => `
                  <tr>
                    <td>${esc(it.description)}</td>
                    <td class="num">${esc(String(it.quantity))}</td>
                    <td class="num">${esc(formatMinor(it.unitPrice))}</td>
                    <td class="num fw-700">${esc(formatMinor(it.total))}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="list-divider"></div>
            <div class="kv"><span class="kv__k">المجموع الفرعي</span>
              <span class="kv__v num">${esc(formatMinor(inv.subtotal))}</span></div>
            ${inv.discount ? `<div class="kv"><span class="kv__k">الخصم</span>
              <span class="kv__v num">− ${esc(formatMinor(inv.discount))}</span></div>` : ''}
            ${inv.tax ? `<div class="kv"><span class="kv__k">الضريبة (${esc(String(inv.taxRate))}%)</span>
              <span class="kv__v num">${esc(formatMinor(inv.tax))}</span></div>` : ''}
            <div class="kv"><span class="kv__k fw-700">الإجمالي</span>
              <span class="kv__v num fw-700">${esc(formatMinor(inv.total))}</span></div>
            ${inv.notes ? `<div class="list-divider"></div>
              <div class="fs-sm text-muted" style="white-space:pre-wrap">${esc(inv.notes)}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="hand-coins"></i> سندات القبض</div></div>
          <div id="inv-receipts">${'<div class="skeleton skeleton--text"></div>'.repeat(2)}</div>
        </div>
      </div>`;

    refreshIcons(root);

    $('#print-invoice')?.addEventListener('click', () => window.print());
    $('#add-payment')?.addEventListener('click', () => openPaymentModal(inv));
    $('#cancel-invoice')?.addEventListener('click', () => cancelInvoice(inv));
  }

  // Receipts live in their own listener so recording a payment refreshes the
  // list without re-rendering the whole invoice.
  unsubs.push(onSnapshot(
    query(col('payments'), where('invoiceId', '==', invoiceId), orderBy('paidAt', 'desc'), limit(100)),
    (snap) => {
      const node = $('#inv-receipts');
      if (!node) return;
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      node.innerHTML = rows.length ? rows.map((p) => `
        <div class="list-row">
          <div class="list-row__body">
            <div class="list-row__title ltr">${esc(p.receiptNo)}
              ${p.voided ? '<span class="badge badge--danger">ملغى</span>' : ''}</div>
            <div class="list-row__sub">
              ${esc(PAYMENT_METHODS[p.method] || p.method)} · ${esc(p.paidAt)}
              ${p.reference ? ` · ${esc(p.reference)}` : ''}
            </div>
          </div>
          <div style="text-align:end">
            <div class="num fw-700" style="${p.voided ? 'text-decoration:line-through' : ''}">
              ${esc(formatMinor(p.amount))}</div>
            ${canVoid && !p.voided
              ? `<button class="btn btn--ghost btn--sm mt-2" data-void="${attr(p.id)}">إلغاء السند</button>` : ''}
          </div>
        </div>`).join('')
        : '<div class="text-muted fs-sm">لم تُسجَّل أي دفعة بعد.</div>';

      $$('[data-void]', node).forEach((b) => b.addEventListener('click', () => voidPayment(b.dataset.void)));
    },
    (err) => console.warn('[luma] receipts', err.code)
  ));

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ========================================================================== */
/* Actions                                                                    */
/* ========================================================================== */

function openPaymentModal(invoice) {
  const balance = invoice.balance ?? (invoice.total - (invoice.paid || 0));
  openModal({
    title: 'تسجيل دفعة',
    subtitle: `${invoice.invoiceNo} — المتبقي ${formatMinor(balance)}`,
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="p-amount">المبلغ (د.أ) <span class="req">*</span></label>
        <input class="input ltr" id="p-amount" type="number" min="0.01" step="0.01"
               value="${(balance / 100).toFixed(2)}">
        <div class="field__hint">لا يمكن أن يتجاوز المتبقي على الفاتورة.</div>
      </div>
      <div class="field">
        <label class="field__label" for="p-method">طريقة الدفع <span class="req">*</span></label>
        <select class="select" id="p-method">
          ${Object.entries(PAYMENT_METHODS).map(([k, v]) =>
            `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="p-date">تاريخ الدفع <span class="req">*</span></label>
        <input class="input" id="p-date" type="date" value="${toDateInput(new Date())}">
      </div>
      <div class="field">
        <label class="field__label" for="p-ref">المرجع (رقم الحوالة أو الشيك)</label>
        <input class="input ltr" id="p-ref" maxlength="120">
      </div>
      <div class="field">
        <label class="field__label" for="p-notes">ملاحظات</label>
        <textarea class="textarea" id="p-notes" rows="2" maxlength="1000"></textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="p-save"><i data-lucide="check"></i> تسجيل السند</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#p-save').addEventListener('click', async () => {
        const amount = toMinor(api.$('#p-amount').value);
        if (!(amount > 0)) return toastError('أدخل مبلغاً صحيحاً.');
        if (amount > balance) return toastError('المبلغ يتجاوز المتبقي على الفاتورة.');

        const button = api.$('#p-save');
        setBusy(button, true);
        try {
          const result = await callFn('recordPayment', {
            invoiceId: invoice.id,
            amount,
            method: api.$('#p-method').value,
            paidAt: api.$('#p-date').value,
            reference: sanitizeText(api.$('#p-ref').value, 120),
            notes: sanitizeText(api.$('#p-notes').value, 1000)
          });
          toastSuccess(`تم تسجيل السند ${result.receiptNo}.`);
          api.close();
        } catch (err) { reportError(err, 'record-payment'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

async function voidPayment(paymentId) {
  const reason = await promptReason('إلغاء سند القبض',
    'سيُعاد المبلغ إلى رصيد الفاتورة. السند يبقى في السجل مع سبب الإلغاء.');
  if (!reason) return;
  try {
    await callFn('voidPayment', { paymentId, reason });
    toastSuccess('تم إلغاء السند وتحديث رصيد الفاتورة.');
  } catch (err) { reportError(err, 'void-payment'); }
}

async function cancelInvoice(invoice) {
  const reason = await promptReason('إلغاء الفاتورة',
    `سيتم إلغاء الفاتورة ${invoice.invoiceNo}. لا يمكن التراجع.`);
  if (!reason) return;
  try {
    await callFn('cancelInvoice', { invoiceId: invoice.id, reason });
    toastSuccess('تم إلغاء الفاتورة.');
  } catch (err) { reportError(err, 'cancel-invoice'); }
}

/** Small reason prompt shared by the two irreversible actions. */
function promptReason(title, message) {
  return new Promise((resolve) => {
    openModal({
      title,
      size: 'sm',
      bodyHTML: `
        <div class="security-note mb-4" style="background:var(--danger-soft);border-color:rgba(248,113,113,.35)">
          <i data-lucide="alert-triangle" style="color:var(--danger)"></i>
          <div>${esc(message)}</div>
        </div>
        <div class="field">
          <label class="field__label" for="v-reason">السبب <span class="req">*</span></label>
          <textarea class="textarea" id="v-reason" rows="3" maxlength="500"></textarea>
        </div>`,
      footerHTML: `
        <button class="btn btn--ghost" data-modal-close>تراجع</button>
        <button class="btn btn--danger" id="v-go">تأكيد</button>`,
      onMount: (api) => {
        refreshIcons(api.root);
        api.$('#v-go').addEventListener('click', () => {
          const reason = sanitizeText(api.$('#v-reason').value, 500);
          if (!reason) return toastError('السبب مطلوب.');
          api.close();
          resolve(reason);
        });
      },
      onClose: () => resolve(null)
    });
  });
}

/* ------------------------------------------------------- invoice modal */

function openInvoiceModal(clients, contract = null) {
  let items = contract
    ? [{ description: contract.title, quantity: 1, unitPrice: contract.value }]
    : [{ description: '', quantity: 1, unitPrice: 0 }];

  const lineRow = (item, index) => `
    <tr data-line="${index}">
      <td><input class="input" data-f="description" value="${attr(item.description)}"
                 placeholder="وصف الخدمة" maxlength="300"></td>
      <td style="width:90px"><input class="input ltr" data-f="quantity" type="number"
                 min="1" step="1" value="${item.quantity}"></td>
      <td style="width:130px"><input class="input ltr" data-f="unitPrice" type="number"
                 min="0" step="0.01" value="${(item.unitPrice / 100).toFixed(2)}"></td>
      <td class="num" data-total>${formatMinor(item.quantity * item.unitPrice)}</td>
      <td style="width:40px">
        <button class="icon-btn" data-rm-line="${index}" style="width:28px;height:28px">
          <i data-lucide="x" class="icon-sm"></i></button>
      </td>
    </tr>`;

  openModal({
    title: contract ? `فاتورة من العقد — ${contract.title}` : 'فاتورة جديدة',
    size: 'lg',
    bodyHTML: `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="i-client">العميل <span class="req">*</span></label>
          <select class="select" id="i-client" ${contract ? 'disabled' : ''}>
            <option value="">— اختر العميل —</option>
            ${clients.map((c) => `<option value="${attr(c.id)}"
              ${contract?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="i-issue">تاريخ الإصدار <span class="req">*</span></label>
          <input class="input" id="i-issue" type="date" value="${toDateInput(new Date())}">
        </div>
        <div class="field">
          <label class="field__label" for="i-due">تاريخ الاستحقاق</label>
          <input class="input" id="i-due" type="date">
        </div>
      </div>

      <div class="field">
        <label class="field__label">البنود <span class="req">*</span></label>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة (د.أ)</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody id="i-lines">${items.map(lineRow).join('')}</tbody>
          </table>
        </div>
        <button class="btn btn--ghost btn--sm mt-2" id="i-add-line"><i data-lucide="plus"></i> إضافة بند</button>
      </div>

      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="i-discount">الخصم (د.أ)</label>
          <input class="input ltr" id="i-discount" type="number" min="0" step="0.01" value="0">
        </div>
        <div class="field">
          <label class="field__label" for="i-tax">الضريبة (%)</label>
          <input class="input ltr" id="i-tax" type="number" min="0" max="100" step="0.1" value="0">
        </div>
      </div>

      <div class="card card--pad-sm" style="background:var(--bg-inset)">
        <div class="kv"><span class="kv__k">المجموع الفرعي</span>
          <span class="kv__v num" id="i-subtotal">0.00 د.أ</span></div>
        <div class="kv"><span class="kv__k fw-700">الإجمالي</span>
          <span class="kv__v num fw-700" id="i-total">0.00 د.أ</span></div>
      </div>

      <div class="field mt-4">
        <label class="field__label" for="i-notes">ملاحظات</label>
        <textarea class="textarea" id="i-notes" rows="2" maxlength="2000"></textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="i-save"><i data-lucide="check"></i> إصدار الفاتورة</button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      const readLines = () => [...api.root.querySelectorAll('[data-line]')].map((tr) => ({
        description: tr.querySelector('[data-f="description"]').value.trim(),
        quantity: Number(tr.querySelector('[data-f="quantity"]').value) || 0,
        unitPrice: toMinor(tr.querySelector('[data-f="unitPrice"]').value)
      }));

      const recompute = () => {
        const lines = readLines();
        let subtotal = 0;
        [...api.root.querySelectorAll('[data-line]')].forEach((tr, i) => {
          const total = Math.round(lines[i].quantity * lines[i].unitPrice);
          tr.querySelector('[data-total]').textContent = formatMinor(total);
          subtotal += total;
        });
        const discount = toMinor(api.$('#i-discount').value);
        const taxRate = Number(api.$('#i-tax').value) || 0;
        const tax = Math.round(subtotal * (taxRate / 100));
        api.$('#i-subtotal').textContent = formatMinor(subtotal);
        api.$('#i-total').textContent = formatMinor(subtotal + tax - discount);
      };

      const rebind = () => {
        api.root.querySelectorAll('[data-line] input').forEach((input) =>
          input.addEventListener('input', recompute));
        api.root.querySelectorAll('[data-rm-line]').forEach((b) => b.addEventListener('click', () => {
          const rows = [...api.root.querySelectorAll('[data-line]')];
          if (rows.length === 1) return toastError('الفاتورة تحتاج بنداً واحداً على الأقل.');
          b.closest('[data-line]').remove();
          recompute();
        }));
        refreshIcons(api.$('#i-lines'));
      };

      rebind();
      recompute();
      ['#i-discount', '#i-tax'].forEach((s) => api.$(s).addEventListener('input', recompute));

      api.$('#i-add-line').addEventListener('click', () => {
        const index = api.root.querySelectorAll('[data-line]').length;
        api.$('#i-lines').insertAdjacentHTML('beforeend',
          lineRow({ description: '', quantity: 1, unitPrice: 0 }, index));
        rebind();
        recompute();
      });

      api.$('#i-save').addEventListener('click', async () => {
        const clientId = contract ? contract.clientId : api.$('#i-client').value;
        if (!clientId) return toastError('اختر العميل.');
        const lines = readLines();
        if (lines.some((l) => !l.description)) return toastError('أدخل وصفاً لكل بند.');
        if (lines.some((l) => !(l.quantity > 0))) return toastError('الكمية يجب أن تكون أكبر من صفر.');

        const button = api.$('#i-save');
        setBusy(button, true);
        try {
          const result = await callFn('createInvoice', {
            clientId,
            contractId: contract?.id || '',
            issueDate: api.$('#i-issue').value,
            dueDate: api.$('#i-due').value,
            items: lines,
            discount: toMinor(api.$('#i-discount').value),
            taxRate: Number(api.$('#i-tax').value) || 0,
            notes: sanitizeText(api.$('#i-notes').value, 2000)
          });
          toastSuccess(`تم إصدار الفاتورة ${result.invoiceNo}.`);
          api.close();
          location.hash = `#/finance/${result.id}`;
        } catch (err) { reportError(err, 'create-invoice'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

/* ------------------------------------------------------ contract modal */

function openContractModal(clients, contract = null) {
  const isEdit = !!contract;
  openModal({
    title: isEdit ? 'تعديل العقد' : 'عقد جديد',
    size: 'lg',
    bodyHTML: `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="c-client">العميل <span class="req">*</span></label>
          <select class="select" id="c-client" ${isEdit ? 'disabled' : ''}>
            <option value="">— اختر العميل —</option>
            ${clients.map((c) => `<option value="${attr(c.id)}"
              ${contract?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="c-title">اسم الباقة <span class="req">*</span></label>
          <input class="input" id="c-title" maxlength="200" value="${attr(contract?.title || '')}"
                 placeholder="باقة إدارة السوشيال ميديا">
        </div>
        <div class="field">
          <label class="field__label" for="c-value">قيمة الباقة (د.أ) <span class="req">*</span></label>
          <input class="input ltr" id="c-value" type="number" min="1" step="0.01"
                 value="${contract ? (contract.value / 100).toFixed(2) : ''}">
        </div>
        <div class="field">
          <label class="field__label" for="c-cycle">دورة الدفع <span class="req">*</span></label>
          <select class="select" id="c-cycle">
            ${Object.entries(BILLING_CYCLES).map(([k, v]) => `<option value="${k}"
              ${contract?.billingCycle === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="c-start">تاريخ البداية <span class="req">*</span></label>
          <input class="input" id="c-start" type="date"
                 value="${attr(contract?.startDate || toDateInput(new Date()))}">
        </div>
        <div class="field">
          <label class="field__label" for="c-end">تاريخ النهاية <span class="req">*</span></label>
          <input class="input" id="c-end" type="date" value="${attr(contract?.endDate || '')}">
        </div>
        <div class="field field--full">
          <label class="field__label" for="c-services">الخدمات المشمولة</label>
          <input class="input" id="c-services" maxlength="600"
                 value="${attr((contract?.services || []).join('، '))}"
                 placeholder="تصميم، إدارة حسابات، تصوير — افصل بينها بفاصلة">
        </div>
        <div class="field field--full">
          <label class="field__label" for="c-notes">ملاحظات</label>
          <textarea class="textarea" id="c-notes" rows="2" maxlength="2000">${esc(contract?.notes || '')}</textarea>
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="c-save"><i data-lucide="check"></i> ${isEdit ? 'حفظ' : 'إنشاء العقد'}</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#c-save').addEventListener('click', async () => {
        const clientId = isEdit ? contract.clientId : api.$('#c-client').value;
        const title = sanitizeText(api.$('#c-title').value, 200);
        const value = toMinor(api.$('#c-value').value);
        const startDate = api.$('#c-start').value;
        const endDate = api.$('#c-end').value;

        if (!clientId) return toastError('اختر العميل.');
        if (!title) return toastError('اسم الباقة مطلوب.');
        if (!(value > 0)) return toastError('أدخل قيمة صحيحة للباقة.');
        if (!startDate || !endDate) return toastError('حدد تاريخي البداية والنهاية.');
        if (new Date(endDate) <= new Date(startDate)) {
          return toastError('تاريخ النهاية يجب أن يكون بعد البداية.');
        }

        const button = api.$('#c-save');
        setBusy(button, true);
        try {
          const result = await callFn('saveContract', {
            contractId: contract?.id || '',
            clientId, title, value, startDate, endDate,
            billingCycle: api.$('#c-cycle').value,
            services: api.$('#c-services').value.split(/[،,]/).map((s) => s.trim()).filter(Boolean),
            notes: sanitizeText(api.$('#c-notes').value, 2000)
          });
          toastSuccess(isEdit ? 'تم حفظ العقد.' : `تم إنشاء العقد ${result.contractNo}.`);
          api.close();
        } catch (err) { reportError(err, 'save-contract'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

/* ------------------------------------------------------------- helpers */

function stat(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num" style="font-size:var(--fs-xl)">${esc(value)}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}
