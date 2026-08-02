/**
 * Team panel — who is working, who is on a break, and what everyone is carrying.
 * Visible to every employee; the workload figures come from live task data.
 */

import { session } from './auth.js';
import { can, rolesLabel, JOB_ROLES, DEPARTMENTS } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, avatarWithPresence, avatarHTML, debounce
} from './utils/dom.js';
import { getDirectory } from './utils/api.js';
import { summarize, allTasksQuery, myTasksQuery, watchTasks } from './utils/task-model.js';
import { watchAllPresence, WORK_STATES } from './utils/presence.js';
import { formatDuration, timeAgo } from './utils/format.js';

export async function render(container) {
  const unsubs = [];
  const canSeeAll = can(session.claims, 'dashboard.viewCompany') || can(session.claims, 'tasks.editAll');

  let statuses = {};
  let byAssignee = {};
  let filters = { search: '', department: 'all', role: 'all', state: 'all' };

  const directory = (await getDirectory().catch(() => [])).filter((u) => u.status !== 'disabled');

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">الفريق</div>
          <div class="page-head__sub" id="team-count">…</div>
        </div>
        <div class="page-head__actions">
          ${can(session.claims, 'employees.view')
            ? '<a class="btn btn--secondary" href="#/employees"><i data-lucide="id-card"></i> إدارة الموظفين</a>' : ''}
          <a class="btn btn--primary" href="#/chat"><i data-lucide="message-circle"></i> الدردشة</a>
        </div>
      </div>

      <div class="grid grid-4 mb-4" id="team-stats"></div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
        <input class="input" id="f-search" type="search" placeholder="ابحث عن زميل…">
        <select class="select" id="f-dept">
          <option value="all">كل الأقسام</option>
          ${Object.entries(DEPARTMENTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
        <select class="select" id="f-role">
          <option value="all">كل المسميات</option>
          ${Object.entries(JOB_ROLES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
        <select class="select" id="f-state">
          <option value="all">كل الحالات</option>
          ${Object.entries(WORK_STATES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
      </div>

      <div id="team-grid">${'<div class="skeleton skeleton--card"></div>'.repeat(6)}</div>
    </div>`;

  refreshIcons(container);

  const applyFilters = () => {
    filters = {
      search: $('#f-search').value.trim().toLowerCase(),
      department: $('#f-dept').value,
      role: $('#f-role').value,
      state: $('#f-state').value
    };
    paint();
  };
  $('#f-search').addEventListener('input', debounce(applyFilters, 200));
  ['#f-dept', '#f-role', '#f-state'].forEach((s) => $(s).addEventListener('change', applyFilters));

  unsubs.push(watchAllPresence((value) => { statuses = value; paint(); }));

  unsubs.push(watchTasks(
    canSeeAll ? allTasksQuery() : myTasksQuery(session.uid),
    (rows) => {
      byAssignee = summarize(rows.filter((t) => !t.deleted)).byAssignee;
      paint();
    },
    () => {}
  ));

  function paint() {
    const rows = directory.filter((u) => {
      const state = statuses[u.id]?.state || 'offline';
      if (filters.search && !u.displayName.toLowerCase().includes(filters.search)) return false;
      if (filters.department !== 'all' && u.department !== filters.department) return false;
      if (filters.role !== 'all' && !(u.roles || []).includes(filters.role)) return false;
      if (filters.state !== 'all' && state !== filters.state) return false;
      return true;
    });

    $('#team-count').textContent = `${rows.length} من ${directory.length} عضواً`;

    const counts = { working: 0, break: 0, online: 0, offline: 0 };
    directory.forEach((u) => {
      const state = statuses[u.id]?.state || 'offline';
      counts[state] = (counts[state] || 0) + 1;
    });

    $('#team-stats').innerHTML = `
      ${stat('activity', 'success', counts.working, 'يعملون الآن')}
      ${stat('coffee', 'warning', counts.break, 'في استراحة')}
      ${stat('circle', 'info', counts.online, 'متصلون')}
      ${stat('moon', '', counts.offline, 'غير متصلين')}`;
    refreshIcons($('#team-stats'));

    const host = $('#team-grid');
    if (!rows.length) {
      mount(host, emptyState({ icon: 'users', title: 'لا نتائج مطابقة' }));
      return;
    }

    const rank = { working: 0, break: 1, online: 2, offline: 3 };
    const sorted = [...rows].sort((a, b) =>
      rank[statuses[a.id]?.state || 'offline'] - rank[statuses[b.id]?.state || 'offline']);

    host.innerHTML = `<div class="grid grid-auto">${sorted.map((u) => {
      const state = statuses[u.id]?.state || 'offline';
      const meta = WORK_STATES[state];
      const load = byAssignee[u.id] || { total: 0, completed: 0, open: 0, overdue: 0 };
      const rate = load.total ? Math.round((load.completed / load.total) * 100) : 0;
      const breakStart = statuses[u.id]?.breakStartedAt;

      return `
        <article class="card">
          <div class="flex gap-3 items-start">
            ${avatarWithPresence(u, state, 'lg')}
            <div class="flex-1" style="min-width:0">
              <a class="fw-700 truncate" href="#/employees/${attr(u.id)}"
                 style="color:inherit;display:block">${esc(u.displayName)}</a>
              <div class="fs-xs" style="color:${meta.color}">● ${esc(meta.ar)}
                ${state === 'break' && breakStart
                  ? `<span class="num text-muted">(${esc(formatDuration(Date.now() - breakStart))})</span>` : ''}
              </div>
              <div class="tag-list mt-2">
                ${(u.roles || []).slice(0, 2).map((r) => `
                  <span class="badge" style="color:${JOB_ROLES[r]?.color || 'inherit'}">
                    ${esc(JOB_ROLES[r]?.ar || r)}</span>`).join('')}
              </div>
            </div>
          </div>

          <div class="list-divider"></div>

          <div class="flex justify-between fs-xs text-muted mb-2">
            <span>حِمل العمل الحالي</span>
            <span class="num">${load.completed}/${load.total}</span>
          </div>
          <div class="progress"><div class="progress__bar${rate === 100 ? ' progress__bar--success' : ''}"
            style="width:${rate}%"></div></div>

          <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
            <span class="badge badge--info">${load.open} مفتوحة</span>
            ${load.overdue ? `<span class="badge badge--danger">${load.overdue} متأخرة</span>` : ''}
            <span class="badge badge--success">${load.completed} مكتملة</span>
          </div>

          <div class="flex gap-2 mt-3">
            <a class="btn btn--secondary btn--sm flex-1" href="#/employees/${attr(u.id)}">
              <i data-lucide="user"></i> الملف</a>
            ${u.id !== session.uid ? `
              <a class="btn btn--ghost btn--sm flex-1" href="#/chat?dm=${attr(u.id)}">
                <i data-lucide="message-circle"></i> مراسلة</a>` : ''}
          </div>
        </article>`;
    }).join('')}</div>`;
    refreshIcons(host);
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

function stat(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon${tone ? ` stat__icon--${attr(tone)}` : ''}">
        <i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num">${esc(value)}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}
