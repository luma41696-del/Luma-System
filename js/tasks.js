/**
 * Tasks: list / kanban / table / calendar views, task detail, and the create
 * & edit modal. Route `/my-tasks` scopes to the signed-in user, `/tasks` shows
 * everything the viewer is allowed to read.
 */

import { session } from './auth.js';
import { can, JOB_ROLES } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, avatarHTML, avatarStack, emptyState, debounce, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog, promptDialog, lightbox } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, getOne, getMany, getUsers,
  getDirectory, addDoc, updateDoc, deleteDoc, setDoc, doc, ts, callFn, arrayUnion
} from './utils/api.js';
import {
  TASK_STATUSES, PRIORITIES, BOARD_COLUMNS, summarize, sortTasks, filterTasks,
  isOverdue, progressOf, statusLabel, priorityLabel, myTasksQuery, allTasksQuery,
  watchTasks
} from './utils/task-model.js';
import {
  formatDate, formatDateTime, formatDuration, timeAgo, toMillis, toDateTimeInput, formatBytes,
  dayKey
} from './utils/format.js';
import { sanitizeText, sanitizeMultiline, renderMessageBody } from './utils/sanitize.js';
import { uploadFile, pickFiles, paths, deleteFile } from './utils/upload.js';
import { uploadsEnabled, UPLOADS_DISABLED_MSG } from './features.js';

const VIEW_KEY = 'luma.taskView';

/* ========================================================================== */
/* Route entry                                                                */
/* ========================================================================== */

export async function render(container, ctx) {
  if (ctx.params.id) return renderDetail(container, ctx.params.id);
  return renderBoard(container, ctx);
}

/* ========================================================================== */
/* Board / list                                                               */
/* ========================================================================== */

