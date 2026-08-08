/**
 * Employee profile: overview, statistics, financial data (permission gated),
 * break history and account management.
 *
 * Salary and banking live in `users/{uid}/private/{salary|banking}` so that
 * Security Rules can gate them independently of the rest of the profile —
 * field-level rules are not possible in Firestore, separate documents are.
 */

import { session } from './auth.js';
import {
  can, isAdmin, JOB_ROLES, DEPARTMENTS, PERMISSIONS, PERMISSION_GROUPS,
  PERMISSION_PRESETS, rolesLabel, ROLE_LABELS, permsToCodes
} from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, avatarHTML, emptyState, setBusy
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, getOne, getMany,
  updateDoc, callFn, ts
} from './utils/api.js';
import {
  summarize, dailySeries, monthlySeries, sortTasks, isOverdue, TASK_STATUSES,
  watchTasks, myTasksQuery
} from './utils/task-model.js';
import {
  formatDate, formatDateTime, formatDuration, formatMoney, maskTail, timeAgo,
  AR_MONTHS_SHORT, AR_DAYS_SHORT, weekdayIndex, toMillis
} from './utils/format.js';
import { watchAllPresence, breakHistory, WORK_STATES } from './utils/presence.js';
import { barChart, lineChart, doughnutChart, destroyAllCharts } from './utils/charts.js';
import { uploadFile, compressImage, pickFiles, paths, deleteFile } from './utils/upload.js';
import { uploadsEnabled } from './features.js';
import { sanitizeText, isValidEmail, isValidPhone, isValidIBAN, isValidCliq } from './utils/sanitize.js';

export async function render(container, ctx) {
  const uid = ctx.params.id || session.uid;
  const isSelf = uid === session.uid;
  const unsubs = [];

  if (!isSelf && !can(session.claims, 'employees.view')) {
    mount(container, `<div class="page__inner">${emptyState({
      icon: 'shield-alert', title: 'لا تملك صلاحية عرض ملفات الموظفين'
    })}</div>`);
    return;
  }

  container.innerHTML = `<div class="page__inner" id="profile-root">
    <div class="skeleton" style="height:180px;border-radius:var(--radius-lg)"></div>
  </div>`;
  const root = $('#profile-root', container);

  let profile = null;
  let tasks = [];
  let statuses = {};
  let activeTab = 'overview';

  unsubs.push(onSnapshot(ref('users', uid), (snap) => {
    if (!snap.exists()) {
      mount(root, emptyState({ icon: 'user-x', title: 'الموظف غير موجود' }));
      return;
    }
    profile = { id: snap.id, ...snap.data() };
    paint();
  }, (err) => mount(root, emptyState({ icon: 'shield-alert', title: 'تعذّر تحميل الملف', text: err.message }))));

  unsubs.push(watchTasks(myTasksQuery(uid, 400), (rows) => { tasks = rows.filter((t) => !t.deleted); paint(); }));
  unsubs.push(watchAllPresence((value) => { statuses = value; paintPresence(); }));

  function paint() {
    if (!profile) return;
    const stats = summarize(tasks, { uid });
    const state = statuses[uid]?.state || 'offline';

    root.innerHTML = `
      ${headerHTML(profile, state, isSelf)}
      <div class="tabs mt-4" id="profile-tabs">
        <button class="tab" data-tab="overview"><i data-lucide="layout-dashboard"></i> نظرة عامة</button>
        <button class="tab" data-tab="tasks"><i data-lucide="check-square"></i> المهام</button>
        <button class="tab" data-tab="stats"><i data-lucide="bar-chart-3"></i> الإحصائيات</button>
        <button class="tab" data-tab="breaks"><i data-lucide="coffee"></i> الاستراحات</button>
        ${(isSelf || can(session.claims, 'employees.viewSalary') || can(session.claims, 'employees.viewBanking'))
          ? '<button class="tab" data-tab="finance"><i data-lucide="wallet"></i> البيانات المالية</button>' : ''}
        ${isAdmin(session.claims) || can(session.claims, 'employees.edit')
          ? '<button class="tab" data-tab="account"><i data-lucide="shield"></i> الحساب والصلاحيات</button>' : ''}
      </div>
      <div id="tab-body"></div>`;

    refreshIcons(root);
    wireHeader();

    $('#profile-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      activeTab = tab.dataset.tab;
      paintTab(stats);
    });

    paintTab(stats);
  }

  function paintTab(stats) {
    $$('#profile-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === activeTab));
    const host = $('#tab-body');
    destroyAllCharts();

    if (activeTab === 'overview') renderOverview(host, profile, stats, tasks, isSelf);
    else if (activeTab === 'tasks') renderTasks(host, tasks);
    else if (activeTab === 'stats') renderStats(host, tasks, stats);
    else if (activeTab === 'breaks') renderBreaks(host, uid);
    else if (activeTab === 'finance') renderFinance(host, profile, isSelf);
    else if (activeTab === 'account') renderAccount(host, profile);

    refreshIcons(host);
  }

  function paintPresence() {
    const node = $('#presence-chip');
    if (!node || !profile) return;
    const state = statuses[uid]?.state || 'offline';
    const meta = WORK_STATES[state];
    node.innerHTML = `<span class="status-pill" data-state="${attr(state)}">
      <span class="status-pill__dot"></span>${esc(meta.ar)}</span>`;
    const dot = $('#avatar-presence-dot');
    if (dot) dot.className = `presence presence--${state}`;
  }

  function wireHeader() {
    $('#change-avatar')?.addEventListener('click', async () => {
      const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp' });
      if (!file) return;
      try {
        const compressed = await compressImage(file, { maxSize: 512 });
        const uploaded = await uploadFile(compressed, paths.avatar(uid, compressed), {
          maxMB: 3, kinds: ['image']
        });
        const previous = profile.photoPath;
        // photoPath is kept so the object can be removed later; an inline
        // (data-URL) image has no path and needs no cleanup.
        await updateDoc(ref('users', uid), {
          photoURL: uploaded.url, photoPath: uploaded.path || '', updatedAt: ts()
        });
        if (previous && previous !== uploaded.path) await deleteFile(previous).catch(() => {});
        toastSuccess('تم تحديث الصورة الشخصية.');
      } catch (err) { reportError(err, 'avatar'); }
    });

    $('#remove-avatar')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'حذف الصورة الشخصية',
        message: 'سيتم حذف صورتك وستظهر الأحرف الأولى من اسمك بدلاً منها.',
        confirmText: 'حذف',
        danger: true
      });
      if (!ok) return;
      try {
        const previous = profile.photoPath;      // absent for inline images
        await updateDoc(ref('users', uid), { photoURL: '', photoPath: '', updatedAt: ts() });
        if (previous) await deleteFile(previous).catch(() => {});
        toastSuccess('تم حذف الصورة الشخصية.');
      } catch (err) { reportError(err, 'remove-avatar'); }
    });

    $('#edit-profile')?.addEventListener('click', () => openProfileEditor(profile, isSelf));
    paintPresence();
  }

  return () => {
    unsubs.forEach((fn) => { try { fn(); } catch {} });
    destroyAllCharts();
  };
}

