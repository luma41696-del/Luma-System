/**
 * The tools the assistant may call. All read-only, all computed here.
 *
 * The model never does arithmetic on money. It decides *which* question is
 * being asked and explains the answer; every figure below is calculated from
 * Firestore using the same rules the rest of the finance module uses. That is
 * the difference between a reporting assistant and one that invents numbers.
 *
 * Two further constraints:
 *   - Every tool re-checks the caller's permissions. Prompt text is not an
 *     access control; a model can be talked out of an instruction, and a rule
 *     cannot.
 *   - Each tool returns the smallest useful answer — totals and short lists,
 *     never the raw collection — so the minimum leaves our servers.
 */

const { db } = require('../lib/admin');
const { has } = require('../lib/permissions');

/** Guard used by every tool. Throws a message the assistant can relay. */
function ensure(caller, permission) {
  if (!has(caller, permission)) {
    const err = new Error('لا تملك صلاحية الوصول إلى هذه البيانات.');
    err.denied = true;
    throw err;
  }
}

/* ------------------------------------------------------------- utilities */

const money = (minor) => Math.round(minor || 0) / 100;

/** Inclusive [from, to] as YYYY-MM-DD; defaults to the current month. */
function resolvePeriod({ from, to, month } = {}) {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, label: month };
  }
  if (from && to) return { from, to, label: `${from} → ${to}` };
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(Date.UTC(y, now.getMonth() + 1, 0)).getUTCDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}`, label: `${y}-${m}` };
}

async function invoicesBetween(from, to) {
  const snap = await db.collection('invoices')
    .where('issueDate', '>=', from).where('issueDate', '<=', to).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status !== 'cancelled');
}

async function expensesBetween(from, to, { approvedOnly = true } = {}) {
  const snap = await db.collection('expenses')
    .where('spentAt', '>=', from).where('spentAt', '<=', to).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => (approvedOnly ? e.status === 'approved' : e.status !== 'rejected'));
}

/**
 * Clients are named in conversation, not by id, so a fuzzy match is needed.
 * Ambiguity is reported rather than guessed at — picking the wrong client
 * would produce a confidently wrong number.
 */
async function resolveClient(nameOrId) {
  const term = String(nameOrId || '').trim();
  if (!term) throw new Error('لم يُحدَّد العميل.');

  const direct = await db.collection('clients').doc(term).get().catch(() => null);
  if (direct && direct.exists) return { id: direct.id, ...direct.data() };

  const snap = await db.collection('clients').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lower = term.toLowerCase();

  const exact = all.filter((c) => (c.name || '').toLowerCase() === lower);
  if (exact.length === 1) return exact[0];

  const partial = all.filter((c) => (c.name || '').toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const err = new Error(`أكثر من عميل يطابق «${term}»: ${partial.map((c) => c.name).join('، ')}. حدّد الاسم بدقة.`);
    err.ambiguous = true;
    throw err;
  }
  const err = new Error(`لا يوجد عميل بالاسم «${term}» في النظام.`);
  err.notFound = true;
  throw err;
}

/* =========================================================================== */
/* Tool implementations                                                        */
/* =========================================================================== */

const IMPLEMENTATIONS = {
  async getFinancialSummary(caller, args) {
    ensure(caller, 'finance.view');
    const { from, to, label } = resolvePeriod(args);
    const invoices = await invoicesBetween(from, to);
    const expenses = await expensesBetween(from, to);

    const billed = invoices.reduce((s, i) => s + (i.total || 0), 0);
    const collected = invoices.reduce((s, i) => s + (i.paid || 0), 0);
    const spent = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const overdue = invoices.filter((i) => i.status === 'overdue');

    return {
      period: label,
      invoiceCount: invoices.length,
      totalBilled: money(billed),
      totalCollected: money(collected),
      outstanding: money(billed - collected),
      totalExpenses: money(spent),
      // Revenue is what was invoiced; profit here is invoiced minus approved
      // expenses. Advertising budgets are excluded by design — see getAdBudget.
      netProfit: money(billed - spent),
      overdueCount: overdue.length,
      overdueAmount: money(overdue.reduce((s, i) => s + (i.balance ?? i.total), 0)),
      currency: 'JOD',
      hasData: invoices.length > 0 || expenses.length > 0
    };
  },

  async getRevenueByPeriod(caller, args) {
    ensure(caller, 'finance.view');
    const { from, to, label } = resolvePeriod(args);
    const invoices = await invoicesBetween(from, to);
    return {
      period: label,
      invoiceCount: invoices.length,
      billed: money(invoices.reduce((s, i) => s + (i.total || 0), 0)),
      collected: money(invoices.reduce((s, i) => s + (i.paid || 0), 0)),
      currency: 'JOD',
      hasData: invoices.length > 0
    };
  },

  async getOutstandingInvoices(caller, args) {
    ensure(caller, 'finance.view');
    const snap = await db.collection('invoices').get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => i.status !== 'cancelled' && (i.balance ?? i.total) > 0)
      .sort((a, b) => (b.balance ?? b.total) - (a.balance ?? a.total))
      .slice(0, Number(args?.limit) || 20);

    return {
      count: rows.length,
      totalOutstanding: money(rows.reduce((s, i) => s + (i.balance ?? i.total), 0)),
      currency: 'JOD',
      invoices: rows.map((i) => ({
        invoiceNo: i.invoiceNo, client: i.clientName,
        total: money(i.total), paid: money(i.paid || 0),
        balance: money(i.balance ?? i.total), dueDate: i.dueDate, status: i.status
      }))
    };
  },

  async getOverdueInvoices(caller, args) {
    ensure(caller, 'finance.view');
    const today = new Date().toISOString().slice(0, 10);
    const snap = await db.collection('invoices').get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => i.status !== 'cancelled' && (i.balance ?? i.total) > 0
        && i.dueDate && i.dueDate < today)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .slice(0, Number(args?.limit) || 20);

    return {
      count: rows.length,
      totalOverdue: money(rows.reduce((s, i) => s + (i.balance ?? i.total), 0)),
      currency: 'JOD',
      asOf: today,
      invoices: rows.map((i) => ({
        invoiceNo: i.invoiceNo, client: i.clientName,
        balance: money(i.balance ?? i.total), dueDate: i.dueDate,
        daysLate: Math.floor((new Date(today) - new Date(i.dueDate)) / 86_400_000)
      }))
    };
  },

  async getClientFinancialSummary(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);
    const invSnap = await db.collection('invoices').where('clientId', '==', client.id).get();
    const invoices = invSnap.docs.map((d) => d.data()).filter((i) => i.status !== 'cancelled');

    const billed = invoices.reduce((s, i) => s + (i.total || 0), 0);
    const paid = invoices.reduce((s, i) => s + (i.paid || 0), 0);

    return {
      client: client.name,
      invoiceCount: invoices.length,
      totalBilled: money(billed),
      totalPaid: money(paid),
      balance: money(billed - paid),
      overdueCount: invoices.filter((i) => i.status === 'overdue').length,
      currency: 'JOD',
      hasData: invoices.length > 0
    };
  },

  async getClientInvoices(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);
    const snap = await db.collection('invoices').where('clientId', '==', client.id).get();
    const rows = snap.docs.map((d) => d.data())
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
      .slice(0, Number(args?.limit) || 20);
    return {
      client: client.name,
      count: rows.length,
      currency: 'JOD',
      invoices: rows.map((i) => ({
        invoiceNo: i.invoiceNo, issueDate: i.issueDate, dueDate: i.dueDate,
        total: money(i.total), paid: money(i.paid || 0),
        balance: money(i.balance ?? i.total), status: i.status
      }))
    };
  },

  async getClientPayments(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);
    const snap = await db.collection('payments').where('clientId', '==', client.id).get();
    const rows = snap.docs.map((d) => d.data()).filter((p) => !p.voided)
      .sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''))
      .slice(0, Number(args?.limit) || 20);
    return {
      client: client.name,
      count: rows.length,
      totalPaid: money(rows.reduce((s, p) => s + (p.amount || 0), 0)),
      currency: 'JOD',
      payments: rows.map((p) => ({
        receiptNo: p.receiptNo, amount: money(p.amount),
        method: p.method, paidAt: p.paidAt, invoiceNo: p.invoiceNo
      }))
    };
  },

  async getContractDetails(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);
    const snap = await db.collection('contracts').where('clientId', '==', client.id).get();
    const rows = snap.docs.map((d) => d.data());
    return {
      client: client.name,
      count: rows.length,
      currency: 'JOD',
      contracts: rows.map((c) => ({
        contractNo: c.contractNo, title: c.title, value: money(c.value),
        billingCycle: c.billingCycle, startDate: c.startDate, endDate: c.endDate,
        services: c.services || [],
        expired: c.endDate ? new Date(c.endDate) < new Date() : null
      }))
    };
  },

  async getExpensesByPeriod(caller, args) {
    ensure(caller, 'finance.view');
    const { from, to, label } = resolvePeriod(args);
    const rows = await expensesBetween(from, to);
    const byCategory = {};
    for (const e of rows) {
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
    }
    return {
      period: label,
      count: rows.length,
      total: money(rows.reduce((s, e) => s + (e.amount || 0), 0)),
      currency: 'JOD',
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, money(v)])
      ),
      note: 'المصاريف المعتمدة فقط.',
      hasData: rows.length > 0
    };
  },

  async getAdBudgetByClient(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);
    const snap = await db.collection('adBudgets').where('clientId', '==', client.id).get();
    const rows = snap.docs.map((d) => d.data());
    const received = rows.reduce((s, b) => s + (b.received || 0), 0);
    const spent = rows.reduce((s, b) => s + (b.spent || 0), 0);
    return {
      client: client.name,
      received: money(received),
      spent: money(spent),
      remaining: money(received - spent),
      currency: 'JOD',
      byPlatform: rows.map((b) => ({
        platform: b.platform, period: b.period,
        received: money(b.received), spent: money(b.spent || 0)
      })),
      note: 'ميزانية الإعلانات أموال العميل ولا تُحتسب ضمن إيرادات الوكالة.',
      hasData: rows.length > 0
    };
  },

  async getProfitByClient(caller, args) {
    ensure(caller, 'finance.view');
    const client = await resolveClient(args?.client);

    const [invSnap, expSnap] = await Promise.all([
      db.collection('invoices').where('clientId', '==', client.id).get(),
      db.collection('expenses').where('clientId', '==', client.id).get()
    ]);
    const invoices = invSnap.docs.map((d) => d.data()).filter((i) => i.status !== 'cancelled');
    const expenses = expSnap.docs.map((d) => d.data()).filter((e) => e.status === 'approved');

    const revenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
    const cost = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    return {
      client: client.name,
      revenue: money(revenue),
      directCosts: money(cost),
      profit: money(revenue - cost),
      margin: revenue ? `${Math.round(((revenue - cost) / revenue) * 100)}%` : null,
      currency: 'JOD',
      note: 'ميزانيات الإعلانات مستثناة لأنها أموال العميل وليست إيراداً للوكالة.',
      hasData: invoices.length > 0 || expenses.length > 0
    };
  },

  async compareFinancialPeriods(caller, args) {
    ensure(caller, 'finance.view');
    const a = resolvePeriod({ month: args?.periodA });
    const b = resolvePeriod({ month: args?.periodB });

    const build = async (p) => {
      const invoices = await invoicesBetween(p.from, p.to);
      const expenses = await expensesBetween(p.from, p.to);
      const billed = invoices.reduce((s, i) => s + (i.total || 0), 0);
      return {
        period: p.label,
        billed: money(billed),
        collected: money(invoices.reduce((s, i) => s + (i.paid || 0), 0)),
        expenses: money(expenses.reduce((s, e) => s + (e.amount || 0), 0)),
        invoiceCount: invoices.length
      };
    };

    const [first, second] = await Promise.all([build(a), build(b)]);
    const delta = first.billed - second.billed;
    return {
      current: first,
      previous: second,
      change: money(Math.round(delta * 100)),
      changePercent: second.billed ? `${Math.round((delta / second.billed) * 100)}%` : null,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      currency: 'JOD'
    };
  },

  async getUpcomingPayments(caller, args) {
    ensure(caller, 'finance.view');
    const days = Math.min(Math.max(Number(args?.days) || 30, 1), 365);
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const snap = await db.collection('invoices').get();
    const rows = snap.docs.map((d) => d.data())
      .filter((i) => i.status !== 'cancelled' && (i.balance ?? i.total) > 0
        && i.dueDate && i.dueDate >= today && i.dueDate <= until)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

    return {
      windowDays: days,
      count: rows.length,
      total: money(rows.reduce((s, i) => s + (i.balance ?? i.total), 0)),
      currency: 'JOD',
      invoices: rows.slice(0, 20).map((i) => ({
        invoiceNo: i.invoiceNo, client: i.clientName,
        balance: money(i.balance ?? i.total), dueDate: i.dueDate
      }))
    };
  },

  async getTopClientsByRevenue(caller, args) {
    ensure(caller, 'finance.view');
    const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 20);
    const period = args?.month ? resolvePeriod({ month: args.month }) : null;

    const snap = period
      ? await db.collection('invoices')
          .where('issueDate', '>=', period.from).where('issueDate', '<=', period.to).get()
      : await db.collection('invoices').get();

    const totals = {};
    snap.docs.map((d) => d.data()).filter((i) => i.status !== 'cancelled').forEach((i) => {
      const key = i.clientName || i.clientId;
      if (!totals[key]) totals[key] = { client: key, billed: 0, collected: 0, invoices: 0 };
      totals[key].billed += i.total || 0;
      totals[key].collected += i.paid || 0;
      totals[key].invoices += 1;
    });

    const rows = Object.values(totals).sort((a, b) => b.billed - a.billed).slice(0, limit);
    return {
      period: period?.label || 'كل الفترات',
      currency: 'JOD',
      clients: rows.map((r) => ({
        client: r.client, billed: money(r.billed),
        collected: money(r.collected), invoices: r.invoices
      })),
      hasData: rows.length > 0
    };
  }
};

/* =========================================================================== */
/* Declarations handed to the model                                            */
/* =========================================================================== */

const clientArg = {
  client: { type: 'string', description: 'اسم العميل كما يذكره المستخدم، أو معرّفه.' }
};
const periodArgs = {
  month: { type: 'string', description: 'شهر بصيغة YYYY-MM. اتركه فارغاً للشهر الحالي.' },
  from: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري).' },
  to: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري).' }
};

function tool(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  };
}

const DEFINITIONS = [
  tool('getFinancialSummary', 'ملخص مالي شامل لفترة: الفواتير والمحصّل والمستحق والمصاريف وصافي الربح.', periodArgs),
  tool('getRevenueByPeriod', 'إجمالي الإيرادات المفوترة والمحصّلة خلال فترة.', periodArgs),
  tool('getOutstandingInvoices', 'الفواتير التي عليها رصيد متبقٍ (غير مسددة بالكامل).', { limit: { type: 'number' } }),
  tool('getOverdueInvoices', 'الفواتير المتأخرة عن تاريخ استحقاقها مع عدد أيام التأخير.', { limit: { type: 'number' } }),
  tool('getClientFinancialSummary', 'الوضع المالي لعميل: إجمالي الفواتير والمدفوع والمتبقي.', clientArg, ['client']),
  tool('getClientInvoices', 'فواتير عميل محدد.', { ...clientArg, limit: { type: 'number' } }, ['client']),
  tool('getClientPayments', 'سندات القبض المسجّلة لعميل محدد.', { ...clientArg, limit: { type: 'number' } }, ['client']),
  tool('getContractDetails', 'عقود عميل: قيمة الباقة، دورة الدفع، المدة والخدمات.', clientArg, ['client']),
  tool('getExpensesByPeriod', 'المصاريف المعتمدة خلال فترة، موزّعة على التصنيفات.', periodArgs),
  tool('getAdBudgetByClient', 'ميزانية إعلانات عميل: المستلم والمصروف والمتبقي لكل منصة.', clientArg, ['client']),
  tool('getProfitByClient', 'ربحية عميل: الإيراد ناقص المصاريف المرتبطة به.', clientArg, ['client']),
  tool('compareFinancialPeriods', 'مقارنة بين شهرين. مرّر periodA و periodB بصيغة YYYY-MM.', {
    periodA: { type: 'string', description: 'الشهر الأول YYYY-MM' },
    periodB: { type: 'string', description: 'الشهر المقارن به YYYY-MM' }
  }, ['periodA', 'periodB']),
  tool('getUpcomingPayments', 'الفواتير التي تستحق خلال عدد أيام قادمة.', { days: { type: 'number' } }),
  tool('getTopClientsByRevenue', 'أعلى العملاء من حيث الإيراد.', {
    limit: { type: 'number' }, month: { type: 'string' }
  })
];

/** Dispatch. Unknown names are rejected rather than ignored. */
async function runTool(caller, name, args) {
  const implementation = IMPLEMENTATIONS[name];
  if (!implementation) throw new Error(`أداة غير معروفة: ${name}`);
  return implementation(caller, args || {});
}

module.exports = { DEFINITIONS, runTool, TOOL_NAMES: Object.keys(IMPLEMENTATIONS) };
