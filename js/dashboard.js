/**
 * Home dashboard. Renders one of two layouts depending on the viewer:
 *   • dashboard.viewCompany  → company-wide manager view
 *   • otherwise              → personal employee view
 * Both are driven by live Firestore data, never by placeholder numbers.
 */

import { session } from './auth.js';
import { can, rolesLabel, JOB_ROLES } from './permissions.js';
import { $, $$, esc, attr, render as mount, refreshIcons, avatarHTML, avatarWithPresence, emptyState } from './utils/dom.js';
import { reportError, toastSuccess } from './utils/toast.js';
import {
  col, query, where, orderBy, limit, onSnapshot, getMany, getDirectory, getUsers
} from './utils/api.js';
import {
  TASK_STATUSES, PRIORITIES, summarize, dailySeries, sortTasks, isOverdue, isDueToday,
  progressOf, statusLabel, myTasksQuery, allTasksQuery, watchTasks
} from './utils/task-model.js';
import {
  formatDate, formatTime, formatDuration, timeAgo, toMillis, AR_DAYS_SHORT,
  startOfMonth, weekdayIndex, dayKey, isToday
} from './utils/format.js';
import {
  watchAllPresence, presence, onSelfPresence, WORK_STATES,
  confirmStartBreak, confirmEndBreak
} from './utils/presence.js';
import { lineChart, doughnutChart, barChart, destroyAllCharts } from './utils/charts.js';

export async function render(container, ctx) {
  const isManagerView = can(session.claims, 'dashboard.viewCompany');
  const unsubs = [];

  container.innerHTML = `
    <div class="page__inner">
      <div id="dash-announce"></div>
      <div id="dash-root"></div>
    </div>`;
  const root = $('#dash-root', container);

  // Above everything else on purpose: a notice nobody scrolls to is a notice
  // nobody read.
  const { mountAnnouncements } = await import('./announcements.js');
  unsubs.push(mountAnnouncements($('#dash-announce', container)));

  if (isManagerView) await renderManager(root, unsubs);
  else await renderEmployee(root, unsubs);

  return () => {
    unsubs.forEach((fn) => { try { fn(); } catch {} });
    destroyAllCharts();
  };
}

/* ========================================================================== */
/* Employee dashboard                                                         */
/* ========================================================================== */