async function renderBoard(container, ctx) {
  const scopeMine = ctx.path === '/my-tasks';
  const canSeeAll = can(session.claims, 'tasks.editAll') || can(session.claims, 'dashboard.viewCompany');
  const unsubs = [];

  let tasks = [];
  let view = localStorage.getItem(VIEW_KEY) || 'list';
  let filters = {
    status: ctx.query.status || 'all',
    priority: 'all',
    assignee: 'all',
    client: 'all',
    search: ''
  };

  const [directory, clients] = await Promise.all([
    getDirectory().catch(() => []),
    can(session.claims, 'clients.view')
      ? getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
      : Promise.resolve([])
  ]);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">${scopeMine ? 'مهامي' : 'كل المهام'}</div>
          <div class="page-head__sub" id="task-count">…</div>
        </div>
        <div class="page-head__actions">
          <div class="btn-group" id="view-switch">
            <button data-view="list" title="قائمة"><i data-lucide="list"></i> قائمة</button>
            <button data-view="board" title="لوحة"><i data-lucide="columns-3"></i> لوحة</button>
            <button data-view="table" title="جدول"><i data-lucide="table"></i> جدول</button>
          </div>
          ${!scopeMine && canSeeAll ? '' : `<a class="btn btn--ghost" href="#/tasks">كل المهام</a>`}
          <button class="btn btn--primary" id="new-task"><i data-lucide="plus"></i> مهمة جديدة</button>
        </div>
      </div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
        <input class="input" id="f-search" type="search" placeholder="بحث في العنوان أو الوصف…">
        <select class="select" id="f-status">
          <option value="all">كل الحالات</option>
          <option value="open">المفتوحة</option>
          <option value="overdue">المتأخرة</option>
          ${Object.entries(TASK_STATUSES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
        <select class="select" id="f-priority">
          <option value="all">كل الأولويات</option>
          ${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
        ${!scopeMine ? `
          <select class="select" id="f-assignee">
            <option value="all">كل الموظفين</option>
            ${directory.map((u) => `<option value="${attr(u.id)}">${esc(u.displayName)}</option>`).join('')}
          </select>` : ''}
        ${clients.length ? `
          <select class="select" id="f-client">
            <option value="all">كل العملاء</option>
            ${clients.map((c) => `<option value="${attr(c.id)}">${esc(c.name)}</option>`).join('')}
          </select>` : ''}
        <button class="btn btn--ghost btn--sm" id="f-reset"><i data-lucide="rotate-ccw"></i> إعادة تعيين</button>
      </div>

      <div class="grid grid-4 mb-4" id="task-stats"></div>
      <div id="task-view">${'<div class="skeleton skeleton--row"></div>'.repeat(5)}</div>
    </div>`;

  refreshIcons(container);

  $('#new-task').addEventListener('click', () => openTaskModal({ personal: !can(session.claims, 'tasks.create') }));

  /* --------------------------------------------------------- filters */
  const applyFilters = () => {
    filters.search = $('#f-search').value.trim();
    filters.status = $('#f-status').value;
    filters.priority = $('#f-priority').value;
    filters.assignee = $('#f-assignee')?.value || 'all';
    filters.client = $('#f-client')?.value || 'all';
    paint();
  };
  $('#f-search').addEventListener('input', debounce(applyFilters, 250));
  ['#f-status', '#f-priority', '#f-assignee', '#f-client'].forEach((sel) => {
    $(sel)?.addEventListener('change', applyFilters);
  });
  $('#f-status').value = filters.status;
  $('#f-reset').addEventListener('click', () => {
    $('#f-search').value = '';
    $('#f-status').value = 'all';
    $('#f-priority').value = 'all';
    if ($('#f-assignee')) $('#f-assignee').value = 'all';
    if ($('#f-client')) $('#f-client').value = 'all';
    applyFilters();
  });

  /* ------------------------------------------------------ view switch */
  const syncViewButtons = () => {
    $$('#view-switch button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  };
  syncViewButtons();
  $('#view-switch').addEventListener('click', (e) => {
    const button = e.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    localStorage.setItem(VIEW_KEY, view);
    syncViewButtons();
    paint();
  });

  /* ----------------------------------------------------------- data */
  const q = scopeMine || !canSeeAll ? myTasksQuery(session.uid) : allTasksQuery();
  unsubs.push(watchTasks(q, (rows) => {
    tasks = rows.filter((t) => !t.deleted);
    paint();
  }, (err) => {
    mount($('#task-view'), `<div class="card">${esc(err.message)}</div>`);
  }));

  function paint() {
    const filtered = filterTasks(tasks, filters);
    const stats = summarize(filtered);

    $('#task-count').textContent =
      `${filtered.length} مهمة معروضة من أصل ${tasks.length}`;

    $('#task-stats').innerHTML = `
      ${statChip('list-todo', 'info', stats.open, 'مفتوحة')}
      ${statChip('loader', 'brand', stats.inProgress, 'قيد التنفيذ')}
      ${statChip('check-circle-2', 'success', stats.completed, 'مكتملة')}
      ${statChip('alert-triangle', 'danger', stats.overdue, 'متأخرة')}`;
    refreshIcons($('#task-stats'));

    const host = $('#task-view');
    if (!filtered.length) {
      mount(host, emptyState({
        icon: 'clipboard-list',
        title: 'لا توجد مهام',
        text: 'لم يتم العثور على مهام مطابقة للتصفية الحالية.',
        action: '<button class="btn btn--primary" onclick="document.getElementById(\'new-task\').click()">إنشاء مهمة</button>'
      }));
      return;
    }

    if (view === 'board') renderKanban(host, filtered, people);
    else if (view === 'table') renderTable(host, filtered, people);
    else renderList(host, filtered, people);
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

function statChip(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num">${value}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------- list view */

/**
 * Tasks created today are shown in their own group above the rest, so what
 * landed today is obvious at a glance instead of being sorted in among older
 * work. `dayKey` is timezone-aware (Asia/Amman), so "today" means the office's
 * today, not the device's.
 */
function renderList(host, tasks, people) {
  const sorted = sortTasks(tasks);
  const today = dayKey();
  const isToday = (t) => t.createdAt && dayKey(toMillis(t.createdAt)) === today;

  const todays = sorted.filter(isToday);
  const earlier = sorted.filter((t) => !isToday(t));

  const group = (label, icon, items, extraClass = '') => `
    <section class="task-group ${extraClass}">
      <header class="task-group__head">
        <i data-lucide="${attr(icon)}"></i>
        <span class="task-group__title">${esc(label)}</span>
        <span class="task-group__count num">${items.length}</span>
      </header>
      <div class="grid grid-auto">${items.map((t) => taskCard(t, people)).join('')}</div>
    </section>`;

  // With nothing new today, a lone "earlier" heading is just noise.
  host.innerHTML = todays.length
    ? group('مهام اليوم', 'sparkles', todays, 'task-group--today') +
      (earlier.length ? group('مهام سابقة', 'history', earlier) : '')
    : `<div class="grid grid-auto">${earlier.map((t) => taskCard(t, people)).join('')}</div>`;

  refreshIcons(host);
  bindCards(host);
}

function taskCard(task, people) {
  const status = TASK_STATUSES[task.status] || {};
  const overdue = isOverdue(task);
  const progress = progressOf(task);
  const assignees = (task.assignees || []).map((id) => people[id]).filter(Boolean);

  return `
    <article class="task-card${overdue ? ' is-overdue' : ''}" data-priority="${attr(task.priority)}"
             data-task="${attr(task.id)}" tabindex="0">
      <div class="task-card__top">
        <div class="flex-1">
          <div class="task-card__title clamp-2">${esc(task.title)}</div>
          ${task.clientName ? `<div class="fs-xs text-muted mt-2"><i data-lucide="briefcase" class="icon-sm"></i> ${esc(task.clientName)}</div>` : ''}
        </div>
        <span class="badge badge--${attr(overdue ? 'danger' : status.badge || '')}">
          ${esc(overdue ? 'متأخرة' : status.ar || '')}
        </span>
      </div>

      ${task.description ? `<div class="fs-sm text-muted clamp-2">${esc(task.description)}</div>` : ''}

      <div class="progress"><div class="progress__bar${progress === 100 ? ' progress__bar--success' : ''}"
        style="width:${progress}%"></div></div>

      <div class="task-card__meta">
        ${task.dueAt ? `<span><i data-lucide="calendar" class="icon-sm"></i> ${esc(formatDate(task.dueAt, { short: true }))}</span>` : ''}
        <span><i data-lucide="flag" class="icon-sm"></i> ${esc(priorityLabel(task.priority))}</span>
        ${task.checklist?.length ? `<span><i data-lucide="check-square" class="icon-sm"></i>
          ${task.checklist.filter((i) => i.done).length}/${task.checklist.length}</span>` : ''}
        ${task.commentCount ? `<span><i data-lucide="message-square" class="icon-sm"></i> ${task.commentCount}</span>` : ''}
        ${task.attachments?.length ? `<span><i data-lucide="paperclip" class="icon-sm"></i> ${task.attachments.length}</span>` : ''}
      </div>

      <div class="task-card__foot">
        ${avatarStack(assignees, 3)}
        <span class="fs-2xs text-muted">${esc(timeAgo(task.updatedAt || task.createdAt))}</span>
      </div>
    </article>`;
}

function bindCards(host) {
  on(host, 'click', '[data-task]', (e, node) => {
    if (e.target.closest('button')) return;
    location.hash = `#/tasks/${node.dataset.task}`;
  });
  on(host, 'keydown', '[data-task]', (e, node) => {
    if (e.key === 'Enter') location.hash = `#/tasks/${node.dataset.task}`;
  });
}

/* ------------------------------------------------------------ kanban view */

function renderKanban(host, tasks, people) {
  const columns = BOARD_COLUMNS.map((status) => ({
    status,
    meta: TASK_STATUSES[status],
    items: sortTasks(tasks.filter((t) => t.status === status))
  }));

  host.innerHTML = `<div class="kanban">${columns.map((c) => `
    <section class="kanban__col" data-col="${attr(c.status)}">
      <header class="kanban__head">
        <span class="kanban__title">
          <span style="width:9px;height:9px;border-radius:50%;background:${c.meta.color};display:inline-block"></span>
          ${esc(c.meta.ar)}
        </span>
        <span class="kanban__count">${c.items.length}</span>
      </header>
      <div class="kanban__list">${c.items.map((t) => taskCard(t, people)).join('')}</div>
    </section>`).join('')}</div>`;

  refreshIcons(host);
  bindCards(host);
  enableDragAndDrop(host);
}

function enableDragAndDrop(host) {
  let dragged = null;

  $$('.task-card', host).forEach((card) => {
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      dragged = card;
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      dragged = null;
    });
  });

  $$('.kanban__col', host).forEach((column) => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('is-drop-target');
    });
    column.addEventListener('dragleave', () => column.classList.remove('is-drop-target'));
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('is-drop-target');
      if (!dragged) return;
      const taskId = dragged.dataset.task;
      const status = column.dataset.col;
      try {
        await changeStatus(taskId, status);
        toastSuccess(`تم نقل المهمة إلى «${statusLabel(status)}».`);
      } catch (err) {
        reportError(err, 'kanban-drop');
      }
    });
  });
}

