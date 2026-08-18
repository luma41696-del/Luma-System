/**
 * Tools for the management assistant: who is on the team, how loaded they are,
 * how one person is doing, and what work is drifting.
 *
 * Every tool re-checks its own permission, exactly as the finance tools do.
 * Holding `tasks.ai` buys a conversation, not a view of everyone's numbers —
 * a manager without `dashboard.viewTeam` gets a refusal from the tool rather
 * than a filtered half-answer that reads as complete.
 *
 * `draftTask` is the one tool that looks like a write and deliberately is not:
 * it returns a proposal the browser opens in the ordinary task form for a
 * person to check and save. An assistant that could create tasks outright
 * would be one confidently-wrong sentence away from assigning real work to
 * the wrong person.
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

/** Any of the listed permissions is enough. */
function ensureAny(caller, permissions) {
  if (!permissions.some((p) => has(caller, p))) {
    const err = new Error('لا تملك صلاحية الوصول إلى هذه البيانات.');
    err.denied = true;
    throw err;
  }
}

const OPEN_STATUSES = ['new', 'assigned', 'inprogress', 'waiting', 'review'];
const TASK_CEILING = 1000;

const toMillis = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
};

const isOverdue = (t) => {
  const due = toMillis(t.dueAt);
  return !!due && due < Date.now() && t.status !== 'completed' && t.status !== 'cancelled';
};

/** Bounded read, ordered so the ceiling drops the oldest rather than a random slice. */
async function recentTasks() {
  const snap = await db.collection('tasks').orderBy('createdAt', 'desc').limit(TASK_CEILING).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.deleted);
}

async function activeEmployees() {
  const snap = await db.collection('users').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.status !== 'disabled');
}

/* ------------------------------------------------------------------ tools */

async function listEmployees(caller) {
  ensure(caller, 'employees.view');
  const people = await activeEmployees();
  return {
    count: people.length,
    employees: people.map((u) => ({
      id: u.id,
      name: u.displayName || '',
      roles: u.roles || [],
      department: u.department || '',
      accountRole: u.accountRole || 'employee'
    }))
  };
}

async function getTeamWorkload(caller) {
  ensureAny(caller, ['dashboard.viewTeam', 'dashboard.viewCompany', 'tasks.editAll']);
  const [people, tasks] = await Promise.all([activeEmployees(), recentTasks()]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rows = people.map((u) => {
    const mine = tasks.filter((t) => (t.assignees || []).includes(u.id));
    const open = mine.filter((t) => OPEN_STATUSES.includes(t.status));
    return {
      id: u.id,
      name: u.displayName || '',
      roles: u.roles || [],
      open: open.length,
      inProgress: mine.filter((t) => t.status === 'inprogress').length,
      overdue: mine.filter(isOverdue).length,
      completedThisMonth: mine.filter((t) =>
        t.status === 'completed' && toMillis(t.completedAt) >= monthStart.getTime()).length
    };
  });

  rows.sort((a, b) => b.open - a.open);
  return {
    // Stated so the model can say "least loaded" without inventing a ranking.
    note: 'open = المهام المفتوحة المسندة حالياً. الترتيب من الأكثر انشغالاً إلى الأقل.',
    unassignedOpen: tasks.filter((t) =>
      OPEN_STATUSES.includes(t.status) && !(t.assignees || []).length).length,
    team: rows
  };
}

async function getEmployeeReport(caller, { employee, days = 30 } = {}) {
  ensureAny(caller, ['dashboard.viewTeam', 'dashboard.viewCompany', 'reports.view']);
  if (!employee) throw new Error('حدد اسم الموظف.');

  const people = await activeEmployees();
  const needle = String(employee).trim().toLowerCase();
  const person = people.find((u) => u.id === employee)
    || people.find((u) => (u.displayName || '').toLowerCase() === needle)
    || people.find((u) => (u.displayName || '').toLowerCase().includes(needle));
  if (!person) throw new Error(`لم أجد موظفاً باسم «${employee}».`);

  const tasks = (await recentTasks()).filter((t) => (t.assignees || []).includes(person.id));
  const since = Date.now() - Math.max(1, Math.min(365, Number(days) || 30)) * 86_400_000;

  const completed = tasks.filter((t) => t.status === 'completed' && toMillis(t.completedAt) >= since);
  const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
  const overdue = tasks.filter(isOverdue);

  // Only tasks with both ends recorded can contribute an average.
  const durations = completed
    .map((t) => toMillis(t.completedAt) - (toMillis(t.startedAt) || toMillis(t.createdAt)))
    .filter((ms) => ms > 0);
  const avgHours = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) / 3_600_000)
    : null;

  const byClient = {};
  completed.forEach((t) => {
    const key = t.clientName || 'بدون عميل';
    byClient[key] = (byClient[key] || 0) + 1;
  });

  return {
    employee: { id: person.id, name: person.displayName || '', roles: person.roles || [] },
    periodDays: Number(days) || 30,
    completedInPeriod: completed.length,
    openNow: open.length,
    overdueNow: overdue.length,
    avgCompletionHours: avgHours,
    completedByClient: byClient,
    // Named explicitly so the model does not present a rate built on nothing.
    hasEnoughData: completed.length > 0 || open.length > 0
  };
}

