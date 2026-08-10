/**
 * Financial dashboard and reports — the final stage of the finance module.
 *
 * Everything here is derived from records the earlier stages created: invoices,
 * receipts, approved expenses and contracts. Nothing is stored twice, so a
 * figure on a report can always be traced back to the document it came from.
 *
 * Two accounting distinctions are kept visible rather than blended away:
 *
 *   - Billed vs collected. An invoice raised is revenue earned; a receipt is
 *     cash received. Reporting only one of them hides either the work done or
 *     the money actually in hand, so both are shown side by side.
 *   - Advertising budgets are excluded throughout. They are the client's money
 *     passing through the agency; folding them in would inflate both revenue
 *     and profit by the whole ad spend.
 */

import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState
} from './utils/dom.js';
import { col, query, orderBy, limit, onSnapshot } from './utils/api.js';
import { formatMinor, formatDate, daysBetween } from './utils/format.js';
import { lineChart, barChart, doughnutChart, destroyAllCharts } from './utils/charts.js';

/* ------------------------------------------------------------- periods */

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => iso(d).slice(0, 7);

/** Named ranges offered in the period picker. */
function periodRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const endOf = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0));

  switch (key) {
    case 'lastMonth':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(endOf(y, m - 1)), label: 'الشهر الماضي' };
    case 'quarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { from: iso(new Date(Date.UTC(y, qStart, 1))), to: iso(endOf(y, qStart + 2)), label: 'هذا الربع' };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `سنة ${y}` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `سنة ${y - 1}` };
    case 'all':
      return { from: '1970-01-01', to: '2999-12-31', label: 'كل الفترات' };
    default:
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(endOf(y, m)), label: 'هذا الشهر' };
  }
}

