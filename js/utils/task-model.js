/**
 * Task domain model — statuses, priorities, queries and derived statistics.
 * Shared by tasks.js, dashboard.js, reports.js, calendar.js and the profiles,
 * so the same definition of "overdue" or "completed" is used everywhere.
 */

import {
  col, query, where, orderBy, limit as qLimit, getMany, onSnapshot
} from './api.js';
import { toMillis, dayKey, startOfWeek, startOfMonth, startOfYear, isToday } from './format.js';

export const TASK_STATUSES = {
  new:        { ar: 'جديدة',        color: 'var(--gray)',    badge: '',        icon: 'circle-dashed' },
  assigned:   { ar: 'مُسندة',       color: 'var(--info)',    badge: 'info',    icon: 'user-check' },
  inprogress: { ar: 'قيد التنفيذ',  color: 'var(--yellow)',  badge: 'brand',   icon: 'loader' },
  waiting:    { ar: 'بانتظار',      color: 'var(--purple)',  badge: 'purple',  icon: 'pause-circle' },
  review:     { ar: 'قيد المراجعة', color: 'var(--accent-6)', badge: 'warning', icon: 'eye' },
  completed:  { ar: 'مكتملة',       color: 'var(--success)', badge: 'success', icon: 'check-circle-2' },
  cancelled:  { ar: 'ملغاة',        color: 'var(--gray)',    badge: '',        icon: 'x-circle' }
};

/**
 * Board column order (overdue is derived, not stored).
 * Completed leads the board so finished work is the first thing on screen.
 */
export const BOARD_COLUMNS = ['completed', 'new', 'assigned', 'inprogress', 'waiting', 'review'];

export const PRIORITIES = {
  urgent: { ar: 'عاجلة',  color: 'var(--danger)',  badge: 'danger',  weight: 4 },
  high:   { ar: 'مرتفعة', color: 'var(--warning)', badge: 'warning', weight: 3 },
  medium: { ar: 'متوسطة', color: 'var(--info)',    badge: 'info',    weight: 2 },
  low:    { ar: 'منخفضة', color: 'var(--gray)',    badge: '',        weight: 1 }
};

export const OPEN_STATUSES = ['new', 'assigned', 'inprogress', 'waiting', 'review'];

export function statusLabel(status) { return TASK_STATUSES[status]?.ar || status; }
export function priorityLabel(priority) { return PRIORITIES[priority]?.ar || priority; }

/** Overdue = has a deadline in the past and is neither completed nor cancelled. */
export function isOverdue(task) {
  if (!task?.dueAt) return false;
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return toMillis(task.dueAt) < Date.now();
}

export function isDueToday(task) {
  return !!task?.dueAt && isToday(task.dueAt) &&
    task.status !== 'completed' && task.status !== 'cancelled';
}

export function isOpen(task) {
  return OPEN_STATUSES.includes(task?.status);
}

/** Effective status used for display — folds "overdue" into the status chip. */
export function effectiveStatus(task) {
  return isOverdue(task) ? 'overdue' : task.status;
}

export function progressOf(task) {
  if (task.status === 'completed') return 100;
  if (typeof task.progress === 'number') return Math.max(0, Math.min(100, task.progress));
  const list = task.checklist || [];
  if (list.length) return Math.round((list.filter((i) => i.done).length / list.length) * 100);
  return { new: 0, assigned: 10, inprogress: 45, waiting: 45, review: 80 }[task.status] || 0;
}

/* ----------------------------------------------------------------- queries */

/** Tasks assigned to one employee. */
export function myTasksQuery(uid, max = 200) {
  return query(col('tasks'), where('assignees', 'array-contains', uid),
    orderBy('dueAt', 'asc'), qLimit(max));
}

/** Every task in the company (needs dashboard.viewCompany / tasks.editAll). */
export function allTasksQuery(max = 400) {
  return query(col('tasks'), orderBy('createdAt', 'desc'), qLimit(max));
}

export function clientTasksQuery(clientId, max = 200) {
  return query(col('tasks'), where('clientId', '==', clientId),
    orderBy('createdAt', 'desc'), qLimit(max));
}

export async function fetchMyTasks(uid) {
  return getMany(myTasksQuery(uid));
}

export async function fetchAllTasks() {
  return getMany(allTasksQuery());
}

export function watchTasks(q, onData, onError) {
  return onSnapshot(q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.warn('[luma] tasks listener', err.code); onError?.(err); });
}

/* -------------------------------------------------------------- statistics */

/**
 * Compute the numbers every dashboard, profile and report needs from a plain
 * array of task documents — one pass, no extra reads.
 */