/* ------------------------------------------------------------- table view */

function renderTable(host, tasks, people) {
  const sorted = sortTasks(tasks);
  host.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>المهمة</th><th>العميل</th><th>المسؤولون</th>
            <th>الأولوية</th><th>الحالة</th><th>الموعد</th><th>التقدم</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((t) => {
            const status = TASK_STATUSES[t.status] || {};
            const overdue = isOverdue(t);
            const progress = progressOf(t);
            const assignees = (t.assignees || []).map((id) => people[id]).filter(Boolean);
            return `
              <tr data-task="${attr(t.id)}" style="cursor:pointer">
                <td class="is-strong">${esc(t.title)}</td>
                <td>${esc(t.clientName || '—')}</td>
                <td>${avatarStack(assignees, 3)}</td>
                <td><span class="badge badge--${attr(PRIORITIES[t.priority]?.badge || '')}">
                  ${esc(priorityLabel(t.priority))}</span></td>
                <td><span class="badge badge--${attr(overdue ? 'danger' : status.badge || '')}">
                  ${esc(overdue ? 'متأخرة' : status.ar || '')}</span></td>
                <td class="num">${t.dueAt ? esc(formatDate(t.dueAt, { short: true })) : '—'}</td>
                <td style="min-width:120px">
                  <div class="progress"><div class="progress__bar" style="width:${progress}%"></div></div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  refreshIcons(host);
  bindCards(host);
}

/* ========================================================================== */
/* Task detail                                                                */
/* ========================================================================== */

async function renderDetail(container, taskId) {
  const unsubs = [];
  // paintDetail subscribes to comments and activity, and it runs again on every
  // change to the task document. Its listeners live in their own bucket that is
  // torn down before each repaint, so they cannot stack up.
  const paintUnsubs = [];

  container.innerHTML = `<div class="page__inner" id="task-detail">
    <div class="skeleton skeleton--title"></div>
    <div class="skeleton" style="height:300px;border-radius:var(--radius-lg)"></div>
  </div>`;

  const root = $('#task-detail', container);

  unsubs.push(onSnapshot(ref('tasks', taskId), async (snap) => {
    if (!snap.exists()) {
      mount(root, emptyState({ icon: 'file-x', title: 'المهمة غير موجودة', text: 'ربما تم حذفها.' }));
      return;
    }
    paintUnsubs.forEach((fn) => { try { fn(); } catch {} });
    paintUnsubs.length = 0;

    const task = { id: snap.id, ...snap.data() };
    await paintDetail(root, task, paintUnsubs);
  }, (err) => {
    mount(root, emptyState({ icon: 'shield-alert', title: 'لا تملك صلاحية عرض هذه المهمة', text: err.message }));
  }));

  return () => [...unsubs, ...paintUnsubs].forEach((fn) => { try { fn(); } catch {} });
}

async function paintDetail(root, task, unsubs) {
  const assignees = await getUsers(task.assignees || []);
  const creator = await getUsers([task.createdBy]).then((r) => r[0]);
  const status = TASK_STATUSES[task.status] || {};
  const overdue = isOverdue(task);
  const progress = progressOf(task);

  const isAssignee = (task.assignees || []).includes(session.uid);
  const canEdit = can(session.claims, 'tasks.editAll') || task.createdBy === session.uid;
  const canWork = canEdit || isAssignee;

  root.innerHTML = `
    <div class="page-head">
      <div class="flex-1" style="min-width:0">
        <div class="flex items-center gap-3 mb-3" style="flex-wrap:wrap">
          <span class="badge badge--${attr(overdue ? 'danger' : status.badge || '')}">
            <span class="badge__dot"></span>${esc(overdue ? 'متأخرة' : status.ar || '')}
          </span>
          <span class="badge badge--${attr(PRIORITIES[task.priority]?.badge || '')}">
            ${esc(priorityLabel(task.priority))}
          </span>
          ${task.isPersonal ? '<span class="badge">مهمة شخصية</span>' : ''}
        </div>
        <h1 class="page-head__title">${esc(task.title)}</h1>
        <div class="page-head__sub">
          أنشأها ${esc(creator?.displayName || '—')} · ${esc(timeAgo(task.createdAt))}
        </div>
      </div>
      <div class="page-head__actions">
        <a class="btn btn--ghost" href="#/my-tasks"><i data-lucide="arrow-right"></i> رجوع</a>
        ${canWork ? `<button class="btn btn--secondary" id="btn-status"><i data-lucide="refresh-cw"></i> تغيير الحالة</button>` : ''}
        ${canEdit ? `<button class="btn btn--secondary" id="btn-edit"><i data-lucide="pencil"></i> تعديل</button>` : ''}
        ${can(session.claims, 'tasks.delete') ? `<button class="btn btn--outline-danger btn--icon" id="btn-delete" title="حذف"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
    </div>

    <div class="grid grid-main">
      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="align-right"></i> الوصف</div></div>
          <div class="fs-md" style="white-space:pre-wrap;line-height:1.9">
            ${task.description ? esc(task.description) : '<span class="text-muted">لا يوجد وصف.</span>'}
          </div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="check-square"></i> قائمة التحقق</div>
            ${canWork ? '<button class="btn btn--ghost btn--sm" id="add-check"><i data-lucide="plus"></i> إضافة بند</button>' : ''}
          </div>
          <div id="checklist"></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="paperclip"></i> المرفقات</div>
            ${canWork && uploadsEnabled()
              ? '<button class="btn btn--ghost btn--sm" id="add-file"><i data-lucide="upload"></i> رفع ملف</button>'
              : `<span class="fs-2xs text-muted">${esc(UPLOADS_DISABLED_MSG)}</span>`}
          </div>
          <div id="attachments"></div>
        </div>

        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="message-square"></i> التعليقات</div></div>
          <div id="comments">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
          <div class="list-divider"></div>
          <div class="chat-composer">
            <textarea class="textarea" id="comment-input" rows="2" placeholder="اكتب تعليقاً…"></textarea>
            <button class="btn btn--primary btn--icon" id="comment-send" aria-label="إرسال">
              <i data-lucide="send"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="info"></i> التفاصيل</div></div>
          <div class="kv"><span class="kv__k">التقدم</span><span class="kv__v num">${progress}%</span></div>
          <div class="progress mb-3"><div class="progress__bar${progress === 100 ? ' progress__bar--success' : ''}" style="width:${progress}%"></div></div>
          <div class="kv"><span class="kv__k">العميل</span><span class="kv__v">
            ${task.clientId ? `<a href="#/clients/${attr(task.clientId)}">${esc(task.clientName || '—')}</a>` : '—'}
          </span></div>
          <div class="kv"><span class="kv__k">المشروع</span><span class="kv__v">${esc(task.project || '—')}</span></div>
          <div class="kv"><span class="kv__k">تاريخ البدء</span><span class="kv__v">${esc(task.startedAt ? formatDate(task.startedAt) : '—')}</span></div>
          <div class="kv"><span class="kv__k">الموعد النهائي</span>
            <span class="kv__v" style="color:${overdue ? 'var(--danger)' : 'inherit'}">
              ${task.dueAt ? esc(formatDateTime(task.dueAt)) : '—'}</span></div>
          <div class="kv"><span class="kv__k">تاريخ الإنجاز</span><span class="kv__v">${esc(task.completedAt ? formatDateTime(task.completedAt) : '—')}</span></div>
          <div class="kv"><span class="kv__k">الوقت المستغرق</span><span class="kv__v num">${esc(formatDuration(task.timeSpentMs || 0))}</span></div>
        </div>

        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="users"></i> المسؤولون</div></div>
          ${assignees.length ? assignees.map((u) => `
            <a class="list-row" href="#/employees/${attr(u.id)}">
              ${avatarHTML(u)}
              <div class="list-row__body">
                <div class="list-row__title">${esc(u.displayName)}</div>
                <div class="list-row__sub">${esc((u.roles || []).map((r) => JOB_ROLES[r]?.ar || r).join(' + '))}</div>
              </div>
            </a>`).join('') : '<div class="text-muted fs-sm">لم يتم إسناد المهمة بعد.</div>'}
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="hammer"></i> من عمل على المهمة</div>
          </div>
          <div id="contributors">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
        </div>

        ${canWork ? `
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="zap"></i> إجراءات سريعة</div></div>
          <div class="flex-col gap-2">
            ${task.status !== 'inprogress' && task.status !== 'completed'
              ? '<button class="btn btn--secondary btn--block" data-quick="inprogress"><i data-lucide="play"></i> بدء العمل</button>' : ''}
            ${task.status === 'inprogress'
              ? '<button class="btn btn--secondary btn--block" data-quick="waiting"><i data-lucide="pause"></i> إيقاف مؤقت</button>' : ''}
            ${task.status !== 'review' && task.status !== 'completed'
              ? '<button class="btn btn--secondary btn--block" data-quick="review"><i data-lucide="eye"></i> إرسال للمراجعة</button>' : ''}
            ${task.status !== 'completed'
              ? '<button class="btn btn--success btn--block" data-quick="completed"><i data-lucide="check"></i> إنهاء المهمة</button>'
              : '<button class="btn btn--secondary btn--block" data-quick="inprogress"><i data-lucide="rotate-ccw"></i> إعادة فتح</button>'}
          </div>
        </div>` : ''}

        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="history"></i> سجل المهمة</div></div>
          <div id="activity">${'<div class="skeleton skeleton--text"></div>'.repeat(3)}</div>
        </div>
      </div>
    </div>`;

  refreshIcons(root);

  /* ----------------------------------------------------------- actions */
  $('#btn-edit')?.addEventListener('click', () => openTaskModal({ task }));
  $('#btn-status')?.addEventListener('click', () => openStatusPicker(task));
  $('#btn-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'حذف المهمة',
      message: `سيتم حذف المهمة «${esc(task.title)}» نهائياً مع تعليقاتها. لا يمكن التراجع.`,
      confirmText: 'حذف',
      danger: true
    });
    if (!ok) return;
    try {
      await deleteDoc(ref('tasks', task.id));
      toastSuccess('تم حذف المهمة.');
      location.hash = '#/my-tasks';
    } catch (err) { reportError(err, 'delete-task'); }
  });

  $$('[data-quick]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await changeStatus(task.id, button.dataset.quick, task);
        toastSuccess('تم تحديث حالة المهمة.');
      } catch (err) { reportError(err, 'quick-status'); }
    });
  });

  /* --------------------------------------------------------- checklist */
  paintChecklist(task, canWork);
  $('#add-check')?.addEventListener('click', async () => {
    const text = await promptDialog({ title: 'إضافة بند', label: 'نص البند', confirmText: 'إضافة' });
    if (!text) return;
    const list = [...(task.checklist || []), { id: crypto.randomUUID(), text: sanitizeText(text, 200), done: false }];
    await updateDoc(ref('tasks', task.id), { checklist: list, updatedAt: ts() });
  });

  /* -------------------------------------------------------- attachments */
  paintAttachments(task, canWork);
  $('#add-file')?.addEventListener('click', async () => {   // absent while uploads are off
    const [file] = await pickFiles({ accept: 'image/*,.pdf,.doc,.docx,.xlsx,.zip,.txt' });
    if (!file) return;
    try {
      toastSuccess('جارٍ الرفع…');
      const uploaded = await uploadFile(file, paths.task(task.id, file), { maxMB: 25 });
      await updateDoc(ref('tasks', task.id), {
        attachments: [...(task.attachments || []), {
          ...uploaded, uploadedBy: session.uid, uploadedAt: Date.now()
        }],
        updatedAt: ts()
      });
      await logActivity(task.id, 'attachment', `أضاف الملف ${file.name}`);
      toastSuccess('تم رفع الملف.');
    } catch (err) { reportError(err, 'upload'); }
  });

  /* ---------------------------------------------------------- comments */
  const sendComment = async () => {
    const input = $('#comment-input');
    const body = sanitizeMultiline(input.value, 4000);
    if (!body) return;
    input.value = '';
    try {
      await addDoc(col('tasks', task.id, 'comments'), {
        authorId: session.uid,
        authorName: session.profile?.displayName || '',
        body,
        createdAt: ts()
      });
      await updateDoc(ref('tasks', task.id), {
        commentCount: (task.commentCount || 0) + 1,
        updatedAt: ts()
      }).catch(() => {});
    } catch (err) { reportError(err, 'comment'); }
  };
  $('#comment-send').addEventListener('click', sendComment);
  $('#comment-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment(); }
  });

  unsubs.push(onSnapshot(
    query(col('tasks', task.id, 'comments'), orderBy('createdAt', 'asc'), limit(100)),
    async (snap) => {
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const authors = await getUsers([...new Set(comments.map((c) => c.authorId))]);
      const byId = Object.fromEntries(authors.map((u) => [u.id, u]));
      const node = $('#comments');
      if (!node) return;
      node.innerHTML = comments.length ? comments.map((c) => `
        <div class="flex gap-3 mb-3">
          ${avatarHTML(byId[c.authorId] || { displayName: c.authorName })}
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="fw-700 fs-sm">${esc(byId[c.authorId]?.displayName || c.authorName || 'مستخدم')}</span>
              <span class="fs-2xs text-muted">${esc(timeAgo(c.createdAt))}</span>
              ${c.authorId === session.uid
                ? `<button class="icon-btn" data-del-comment="${attr(c.id)}" style="width:24px;height:24px">
                     <i data-lucide="trash-2" class="icon-sm"></i></button>` : ''}
            </div>
            <div class="fs-md" style="white-space:pre-wrap">${renderMessageBody(c.body)}</div>
          </div>
        </div>`).join('') : '<div class="text-muted fs-sm">لا توجد تعليقات بعد.</div>';
      refreshIcons(node);

      $$('[data-del-comment]', node).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'حذف التعليق', message: 'سيتم حذف تعليقك.', danger: true }))) return;
        await deleteDoc(ref('tasks', task.id, 'comments', b.dataset.delComment));
      }));
    },
    () => {}
  ));

  /* ---------------------------------------------------------- activity */
  unsubs.push(onSnapshot(
    query(col('tasks', task.id, 'activity'), orderBy('at', 'desc'), limit(30)),
    async (snap) => {
      const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // `task.contributors` is authoritative and complete; the activity log is
      // capped at 30 events, so it is only a fallback for tasks created before
      // the field existed (and it can under-report on long-running ones).
      const fromLog = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
      const contributorIds = task.contributors?.length ? task.contributors : fromLog;

      const actors = await getUsers([...new Set([...contributorIds, ...fromLog])]);
      const byId = Object.fromEntries(actors.map((u) => [u.id, u]));

      const node = $('#activity');
      if (node) {
        node.innerHTML = events.length ? `<div class="timeline">${events.map((e) => `
          <div class="timeline__item">
            <span class="timeline__dot"></span>
            <div class="timeline__text">
              <strong>${esc(byId[e.actorId]?.displayName || 'مستخدم')}</strong> ${esc(e.text)}
            </div>
            <div class="timeline__time">${esc(timeAgo(e.at))}</div>
          </div>`).join('')}</div>` : '<div class="text-muted fs-sm">لا يوجد سجل بعد.</div>';
      }

      paintContributors(contributorIds, byId, events);
    },
    () => {}
  ));

  /**
   * Everyone who actually did something on this task, newest contribution
   * first, with what they last did — distinct from "المسؤولون", which is only
   * who it was handed to.
   */
  function paintContributors(ids, byId, events) {
    const node = $('#contributors');
    if (!node) return;

    const lastByActor = new Map();
    for (const e of events) {                      // events arrive newest-first
      if (e.actorId && !lastByActor.has(e.actorId)) lastByActor.set(e.actorId, e);
    }

    const rows = ids
      .map((id) => ({ id, user: byId[id], last: lastByActor.get(id) }))
      .filter((r) => r.user)
      .sort((a, b) => toMillis(b.last?.at) - toMillis(a.last?.at));

    node.innerHTML = rows.length ? rows.map((r) => `
      <a class="list-row" href="#/employees/${attr(r.id)}">
        ${avatarHTML(r.user)}
        <div class="list-row__body">
          <div class="list-row__title">${esc(r.user.displayName)}</div>
          <div class="list-row__sub truncate">${
            r.last ? esc(r.last.text) : esc((r.user.roles || []).map((x) => JOB_ROLES[x]?.ar || x).join(' + '))
          }</div>
        </div>
        ${r.last ? `<span class="fs-2xs text-muted">${esc(timeAgo(r.last.at))}</span>` : ''}
      </a>`).join('')
      : '<div class="text-muted fs-sm">لم يعمل أحد على المهمة بعد.</div>';

    refreshIcons(node);
  }

  function paintChecklist(taskDoc, editable) {
    const host = $('#checklist');
    const list = taskDoc.checklist || [];
    if (!list.length) {
      host.innerHTML = '<div class="text-muted fs-sm">لا توجد بنود.</div>';
      return;
    }
    host.innerHTML = list.map((item) => `
      <label class="checklist-item${item.done ? ' is-done' : ''}">
        <input type="checkbox" ${item.done ? 'checked' : ''} ${editable ? '' : 'disabled'}
               data-check="${attr(item.id)}">
        <span class="checklist-item__text">${esc(item.text)}</span>
        ${editable ? `<button class="icon-btn" data-rm-check="${attr(item.id)}" style="width:26px;height:26px">
          <i data-lucide="x" class="icon-sm"></i></button>` : ''}
      </label>`).join('');
    refreshIcons(host);

    $$('[data-check]', host).forEach((box) => box.addEventListener('change', async () => {
      const next = list.map((i) => i.id === box.dataset.check ? { ...i, done: box.checked } : i);
      const done = next.filter((i) => i.done).length;
      await updateDoc(ref('tasks', taskDoc.id), {
        checklist: next,
        progress: Math.round((done / next.length) * 100),
        updatedAt: ts()
      });
    }));

    $$('[data-rm-check]', host).forEach((button) => button.addEventListener('click', async (e) => {
      e.preventDefault();
      const next = list.filter((i) => i.id !== button.dataset.rmCheck);
      await updateDoc(ref('tasks', taskDoc.id), { checklist: next, updatedAt: ts() });
    }));
  }

  function paintAttachments(taskDoc, editable) {
    const host = $('#attachments');
    const files = taskDoc.attachments || [];
    if (!files.length) {
      host.innerHTML = '<div class="text-muted fs-sm">لا توجد مرفقات.</div>';
      return;
    }
    host.innerHTML = `<div class="tag-list">${files.map((f, i) => `
      <span class="attachment-chip">
        <i data-lucide="${f.type?.startsWith('image/') ? 'image' : 'file'}" class="icon-sm"></i>
        <a href="${attr(f.url)}" target="_blank" rel="noopener noreferrer" class="truncate">${esc(f.name)}</a>
        <span class="text-muted fs-2xs">${esc(formatBytes(f.size))}</span>
        ${editable ? `<button class="icon-btn" data-rm-file="${i}" style="width:22px;height:22px">
          <i data-lucide="x" class="icon-sm"></i></button>` : ''}
      </span>`).join('')}</div>`;
    refreshIcons(host);

    $$('[data-rm-file]', host).forEach((button) => button.addEventListener('click', async () => {
      const index = Number(button.dataset.rmFile);
      const file = files[index];
      if (!(await confirmDialog({ title: 'حذف المرفق', message: `حذف «${esc(file.name)}»؟`, danger: true }))) return;
      try {
        await deleteFile(file.path);
        await updateDoc(ref('tasks', taskDoc.id), {
          attachments: files.filter((_, i) => i !== index), updatedAt: ts()
        });
        toastSuccess('تم حذف المرفق.');
      } catch (err) { reportError(err, 'delete-file'); }
    }));
  }
}

