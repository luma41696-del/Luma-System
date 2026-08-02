/**
 * Reports & statistics — daily, weekly, monthly, annual and custom ranges.
 * Every figure is computed from the real task / break / request documents; the
 * export paths (PDF, CSV, print) reuse exactly the same numbers.
 */

import { session } from './auth.js';
import { can, rolesLabel, JOB_ROLES, DEPARTMENTS } from './permissions.js';
import { $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, avatarHTML } from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import {
  col, query, where, orderBy, limit, getMany, getDirectory, getOne
} from './utils/api.js';
import {
  summarize, dailySeries, monthlySeries, TASK_STATUSES, PRIORITIES, isOverdue
} from './utils/task-model.js';
import {
  formatDate, formatDuration, formatPercent, toMillis, startOfDay, endOfDay,
  startOfWeek, startOfMonth, startOfYear, AR_MONTHS_SHORT, dayKey, addDays, toDateInput
} from './utils/format.js';
import { barChart, lineChart, doughnutChart, destroyAllCharts } from './utils/charts.js';
import { buildReportSheet, downloadPdf, printSheet, downloadCsv } from './utils/pdf.js';

const PRESETS = {
  today:  'اليوم',
  week:   'هذا الأسبوع',
  month:  'هذا الشهر',
  year:   'هذه السنة',
  custom: 'فترة مخصصة'
};