export function summarize(tasks = [], { uid = null } = {}) {
  const today = dayKey();
  const weekStart = startOfWeek().getTime();
  const monthStart = startOfMonth().getTime();
  const yearStart = startOfYear().getTime();

  const stats = {
    total: tasks.length,
    completed: 0, completedToday: 0, completedWeek: 0, completedMonth: 0, completedYear: 0,
    open: 0, overdue: 0, dueToday: 0, inProgress: 0, review: 0, cancelled: 0,
    byStatus: {}, byPriority: {}, byClient: {}, byAssignee: {},
    totalTimeMs: 0, completionTimes: []
  };

  for (const status of Object.keys(TASK_STATUSES)) stats.byStatus[status] = 0;
  for (const priority of Object.keys(PRIORITIES)) stats.byPriority[priority] = 0;

  for (const task of tasks) {
    if (uid && !(task.assignees || []).includes(uid)) continue;

    stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
    stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;
    stats.totalTimeMs += task.timeSpentMs || 0;

    if (task.clientId) {
      stats.byClient[task.clientId] ??= { name: task.clientName || '—', total: 0, completed: 0 };
      stats.byClient[task.clientId].total++;
    }
    for (const assignee of task.assignees || []) {
      stats.byAssignee[assignee] ??= { total: 0, completed: 0, overdue: 0, open: 0 };
      stats.byAssignee[assignee].total++;
    }

    if (task.status === 'completed') {
      stats.completed++;
      const done = toMillis(task.completedAt);
      if (done) {
        if (dayKey(done) === today) stats.completedToday++;
        if (done >= weekStart) stats.completedWeek++;
        if (done >= monthStart) stats.completedMonth++;
        if (done >= yearStart) stats.completedYear++;
        const started = toMillis(task.startedAt) || toMillis(task.createdAt);
        if (started && done > started) stats.completionTimes.push(done - started);
      }
      if (task.clientId) stats.byClient[task.clientId].completed++;
      for (const assignee of task.assignees || []) stats.byAssignee[assignee].completed++;
    } else if (task.status === 'cancelled') {
      stats.cancelled++;
    } else {
      stats.open++;
      for (const assignee of task.assignees || []) stats.byAssignee[assignee].open++;
      if (task.status === 'inprogress') stats.inProgress++;
      if (task.status === 'review') stats.review++;
      if (isOverdue(task)) {
        stats.overdue++;
        for (const assignee of task.assignees || []) stats.byAssignee[assignee].overdue++;
      }
      if (isDueToday(task)) stats.dueToday++;
    }
  }

  const closable = stats.completed + stats.open;
  stats.completionRate = closable ? Math.round((stats.completed / closable) * 100) : 0;
  stats.avgCompletionMs = stats.completionTimes.length
    ? Math.round(stats.completionTimes.reduce((a, b) => a + b, 0) / stats.completionTimes.length)
    : 0;

  return stats;
}

/** Completed-per-day series for the productivity chart. */
export function dailySeries(tasks, days = 7) {
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    buckets.push({ key: dayKey(date), date, completed: 0, created: 0 });
  }
  const index = Object.fromEntries(buckets.map((b) => [b.key, b]));

  for (const task of tasks) {
    const created = toMillis(task.createdAt);
    if (created && index[dayKey(created)]) index[dayKey(created)].created++;
    if (task.status === 'completed') {
      const done = toMillis(task.completedAt);
      if (done && index[dayKey(done)]) index[dayKey(done)].completed++;
    }
  }
  return buckets;
}

/** Monthly series across the current year. */
export function monthlySeries(tasks) {
  const months = Array.from({ length: 12 }, () => ({ completed: 0, created: 0 }));
  const year = new Date().getFullYear();
  for (const task of tasks) {
    const created = new Date(toMillis(task.createdAt));
    if (created.getFullYear() === year) months[created.getMonth()].created++;
    if (task.status === 'completed') {
      const done = new Date(toMillis(task.completedAt));
      if (done.getFullYear() === year) months[done.getMonth()].completed++;
    }
  }
  return months;
}

/** Sort helper: urgent + soonest deadline first, completed last. */
export function sortTasks(tasks, mode = 'smart') {
  const copy = [...tasks];
  if (mode === 'due') return copy.sort((a, b) => (toMillis(a.dueAt) || 8e15) - (toMillis(b.dueAt) || 8e15));
  if (mode === 'created') return copy.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  if (mode === 'priority') {
    return copy.sort((a, b) => (PRIORITIES[b.priority]?.weight || 0) - (PRIORITIES[a.priority]?.weight || 0));
  }
  return copy.sort((a, b) => {
    const aDone = a.status === 'completed' || a.status === 'cancelled';
    const bDone = b.status === 'completed' || b.status === 'cancelled';
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aOver = isOverdue(a), bOver = isOverdue(b);
    if (aOver !== bOver) return aOver ? -1 : 1;
    const weight = (PRIORITIES[b.priority]?.weight || 0) - (PRIORITIES[a.priority]?.weight || 0);
    if (weight) return weight;
    return (toMillis(a.dueAt) || 8e15) - (toMillis(b.dueAt) || 8e15);
  });
}

/** Apply the filter bar. */
export function filterTasks(tasks, filters = {}) {
  return tasks.filter((task) => {
    if (filters.status && filters.status !== 'all') {
      if (filters.status === 'overdue') { if (!isOverdue(task)) return false; }
      else if (filters.status === 'open') { if (!isOpen(task)) return false; }
      else if (task.status !== filters.status) return false;
    }
    if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.assignee && filters.assignee !== 'all' && !(task.assignees || []).includes(filters.assignee)) return false;
    if (filters.client && filters.client !== 'all' && task.clientId !== filters.client) return false;
    if (filters.creator && filters.creator !== 'all' && task.createdBy !== filters.creator) return false;
    if (filters.project && filters.project !== 'all' && task.project !== filters.project) return false;
    if (filters.role && filters.role !== 'all' && !(task.roleTags || []).includes(filters.role)) return false;
    if (filters.from && toMillis(task.dueAt) && toMillis(task.dueAt) < new Date(filters.from).getTime()) return false;
    if (filters.to && toMillis(task.dueAt) && toMillis(task.dueAt) > new Date(filters.to).getTime() + 86_399_000) return false;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      const haystack = `${task.title} ${task.description || ''} ${task.clientName || ''} ${task.project || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}