/* ========================================================================== */
/* Mutations                                                                  */
/* ========================================================================== */

export async function changeStatus(taskId, status, task = null) {
  const patch = { status, lastStatusAt: ts(), updatedAt: ts() };

  if (status === 'inprogress' && !task?.startedAt) patch.startedAt = ts();
  if (status === 'completed') {
    patch.completedAt = ts();
    patch.progress = 100;
    if (task?.startedAt) {
      patch.timeSpentMs = (task.timeSpentMs || 0) + Math.max(0, Date.now() - toMillis(task.startedAt));
    }
  }
  if (status !== 'completed' && task?.status === 'completed') patch.completedAt = null;

  await updateDoc(ref('tasks', taskId), patch);
  await logActivity(taskId, 'status', `غيّر الحالة إلى «${statusLabel(status)}»`);
}

async function logActivity(taskId, type, text) {
  try {
    await addDoc(col('tasks', taskId, 'activity'), {
      actorId: session.uid,
      type,
      text: sanitizeText(text, 300),
      at: ts()
    });
  } catch (err) {
    console.warn('[luma] activity log failed', err.code);
  }

  // Anyone who acts on a task is a contributor, whether or not they were ever
  // assigned to it. Kept on the task itself so the detail page can list them
  // without paging through the whole activity log.
  //
  // arrayUnion is idempotent in content but still costs a write and still
  // re-triggers every task listener, so a already-recorded actor is skipped.
  const seenKey = `${taskId}:${session.uid}`;
  if (recordedContributors.has(seenKey)) return;
  try {
    await updateDoc(ref('tasks', taskId), { contributors: arrayUnion(session.uid) });
    recordedContributors.add(seenKey);
  } catch (err) {
    console.warn('[luma] contributor update failed', err.code);
  }
}

