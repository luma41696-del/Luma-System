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
const day = 86_400_000;

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
    // Tagged so a client can tell a task proposal from a calendar one and
    // open the right form.
    kind: 'task',
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

/* ------------------------------------------------------------- calendar */

const EVENT_TYPES = ['meeting', 'deadline', 'task', 'leave', 'event', 'birthday'];

const asDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Calendar entries in a window.
 *
 * The admin SDK bypasses security rules, so the visibility test from
 * firestore.rules is repeated here by hand. Without it this tool would be a
 * way to read private events through the assistant that the same person is
 * refused when they ask the database directly.
 */
async function listCalendarEvents(caller, { from, to } = {}) {
  const start = asDate(from) || new Date();
  const end = asDate(to) || new Date(start.getTime() + 30 * day);

  const snap = await db.collection('calendarEvents')
    .orderBy('startAt', 'asc')
    .limit(500)
    .get();

  const seesEverything = has(caller, 'dashboard.viewCompany') || has(caller, 'dashboard.viewTeam');

  const events = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => {
      const at = asDate(e.startAt);
      return at && at >= start && at <= end;
    })
    .filter((e) => seesEverything
      || (e.visibility || 'team') === 'team'
      || (e.participants || []).includes(caller.uid)
      || e.createdBy === caller.uid)
    .slice(0, 100)
    .map((e) => ({
      id: e.id,
      title: e.title || '',
      type: e.type || 'event',
      startAt: asDate(e.startAt)?.toISOString() || null,
      endAt: asDate(e.endAt)?.toISOString() || null,
      location: e.location || null,
      client: e.clientName || null,
      participantCount: (e.participants || []).length
    }));

  return { from: start.toISOString(), to: end.toISOString(), count: events.length, events };
}

/**
 * Propose a calendar entry. A draft only — nothing is written.
 *
 * Same contract as draftTask: names are resolved to real ids server-side, and
 * the browser opens the ordinary event form for a person to confirm.
 */