/* ------------------------------------------------------------------ header */

function headerHTML(profile, state, isSelf) {
  const canEdit = isSelf || can(session.claims, 'employees.edit');
  return `
    <div class="card profile-hero">
      <div class="flex gap-4 items-start" style="flex-wrap:wrap">
        <div class="avatar-wrap">
          ${avatarHTML(profile, 'xl')}
          ${!isSelf ? `<span class="presence presence--${attr(state)}" id="avatar-presence-dot"></span>` : ''}
          ${isSelf && uploadsEnabled() ? `<button class="icon-btn" id="change-avatar"
            style="position:absolute;bottom:-4px;inset-inline-end:-4px;background:var(--brand-gradient);
                   color:var(--text-on-brand);border-radius:50%;width:30px;height:30px"
            aria-label="تغيير الصورة" title="تغيير الصورة"><i data-lucide="camera" class="icon-sm"></i></button>` : ''}
          ${isSelf && profile.photoURL ? `<button class="icon-btn" id="remove-avatar"
            style="position:absolute;bottom:-4px;inset-inline-start:-4px;background:var(--danger);
                   color:#fff;border-radius:50%;width:30px;height:30px"
            aria-label="حذف الصورة" title="حذف الصورة"><i data-lucide="trash-2" class="icon-sm"></i></button>` : ''}
        </div>

        <div class="flex-1" style="min-width:220px">
          <div class="flex items-center gap-3" style="flex-wrap:wrap">
            <h1 style="font-size:var(--fs-2xl);font-weight:800">${esc(profile.displayName)}</h1>
            <span id="presence-chip"></span>
            ${profile.status === 'disabled' ? '<span class="badge badge--danger">معطّل</span>' : ''}
          </div>
          <div class="fs-sm text-muted ltr">@${esc(profile.username)}</div>
          <div class="tag-list mt-3">
            ${(profile.roles || []).map((r) => `
              <span class="badge" style="color:${JOB_ROLES[r]?.color || 'inherit'}">
                ${esc(JOB_ROLES[r]?.ar || r)}</span>`).join('')}
            <span class="badge">${esc(DEPARTMENTS[profile.department] || 'بدون قسم')}</span>
            <span class="badge badge--brand">${esc(ROLE_LABELS[profile.accountRole] || 'موظف')}</span>
          </div>
        </div>

        <div class="flex-col gap-2" style="min-width:180px">
          ${canEdit ? '<button class="btn btn--secondary" id="edit-profile"><i data-lucide="pencil"></i> تعديل البيانات</button>' : ''}
          ${!isSelf ? `<a class="btn btn--ghost" href="#/chat?dm=${attr(profile.id)}">
            <i data-lucide="message-circle"></i> مراسلة</a>` : ''}
        </div>
      </div>

      <div class="list-divider"></div>

      <div class="grid grid-4">
        <div class="kv"><span class="kv__k">الهاتف</span>
          <span class="kv__v ltr">${esc(profile.phone || '—')}</span></div>
        <div class="kv"><span class="kv__k">البريد</span>
          <span class="kv__v ltr truncate">${esc(profile.personalEmail || '—')}</span></div>
        <div class="kv"><span class="kv__k">تاريخ المباشرة</span>
          <span class="kv__v">${esc(profile.joinDate ? formatDate(profile.joinDate) : '—')}</span></div>
        <div class="kv"><span class="kv__k">رصيد الإجازات</span>
          <span class="kv__v num">${(profile.leave?.remaining ?? 0)} / ${(profile.leave?.annualQuota ?? 14)} يوم</span></div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- overview */

function renderOverview(host, profile, stats, tasks, isSelf) {
  const recent = sortTasks(tasks).slice(0, 6);
  host.innerHTML = `
    <div class="grid grid-4 mt-4">
      ${stat('check-circle-2', 'success', stats.completed, 'مهام مكتملة')}
      ${stat('list-todo', 'info', stats.open, 'مهام متبقية')}
      ${stat('alert-triangle', 'danger', stats.overdue, 'مهام متأخرة')}
      ${stat('percent', 'brand', `${stats.completionRate}%`, 'نسبة الإنجاز')}
    </div>

    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="target"></i> نسبة الإنجاز</div></div>
        <div class="flex items-center gap-4 mt-2" style="flex-wrap:wrap">
          ${ringHTML(stats.completionRate, { sub: 'إنجاز' })}
          <div class="flex-col gap-2">
            <div class="kv"><span class="kv__k">مكتملة</span><span class="kv__v num">${stats.completed}</span></div>
            <div class="kv"><span class="kv__k">متبقية</span><span class="kv__v num">${stats.open}</span></div>
            <div class="kv"><span class="kv__k">متأخرة</span>
              <span class="kv__v num" style="color:var(--danger)">${stats.overdue}</span></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="activity"></i> النشاط الأسبوعي</div></div>
        ${weekBarsHTML(tasks)}
      </div>
    </div>

    <div class="grid grid-main mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="list"></i> أحدث المهام</div></div>
        ${recent.length ? recent.map((t) => `
          <a class="list-row" href="#/tasks/${attr(t.id)}">
            <div class="list-row__body">
              <div class="list-row__title truncate">${esc(t.title)}</div>
              <div class="list-row__sub">${esc(t.clientName || 'بدون عميل')} ·
                ${t.dueAt ? esc(formatDate(t.dueAt, { short: true })) : 'بدون موعد'}</div>
            </div>
            <span class="badge badge--${attr(isOverdue(t) ? 'danger' : TASK_STATUSES[t.status]?.badge || '')}">
              ${esc(isOverdue(t) ? 'متأخرة' : TASK_STATUSES[t.status]?.ar || '')}</span>
          </a>`).join('') : emptyState({ icon: 'clipboard-list', title: 'لا مهام بعد' })}
      </div>

      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="user"></i> معلومات إضافية</div></div>
          <div class="kv"><span class="kv__k">القسم</span><span class="kv__v">${esc(DEPARTMENTS[profile.department] || '—')}</span></div>
          <div class="kv"><span class="kv__k">إجازات مستخدمة هذا الشهر</span>
            <span class="kv__v num">${profile.leave?.usedThisMonth ?? 0} يوم</span></div>
          <div class="kv"><span class="kv__k">الوقت المسجّل</span>
            <span class="kv__v num">${esc(formatDuration(stats.totalTimeMs))}</span></div>
          <div class="kv"><span class="kv__k">متوسط إنهاء المهمة</span>
            <span class="kv__v num">${esc(formatDuration(stats.avgCompletionMs))}</span></div>
          <div class="kv"><span class="kv__k">حالة الحساب</span>
            <span class="kv__v">${profile.status === 'disabled' ? 'معطّل' : 'نشط'}</span></div>
        </div>

        ${profile.notes && can(session.claims, 'employees.view') ? `
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="sticky-note"></i> ملاحظات الإدارة</div></div>
          <div class="fs-sm" style="white-space:pre-wrap">${esc(profile.notes)}</div>
        </div>` : ''}
      </div>
    </div>`;
}

function renderTasks(host, tasks) {
  const sorted = sortTasks(tasks);
  host.innerHTML = sorted.length ? `
    <div class="table-wrap mt-4">
      <table class="table">
        <thead><tr><th>المهمة</th><th>العميل</th><th>الحالة</th><th>الأولوية</th><th>الموعد</th></tr></thead>
        <tbody>${sorted.map((t) => `
          <tr onclick="location.hash='#/tasks/${attr(t.id)}'" style="cursor:pointer">
            <td class="is-strong">${esc(t.title)}</td>
            <td>${esc(t.clientName || '—')}</td>
            <td><span class="badge badge--${attr(isOverdue(t) ? 'danger' : TASK_STATUSES[t.status]?.badge || '')}">
              ${esc(isOverdue(t) ? 'متأخرة' : TASK_STATUSES[t.status]?.ar || '')}</span></td>
            <td>${esc(t.priority || '—')}</td>
            <td class="num">${t.dueAt ? esc(formatDate(t.dueAt, { short: true })) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="mt-4">${emptyState({ icon: 'clipboard-list', title: 'لا مهام' })}</div>`;
}

function renderStats(host, tasks, stats) {
  host.innerHTML = `
    <div class="grid grid-4 mt-4">
      ${stat('sun', 'brand', stats.completedToday, 'اليوم')}
      ${stat('calendar-days', 'info', stats.completedWeek, 'هذا الأسبوع')}
      ${stat('calendar', 'purple', stats.completedMonth, 'هذا الشهر')}
      ${stat('trophy', 'success', stats.completedYear, 'هذه السنة')}
    </div>

    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title">الإنجاز اليومي — آخر 14 يوم</div></div>
        <div class="chart-box" style="height:240px"><canvas id="p-daily"></canvas></div>
      </div>
      <div class="card">
        <div class="card__head"><div class="card__title">الإنجاز الشهري — هذه السنة</div></div>
        <div class="chart-box" style="height:240px"><canvas id="p-monthly"></canvas></div>
      </div>
      <div class="card">
        <div class="card__head"><div class="card__title">توزيع الحالات</div></div>
        <div class="chart-box" style="height:240px"><canvas id="p-status"></canvas></div>
      </div>
      <div class="card">
        <div class="card__head"><div class="card__title">المهام حسب العميل</div></div>
        <div class="chart-box" style="height:240px"><canvas id="p-client"></canvas></div>
      </div>
    </div>`;

  const daily = dailySeries(tasks, 14);
  lineChart('p-daily', daily.map((d) => `${d.date.getDate()}`), [
    { label: 'مكتملة', data: daily.map((d) => d.completed) }
  ]);

  const monthly = monthlySeries(tasks);
  barChart('p-monthly', AR_MONTHS_SHORT, [
    { label: 'مكتملة', data: monthly.map((m) => m.completed) }
  ]);

  const statusKeys = Object.keys(TASK_STATUSES).filter((k) => stats.byStatus[k] > 0);
  doughnutChart('p-status', statusKeys.map((k) => TASK_STATUSES[k].ar), statusKeys.map((k) => stats.byStatus[k]));

  const clientRows = Object.values(stats.byClient).sort((a, b) => b.total - a.total).slice(0, 6);
  barChart('p-client', clientRows.map((c) => c.name), [
    { label: 'مهام', data: clientRows.map((c) => c.total) }
  ], { horizontal: true });
}

async function renderBreaks(host, uid) {
  host.innerHTML = `<div class="card mt-4"><div id="breaks-body">
    ${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div></div>`;

  try {
    const history = await breakHistory(uid, 40);
    const today = history.filter((b) => b.dayKey === new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date()));
    const todayTotal = today.reduce((sum, b) => sum + (b.durationMs || 0), 0);
    const weekTotal = history
      .filter((b) => toMillis(b.startedAt) > Date.now() - 7 * 86_400_000)
      .reduce((sum, b) => sum + (b.durationMs || 0), 0);

    host.innerHTML = `
      <div class="grid grid-3 mt-4">
        ${stat('coffee', 'warning', formatDuration(todayTotal), 'استراحات اليوم')}
        ${stat('calendar-days', 'info', formatDuration(weekTotal), 'استراحات الأسبوع')}
        ${stat('hash', 'brand', history.length, 'عدد الاستراحات المسجّلة')}
      </div>
      <div class="card mt-4">
        <div class="card__head"><div class="card__title"><i data-lucide="history"></i> سجل الاستراحات</div></div>
        ${history.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>التاريخ</th><th>البداية</th><th>النهاية</th><th>المدة</th><th>السبب</th></tr></thead>
              <tbody>${history.map((b) => `
                <tr>
                  <td class="num">${esc(b.dayKey || formatDate(b.startedAt))}</td>
                  <td class="num">${esc(b.startedAt ? formatDateTime(b.startedAt).split('·')[1]?.trim() || '—' : '—')}</td>
                  <td class="num">${b.endedAt ? esc(formatDateTime(b.endedAt).split('·')[1]?.trim()) : '<span class="badge badge--warning">جارية</span>'}</td>
                  <td class="num">${esc(formatDuration(b.durationMs || 0))}</td>
                  <td>${esc(b.reason || '—')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : emptyState({ icon: 'coffee', title: 'لا استراحات مسجّلة' })}
      </div>`;
    refreshIcons(host);
  } catch (err) {
    host.innerHTML = `<div class="card mt-4">${emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل سجل الاستراحات', text: err.message
    })}</div>`;
  }
}

/* ----------------------------------------------------------------- finance */

async function renderFinance(host, profile, isSelf) {
  const canSalary = isSelf || can(session.claims, 'employees.viewSalary');
  const canBanking = isSelf || can(session.claims, 'employees.viewBanking');
  const canEditSalary = can(session.claims, 'employees.editSalary');

  host.innerHTML = `
    <div class="security-note mt-4">
      <i data-lucide="lock"></i>
      <div>
        البيانات المالية محمية بصلاحيات منفصلة، ومخزّنة في مستندات مستقلة لا يمكن قراءتها
        إلا لمن يملك الصلاحية. كل عملية عرض أو تعديل تُسجَّل في سجل التدقيق.
      </div>
    </div>

    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head">
          <div class="card__title"><i data-lucide="banknote"></i> الراتب</div>
          ${canEditSalary ? '<button class="btn btn--ghost btn--sm" id="edit-salary"><i data-lucide="pencil"></i> تعديل</button>' : ''}
        </div>
        <div id="salary-body">${canSalary ? '<div class="skeleton skeleton--text"></div>' : lockedBox('لا تملك صلاحية عرض الرواتب')}</div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title"><i data-lucide="landmark"></i> البيانات البنكية</div>
          ${isSelf ? '<button class="btn btn--ghost btn--sm" id="edit-banking"><i data-lucide="pencil"></i> تعديل</button>' : ''}
        </div>
        <div id="banking-body">${canBanking ? '<div class="skeleton skeleton--text"></div>' : lockedBox('لا تملك صلاحية عرض البيانات البنكية')}</div>
      </div>
    </div>`;

  refreshIcons(host);

  if (canSalary) {
    try {
      const salary = await getOne('users', profile.id, 'private', 'salary');
      $('#salary-body').innerHTML = salary ? `
        <div class="kv"><span class="kv__k">الراتب الأساسي</span>
          <span class="kv__v num">${esc(formatMoney(salary.amount, salary.currency || 'JOD'))}</span></div>
        <div class="kv"><span class="kv__k">البدلات</span>
          <span class="kv__v num">${esc(formatMoney(salary.allowances || 0))}</span></div>
        <div class="kv"><span class="kv__k">آخر تحديث</span>
          <span class="kv__v">${esc(salary.updatedAt ? formatDate(salary.updatedAt) : '—')}</span></div>`
        : '<div class="text-muted fs-sm">لم يتم تسجيل راتب لهذا الموظف بعد.</div>';
    } catch {
      $('#salary-body').innerHTML = lockedBox('تعذّر تحميل بيانات الراتب.');
    }
  }

  if (canBanking) {
    try {
      const banking = await getOne('users', profile.id, 'private', 'banking');
      const showFull = isSelf || can(session.claims, 'employees.viewBanking');
      $('#banking-body').innerHTML = banking ? `
        <div class="kv"><span class="kv__k">IBAN</span>
          <span class="kv__v ltr">${esc(showFull ? banking.iban : maskTail(banking.iban))}</span></div>
        <div class="kv"><span class="kv__k">اسم البنك</span>
          <span class="kv__v">${esc(banking.bankName || '—')}</span></div>
        <div class="kv"><span class="kv__k">CliQ</span>
          <span class="kv__v ltr">${esc(banking.cliq || '—')}</span></div>
        <div class="kv"><span class="kv__k">آخر تحديث</span>
          <span class="kv__v">${esc(banking.updatedAt ? formatDate(banking.updatedAt) : '—')}</span></div>`
        : '<div class="text-muted fs-sm">لم يتم تسجيل بيانات بنكية بعد.</div>';
    } catch {
      $('#banking-body').innerHTML = lockedBox('تعذّر تحميل البيانات البنكية.');
    }
  }

  $('#edit-salary')?.addEventListener('click', () => openSalaryEditor(profile));
  $('#edit-banking')?.addEventListener('click', () => openBankingEditor(profile));
}

function lockedBox(text) {
  return `<div class="empty-state" style="padding:var(--sp-5)">
    <div class="empty-state__icon"><i data-lucide="lock"></i></div>
    <div class="fs-sm text-muted">${esc(text)}</div>
  </div>`;
}

function openSalaryEditor(profile) {
  openModal({
    title: `تعديل راتب ${profile.displayName}`,
    size: 'sm',
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="shield-alert"></i>
        <div>سيتم تسجيل هذا التعديل في سجل التدقيق باسمك.</div>
      </div>
      <div class="field">
        <label class="field__label" for="s-amount">الراتب الأساسي (د.أ)</label>
        <input class="input ltr" id="s-amount" type="number" min="0" step="0.01" required>
      </div>
      <div class="field">
        <label class="field__label" for="s-allow">البدلات (د.أ)</label>
        <input class="input ltr" id="s-allow" type="number" min="0" step="0.01" value="0">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="s-save">حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#s-save').addEventListener('click', async () => {
        const amount = Number(api.$('#s-amount').value);
        if (!(amount >= 0)) return toastError('أدخل مبلغاً صحيحاً.');
        const button = api.$('#s-save');
        setBusy(button, true);
        try {
          await callFn('updateEmployeeFinance', {
            uid: profile.id,
            salary: { amount, allowances: Number(api.$('#s-allow').value) || 0, currency: 'JOD' }
          });
          toastSuccess('تم تحديث الراتب.');
          api.close();
          location.reload();
        } catch (err) { reportError(err, 'salary'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

function openBankingEditor(profile) {
  openModal({
    title: 'تعديل بياناتي البنكية',
    size: 'sm',
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="shield-alert"></i>
        <div>تأكد من صحة رقم الـ IBAN. سيتم تسجيل التعديل في سجل التدقيق.</div>
      </div>
      <div class="field">
        <label class="field__label" for="b-iban">رقم الـ IBAN</label>
        <input class="input ltr" id="b-iban" placeholder="JO94CBJO0010000000000131000302" maxlength="34">
        <div class="field__error" id="b-iban-err" hidden></div>
      </div>
      <div class="field">
        <label class="field__label" for="b-bank">اسم البنك</label>
        <input class="input" id="b-bank" maxlength="80">
      </div>
      <div class="field">
        <label class="field__label" for="b-cliq">اسم أو رقم CliQ</label>
        <input class="input ltr" id="b-cliq" maxlength="40">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="b-save">حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#b-save').addEventListener('click', async () => {
        const iban = api.$('#b-iban').value.replace(/\s+/g, '').toUpperCase();
        const cliq = api.$('#b-cliq').value.trim();
        const err = api.$('#b-iban-err');

        if (iban && !isValidIBAN(iban)) {
          err.textContent = 'رقم IBAN غير صالح (تحقق من الصيغة والرقم).';
          err.hidden = false;
          return;
        }
        if (cliq && !isValidCliq(cliq)) return toastError('اسم/رقم CliQ غير صالح.');

        const button = api.$('#b-save');
        setBusy(button, true);
        try {
          await callFn('updateOwnBanking', {
            iban, cliq, bankName: sanitizeText(api.$('#b-bank').value, 80)
          });
          toastSuccess('تم حفظ البيانات البنكية.');
          api.close();
          location.reload();
        } catch (e) { reportError(e, 'banking'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

/* ----------------------------------------------------------------- account */

function renderAccount(host, profile) {
  const admin = isAdmin(session.claims);
  const selectedRoles = new Set(profile.roles || []);
  const selectedPerms = new Set(
    Object.entries(PERMISSIONS)
      .filter(([, meta]) => (profile.perms || []).includes(meta.code))
      .map(([name]) => name)
  );

  host.innerHTML = `
    <div class="grid grid-main mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="shield"></i> الصلاحيات</div></div>
        ${admin ? `
          <div class="field">
            <label class="field__label">نوع الحساب</label>
            <select class="select" id="a-role">
              ${Object.entries(ROLE_LABELS).map(([k, v]) => `
                <option value="${k}" ${(profile.accountRole || 'employee') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label">المسميات الوظيفية</label>
            <div class="chip-select" id="a-roles">
              ${Object.entries(JOB_ROLES).map(([k, v]) => `
                <button type="button" class="chip-toggle${selectedRoles.has(k) ? ' is-on' : ''}"
                        data-role="${attr(k)}">${esc(v.ar)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label class="field__label">الصلاحيات التفصيلية</label>
            <div id="a-perms" style="max-height:340px;overflow-y:auto;border:1px solid var(--border);
                 border-radius:var(--radius-sm);padding:var(--sp-3)"></div>
          </div>
          <button class="btn btn--primary" id="a-save"><i data-lucide="save"></i> حفظ الصلاحيات</button>
        ` : `
          <div class="tag-list">
            ${[...selectedPerms].map((p) => `<span class="badge">${esc(PERMISSIONS[p].ar)}</span>`).join('')
              || '<span class="text-muted fs-sm">لا صلاحيات إضافية.</span>'}
          </div>
          <p class="fs-xs text-muted mt-3">تعديل الصلاحيات متاح لمدير النظام فقط.</p>`}
      </div>

      <div class="flex-col gap-4">
        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="settings-2"></i> إدارة الحساب</div></div>
          <div class="kv"><span class="kv__k">الحالة</span>
            <span class="kv__v">${profile.status === 'disabled' ? 'معطّل' : 'نشط'}</span></div>
          <div class="kv"><span class="kv__k">تغيير كلمة المرور إجبارياً</span>
            <span class="kv__v">${profile.mustChangePassword ? 'نعم' : 'لا'}</span></div>
          <div class="list-divider"></div>
          <div class="flex-col gap-2">
            <button class="btn btn--secondary btn--block" id="a-reset">
              <i data-lucide="key-round"></i> إعادة تعيين كلمة المرور
            </button>
            ${can(session.claims, 'employees.delete') ? `
              <button class="btn btn--${profile.status === 'disabled' ? 'success' : 'outline-danger'} btn--block" id="a-toggle">
                <i data-lucide="${profile.status === 'disabled' ? 'user-check' : 'user-x'}"></i>
                ${profile.status === 'disabled' ? 'إعادة تفعيل الحساب' : 'تعطيل الحساب'}
              </button>
              <div class="list-divider"></div>
              <div class="security-note" style="background:var(--danger-soft);border-color:rgba(248,113,113,.3)">
                <i data-lucide="alert-triangle" style="color:var(--danger)"></i>
                <div class="fs-xs">
                  <strong>منطقة الخطر.</strong> التعطيل يمنع الدخول ويحتفظ بكل السجلات —
                  وهو الخيار الموصى به. الحذف النهائي لا يمكن التراجع عنه.
                </div>
              </div>
              <button class="btn btn--danger btn--block" id="a-delete">
                <i data-lucide="trash-2"></i> حذف الموظف نهائياً
              </button>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card__head"><div class="card__title"><i data-lucide="calendar-check"></i> رصيد الإجازات</div></div>
          <div class="kv"><span class="kv__k">الرصيد السنوي</span>
            <span class="kv__v num">${profile.leave?.annualQuota ?? 14} يوم</span></div>
          <div class="kv"><span class="kv__k">المستخدم</span>
            <span class="kv__v num">${profile.leave?.used ?? 0} يوم</span></div>
          <div class="kv"><span class="kv__k">المتبقي</span>
            <span class="kv__v num">${profile.leave?.remaining ?? (profile.leave?.annualQuota ?? 14)} يوم</span></div>
          ${can(session.claims, 'employees.edit') ? `
            <button class="btn btn--ghost btn--block mt-3" id="a-leave">
              <i data-lucide="pencil"></i> تعديل الرصيد</button>` : ''}
        </div>
      </div>
    </div>`;

  refreshIcons(host);

  if (admin) {
    const permHost = $('#a-perms');
    const paintPerms = () => {
      permHost.innerHTML = Object.entries(PERMISSION_GROUPS).map(([groupKey, groupLabel]) => `
        <div class="mb-3">
          <div class="fs-xs fw-700 text-brand mb-2">${esc(groupLabel)}</div>
          ${Object.entries(PERMISSIONS).filter(([, m]) => m.group === groupKey).map(([name, meta]) => `
            <label class="checkbox" style="display:flex;padding:3px 0">
              <input type="checkbox" data-perm="${attr(name)}" ${selectedPerms.has(name) ? 'checked' : ''}>
              <span class="fs-sm">${esc(meta.ar)}</span>
            </label>`).join('')}
        </div>`).join('');
      permHost.querySelectorAll('[data-perm]').forEach((box) => box.addEventListener('change', () => {
        if (box.checked) selectedPerms.add(box.dataset.perm);
        else selectedPerms.delete(box.dataset.perm);
      }));
    };
    paintPerms();

    $$('[data-role]', host).forEach((chip) => chip.addEventListener('click', () => {
      const role = chip.dataset.role;
      if (selectedRoles.has(role)) { selectedRoles.delete(role); chip.classList.remove('is-on'); }
      else { selectedRoles.add(role); chip.classList.add('is-on'); }
    }));

    $('#a-save').addEventListener('click', async () => {
      const button = $('#a-save');
      setBusy(button, true);
      try {
        await callFn('updateEmployeeAccess', {
          uid: profile.id,
          roles: [...selectedRoles],
          accountRole: $('#a-role').value,
          permissions: [...selectedPerms]
        });
        toastSuccess('تم تحديث الصلاحيات. ستُطبّق على الموظف خلال دقيقة.');
      } catch (err) { reportError(err, 'access'); }
      finally { setBusy(button, false); }
    });
  }

  $('#a-reset')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'إعادة تعيين كلمة المرور',
      message: `سيتم توليد كلمة مرور مؤقتة جديدة لـ ${esc(profile.displayName)} وإلزامه بتغييرها عند أول دخول.`,
      confirmText: 'إعادة التعيين'
    });
    if (!ok) return;
    try {
      const result = await callFn('resetEmployeePassword', { uid: profile.id });
      openModal({
        title: 'كلمة المرور المؤقتة الجديدة',
        size: 'sm',
        bodyHTML: `
          <div class="security-note mb-4"><i data-lucide="key-round"></i>
            <div>تُعرض مرة واحدة فقط — سلّمها للموظف عبر قناة آمنة.</div></div>
          <div class="secret-field"><span class="secret-field__value">${esc(result.tempPassword)}</span></div>`,
        footerHTML: '<button class="btn btn--primary" data-modal-close>تم</button>',
        onMount: (api) => refreshIcons(api.root)
      });
    } catch (err) { reportError(err, 'reset-password'); }
  });

  $('#a-toggle')?.addEventListener('click', async () => {
    const disabling = profile.status !== 'disabled';
    const ok = await confirmDialog({
      title: disabling ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب',
      message: disabling
        ? 'سيتم منع الموظف من تسجيل الدخول فوراً مع الاحتفاظ بكل بياناته ومهامه.'
        : 'سيتمكن الموظف من تسجيل الدخول مرة أخرى.',
      confirmText: disabling ? 'تعطيل' : 'تفعيل',
      danger: disabling
    });
    if (!ok) return;
    try {
      await callFn('setEmployeeStatus', { uid: profile.id, status: disabling ? 'disabled' : 'active' });
      toastSuccess(disabling ? 'تم تعطيل الحساب.' : 'تم تفعيل الحساب.');
    } catch (err) { reportError(err, 'status'); }
  });

  $('#a-delete')?.addEventListener('click', () => openDeleteEmployee(profile));

  $('#a-leave')?.addEventListener('click', () => {
    openModal({
      title: 'تعديل رصيد الإجازات',
      size: 'sm',
      bodyHTML: `
        <div class="field">
          <label class="field__label" for="l-quota">الرصيد السنوي (أيام)</label>
          <input class="input ltr" id="l-quota" type="number" min="0" max="60"
                 value="${profile.leave?.annualQuota ?? 14}">
        </div>
        <div class="field">
          <label class="field__label" for="l-used">الأيام المستخدمة</label>
          <input class="input ltr" id="l-used" type="number" min="0" value="${profile.leave?.used ?? 0}">
        </div>`,
      footerHTML: `
        <button class="btn btn--ghost" data-modal-close>إلغاء</button>
        <button class="btn btn--primary" id="l-save">حفظ</button>`,
      onMount: (api) => {
        api.$('#l-save').addEventListener('click', async () => {
          const quota = Number(api.$('#l-quota').value) || 0;
          const used = Number(api.$('#l-used').value) || 0;
          try {
            await callFn('updateLeaveBalance', {
              uid: profile.id, annualQuota: quota, used, remaining: Math.max(0, quota - used)
            });
            toastSuccess('تم تحديث رصيد الإجازات.');
            api.close();
          } catch (err) { reportError(err, 'leave'); }
        });
      }
    });
  });
}