/** `taskId:uid` pairs already written this session — see logActivity. */
const recordedContributors = new Set();

function openStatusPicker(task) {
  openModal({
    title: 'تغيير حالة المهمة',
    size: 'sm',
    bodyHTML: `<div class="flex-col gap-2">${Object.entries(TASK_STATUSES).map(([key, meta]) => `
      <button class="btn btn--secondary btn--block" data-status="${attr(key)}"
              style="justify-content:flex-start;${key === task.status ? 'border-color:var(--yellow)' : ''}">
        <span style="width:9px;height:9px;border-radius:50%;background:${meta.color}"></span>
        ${esc(meta.ar)}
      </button>`).join('')}</div>`,
    onMount: (api) => {
      $$('[data-status]', api.root).forEach((button) => button.addEventListener('click', async () => {
        api.close();
        try {
          await changeStatus(task.id, button.dataset.status, task);
          toastSuccess('تم تحديث الحالة.');
        } catch (err) { reportError(err, 'status'); }
      }));
    }
  });
}

/* ========================================================================== */
/* Create / edit modal                                                        */
/* ========================================================================== */

/**
 * @param {{task?:object, personal?:boolean, clientId?:string, defaults?:object}} options
 */
export async function openTaskModal({ task = null, personal = false, clientId = '', defaults = {} } = {}) {
  const isEdit = !!task;
  const canAssign = can(session.claims, 'tasks.assign') || can(session.claims, 'tasks.create');

  const [directory, clients] = await Promise.all([
    canAssign ? getDirectory().catch(() => []) : Promise.resolve([]),
    can(session.claims, 'clients.view')
      ? getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
      : Promise.resolve([])
  ]);

  const selected = new Set(task?.assignees || (personal || !canAssign ? [session.uid] : []));

  const modal = openModal({
    title: isEdit ? 'تعديل المهمة' : (personal ? 'مهمة شخصية جديدة' : 'مهمة جديدة'),
    subtitle: personal ? 'ستظهر لك وحدك ضمن مهامي' : '',
    size: 'lg',
    bodyHTML: `
      <form id="task-form">
        <div class="field">
          <label class="field__label" for="t-title">عنوان المهمة <span class="req">*</span></label>
          <input class="input" id="t-title" required maxlength="200"
                 value="${attr(task?.title || defaults.title || '')}"
                 placeholder="مثال: تصميم منشورات إنستغرام لشهر آب">
        </div>

        <div class="field">
          <label class="field__label" for="t-desc">الوصف</label>
          <textarea class="textarea" id="t-desc" maxlength="4000" rows="3"
            placeholder="تفاصيل المهمة والمتطلبات…">${esc(task?.description || '')}</textarea>
        </div>

        <div class="form-grid">
          ${canAssign && clients.length ? `
          <div class="field">
            <label class="field__label" for="t-client">العميل</label>
            <select class="select" id="t-client">
              <option value="">— بدون عميل —</option>
              ${clients.map((c) => `<option value="${attr(c.id)}" ${
                (task?.clientId || clientId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>` : ''}

          <div class="field">
            <label class="field__label" for="t-project">المشروع</label>
            <input class="input" id="t-project" maxlength="120"
                   value="${attr(task?.project || '')}" placeholder="اسم المشروع أو الحملة">
          </div>

          <div class="field">
            <label class="field__label" for="t-priority">الأولوية</label>
            <select class="select" id="t-priority">
              ${Object.entries(PRIORITIES).map(([k, v]) => `
                <option value="${k}" ${(task?.priority || 'medium') === k ? 'selected' : ''}>${esc(v.ar)}</option>`).join('')}
            </select>
          </div>

          <div class="field">
            <label class="field__label" for="t-status">الحالة</label>
            <select class="select" id="t-status">
              ${Object.entries(TASK_STATUSES).map(([k, v]) => `
                <option value="${k}" ${(task?.status || (canAssign && !personal ? 'assigned' : 'new')) === k ? 'selected' : ''}>
                  ${esc(v.ar)}</option>`).join('')}
            </select>
          </div>

          <div class="field">
            <label class="field__label" for="t-due">الموعد النهائي</label>
            <input class="input" id="t-due" type="datetime-local"
                   value="${attr(task?.dueAt ? toDateTimeInput(task.dueAt) : (defaults.dueAt || ''))}">
          </div>

          <div class="field">
            <label class="field__label" for="t-start">تاريخ البدء</label>
            <input class="input" id="t-start" type="datetime-local"
                   value="${attr(task?.startedAt ? toDateTimeInput(task.startedAt) : '')}">
          </div>
        </div>

        ${canAssign && !personal ? `
        <div class="field">
          <label class="field__label">المسؤولون <span class="req">*</span></label>
          <div class="chip-select" id="t-assignees">
            ${directory.filter((u) => u.status !== 'disabled').map((u) => `
              <button type="button" class="chip-toggle${selected.has(u.id) ? ' is-on' : ''}"
                      data-uid="${attr(u.id)}">${esc(u.displayName)}</button>`).join('')}
          </div>
          <div class="field__hint">يمكن إسناد المهمة لأكثر من موظف.</div>
        </div>` : ''}

        <div class="field">
          <label class="field__label">قائمة التحقق</label>
          <div id="t-checklist" class="flex-col gap-2"></div>
          <button type="button" class="btn btn--ghost btn--sm mt-2" id="t-add-check">
            <i data-lucide="plus"></i> إضافة بند
          </button>
        </div>
      </form>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="t-save">
        <i data-lucide="check"></i> ${isEdit ? 'حفظ التعديلات' : 'إنشاء المهمة'}
      </button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      /* assignees */
      api.root.querySelectorAll('[data-uid]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const uid = chip.dataset.uid;
          if (selected.has(uid)) { selected.delete(uid); chip.classList.remove('is-on'); }
          else { selected.add(uid); chip.classList.add('is-on'); }
        });
      });

      /* checklist editor */
      let checklist = [...(task?.checklist || [])];
      const paintChecks = () => {
        const host = api.$('#t-checklist');
        host.innerHTML = checklist.map((item, i) => `
          <div class="flex gap-2 items-center">
            <input class="input" data-ci="${i}" value="${attr(item.text)}" maxlength="200">
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-rc="${i}">
              <i data-lucide="x"></i></button>
          </div>`).join('');
        refreshIcons(host);
        host.querySelectorAll('[data-ci]').forEach((input) => input.addEventListener('input', () => {
          checklist[Number(input.dataset.ci)].text = input.value;
        }));
        host.querySelectorAll('[data-rc]').forEach((button) => button.addEventListener('click', () => {
          checklist.splice(Number(button.dataset.rc), 1);
          paintChecks();
        }));
      };
      paintChecks();
      api.$('#t-add-check').addEventListener('click', () => {
        checklist.push({ id: crypto.randomUUID(), text: '', done: false });
        paintChecks();
      });

      /* save */
      api.$('#t-save').addEventListener('click', async () => {
        const title = sanitizeText(api.$('#t-title').value, 200);
        if (!title) { toastError('عنوان المهمة مطلوب.'); return; }

        const assignees = canAssign && !personal ? [...selected] : [session.uid];
        if (!assignees.length) { toastError('يجب اختيار مسؤول واحد على الأقل.'); return; }

        const clientSelect = api.$('#t-client');
        const clientOption = clientSelect?.selectedOptions?.[0];
        const dueValue = api.$('#t-due').value;
        const startValue = api.$('#t-start').value;

        const payload = {
          title,
          titleLower: title.toLowerCase(),
          description: sanitizeMultiline(api.$('#t-desc').value, 4000),
          project: sanitizeText(api.$('#t-project').value, 120),
          clientId: clientSelect?.value || null,
          clientName: clientSelect?.value ? sanitizeText(clientOption.textContent, 140) : null,
          priority: api.$('#t-priority').value,
          status: api.$('#t-status').value,
          assignees,
          dueAt: dueValue ? new Date(dueValue) : null,
          startedAt: startValue ? new Date(startValue) : (task?.startedAt || null),
          checklist: checklist.filter((c) => c.text.trim()),
          isPersonal: personal || (!canAssign),
          updatedAt: ts()
        };

        const button = api.$('#t-save');
        button.classList.add('is-loading');
        try {
          if (isEdit) {
            await updateDoc(ref('tasks', task.id), payload);
            await logActivity(task.id, 'edit', 'عدّل تفاصيل المهمة');
            toastSuccess('تم حفظ التعديلات.');
          } else {
            const created = await addDoc(col('tasks'), {
              ...payload,
              createdBy: session.uid,
              createdAt: ts(),
              completedAt: null,
              progress: 0,
              timeSpentMs: 0,
              commentCount: 0,
              attachments: [],
              watchers: [session.uid],
              deleted: false
            });
            await logActivity(created.id, 'create', 'أنشأ المهمة');
            toastSuccess('تم إنشاء المهمة بنجاح.');
          }
          api.close();
        } catch (err) {
          reportError(err, 'save-task');
        } finally {
          button.classList.remove('is-loading');
        }
      });
    }
  });

  return modal;
}