async function renderEmployee(root, unsubs) {
  const profile = session.profile || {};
  const firstName = (profile.displayName || '').split(' ')[0];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__title">${greeting()} ${esc(firstName)} 👋</div>
        <div class="page-head__sub">${esc(todayLine())}</div>
      </div>
      <div class="page-head__actions">
        <span id="break-action"></span>
        <button class="btn btn--primary" id="add-personal-task">
          <i data-lucide="plus"></i> مهمة شخصية
        </button>
      </div>
    </div>

    <div id="break-banner"></div>

    <div class="grid grid-4" id="emp-stats">
      ${'<div class="skeleton skeleton--card"></div>'.repeat(4)}
    </div>

    <div class="grid grid-main mt-4">
      <div class="flex-col gap-4">
        <div class="card" id="today-tasks">
          <div class="card__head">
            <div class="card__title"><i data-lucide="calendar-check"></i> مهام اليوم</div>
            <a class="card__link" href="#/my-tasks">عرض الكل</a>
          </div>
          <div id="today-tasks-body">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="trending-up"></i> إنتاجيتي — آخر 7 أيام</div>
            <span class="card__sub" id="productivity-note"></span>
          </div>
          <div class="chart-box" style="height:230px"><canvas id="chart-productivity"></canvas></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="list-checks"></i> المهام القادمة</div>
          </div>
          <div id="upcoming-tasks">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="card card--pad-sm">
          <div class="card__head">
            <div class="card__title"><i data-lucide="calendar-days"></i> تقويمي</div>
            <a class="card__link" href="#/calendar">التقويم الكامل</a>
          </div>
          <div id="mini-calendar"></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="bell"></i> آخر الإشعارات</div>
            <a class="card__link" href="#/notifications">الكل</a>
          </div>
          <div id="latest-notifications">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="users"></i> الفريق الآن</div>
            <a class="card__link" href="#/team">الفريق</a>
          </div>
          <div id="team-now">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="history"></i> نشاطي الأخير</div>
          </div>
          <div id="my-activity"></div>
        </div>
      </div>
    </div>`;

  refreshIcons(root);

  $('#add-personal-task').addEventListener('click', async () => {
    const mod = await import('./tasks.js');
    mod.openTaskModal({ personal: true });
  });

  /* ------------------------------------------------------ break controls */
  unsubs.push(onSelfPresence((state) => paintBreakArea(state)));

  function paintBreakArea(state) {
    const onBreak = state.state === 'break';
    const host = $('#break-action');
    if (!host) return;
    host.innerHTML = onBreak
      ? `<button class="btn btn--success" id="break-toggle"><i data-lucide="play"></i> إنهاء الاستراحة</button>`
      : `<button class="btn btn--secondary" id="break-toggle"><i data-lucide="coffee"></i> بدء استراحة</button>`;
    refreshIcons(host);
    $('#break-toggle').addEventListener('click', async () => {
      try { onBreak ? await confirmEndBreak() : await confirmStartBreak(); }
      catch (err) { reportError(err, 'break'); }
    });

    const banner = $('#break-banner');
    if (onBreak && state.breakStartedAt) {
      banner.innerHTML = `
        <div class="break-banner mb-4">
          <i data-lucide="coffee" class="icon-lg" style="color:var(--warning)"></i>
          <div class="flex-1">
            <div class="fw-700">أنت في استراحة الآن</div>
            <div class="fs-sm text-muted">بدأت الساعة ${esc(formatTime(state.breakStartedAt))}</div>
          </div>
          <div class="break-banner__timer num" id="banner-timer">00:00:00</div>
        </div>`;
      refreshIcons(banner);
      const tick = setInterval(() => {
        const node = $('#banner-timer');
        if (!node) { clearInterval(tick); return; }
        const ms = Date.now() - state.breakStartedAt;
        const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
        node.textContent = `${h}:${m}:${s}`;
      }, 1000);
      unsubs.push(() => clearInterval(tick));
    } else {
      banner.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------- tasks */
  unsubs.push(watchTasks(myTasksQuery(session.uid), (tasks) => {
    const stats = summarize(tasks, { uid: session.uid });

    $('#emp-stats').innerHTML = [
      statCard('check-circle-2', 'success', stats.completedToday, 'أُنجزت اليوم'),
      statCard('calendar-check', 'brand', stats.completedWeek, 'أُنجزت هذا الأسبوع'),
      statCard('list-todo', 'info', stats.open, 'مهام متبقية'),
      statCard('alert-triangle', 'danger', stats.overdue, 'مهام متأخرة')
    ].join('');
    refreshIcons($('#emp-stats'));

    // Today's tasks: due today, overdue, or simply open with no due date set
    // at all — an undated task is still active work, and without this it fell
    // into a blind spot (not "due today", not "upcoming" either) and silently
    // never appeared on the dashboard despite showing fine in the full list.
    const openNoDate = (t) => !t.dueAt && t.status !== 'completed' && t.status !== 'cancelled';
    const todays = sortTasks(tasks.filter((t) =>
      isDueToday(t) || (isOverdue(t) && t.status !== 'completed') || openNoDate(t)));
    $('#today-tasks-body').innerHTML = todays.length
      ? todays.slice(0, 6).map(taskRow).join('')
      : emptyState({ icon: 'coffee', title: 'لا توجد مهام لليوم', text: 'استغل الوقت في التخطيط أو ساعد زميلاً في مهمة.' });
    refreshIcons($('#today-tasks-body'));

    // Upcoming
    const upcoming = sortTasks(
      tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' &&
        toMillis(t.dueAt) > Date.now()), 'due'
    ).slice(0, 5);
    $('#upcoming-tasks').innerHTML = upcoming.length
      ? upcoming.map(taskRow).join('')
      : emptyState({ icon: 'calendar', title: 'لا مهام قادمة', text: 'كل شيء تحت السيطرة.' });
    refreshIcons($('#upcoming-tasks'));

    // Productivity chart
    const daily = dailySeries(tasks, 7);
    lineChart('chart-productivity',
      daily.map((d) => AR_DAYS_SHORT[weekdayIndex(d.date)]),
      [
        { label: 'مكتملة', data: daily.map((d) => d.completed), color: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() },
        { label: 'جديدة', data: daily.map((d) => d.created), color: getComputedStyle(document.documentElement).getPropertyValue('--info').trim(), fill: false }
      ]);
    $('#productivity-note').textContent =
      `نسبة الإنجاز ${stats.completionRate}% · متوسط الإنهاء ${formatDuration(stats.avgCompletionMs)}`;

    // Mini calendar
    renderMiniCalendar($('#mini-calendar'), tasks);

    // Activity
    $('#my-activity').innerHTML = buildActivity(tasks);
    refreshIcons($('#my-activity'));
  }, (err) => {
    $('#emp-stats').innerHTML = `<div class="card">${esc(err.message)}</div>`;
  }));

  /* ----------------------------------------------------- notifications */
  const paintNotifs = (items) => {
    const node = $('#latest-notifications');
    if (!node) return;
    node.innerHTML = items.length
      ? items.slice(0, 5).map((n) => `
          <a class="notif-row${n.read ? '' : ' is-unread'}" href="${attr(n.link || '#/notifications')}">
            <span class="notif-row__icon"><i data-lucide="${attr(n.icon || 'bell')}"></i></span>
            <div class="flex-1">
              <div class="notif-row__title">${esc(n.title || '')}</div>
              <div class="notif-row__text clamp-2">${esc(n.body || '')}</div>
              <div class="notif-row__time">${esc(timeAgo(n.createdAt))}</div>
            </div>
          </a>`).join('')
      : emptyState({ icon: 'bell-off', title: 'لا إشعارات', text: 'ستظهر هنا التنبيهات الجديدة.' });
    refreshIcons(node);
  };
  const notifHandler = (e) => paintNotifs(e.detail);
  window.addEventListener('luma:notifications', notifHandler);
  unsubs.push(() => window.removeEventListener('luma:notifications', notifHandler));
  getMany(query(col('notifications'), where('userId', '==', session.uid),
    orderBy('createdAt', 'desc'), limit(5))).then(paintNotifs).catch(() => paintNotifs([]));

  /* ------------------------------------------------------------- team */
  renderTeamNow($('#team-now'), unsubs);
}

/* ========================================================================== */
/* Manager dashboard                                                          */
/* ========================================================================== */

async function renderManager(root, unsubs) {
  const profile = session.profile || {};

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__title">${greeting()} ${esc((profile.displayName || '').split(' ')[0])}</div>
        <div class="page-head__sub">${esc(todayLine())} — نظرة عامة على أداء الوكالة</div>
      </div>
      <div class="page-head__actions">
        <a class="btn btn--secondary" href="#/reports"><i data-lucide="bar-chart-3"></i> التقارير</a>
        <button class="btn btn--primary" id="new-task-btn"><i data-lucide="plus"></i> مهمة جديدة</button>
      </div>
    </div>

    <div class="grid grid-4" id="mgr-stats">${'<div class="skeleton skeleton--card"></div>'.repeat(4)}</div>

    <div class="grid grid-4 mt-4" id="mgr-stats-2">${'<div class="skeleton skeleton--card"></div>'.repeat(4)}</div>

    <div class="grid grid-main-wide mt-4">
      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="users"></i> حِمل العمل حسب الموظف</div>
            <a class="card__link" href="#/employees">إدارة الموظفين</a>
          </div>
          <div id="workload">${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="activity"></i> إنجاز المهام — آخر 14 يوم</div>
          </div>
          <div class="chart-box" style="height:250px"><canvas id="chart-company"></canvas></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="briefcase"></i> تقدم العملاء</div>
            <a class="card__link" href="#/clients">كل العملاء</a>
          </div>
          <div id="client-progress">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
        </div>
      </div>

      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="radio"></i> حالة الفريق الآن</div>
            <a class="card__link" href="#/team">التفاصيل</a>
          </div>
          <div id="presence-summary"></div>
          <div class="list-divider"></div>
          <div id="team-now"></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="inbox"></i> طلبات بانتظار القرار</div>
            <a class="card__link" href="#/documents">الكل</a>
          </div>
          <div id="pending-requests">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="pie-chart"></i> توزيع المهام</div>
          </div>
          <div class="chart-box" style="height:250px"><canvas id="chart-status"></canvas></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title"><i data-lucide="history"></i> نشاط الفريق</div>
          </div>
          <div id="team-activity"></div>
        </div>
      </div>
    </div>`;

  refreshIcons(root);

  $('#new-task-btn').addEventListener('click', async () => {
    (await import('./tasks.js')).openTaskModal();
  });

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  /* ------------------------------------------------------------ tasks */
  unsubs.push(watchTasks(allTasksQuery(), (tasks) => {
    const live = tasks.filter((t) => !t.deleted);
    const stats = summarize(live);

    $('#mgr-stats').innerHTML = [
      statCard('layers', 'brand', stats.total, 'إجمالي المهام'),
      statCard('check-circle-2', 'success', stats.completed, 'مهام مكتملة'),
      statCard('list-todo', 'info', stats.open, 'مهام متبقية'),
      statCard('alert-triangle', 'danger', stats.overdue, 'مهام متأخرة')
    ].join('');

    $('#mgr-stats-2').innerHTML = [
      statCard('loader', 'warning', stats.inProgress, 'قيد التنفيذ'),
      statCard('eye', 'purple', stats.review, 'قيد المراجعة'),
      statCard('calendar-clock', 'info', stats.dueToday, 'مستحقة اليوم'),
      statCard('percent', 'success', `${stats.completionRate}%`, 'نسبة الإنجاز')
    ].join('');
    refreshIcons($('#mgr-stats'));
    refreshIcons($('#mgr-stats-2'));

    /* workload per employee */
    const rows = Object.entries(stats.byAssignee)
      .map(([uid, value]) => ({ uid, user: people[uid], ...value }))
      .filter((r) => r.user)
      .sort((a, b) => b.open - a.open)
      .slice(0, 8);

    $('#workload').innerHTML = rows.length ? rows.map((r) => {
      const rate = r.total ? Math.round((r.completed / r.total) * 100) : 0;
      return `
        <a class="list-row" href="#/employees/${attr(r.uid)}">
          ${avatarHTML(r.user)}
          <div class="list-row__body">
            <div class="list-row__title">${esc(r.user.displayName)}</div>
            <div class="list-row__sub">${esc(rolesLabel(r.user.roles))}</div>
            <div class="progress mt-2"><div class="progress__bar" style="width:${rate}%"></div></div>
          </div>
          <div style="text-align:center;min-width:120px">
            <div class="flex gap-2 justify-center">
              <span class="badge badge--info">${r.open} مفتوحة</span>
              ${r.overdue ? `<span class="badge badge--danger">${r.overdue} متأخرة</span>` : ''}
            </div>
            <div class="fs-xs text-muted mt-2">${r.completed} مكتملة من ${r.total}</div>
          </div>
        </a>`;
    }).join('') : emptyState({ icon: 'users', title: 'لا توجد مهام مُسندة بعد' });
    refreshIcons($('#workload'));

    /* company trend */
    const daily = dailySeries(live, 14);
    lineChart('chart-company',
      daily.map((d) => `${d.date.getDate()}`),
      [
        { label: 'مكتملة', data: daily.map((d) => d.completed), color: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() },
        { label: 'جديدة', data: daily.map((d) => d.created), color: getComputedStyle(document.documentElement).getPropertyValue('--info').trim(), fill: false }
      ]);

    /* status doughnut */
    const statusKeys = Object.keys(TASK_STATUSES).filter((k) => stats.byStatus[k] > 0);
    doughnutChart('chart-status',
      statusKeys.map((k) => TASK_STATUSES[k].ar),
      statusKeys.map((k) => stats.byStatus[k]),
      statusKeys.map((k) => cssColor(TASK_STATUSES[k].color)));

    /* client progress */
    const clientRows = Object.entries(stats.byClient)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    $('#client-progress').innerHTML = clientRows.length ? clientRows.map((c) => {
      const rate = c.total ? Math.round((c.completed / c.total) * 100) : 0;
      return `
        <a class="list-row" href="#/clients/${attr(c.id)}">
          <div class="list-row__body">
            <div class="flex justify-between items-center">
              <span class="list-row__title">${esc(c.name)}</span>
              <span class="fs-sm text-muted num">${c.completed}/${c.total}</span>
            </div>
            <div class="progress mt-2">
              <div class="progress__bar ${rate === 100 ? 'progress__bar--success' : ''}" style="width:${rate}%"></div>
            </div>
          </div>
        </a>`;
    }).join('') : emptyState({ icon: 'briefcase', title: 'لا مهام مرتبطة بعملاء' });

    /* activity feed */
    $('#team-activity').innerHTML = buildActivity(live, people);
    refreshIcons($('#team-activity'));
  }));

  /* --------------------------------------------------------- requests */
  unsubs.push(onSnapshot(
    query(col('requests'), where('status', '==', 'submitted'), orderBy('createdAt', 'desc'), limit(6)),
    async (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const node = $('#pending-requests');
      if (!node) return;
      if (!items.length) {
        node.innerHTML = emptyState({ icon: 'check-circle-2', title: 'لا طلبات معلّقة', text: 'كل الطلبات تمت معالجتها.' });
        refreshIcons(node);
        return;
      }
      const owners = await getUsers(items.map((r) => r.employeeId));
      const byId = Object.fromEntries(owners.map((u) => [u.id, u]));
      const TYPES = { leave: 'إجازة', departure: 'مغادرة', advance: 'سلفة', sick: 'إجازة مرضية' };
      node.innerHTML = items.map((r) => `
        <a class="list-row" href="#/documents/${attr(r.id)}">
          ${avatarHTML(byId[r.employeeId] || {})}
          <div class="list-row__body">
            <div class="list-row__title">${esc(byId[r.employeeId]?.displayName || 'موظف')}</div>
            <div class="list-row__sub">${esc(TYPES[r.type] || r.type)} · ${esc(timeAgo(r.createdAt))}</div>
          </div>
          <span class="badge badge--warning">بانتظار</span>
        </a>`).join('');
      refreshIcons(node);
    },
    (err) => { console.warn('[luma] requests', err.code); }
  ));

  /* --------------------------------------------------------- presence */
  renderTeamNow($('#team-now'), unsubs, { summaryHost: $('#presence-summary'), directory });
}