async function draftEvent(caller, {
  title, type, startAt, endAt, participants, client, location, description, visibility
} = {}) {
  if (!title || String(title).trim().length < 3) throw new Error('عنوان الحدث مطلوب.');

  const start = asDate(startAt);
  if (!start) throw new Error('حدد تاريخ ووقت البداية بصيغة YYYY-MM-DDTHH:MM.');
  // An hour is the sensible default a person would pick, and it keeps the end
  // after the start without the model having to reason about it.
  const end = asDate(endAt) || new Date(start.getTime() + 3_600_000);

  const draft = {
    kind: 'event',
    title: String(title).trim().slice(0, 200),
    type: EVENT_TYPES.includes(type) ? type : 'event',
    // Matches the values the event form actually offers.
    visibility: ['team', 'participants'].includes(visibility) ? visibility : 'team',
    startAt: start.toISOString(),
    endAt: (end > start ? end : new Date(start.getTime() + 3_600_000)).toISOString(),
    location: String(location || '').trim().slice(0, 200),
    description: String(description || '').trim().slice(0, 2000),
    participants: [],
    participantNames: [],
    clientId: null,
    clientName: null,
    unresolved: []
  };

  if (participants) {
    const people = await activeEmployees();
    // The model is asked for a comma-separated list, so a single string of
    // several names has to be split or every name but the first is lost.
    const wanted = Array.isArray(participants)
      ? participants
      : String(participants).split(/[،,]/).map((s) => s.trim()).filter(Boolean);
    wanted.slice(0, 20).forEach((raw) => {
      const needle = String(raw).trim().toLowerCase();
      const person = people.find((u) => u.id === raw)
        || people.find((u) => (u.displayName || '').toLowerCase() === needle)
        || people.find((u) => (u.displayName || '').toLowerCase().includes(needle));
      if (person) {
        draft.participants.push(person.id);
        draft.participantNames.push(person.displayName || '');
      } else {
        draft.unresolved.push(String(raw));
      }
    });
  }

  if (client) {
    const needle = String(client).trim().toLowerCase();
    const rows = (await db.collection('clients').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const match = rows.find((c) => (c.name || '').toLowerCase() === needle)
      || rows.find((c) => (c.name || '').toLowerCase().includes(needle));
    if (match) {
      draft.clientId = match.id;
      draft.clientName = match.name || '';
    } else {
      draft.unresolved.push(String(client));
    }
  }

  return {
    kind: 'eventDraft',
    draft,
    note: 'مسودة فقط — لم تُحفظ. ستُعرض على المستخدم في نموذج الحدث لمراجعتها وحفظها.'
  };
}

/* ----------------------------------------------------------- knowledge */

/**
 * Propose a note for the knowledge base. A draft only — nothing is written.
 *
 * This is the tool the model reaches for after searching the web, which makes
 * it the one place untrusted text could turn into a stored record. It stays a
 * proposal precisely because of that: a person reads the note and its sources
 * before it becomes part of the agency's own material.
 */
async function draftNote(caller, { title, content, tags, sources, client } = {}) {
  ensure(caller, 'knowledge.manage');
  if (!title || String(title).trim().length < 3) throw new Error('عنوان الملاحظة مطلوب.');
  if (!content || String(content).trim().length < 20) {
    throw new Error('محتوى الملاحظة قصير جداً — لخّص ما وجدته أولاً.');
  }

  const draft = {
    kind: 'note',
    title: String(title).trim().slice(0, 200),
    content: String(content).trim().slice(0, 8000),
    tags: String(tags || '')
      .split(/[،,]/).map((t) => t.trim()).filter(Boolean).slice(0, 8),
    // Only http(s) survives: a note is rendered as links, and `javascript:`
    // reaching that markup would be a stored XSS.
    sources: String(sources || '')
      .split(/[\s,،]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 12),
    clientId: null,
    clientName: null,
    unresolved: []
  };

  if (client) {
    const needle = String(client).trim().toLowerCase();
    const rows = (await db.collection('clients').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const match = rows.find((c) => (c.name || '').toLowerCase() === needle)
      || rows.find((c) => (c.name || '').toLowerCase().includes(needle));
    if (match) {
      draft.clientId = match.id;
      draft.clientName = match.name || '';
    } else {
      draft.unresolved.push(String(client));
    }
  }

  return {
    kind: 'noteDraft',
    draft,
    note: 'مسودة فقط — لم تُحفظ. ستُعرض على المستخدم لمراجعتها وحفظها.'
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
  }, ['title']),
  tool('listCalendarEvents', 'الأحداث المسجّلة في التقويم خلال فترة.', {
    from: { type: 'string', description: 'YYYY-MM-DD' },
    to: { type: 'string', description: 'YYYY-MM-DD' }
  }),
  tool('draftEvent',
    'اقترح حدثاً في التقويم (مسودة فقط، لا يُحفظ): اجتماع، موعد تسليم، مهمة، إجازة، حدث، أو عيد ميلاد.', {
      title: { type: 'string' },
      type: { type: 'string', description: 'meeting | deadline | task | leave | event | birthday' },
      startAt: { type: 'string', description: 'YYYY-MM-DDTHH:MM' },
      endAt: { type: 'string', description: 'YYYY-MM-DDTHH:MM — اختياري، الافتراضي ساعة واحدة' },
      participants: { type: 'string', description: 'أسماء المشاركين مفصولة بفاصلة' },
      client: { type: 'string' },
      location: { type: 'string' },
      description: { type: 'string' },
      visibility: { type: 'string', description: 'team | private' }
    }, ['title', 'startAt']),
  tool('draftNote',
    'احفظ ما توصلت إليه كملاحظة في قاعدة المعرفة (مسودة فقط، لا تُحفظ). استخدمها بعد البحث والتحليل.', {
      title: { type: 'string' },
      content: { type: 'string', description: 'الخلاصة والتحليل بصيغة نقاط' },
      tags: { type: 'string', description: 'وسوم مفصولة بفاصلة' },
      sources: { type: 'string', description: 'روابط المصادر مفصولة بمسافة أو فاصلة' },
      client: { type: 'string', description: 'اسم العميل إن كانت الملاحظة تخصّه' }
    }, ['title', 'content'])
];

const IMPLEMENTATIONS = {
  listEmployees, getTeamWorkload, getEmployeeReport, getStaleTasks, draftTask,
  listCalendarEvents, draftEvent, draftNote
};

/** Dispatch. Unknown names are rejected rather than ignored. */
async function runTool(caller, name, args) {
  const implementation = IMPLEMENTATIONS[name];
  if (!implementation) throw new Error(`أداة غير معروفة: ${name}`);
  return implementation(caller, args || {});
}

module.exports = { DEFINITIONS, runTool, TOOL_NAMES: Object.keys(IMPLEMENTATIONS) };