/* ------------------------------------------------------------ profile edit */

function openProfileEditor(profile, isSelf) {
  const canEditAll = can(session.claims, 'employees.edit');

  openModal({
    title: 'تعديل البيانات',
    size: 'lg',
    bodyHTML: `
      <div class="form-grid">
        ${canEditAll ? `
        <div class="field">
          <label class="field__label" for="pe-name">الاسم الكامل</label>
          <input class="input" id="pe-name" maxlength="120" value="${attr(profile.displayName || '')}">
        </div>` : ''}
        <div class="field">
          <label class="field__label" for="pe-phone">رقم الهاتف</label>
          <input class="input ltr" id="pe-phone" type="tel" value="${attr(profile.phone || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="pe-email">البريد الإلكتروني الشخصي</label>
          <input class="input ltr" id="pe-email" type="email" value="${attr(profile.personalEmail || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="pe-birthday">تاريخ الميلاد</label>
          <input class="input" id="pe-birthday" type="date" value="${attr(profile.birthday || '')}">
        </div>
        ${canEditAll ? `
        <div class="field">
          <label class="field__label" for="pe-dept">القسم</label>
          <select class="select" id="pe-dept">
            ${Object.entries(DEPARTMENTS).map(([k, v]) => `
              <option value="${k}" ${profile.department === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="pe-join">تاريخ المباشرة</label>
          <input class="input" id="pe-join" type="date" value="${attr(profile.joinDate || '')}">
        </div>` : ''}
        <div class="field field--full">
          <label class="field__label" for="pe-notes">
            ${canEditAll ? 'ملاحظات الإدارة' : 'ملاحظاتي الشخصية'}
          </label>
          <textarea class="textarea" id="pe-notes" maxlength="2000">${esc(
            canEditAll ? (profile.notes || '') : (profile.personalNotes || '')
          )}</textarea>
        </div>
      </div>
      ${!canEditAll ? `
        <div class="security-note">
          <i data-lucide="info"></i>
          <div>الراتب والمسميات والصلاحيات ورصيد الإجازات تُعدَّل من قبل الإدارة فقط.</div>
        </div>` : ''}`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="pe-save">حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#pe-save').addEventListener('click', async () => {
        const phone = api.$('#pe-phone').value.trim();
        const email = api.$('#pe-email').value.trim();
        if (phone && !isValidPhone(phone)) return toastError('رقم الهاتف غير صالح.');
        if (email && !isValidEmail(email)) return toastError('البريد الإلكتروني غير صالح.');

        const patch = {
          phone,
          personalEmail: email,
          birthday: api.$('#pe-birthday').value || null,
          updatedAt: ts()
        };
        if (canEditAll) {
          const name = sanitizeText(api.$('#pe-name').value, 120);
          if (name) { patch.displayName = name; patch.displayNameLower = name.toLowerCase(); }
          patch.department = api.$('#pe-dept').value;
          patch.joinDate = api.$('#pe-join').value || null;
          patch.notes = sanitizeText(api.$('#pe-notes').value, 2000);
        } else {
          patch.personalNotes = sanitizeText(api.$('#pe-notes').value, 2000);
        }

        const button = api.$('#pe-save');
        setBusy(button, true);
        try {
          await updateDoc(ref('users', profile.id), patch);
          toastSuccess('تم حفظ البيانات.');
          api.close();
        } catch (err) { reportError(err, 'profile-edit'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

/**
 * Permanent employee deletion.
 * Typing the username is required — a plain "are you sure?" is too easy to
 * click through for something this destructive.
 */
function openDeleteEmployee(profile) {
  openModal({
    title: 'حذف الموظف نهائياً',
    subtitle: profile.displayName,
    size: 'sm',
    closeOnBackdrop: false,
    bodyHTML: `
      <div class="security-note mb-4" style="background:var(--danger-soft);border-color:rgba(248,113,113,.35)">
        <i data-lucide="alert-triangle" style="color:var(--danger)"></i>
        <div><strong>لا يمكن التراجع عن هذا الإجراء.</strong></div>
      </div>

      <div class="fs-sm mb-3">سيتم حذف:</div>
      <ul class="fs-sm text-secondary" style="line-height:2;padding-inline-start:18px;list-style:disc">
        <li>حساب الدخول والملف الشخصي</li>
        <li>الطلبات الإدارية ومراسلاتها</li>
        <li>سجل الاستراحات والإشعارات</li>
        <li>عضويته في مجموعات الدردشة</li>
      </ul>

      <div class="fs-sm mt-3 mb-3">وسيتم الاحتفاظ بـ:</div>
      <ul class="fs-sm text-secondary" style="line-height:2;padding-inline-start:18px;list-style:disc">
        <li><strong>المهام</strong> — تبقى كما هي مع إزالة اسمه من المسؤولين</li>
        <li><strong>سجل التدقيق</strong> — يبقى كاملاً للمراجعة</li>
      </ul>

      <div class="field mt-4">
        <label class="field__label" for="del-confirm">
          للتأكيد اكتب اسم المستخدم: <code class="ltr">${esc(profile.username)}</code>
        </label>
        <input class="input ltr" id="del-confirm" autocomplete="off" spellcheck="false"
               placeholder="${attr(profile.username)}">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--danger" id="del-go" disabled>
        <i data-lucide="trash-2"></i> حذف نهائي
      </button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      const input = api.$('#del-confirm');
      const button = api.$('#del-go');

      input.addEventListener('input', () => {
        button.disabled = input.value.trim().toLowerCase() !== profile.username.toLowerCase();
      });

      button.addEventListener('click', async () => {
        setBusy(button, true);
        try {
          const result = await callFn('deleteEmployee', { uid: profile.id });
          api.close();
          const parts = [];
          if (result.removed?.tasksUnassigned) parts.push(`${result.removed.tasksUnassigned} مهمة أُلغي إسنادها`);
          if (result.removed?.requests) parts.push(`${result.removed.requests} طلب`);
          if (result.removed?.chatsLeft) parts.push(`${result.removed.chatsLeft} محادثة`);
          toastSuccess(
            parts.length ? `تم حذف الموظف — ${parts.join(' · ')}` : 'تم حذف الموظف نهائياً.'
          );
          location.hash = '#/employees';
        } catch (err) {
          reportError(err, 'delete-employee');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}

/** A circular progress ring with the percentage centred inside it. */
function ringHTML(percent, { size = 128, stroke = 12, sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const offset = c - (clamped / 100) * c;
  return `
    <div class="ring-wrap" style="width:${size}px;height:${size}px">
      <svg class="progress-ring" width="${size}" height="${size}">
        <circle class="progress-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"></circle>
        <circle class="progress-ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <div class="ring-wrap__label">
        <div class="ring-wrap__value num">${Math.round(clamped)}%</div>
        ${sub ? `<div class="ring-wrap__sub">${esc(sub)}</div>` : ''}
      </div>
    </div>`;
}

/** Tasks completed per day, last 7 days — one column per day, today highlighted. */
function weekBarsHTML(tasks) {
  const days = dailySeries(tasks, 7);
  const max = Math.max(1, ...days.map((d) => d.completed));
  const todayStr = new Date().toDateString();
  return `
    <div class="week-bars">
      ${days.map((d) => {
        const isToday = d.date.toDateString() === todayStr;
        const h = d.completed ? Math.max(10, Math.round((d.completed / max) * 100)) : 4;
        return `
          <div class="week-bars__col">
            <div class="week-bars__count">${d.completed || ''}</div>
            <div class="week-bars__track">
              <div class="week-bars__fill${isToday ? ' week-bars__fill--today' : ''}" style="height:${h}%"></div>
            </div>
            <div class="week-bars__label${isToday ? ' is-today' : ''}">${esc(AR_DAYS_SHORT[weekdayIndex(d.date)])}</div>
          </div>`;
      }).join('')}
    </div>`;
}

function stat(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num">${esc(value)}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}