/* ========================================================================== */
/* Shared pieces                                                              */
/* ========================================================================== */

function statCard(icon, tone, value, label, delta = '') {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num">${esc(value)}</div>
        <div class="stat__label">${esc(label)}</div>
        ${delta ? `<div class="stat__delta up">${esc(delta)}</div>` : ''}
      </div>
    </div>`;
}

function taskRow(task) {
  const overdue = isOverdue(task);
  const status = TASK_STATUSES[task.status] || {};
  return `
    <a class="list-row" href="#/tasks/${attr(task.id)}">
      <span class="stat__icon" style="width:34px;height:34px;background:var(--bg-inset);color:${status.color}">
        <i data-lucide="${attr(status.icon || 'circle')}" class="icon-sm"></i>
      </span>
      <div class="list-row__body">
        <div class="list-row__title truncate">${esc(task.title)}</div>
        <div class="list-row__sub">
          ${task.clientName ? esc(task.clientName) + ' · ' : ''}
          ${task.dueAt ? esc(formatDate(task.dueAt, { short: true })) : 'بدون موعد'}
        </div>
      </div>
      ${overdue
        ? '<span class="badge badge--danger">متأخرة</span>'
        : `<span class="badge badge--${attr(status.badge || '')}">${esc(status.ar || '')}</span>`}
    </a>`;
}

function buildActivity(tasks, people = null) {
  const events = [];
  for (const task of tasks) {
    if (task.completedAt) {
      events.push({
        at: toMillis(task.completedAt), icon: 'check',
        text: `أُنجزت المهمة «${task.title}»`,
        who: people ? (task.assignees || [])[0] : null
      });
    }
    if (task.createdAt) {
      events.push({
        at: toMillis(task.createdAt), icon: 'plus',
        text: `أُضيفت المهمة «${task.title}»`,
        who: people ? task.createdBy : null
      });
    }
  }
  const latest = events.sort((a, b) => b.at - a.at).slice(0, 6);
  if (!latest.length) return emptyState({ icon: 'history', title: 'لا نشاط بعد' });

  return `<div class="timeline">${latest.map((e) => `
    <div class="timeline__item">
      <span class="timeline__dot"></span>
      <div class="timeline__text">
        ${people && e.who && people[e.who] ? `<strong>${esc(people[e.who].displayName)}</strong> — ` : ''}
        ${esc(e.text)}
      </div>
      <div class="timeline__time">${esc(timeAgo(e.at))}</div>
    </div>`).join('')}</div>`;
}

function renderTeamNow(host, unsubs, { summaryHost = null, directory = null } = {}) {
  if (!host) return;
  let people = directory;

  const paint = async (statuses) => {
    if (!people) people = await getDirectory().catch(() => []);
    const active = people.filter((u) => u.status !== 'disabled');

    if (summaryHost) {
      const counts = { working: 0, break: 0, online: 0, offline: 0 };
      active.forEach((u) => {
        const state = statuses[u.id]?.state || 'offline';
        counts[state] = (counts[state] || 0) + 1;
      });
      summaryHost.innerHTML = `
        <div class="grid grid-2 gap-2">
          ${miniStat('يعمل الآن', counts.working, 'var(--success)')}
          ${miniStat('استراحة', counts.break, 'var(--warning)')}
          ${miniStat('متصل', counts.online, 'var(--info)')}
          ${miniStat('غير متصل', counts.offline, 'var(--gray)')}
        </div>`;
    }

    const sorted = [...active].sort((a, b) => {
      const rank = { working: 0, break: 1, online: 2, offline: 3 };
      return (rank[statuses[a.id]?.state || 'offline']) - (rank[statuses[b.id]?.state || 'offline']);
    }).slice(0, 8);

    host.innerHTML = sorted.length ? sorted.map((u) => {
      const state = statuses[u.id]?.state || 'offline';
      const meta = WORK_STATES[state];
      const breakStart = statuses[u.id]?.breakStartedAt;
      return `
        <a class="list-row" href="#/employees/${attr(u.id)}">
          ${avatarWithPresence(u, state)}
          <div class="list-row__body">
            <div class="list-row__title truncate">${esc(u.displayName)}</div>
            <div class="list-row__sub truncate">${esc(rolesLabel(u.roles))}</div>
          </div>
          <div style="text-align:end">
            <div class="fs-xs" style="color:${meta.color}">${esc(meta.ar)}</div>
            ${state === 'break' && breakStart
              ? `<div class="fs-2xs text-muted num">${esc(formatDuration(Date.now() - breakStart))}</div>` : ''}
          </div>
        </a>`;
    }).join('') : emptyState({ icon: 'users', title: 'لا يوجد أعضاء فريق' });
    refreshIcons(host);
  };

  unsubs.push(watchAllPresence(paint));
}

function miniStat(label, value, color) {
  return `
    <div class="card card--flat card--pad-sm" style="padding:var(--sp-3)">
      <div class="fs-xl fw-700 num" style="color:${color}">${value}</div>
      <div class="fs-xs text-muted">${esc(label)}</div>
    </div>`;
}

/** Month grid with a dot on days that have tasks — the compact planner. */
function renderMiniCalendar(host, tasks) {
  if (!host) return;
  const now = new Date();
  const first = startOfMonth(now);
  const startPad = weekdayIndex(first);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const marks = {};
  tasks.forEach((t) => {
    const due = toMillis(t.dueAt);
    if (!due) return;
    const key = dayKey(due);
    marks[key] = marks[key] || { count: 0, overdue: false };
    marks[key].count++;
    if (isOverdue(t)) marks[key].overdue = true;
  });

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<div></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(now.getFullYear(), now.getMonth(), day);
    const key = dayKey(date);
    const mark = marks[key];
    const today = isToday(date);
    cells.push(`
      <a href="#/calendar?date=${key}" class="mini-cal__day${today ? ' is-today' : ''}"
         style="aspect-ratio:1;display:grid;place-items:center;border-radius:9px;font-size:var(--fs-sm);
                position:relative;color:${today ? 'var(--text-on-brand)' : 'var(--text-secondary)'};
                background:${today ? 'var(--yellow)' : 'transparent'};font-weight:${today ? '800' : '500'}">
        <span class="num">${day}</span>
        ${mark ? `<span style="position:absolute;bottom:5px;width:5px;height:5px;border-radius:50%;
          background:${mark.overdue ? 'var(--danger)' : 'var(--yellow)'}"></span>` : ''}
      </a>`);
  }

  host.innerHTML = `
    <div class="fw-700 mb-3" style="text-align:center">
      ${esc(formatDate(now, { withYear: true }).replace(/^\d+\s/, ''))}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">
      ${AR_DAYS_SHORT.map((d) => `<div class="fs-2xs text-muted" style="text-align:center;padding-bottom:4px">${esc(d)}</div>`).join('')}
      ${cells.join('')}
    </div>`;
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Amman', hour: '2-digit', hour12: false
  }).format(new Date()));
  if (hour < 12) return 'صباح الخير';
  if (hour < 17) return 'مساء الخير';
  return 'مساء الخير';
}

function todayLine() {
  const now = new Date();
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return `${days[weekdayIndex(now)]} · ${formatDate(now)}`;
}

function cssColor(value) {
  if (!value?.startsWith('var(')) return value;
  const name = value.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