const PERIODS = [
  ['month', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['quarter', 'هذا الربع'],
  ['year', 'هذه السنة'], ['lastYear', 'السنة الماضية'], ['all', 'كل الفترات']
];

/* ---------------------------------------------------------- data layer */

/**
 * One live subscription per collection, shared by the dashboard and the
 * reports. Both screens summarise the same records, so loading them twice
 * would double the reads for no benefit.
 */
function watchFinanceData(unsubs, onChange) {
  const data = { invoices: [], payments: [], expenses: [], contracts: [], adBudgets: [], accounts: [] };
  let ready = 0;

  const sub = (name, q) => unsubs.push(onSnapshot(q,
    (snap) => {
      data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      ready += 1;
      onChange(data, ready);
    },
    (err) => console.warn(`[luma] ${name}`, err.code)
  ));

  sub('invoices', query(col('invoices'), orderBy('issueDate', 'desc'), limit(2000)));
  sub('payments', query(col('payments'), orderBy('paidAt', 'desc'), limit(2000)));
  sub('expenses', query(col('expenses'), orderBy('spentAt', 'desc'), limit(2000)));
  sub('contracts', query(col('contracts'), orderBy('endDate', 'asc'), limit(500)));
  sub('adBudgets', query(col('adBudgets'), orderBy('period', 'desc'), limit(500)));
  // Treasury may be denied for a user without `ft`; the listener's error path
  // leaves accounts empty and the cash card simply does not render.
  sub('accounts', query(col('accounts'), orderBy('name'), limit(100)));
  return data;
}

/** Aggregate a period. `billed` is accrual, `collected` is cash. */
function summarise(data, { from, to }) {
  const inRange = (d) => d && d >= from && d <= to;
  const today = iso(new Date());

  const invoices = data.invoices.filter((i) => i.status !== 'cancelled');
  const periodInvoices = invoices.filter((i) => inRange(i.issueDate));
  const receipts = data.payments.filter((p) => !p.voided && inRange(p.paidAt));
  const expenses = data.expenses.filter((e) => e.status === 'approved' && inRange(e.spentAt));

  const billed = periodInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const tax = periodInvoices.reduce((s, i) => s + (i.tax || 0), 0);
  const collected = receipts.reduce((s, p) => s + (p.amount || 0), 0);
  const spent = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // Receivables are a balance, not a flow: every unsettled invoice counts,
  // whenever it was raised.
  const openInvoices = invoices.filter((i) => (i.balance ?? i.total) > 0);
  const outstanding = openInvoices.reduce((s, i) => s + (i.balance ?? i.total), 0);
  const overdue = openInvoices.filter((i) => i.dueDate && i.dueDate < today);

  return {
    billed, collected, spent, tax, outstanding,
    profit: billed - spent,
    cashProfit: collected - spent,
    invoiceCount: periodInvoices.length,
    expenseCount: expenses.length,
    overdue,
    overdueAmount: overdue.reduce((s, i) => s + (i.balance ?? i.total), 0),
    openInvoices,
    periodInvoices,
    receipts,
    expenses,
    hasData: periodInvoices.length > 0 || expenses.length > 0 || receipts.length > 0
  };
}

/** Twelve rolling months of billed / collected / spent. */
function monthlySeries(data, months = 12) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    buckets.push({
      key: monthKey(d),
      label: `${AR_MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      billed: 0, collected: 0, spent: 0
    });
  }
  const index = Object.fromEntries(buckets.map((b) => [b.key, b]));

  data.invoices.filter((i) => i.status !== 'cancelled').forEach((i) => {
    const b = index[(i.issueDate || '').slice(0, 7)];
    if (b) b.billed += i.total || 0;
  });
  data.payments.filter((p) => !p.voided).forEach((p) => {
    const b = index[(p.paidAt || '').slice(0, 7)];
    if (b) b.collected += p.amount || 0;
  });
  data.expenses.filter((e) => e.status === 'approved').forEach((e) => {
    const b = index[(e.spentAt || '').slice(0, 7)];
    if (b) b.spent += e.amount || 0;
  });
  return buckets;
}

const toMajor = (minor) => Math.round((minor || 0)) / 100;

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

export function paintOverview(host, unsubs) {
  let period = localStorage.getItem('luma.financePeriod') || 'month';

  host.innerHTML = `
    <div class="filter-bar mt-4">
      <span class="filter-bar__label"><i data-lucide="calendar"></i> الفترة</span>
      <select class="select" id="ov-period" style="max-width:200px">
        ${PERIODS.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select>
      <span class="fs-xs text-muted" id="ov-range"></span>
    </div>
    <div id="ov-body">${'<div class="skeleton skeleton--card"></div>'.repeat(2)}</div>`;
  refreshIcons(host);

  $('#ov-period').value = period;
  $('#ov-period').addEventListener('change', (e) => {
    period = e.target.value;
    localStorage.setItem('luma.financePeriod', period);
    render();
  });

  let data = null;
  data = watchFinanceData(unsubs, (d) => { data = d; render(); });

  function render() {
    const body = $('#ov-body');
    if (!body || !data) return;

    const range = periodRange(period);
    const s = summarise(data, range);
    $('#ov-range').textContent = range.label === 'كل الفترات'
      ? '' : `${range.from} ← ${range.to}`;

    const today = iso(new Date());
    const expiring = data.contracts
      .filter((c) => c.endDate && c.endDate >= today && daysBetween(new Date(), new Date(c.endDate)) <= 45)
      .slice(0, 6);
    const expired = data.contracts.filter((c) => c.endDate && c.endDate < today).length;

    const adReceived = data.adBudgets.reduce((s2, b) => s2 + (b.received || 0), 0);
    const adSpent = data.adBudgets.reduce((s2, b) => s2 + (b.spent || 0), 0);

    destroyAllCharts();

    body.innerHTML = `
      ${!s.hasData ? `
        <div class="security-note mt-4">
          <i data-lucide="info"></i>
          <div>لا توجد حركة مالية في هذه الفترة. الأرقام أدناه تعكس ذلك ولا تُقدَّر تقديراً.</div>
        </div>` : ''}

      <div class="grid grid-4 mt-4">
        ${kpi('trending-up', 'success', formatMinor(s.billed), 'الإيرادات (مفوتَرة)')}
        ${kpi('trending-down', 'danger', formatMinor(s.spent), 'المصروفات المعتمدة')}
        ${kpi('wallet', s.profit >= 0 ? 'brand' : 'danger', formatMinor(s.profit), 'صافي الربح')}
        ${kpi('hand-coins', 'info', formatMinor(s.collected), 'المحصّل فعلياً')}
      </div>

      <div class="grid grid-4 mt-4">
        ${kpi('file-clock', 'warning', formatMinor(s.outstanding), 'ذمم مستحقة على العملاء')}
        ${kpi('alert-triangle', 'danger', String(s.overdue.length), 'فواتير متأخرة')}
        ${kpi('receipt', 'purple', formatMinor(s.tax), 'الضريبة المحصّلة')}
        ${kpi('megaphone', 'info', formatMinor(adReceived - adSpent), 'رصيد إعلانات العملاء')}
      </div>

      ${data.accounts.length ? `
        <div class="grid grid-auto mt-4">
          ${data.accounts.map((a) => kpi(
            a.type === 'bank' ? 'landmark' : 'wallet',
            a.type === 'bank' ? 'info' : 'success',
            formatMinor(a.balance), a.name)).join('')}
          ${kpi('layers', 'brand',
            formatMinor(data.accounts.reduce((t, a) => t + (a.balance || 0), 0)),
            'إجمالي السيولة')}
        </div>` : ''}

      <div class="grid grid-2 mt-4">
        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="bar-chart-3"></i> الإيرادات والمصروفات — 12 شهراً</div>
          </div>
          <div class="chart-box" style="height:280px"><canvas id="ov-trend"></canvas></div>
        </div>
        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="line-chart"></i> التدفق النقدي — المحصّل مقابل المصروف</div>
          </div>
          <div class="chart-box" style="height:280px"><canvas id="ov-cash"></canvas></div>
        </div>
      </div>

      <div class="grid grid-2 mt-4">
        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="alert-triangle"></i> أقدم الفواتير المتأخرة</div>
          </div>
          ${s.overdue.length ? `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>الفاتورة</th><th>العميل</th><th>الاستحقاق</th><th>التأخير</th><th>المتبقي</th></tr></thead>
              <tbody>${[...s.overdue]
                .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
                .slice(0, 6).map((i) => `
                <tr onclick="location.hash='#/finance/${attr(i.id)}'" style="cursor:pointer">
                  <td class="ltr is-strong">${esc(i.invoiceNo || '—')}</td>
                  <td>${esc(i.clientName || '—')}</td>
                  <td class="num">${esc(i.dueDate)}</td>
                  <td class="num" style="color:var(--danger)">
                    ${Math.floor((new Date(today) - new Date(i.dueDate)) / 86400000)} يوم</td>
                  <td class="num fw-700">${esc(formatMinor(i.balance ?? i.total))}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>` : '<div class="text-muted fs-sm">لا توجد فواتير متأخرة.</div>'}
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="file-signature"></i> عقود تقارب الانتهاء</div>
            ${expired ? `<span class="badge badge--danger">${expired} منتهٍ</span>` : ''}
          </div>
          ${expiring.length ? expiring.map((c) => {
            const left = daysBetween(new Date(), new Date(c.endDate));
            return `
              <div class="list-row">
                <div class="list-row__body">
                  <div class="list-row__title">${esc(c.title)}</div>
                  <div class="list-row__sub">${esc(c.clientName || '')} · ينتهي ${esc(c.endDate)}</div>
                </div>
                <span class="badge badge--${left <= 14 ? 'danger' : 'warning'}">${left} يوم</span>
              </div>`;
          }).join('') : '<div class="text-muted fs-sm">لا توجد عقود تنتهي خلال 45 يوماً.</div>'}
        </div>
      </div>`;

    refreshIcons(body);

    const series = monthlySeries(data);
    barChart('ov-trend', series.map((b) => b.label), [
      { label: 'الإيرادات', data: series.map((b) => toMajor(b.billed)) },
      { label: 'المصروفات', data: series.map((b) => toMajor(b.spent)),
        color: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() }
    ]);
    lineChart('ov-cash', series.map((b) => b.label), [
      { label: 'المحصّل', data: series.map((b) => toMajor(b.collected)),
        color: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() },
      { label: 'المصروف', data: series.map((b) => toMajor(b.spent)),
        color: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(), fill: false }
    ]);
  }
}

/* ========================================================================== */
/* Reports                                                                    */
/* ========================================================================== */

export function paintReports(host, unsubs) {
  let period = localStorage.getItem('luma.financePeriod') || 'year';

  host.innerHTML = `
    <div class="filter-bar mt-4">
      <span class="filter-bar__label"><i data-lucide="calendar"></i> الفترة</span>
      <select class="select" id="rp-period" style="max-width:200px">
        ${PERIODS.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select>
      <button class="btn btn--ghost btn--sm" id="rp-print"><i data-lucide="printer"></i> طباعة</button>
    </div>
    <div id="rp-body">${'<div class="skeleton skeleton--card"></div>'.repeat(2)}</div>`;
  refreshIcons(host);

  $('#rp-period').value = period;
  $('#rp-period').addEventListener('change', (e) => {
    period = e.target.value;
    localStorage.setItem('luma.financePeriod', period);
    render();
  });
  $('#rp-print').addEventListener('click', () => window.print());

  let data = null;
  data = watchFinanceData(unsubs, (d) => { data = d; render(); });

  function render() {
    const body = $('#rp-body');
    if (!body || !data) return;

    const range = periodRange(period);
    const s = summarise(data, range);

    /* ---- profit and loss, month by month ---- */
    const pl = {};
    s.periodInvoices.forEach((i) => {
      const k = (i.issueDate || '').slice(0, 7);
      (pl[k] ||= { billed: 0, spent: 0, tax: 0 }).billed += i.total || 0;
      pl[k].tax += i.tax || 0;
    });
    s.expenses.forEach((e) => {
      const k = (e.spentAt || '').slice(0, 7);
      (pl[k] ||= { billed: 0, spent: 0, tax: 0 }).spent += e.amount || 0;
    });
    const plRows = Object.entries(pl).sort(([a], [b]) => a.localeCompare(b));

    /* ---- expenses by category ---- */
    const byCategory = {};
    s.expenses.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0); });
    const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    /* ---- per-client profitability ---- */
    const clients = {};
    s.periodInvoices.forEach((i) => {
      const k = i.clientName || i.clientId || '—';
      (clients[k] ||= { revenue: 0, cost: 0, collected: 0, invoices: 0 });
      clients[k].revenue += i.total || 0;
      clients[k].collected += i.paid || 0;
      clients[k].invoices += 1;
    });
    s.expenses.filter((e) => e.clientId).forEach((e) => {
      const k = e.clientName || e.clientId;
      (clients[k] ||= { revenue: 0, cost: 0, collected: 0, invoices: 0 }).cost += e.amount || 0;
    });
    const clientRows = Object.entries(clients)
      .map(([name, v]) => ({ name, ...v, profit: v.revenue - v.cost }))
      .sort((a, b) => b.revenue - a.revenue);

    /* ---- debtors ---- */
    const debtors = {};
    s.openInvoices.forEach((i) => {
      const k = i.clientName || i.clientId || '—';
      (debtors[k] ||= { balance: 0, count: 0, oldest: null });
      debtors[k].balance += i.balance ?? i.total;
      debtors[k].count += 1;
      if (i.dueDate && (!debtors[k].oldest || i.dueDate < debtors[k].oldest)) debtors[k].oldest = i.dueDate;
    });
    const debtorRows = Object.entries(debtors)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.balance - a.balance);

    destroyAllCharts();

    body.innerHTML = `
      <div class="card mt-4">
        <div class="card__head">
          <div class="card__title"><i data-lucide="scale"></i> الأرباح والخسائر — ${esc(range.label)}</div>
        </div>
        ${plRows.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>الشهر</th><th>الإيرادات</th><th>المصروفات</th><th>صافي الربح</th><th>الهامش</th></tr></thead>
            <tbody>
              ${plRows.map(([k, v]) => {
                const profit = v.billed - v.spent;
                const margin = v.billed ? Math.round((profit / v.billed) * 100) : null;
                return `
                  <tr>
                    <td class="is-strong num">${esc(k)}</td>
                    <td class="num">${esc(formatMinor(v.billed))}</td>
                    <td class="num">${esc(formatMinor(v.spent))}</td>
                    <td class="num fw-700" style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">
                      ${esc(formatMinor(profit))}</td>
                    <td class="num">${margin === null ? '—' : `${margin}%`}</td>
                  </tr>`;
              }).join('')}
              <tr style="border-top:2px solid var(--border-strong)">
                <td class="fw-700">الإجمالي</td>
                <td class="num fw-700">${esc(formatMinor(s.billed))}</td>
                <td class="num fw-700">${esc(formatMinor(s.spent))}</td>
                <td class="num fw-700" style="color:${s.profit >= 0 ? 'var(--success)' : 'var(--danger)'}">
                  ${esc(formatMinor(s.profit))}</td>
                <td class="num fw-700">${s.billed ? `${Math.round((s.profit / s.billed) * 100)}%` : '—'}</td>
              </tr>
            </tbody>
          </table></div>
          <div class="fs-xs text-muted mt-3">
            الإيرادات محسوبة على أساس الاستحقاق (تاريخ الفاتورة). المحصّل فعلياً خلال الفترة:
            <strong class="num">${esc(formatMinor(s.collected))}</strong> —
            والفرق يمثل ما لم يُدفع بعد.
          </div>`
          : '<div class="text-muted fs-sm">لا توجد حركة في هذه الفترة.</div>'}
      </div>

      <div class="grid grid-2 mt-4">
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="pie-chart"></i> المصروفات حسب التصنيف</div></div>
          ${categories.length
            ? '<div class="chart-box" style="height:260px"><canvas id="rp-cats"></canvas></div>'
            : '<div class="text-muted fs-sm">لا مصروفات معتمدة في هذه الفترة.</div>'}
        </div>
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="users"></i> ربحية العملاء</div></div>
          ${clientRows.length ? `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>العميل</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th></tr></thead>
              <tbody>${clientRows.slice(0, 10).map((c) => `
                <tr>
                  <td class="is-strong">${esc(c.name)}</td>
                  <td class="num">${esc(formatMinor(c.revenue))}</td>
                  <td class="num">${esc(formatMinor(c.cost))}</td>
                  <td class="num fw-700" style="color:${c.profit >= 0 ? 'var(--success)' : 'var(--danger)'}">
                    ${esc(formatMinor(c.profit))}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>
            <div class="fs-xs text-muted mt-2">التكلفة هي المصاريف المرتبطة بالعميل فقط.</div>`
            : '<div class="text-muted fs-sm">لا بيانات.</div>'}
        </div>
      </div>

      <div class="card mt-4">
        <div class="card__head">
          <div class="card__title"><i data-lucide="file-clock"></i> العملاء المدينون</div>
          <span class="badge badge--warning">${esc(formatMinor(s.outstanding))}</span>
        </div>
        ${debtorRows.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>أقدم استحقاق</th><th>الرصيد المستحق</th></tr></thead>
            <tbody>${debtorRows.map((d) => `
              <tr>
                <td class="is-strong">${esc(d.name)}</td>
                <td class="num">${d.count}</td>
                <td class="num">${esc(d.oldest || '—')}</td>
                <td class="num fw-700">${esc(formatMinor(d.balance))}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
          : '<div class="text-muted fs-sm">لا ذمم مستحقة — كل الفواتير مسددة.</div>'}
      </div>

      <div class="security-note mt-4">
        <i data-lucide="info"></i>
        <div>
          ميزانيات إعلانات العملاء مستثناة من كل أرقام الإيرادات والأرباح أعلاه،
          لأنها أموال العميل لا دخل الوكالة.
          <div class="fs-xs text-muted mt-2">
            الرواتب والعمولات تظهر ضمن المصروفات فور صرف كشف الرواتب من الصندوق،
            وأرصدة الحسابات معروضة في لوحة التحكم وتبويب «الصندوق والبنوك».
          </div>
        </div>
      </div>`;

    refreshIcons(body);

    if (categories.length) {
      doughnutChart('rp-cats',
        categories.map(([k]) => CATEGORY_LABELS[k] || k),
        categories.map(([, v]) => toMajor(v)));
    }
  }
}

/** Mirrors the labels used on the expenses tab. */
const CATEGORY_LABELS = {
  rent: 'إيجار', subscriptions: 'اشتراكات', tools: 'أدوات وبرامج',
  transport: 'مواصلات', office: 'مصاريف مكتبية', salaries: 'رواتب',
  marketing: 'تسويق', freelancers: 'فريلانسرز وموردون', other: 'أخرى'
};

function kpi(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num" style="font-size:var(--fs-lg)">${esc(value)}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}