export async function render(container) {
  const canCompany = can(session.claims, 'dashboard.viewCompany') || can(session.claims, 'tasks.editAll');
  const canExport = can(session.claims, 'reports.export');

  let preset = 'month';
  let from = startOfMonth();
  let to = endOfDay();
  let employeeId = canCompany ? 'all' : session.uid;
  let data = { tasks: [], breaks: [], requests: [] };

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">التقارير والإحصائيات</div>
          <div class="page-head__sub" id="report-range">…</div>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--secondary" id="r-print"><i data-lucide="printer"></i> طباعة</button>
          ${canExport ? `
            <button class="btn btn--secondary" id="r-csv"><i data-lucide="table"></i> CSV</button>
            <button class="btn btn--primary" id="r-pdf"><i data-lucide="file-down"></i> تصدير PDF</button>` : ''}
        </div>
      </div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="calendar-range"></i> الفترة</span>
        <select class="select" id="f-preset">
          ${Object.entries(PRESETS).map(([k, v]) => `
            <option value="${k}" ${k === 'month' ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <input class="input" id="f-from" type="date" hidden>
        <input class="input" id="f-to" type="date" hidden>
        ${canCompany ? `
          <select class="select" id="f-employee">
            <option value="all">كل الموظفين</option>
            ${directory.map((u) => `<option value="${attr(u.id)}">${esc(u.displayName)}</option>`).join('')}
          </select>` : ''}
        <button class="btn btn--primary btn--sm" id="f-run"><i data-lucide="play"></i> تشغيل التقرير</button>
      </div>

      <div id="report-body">${'<div class="skeleton skeleton--card"></div>'.repeat(4)}</div>
    </div>`;

  refreshIcons(container);

  $('#f-preset').addEventListener('change', (e) => {
    preset = e.target.value;
    const custom = preset === 'custom';
    $('#f-from').hidden = !custom;
    $('#f-to').hidden = !custom;
    if (custom) {
      $('#f-from').value = toDateInput(from);
      $('#f-to').value = toDateInput(to);
    } else {
      applyPreset();
      run();
    }
  });

  $('#f-employee')?.addEventListener('change', (e) => { employeeId = e.target.value; run(); });
  $('#f-run').addEventListener('click', () => {
    if (preset === 'custom') {
      const fromValue = $('#f-from').value;
      const toValue = $('#f-to').value;
      if (!fromValue || !toValue) return toastError('حدد تاريخي البداية والنهاية.');
      from = startOfDay(new Date(fromValue));
      to = endOfDay(new Date(toValue));
    }
    run();
  });

  function applyPreset() {
    to = endOfDay();
    if (preset === 'today') from = startOfDay();
    else if (preset === 'week') from = startOfWeek();
    else if (preset === 'month') from = startOfMonth();
    else if (preset === 'year') from = startOfYear();
  }

  function rangeLabel() {
    return `${formatDate(from)} — ${formatDate(to)}`;
  }

  async function run() {
    $('#report-range').textContent = rangeLabel();
    mount($('#report-body'), '<div class="skeleton skeleton--card"></div>'.repeat(4));
    destroyAllCharts();

    try {
      const constraints = [];
      if (employeeId !== 'all') constraints.push(where('assignees', 'array-contains', employeeId));

      const [tasks, breaks, requests] = await Promise.all([
        getMany(query(col('tasks'), ...constraints, orderBy('createdAt', 'desc'), limit(1000))),
        loadBreaks(),
        loadRequests()
      ]);

      // Filter by the reporting window: a task counts if it was created,
      // completed or is due inside the range.
      const inRange = (value) => {
        const at = toMillis(value);
        return at >= from.getTime() && at <= to.getTime();
      };
      data.tasks = tasks.filter((t) =>
        !t.deleted && (inRange(t.createdAt) || inRange(t.completedAt) || inRange(t.dueAt)));
      data.breaks = breaks;
      data.requests = requests;

      paint();
    } catch (err) {
      mount($('#report-body'), emptyState({
        icon: 'alert-triangle', title: 'تعذّر إنشاء التقرير', text: err.message
      }));
      refreshIcons($('#report-body'));
    }
  }

  async function loadBreaks() {
    const constraints = employeeId !== 'all' ? [where('userId', '==', employeeId)] : [];
    const rows = await getMany(query(
      col('breakSessions'), ...constraints, orderBy('startedAt', 'desc'), limit(1000)
    )).catch(() => []);
    return rows.filter((b) => {
      const at = toMillis(b.startedAt);
      return at >= from.getTime() && at <= to.getTime();
    });
  }

  async function loadRequests() {
    const constraints = employeeId !== 'all' ? [where('employeeId', '==', employeeId)] : [];
    const rows = await getMany(query(
      col('requests'), ...constraints, orderBy('createdAt', 'desc'), limit(500)
    )).catch(() => []);
    return rows.filter((r) => {
      const at = toMillis(r.createdAt);
      return at >= from.getTime() && at <= to.getTime();
    });
  }

  function paint() {
    const stats = summarize(data.tasks, { uid: employeeId !== 'all' ? employeeId : null });
    const breakMs = data.breaks.reduce((sum, b) => sum + (b.durationMs || 0), 0);
    const leaveDays = data.requests
      .filter((r) => r.status === 'approved' && ['leave', 'sick'].includes(r.type))
      .reduce((sum, r) => sum + (r.days || 0), 0);

    const employee = employeeId !== 'all' ? people[employeeId] : null;

    $('#report-body').innerHTML = `
      <div class="grid grid-4">
        ${stat('layers', 'brand', stats.total, 'المهام في الفترة')}
        ${stat('check-circle-2', 'success', stats.completed, 'مهام مكتملة')}
        ${stat('list-todo', 'info', stats.open, 'مهام متبقية')}
        ${stat('alert-triangle', 'danger', stats.overdue, 'مهام متأخرة')}
      </div>

      <div class="grid grid-4 mt-4">
        ${stat('percent', 'success', formatPercent(stats.completionRate), 'نسبة الإنجاز')}
        ${stat('timer', 'info', formatDuration(stats.avgCompletionMs), 'متوسط زمن الإنجاز')}
        ${stat('coffee', 'warning', formatDuration(breakMs), 'إجمالي الاستراحات')}
        ${stat('palmtree', 'purple', `${leaveDays} يوم`, 'أيام الإجازات')}
      </div>

      <div class="grid grid-2 mt-4">
        <div class="card">
          <div class="card__head"><div class="card__title">الإنجاز عبر الفترة</div></div>
          <div class="chart-box" style="height:260px"><canvas id="rep-trend"></canvas></div>
        </div>
        <div class="card">
          <div class="card__head"><div class="card__title">توزيع الحالات</div></div>
          <div class="chart-box" style="height:260px"><canvas id="rep-status"></canvas></div>
        </div>
        <div class="card">
          <div class="card__head"><div class="card__title">المهام حسب العميل</div></div>
          <div class="chart-box" style="height:260px"><canvas id="rep-client"></canvas></div>
        </div>
        <div class="card">
          <div class="card__head"><div class="card__title">المهام حسب الأولوية</div></div>
          <div class="chart-box" style="height:260px"><canvas id="rep-priority"></canvas></div>
        </div>
      </div>

      ${employeeId === 'all' ? `
      <div class="card mt-4">
        <div class="card__head">
          <div class="card__title"><i data-lucide="users"></i> الأداء حسب الموظف</div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>الموظف</th><th>المسمى</th><th>مُسندة</th><th>مكتملة</th>
                  <th>متبقية</th><th>متأخرة</th><th>نسبة الإنجاز</th></tr>
            </thead>
            <tbody id="emp-rows"></tbody>
          </table>
        </div>
      </div>` : ''}

      <div class="card mt-4">
        <div class="card__head"><div class="card__title"><i data-lucide="list"></i> تفاصيل المهام</div></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>المهمة</th><th>العميل</th><th>الحالة</th><th>الموعد</th><th>الإنجاز</th></tr></thead>
            <tbody>
              ${data.tasks.slice(0, 60).map((t) => `
                <tr>
                  <td class="is-strong">${esc(t.title)}</td>
                  <td>${esc(t.clientName || '—')}</td>
                  <td>${esc(isOverdue(t) ? 'متأخرة' : TASK_STATUSES[t.status]?.ar || t.status)}</td>
                  <td class="num">${t.dueAt ? esc(formatDate(t.dueAt, { short: true })) : '—'}</td>
                  <td class="num">${t.completedAt ? esc(formatDate(t.completedAt, { short: true })) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${data.tasks.length > 60
          ? `<div class="fs-xs text-muted mt-3">يُعرض أول 60 صفاً — صدّر CSV للحصول على القائمة الكاملة (${data.tasks.length} مهمة).</div>`
          : ''}
      </div>`;

    refreshIcons($('#report-body'));

    /* charts */
    const days = Math.max(1, Math.round((to - from) / 86_400_000));
    if (days <= 62) {
      const series = dailySeries(data.tasks, Math.min(days, 31));
      lineChart('rep-trend', series.map((d) => `${d.date.getDate()}`), [
        { label: 'مكتملة', data: series.map((d) => d.completed) },
        { label: 'جديدة', data: series.map((d) => d.created), fill: false }
      ]);
    } else {
      const months = monthlySeries(data.tasks);
      barChart('rep-trend', AR_MONTHS_SHORT, [
        { label: 'مكتملة', data: months.map((m) => m.completed) },
        { label: 'جديدة', data: months.map((m) => m.created) }
      ]);
    }

    const statusKeys = Object.keys(TASK_STATUSES).filter((k) => stats.byStatus[k] > 0);
    doughnutChart('rep-status', statusKeys.map((k) => TASK_STATUSES[k].ar),
      statusKeys.map((k) => stats.byStatus[k]));

    const clientRows = Object.values(stats.byClient).sort((a, b) => b.total - a.total).slice(0, 8);
    barChart('rep-client', clientRows.map((c) => c.name),
      [{ label: 'مهام', data: clientRows.map((c) => c.total) }], { horizontal: true });

    const priorityKeys = Object.keys(PRIORITIES).filter((k) => stats.byPriority[k] > 0);
    doughnutChart('rep-priority', priorityKeys.map((k) => PRIORITIES[k].ar),
      priorityKeys.map((k) => stats.byPriority[k]));

    /* per-employee table */
    const empRows = $('#emp-rows');
    if (empRows) {
      const rows = Object.entries(stats.byAssignee)
        .map(([uid, v]) => ({ user: people[uid], ...v }))
        .filter((r) => r.user)
        .sort((a, b) => b.total - a.total);
      empRows.innerHTML = rows.map((r) => {
        const rate = r.total ? Math.round((r.completed / r.total) * 100) : 0;
        return `
          <tr onclick="location.hash='#/employees/${attr(r.user.id)}'" style="cursor:pointer">
            <td class="is-strong">${esc(r.user.displayName)}</td>
            <td>${esc(rolesLabel(r.user.roles))}</td>
            <td class="num">${r.total}</td>
            <td class="num">${r.completed}</td>
            <td class="num">${r.open}</td>
            <td class="num" style="color:${r.overdue ? 'var(--danger)' : 'inherit'}">${r.overdue}</td>
            <td style="min-width:110px">
              <div class="progress"><div class="progress__bar" style="width:${rate}%"></div></div>
              <span class="fs-2xs text-muted num">${rate}%</span>
            </td>
          </tr>`;
      }).join('');
    }

    /* exports */
    const sheet = () => buildReportSheet({
      title: employee ? `تقرير أداء — ${employee.displayName}` : 'تقرير أداء الوكالة',
      subtitle: 'تقرير آلي من نظام إدارة لوما',
      periodLabel: rangeLabel(),
      employee: employee
        ? { displayName: employee.displayName, rolesLabel: rolesLabel(employee.roles) } : {},
      sections: [
        {
          title: 'ملخص المهام',
          rows: [
            ['إجمالي المهام', stats.total],
            ['مكتملة', stats.completed],
            ['متبقية', stats.open],
            ['متأخرة', stats.overdue],
            ['قيد التنفيذ', stats.inProgress],
            ['قيد المراجعة', stats.review],
            ['نسبة الإنجاز', formatPercent(stats.completionRate)],
            ['متوسط زمن الإنجاز', formatDuration(stats.avgCompletionMs)]
          ]
        },
        {
          title: 'الحضور والإجازات',
          rows: [
            ['إجمالي مدة الاستراحات', formatDuration(breakMs)],
            ['عدد الاستراحات', data.breaks.length],
            ['أيام الإجازات المعتمدة', `${leaveDays} يوم`],
            ['الطلبات المقدَّمة', data.requests.length]
          ]
        }
      ],
      tables: [
        {
          title: 'المهام حسب الحالة',
          head: ['الحالة', 'العدد'],
          rows: statusKeys.map((k) => [TASK_STATUSES[k].ar, stats.byStatus[k]])
        },
        ...(clientRows.length ? [{
          title: 'المهام حسب العميل',
          head: ['العميل', 'الإجمالي', 'المكتملة'],
          rows: clientRows.map((c) => [c.name, c.total, c.completed])
        }] : [])
      ]
    });

    $('#r-print').onclick = () => printSheet(sheet());
    if ($('#r-pdf')) {
      $('#r-pdf').onclick = async () => {
        const button = $('#r-pdf');
        setBusy(button, true);
        try {
          await downloadPdf(sheet(), `luma-report-${dayKey(from)}_${dayKey(to)}`);
        } finally { setBusy(button, false); }
      };
    }
    if ($('#r-csv')) {
      $('#r-csv').onclick = () => {
        downloadCsv(data.tasks.map((t) => ({
          'العنوان': t.title,
          'العميل': t.clientName || '',
          'المشروع': t.project || '',
          'الحالة': isOverdue(t) ? 'متأخرة' : (TASK_STATUSES[t.status]?.ar || t.status),
          'الأولوية': PRIORITIES[t.priority]?.ar || t.priority,
          'المسؤولون': (t.assignees || []).map((id) => people[id]?.displayName || id).join(' | '),
          'تاريخ الإنشاء': t.createdAt ? formatDate(t.createdAt) : '',
          'الموعد النهائي': t.dueAt ? formatDate(t.dueAt) : '',
          'تاريخ الإنجاز': t.completedAt ? formatDate(t.completedAt) : '',
          'الوقت المستغرق': formatDuration(t.timeSpentMs || 0)
        })), `luma-tasks-${dayKey(from)}_${dayKey(to)}`);
        toastSuccess('تم تصدير الملف.');
      };
    }
  }

  applyPreset();
  await run();

  return () => destroyAllCharts();
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