async function getStaleTasks(caller, { days = 7, limit = 15 } = {}) {
  ensureAny(caller, ['tasks.editAll', 'dashboard.viewCompany', 'dashboard.viewTeam']);
  const cutoff = Date.now() - Math.max(1, Number(days) || 7) * 86_400_000;
  const tasks = await recentTasks();

  const stale = tasks
    .filter((t) => OPEN_STATUSES.includes(t.status))
    .filter((t) => !(t.assignees || []).length || toMillis(t.updatedAt || t.createdAt) < cutoff)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 15)))
    .map((t) => ({
      id: t.id,
      title: t.title || '',
      status: t.status,
      client: t.clientName || null,
      assigneeCount: (t.assignees || []).length,
      overdue: isOverdue(t),
      daysSinceUpdate: Math.floor((Date.now() - toMillis(t.updatedAt || t.createdAt)) / 86_400_000)
    }));

  return { count: stale.length, olderThanDays: Number(days) || 7, tasks: stale };
}

/**
 * Propose a task. Returns a draft only — nothing is written here.
 *
 * Names are resolved to real ids server-side so the browser opens the form
 * with a genuine employee and client selected rather than a string the model
 * guessed at.
 */
async function draftTask(caller, { title, description, assignee, client, priority, dueAt, project } = {}) {
  ensure(caller, 'tasks.create');
  if (!title || String(title).trim().length < 3) throw new Error('عنوان المهمة مطلوب.');

  const draft = {
    title: String(title).trim().slice(0, 200),
    description: String(description || '').trim().slice(0, 2000),
    project: String(project || '').trim().slice(0, 120),
    priority: ['urgent', 'high', 'medium', 'low'].includes(priority) ? priority : 'medium',
    dueAt: /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(String(dueAt || '')) ? String(dueAt) : null,
    assignees: [],
    assigneeNames: [],
    clientId: null,
    clientName: null,
    unresolved: []
  };

  if (assignee) {
    const people = await activeEmployees();
    const wanted = Array.isArray(assignee) ? assignee : [assignee];
    wanted.slice(0, 5).forEach((raw) => {
      const needle = String(raw).trim().toLowerCase();
      const person = people.find((u) => u.id === raw)
        || people.find((u) => (u.displayName || '').toLowerCase() === needle)
        || people.find((u) => (u.displayName || '').toLowerCase().includes(needle));
      if (person) {
        draft.assignees.push(person.id);
        draft.assigneeNames.push(person.displayName || '');
      } else {
        // Surfaced rather than dropped, so the model can say who it could
        // not place instead of quietly proposing an unassigned task.
        draft.unresolved.push(String(raw));
      }
    });
  }

  if (client) {
    const needle = String(client).trim().toLowerCase();
    const snap = await db.collection('clients').get();
    const match = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .find((c) => (c.name || '').toLowerCase() === needle)
      || snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .find((c) => (c.name || '').toLowerCase().includes(needle));
    if (match) {
      draft.clientId = match.id;
      draft.clientName = match.name || '';
    } else {
      draft.unresolved.push(String(client));
    }
  }

  return {
    kind: 'taskDraft',
    draft,
    note: 'هذه مسودة فقط — لم تُحفظ. ستُعرض على المستخدم في نموذج المهمة لمراجعتها وحفظها.'
  };
}

/* ------------------------------------------------------------ definitions */

function tool(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false }
  };
}

const DEFINITIONS = [
  tool('listEmployees', 'قائمة الموظفين النشطين مع مسمياتهم وأقسامهم.'),
  tool('getTeamWorkload', 'حِمل العمل لكل موظف: المهام المفتوحة وقيد التنفيذ والمتأخرة والمنجزة هذا الشهر.'),
  tool('getEmployeeReport', 'تقرير أداء موظف واحد خلال فترة.', {
    employee: { type: 'string', description: 'اسم الموظف أو معرّفه' },
    days: { type: 'number', description: 'عدد الأيام للخلف، الافتراضي 30' }
  }, ['employee']),
  tool('getStaleTasks', 'المهام المفتوحة غير المسندة أو التي لم تُحدَّث منذ فترة.', {
    days: { type: 'number' }, limit: { type: 'number' }
  }),
  tool('draftTask', 'اقترح مهمة جديدة (مسودة فقط، لا تُحفظ). استخدمها عندما يطلب المستخدم إنشاء مهمة.', {
    title: { type: 'string' },
    description: { type: 'string' },
    assignee: { type: 'string', description: 'اسم الموظف المقترح' },
    client: { type: 'string' },
    priority: { type: 'string', description: 'urgent | high | medium | low' },
    dueAt: { type: 'string', description: 'YYYY-MM-DD أو YYYY-MM-DDTHH:MM' },
    project: { type: 'string' }
  }, ['title'])
];

const IMPLEMENTATIONS = {
  listEmployees, getTeamWorkload, getEmployeeReport, getStaleTasks, draftTask
};

/** Dispatch. Unknown names are rejected rather than ignored. */
async function runTool(caller, name, args) {
  const implementation = IMPLEMENTATIONS[name];
  if (!implementation) throw new Error(`أداة غير معروفة: ${name}`);
  return implementation(caller, args || {});
}

module.exports = { DEFINITIONS, runTool, TOOL_NAMES: Object.keys(IMPLEMENTATIONS) };
