/**
 * Calendar — month / week / day / agenda, in Arabic with Asia/Amman as the
 * reference timezone. Events come from three sources and are colour coded:
 *   • tasks (deadlines)      • calendarEvents (meetings, team events)
 *   • approved leave requests
 *
 * Built in-house rather than with FullCalendar so the RTL layout, Arabic month
 * names and the soft event-card look stay under our control.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, avatarHTML, setBusy, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, deleteDoc,
  getDirectory, getMany, ts
} from './utils/api.js';
import {
  AR_MONTHS, AR_DAYS, AR_DAYS_SHORT, formatDate, formatTime, formatDateTime,
  toMillis, toDate, toDateTimeInput, startOfMonth, startOfWeek, startOfDay,
  endOfDay, addDays, weekdayIndex, dayKey, isToday
} from './utils/format.js';
import { sanitizeText, sanitizeMultiline } from './utils/sanitize.js';
import { TASK_STATUSES, isOverdue, myTasksQuery, allTasksQuery, watchTasks } from './utils/task-model.js';

export const EVENT_TYPES = {
  meeting:  { ar: 'اجتماع',       cls: 'meeting',  icon: 'users' },
  deadline: { ar: 'موعد تسليم',   cls: 'deadline', icon: 'flag' },
  task:     { ar: 'مهمة',         cls: 'task',     icon: 'check-square' },
  leave:    { ar: 'إجازة',        cls: 'leave',    icon: 'palmtree' },
  event:    { ar: 'حدث',          cls: 'meeting',  icon: 'calendar' },
  birthday: { ar: 'عيد ميلاد',    cls: 'birthday', icon: 'cake' }
};

export async function render(container, ctx) {
  const unsubs = [];
  const canSeeAll = can(session.claims, 'dashboard.viewCompany') || can(session.claims, 'tasks.editAll');

  let view = localStorage.getItem('luma.calView') || 'month';
  let cursor = ctx.query.date ? new Date(ctx.query.date) : new Date();
  if (isNaN(cursor)) cursor = new Date();

  let tasks = [];
  let events = [];
  let leaves = [];
  let filters = { employee: 'all', client: 'all', type: 'all' };

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
          <div class="page-head__title">التقويم</div>
          <div class="page-head__sub">المواعيد والمهام والإجازات — بتوقيت عمّان</div>
        </div>
        <div class="page-head__actions">
          <div class="btn-group" id="cal-views">
            <button data-view="month">شهر</button>
            <button data-view="week">أسبوع</button>
            <button data-view="day">يوم</button>
            <button data-view="agenda">جدول</button>
          </div>
          <button class="btn btn--primary" id="cal-add"><i data-lucide="plus"></i> حدث جديد</button>
        </div>
      </div>

      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="topbar__icon-btn" id="cal-prev" aria-label="السابق">
            <i data-lucide="chevron-right"></i></button>
          <div class="cal-title" id="cal-title"></div>
          <button class="topbar__icon-btn" id="cal-next" aria-label="التالي">
            <i data-lucide="chevron-left"></i></button>
          <button class="btn btn--secondary btn--sm" id="cal-today">اليوم</button>
        </div>

        <div class="flex gap-2 items-center" style="flex-wrap:wrap">
          ${canSeeAll ? `
          <select class="select" id="f-employee" style="min-height:36px;font-size:var(--fs-sm)">
            <option value="all">كل الموظفين</option>
            ${directory.map((u) => `<option value="${attr(u.id)}">${esc(u.displayName)}</option>`).join('')}
          </select>` : ''}
          ${clients.length ? `
          <select class="select" id="f-client" style="min-height:36px;font-size:var(--fs-sm)">
            <option value="all">كل العملاء</option>
            ${clients.map((c) => `<option value="${attr(c.id)}">${esc(c.name)}</option>`).join('')}
          </select>` : ''}
          <select class="select" id="f-type" style="min-height:36px;font-size:var(--fs-sm)">
            <option value="all">كل الأنواع</option>
            ${Object.entries(EVENT_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="cal-strip"></div>
      <div id="cal-body">${'<div class="skeleton skeleton--row"></div>'.repeat(5)}</div>

      <div class="legend mt-4">
        ${Object.entries(EVENT_TYPES).map(([, v]) => `
          <span class="legend__item">
            <span class="legend__swatch cal-event cal-event--${v.cls}" style="padding:0"></span>
            ${esc(v.ar)}
          </span>`).join('')}
      </div>
    </div>`;

  refreshIcons(container);

  /* ------------------------------------------------------------- wiring */
  const syncViewButtons = () =>
    $$('#cal-views button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  syncViewButtons();

  $('#cal-views').addEventListener('click', (e) => {
    const button = e.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    localStorage.setItem('luma.calView', view);
    syncViewButtons();
    paint();
  });

  $('#cal-prev').addEventListener('click', () => { step(-1); });
  $('#cal-next').addEventListener('click', () => { step(1); });
  $('#cal-today').addEventListener('click', () => { cursor = new Date(); paint(); });
  $('#cal-add').addEventListener('click', () => openEventModal({ date: cursor }));

  ['#f-employee', '#f-client', '#f-type'].forEach((sel) => {
    $(sel)?.addEventListener('change', () => {
      filters = {
        employee: $('#f-employee')?.value || 'all',
        client: $('#f-client')?.value || 'all',
        type: $('#f-type').value
      };
      paint();
    });
  });

  function step(direction) {
    if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    else if (view === 'week') cursor = addDays(cursor, direction * 7);
    else if (view === 'day') cursor = addDays(cursor, direction);
    else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    paint();
  }

  /* --------------------------------------------------------------- data */
  const taskQuery = canSeeAll ? allTasksQuery() : myTasksQuery(session.uid);
  unsubs.push(watchTasks(taskQuery, (rows) => {
    tasks = rows.filter((t) => !t.deleted && t.dueAt);
    paint();
  }));

  unsubs.push(onSnapshot(
    query(col('calendarEvents'), orderBy('startAt', 'asc'), limit(400)),
    (snap) => { events = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paint(); },
    (err) => console.warn('[luma] events', err.code)
  ));

  unsubs.push(onSnapshot(
    query(col('requests'), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(150)),
    (snap) => {
      leaves = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => ['leave', 'sick'].includes(r.type) && r.fromDate);
      paint();
    },
    () => {}
  ));

  /* ------------------------------------------------------------ painting */
  function collect() {
    const all = [];

    for (const task of tasks) {
      if (filters.employee !== 'all' && !(task.assignees || []).includes(filters.employee)) continue;
      if (filters.client !== 'all' && task.clientId !== filters.client) continue;
      all.push({
        id: `task:${task.id}`,
        sourceId: task.id,
        kind: 'task',
        type: isOverdue(task) ? 'deadline' : 'task',
        title: task.title,
        at: toDate(task.dueAt),
        end: toDate(task.dueAt),
        meta: task.clientName || '',
        link: `#/tasks/${task.id}`,
        raw: task
      });
    }

    for (const event of events) {
      if (filters.employee !== 'all' && !(event.participants || []).includes(filters.employee)) continue;
      if (filters.client !== 'all' && event.clientId !== filters.client) continue;
      all.push({
        id: `event:${event.id}`,
        sourceId: event.id,
        kind: 'event',
        type: event.type || 'event',
        title: event.title,
        at: toDate(event.startAt),
        end: toDate(event.endAt || event.startAt),
        meta: event.location || '',
        raw: event
      });
    }

    for (const leave of leaves) {
      if (filters.employee !== 'all' && leave.employeeId !== filters.employee) continue;
      const from = startOfDay(leave.fromDate);
      const to = startOfDay(leave.toDate || leave.fromDate);
      for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        all.push({
          id: `leave:${leave.id}:${dayKey(d)}`,
          sourceId: leave.id,
          kind: 'leave',
          type: 'leave',
          title: `إجازة — ${people[leave.employeeId]?.displayName || 'موظف'}`,
          at: new Date(d),
          end: new Date(d),
          meta: leave.type === 'sick' ? 'مرضية' : '',
          link: `#/documents/${leave.id}`,
          raw: leave
        });
      }
    }

    return filters.type === 'all' ? all : all.filter((e) => e.type === filters.type);
  }

  function paint() {
    const items = collect().filter((e) => e.at);
    const host = $('#cal-body');
    const strip = $('#cal-strip');

    if (view === 'month') {
      $('#cal-title').textContent = `${AR_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
      strip.innerHTML = '';
      renderMonth(host, cursor, items);
    } else if (view === 'week') {
      const start = startOfWeek(cursor);
      $('#cal-title').textContent =
        `${formatDate(start, { short: true })} — ${formatDate(addDays(start, 6), { short: true })}`;
      renderStrip(strip, start, 7);
      renderWeek(host, start, items);
    } else if (view === 'day') {
      $('#cal-title').textContent = `${AR_DAYS[weekdayIndex(cursor)]} ${formatDate(cursor)}`;
      renderStrip(strip, addDays(cursor, -3), 7);
      renderDay(host, cursor, items);
    } else {
      $('#cal-title').textContent = `${AR_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
      strip.innerHTML = '';
      renderAgenda(host, cursor, items);
    }

    refreshIcons(host);
    bindEventClicks(host, items);
  }

  /** Horizontal date navigator (reference image 2). */
  function renderStrip(host, start, count) {
    const days = Array.from({ length: count }, (_, i) => addDays(start, i));
    host.className = 'cal-strip';
    host.innerHTML = days.map((d) => `
      <button class="cal-day-pill${isToday(d) ? ' is-today' : ''}${dayKey(d) === dayKey(cursor) ? ' is-selected' : ''}"
              data-goto="${dayKey(d)}">
        <div class="cal-day-pill__dow">${esc(AR_DAYS_SHORT[weekdayIndex(d)])}</div>
        <div class="cal-day-pill__num num">${d.getDate()}</div>
      </button>`).join('');
    $$('[data-goto]', host).forEach((b) => b.addEventListener('click', () => {
      cursor = new Date(b.dataset.goto);
      paint();
    }));
  }

  function renderMonth(host, date, items) {
    const first = startOfMonth(date);
    const pad = weekdayIndex(first);
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const prevMonthDays = new Date(date.getFullYear(), date.getMonth(), 0).getDate();

    const byDay = {};
    items.forEach((e) => {
      const key = dayKey(e.at);
      (byDay[key] ||= []).push(e);
    });

    const cells = [];
    for (let i = pad - 1; i >= 0; i--) {
      cells.push({ day: prevMonthDays - i, muted: true, date: new Date(date.getFullYear(), date.getMonth() - 1, prevMonthDays - i) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, muted: false, date: new Date(date.getFullYear(), date.getMonth(), d) });
    }
    while (cells.length % 7 !== 0) {
      const next = cells.length - pad - daysInMonth + 1;
      cells.push({ day: next, muted: true, date: new Date(date.getFullYear(), date.getMonth() + 1, next) });
    }

    host.innerHTML = `
      <div class="cal-month">
        ${AR_DAYS_SHORT.map((d) => `<div class="cal-month__dow">${esc(d)}</div>`).join('')}
        ${cells.map((cell) => {
          const key = dayKey(cell.date);
          const dayEvents = (byDay[key] || []).slice(0, 3);
          const extra = (byDay[key] || []).length - dayEvents.length;
          return `
            <div class="cal-cell${cell.muted ? ' is-muted' : ''}${isToday(cell.date) ? ' is-today' : ''}"
                 data-date="${key}">
              <span class="cal-cell__num num">${cell.day}</span>
              ${dayEvents.map((e) => eventChip(e)).join('')}
              ${extra > 0 ? `<span class="fs-2xs text-muted">+${extra} أخرى</span>` : ''}
            </div>`;
        }).join('')}
      </div>`;

    enableDrop(host, items);
    on(host, 'dblclick', '.cal-cell', (e, cell) => openEventModal({ date: new Date(cell.dataset.date) }));
  }

  function renderWeek(host, start, items) {
    const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 → 20:00
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

    host.innerHTML = `
      <div class="cal-week">
        <div class="cal-week__head"></div>
        ${days.map((d) => `
          <div class="cal-week__head${isToday(d) ? ' is-today' : ''}">
            ${esc(AR_DAYS_SHORT[weekdayIndex(d)])}
            <div class="num" style="font-size:var(--fs-lg)">${d.getDate()}</div>
          </div>`).join('')}
        ${hours.map((hour) => `
          <div class="cal-week__time num">${String(hour).padStart(2, '0')}:00</div>
          ${days.map((d) => {
            const slotStart = new Date(d); slotStart.setHours(hour, 0, 0, 0);
            const slotEnd = new Date(d); slotEnd.setHours(hour + 1, 0, 0, 0);
            const slotEvents = items.filter((e) => e.at >= slotStart && e.at < slotEnd);
            return `<div class="cal-week__slot" data-slot="${slotStart.toISOString()}">
              ${slotEvents.map((e) => eventChip(e)).join('')}</div>`;
          }).join('')}`).join('')}
      </div>`;

    on(host, 'dblclick', '.cal-week__slot', (e, slot) =>
      openEventModal({ date: new Date(slot.dataset.slot) }));
  }

  function renderDay(host, date, items) {
    const dayEvents = items
      .filter((e) => dayKey(e.at) === dayKey(date))
      .sort((a, b) => a.at - b.at);

    host.innerHTML = `
      <div class="card">
        <div class="card__head">
          <div class="card__title">${esc(AR_DAYS[weekdayIndex(date)])} ${esc(formatDate(date))}</div>
          <span class="card__sub">${dayEvents.length} عنصر</span>
        </div>
        ${dayEvents.length ? dayEvents.map((e) => `
          <div class="list-row" data-event="${attr(e.id)}">
            <span class="stat__icon" style="width:38px;height:38px">
              <i data-lucide="${attr(EVENT_TYPES[e.type]?.icon || 'calendar')}"></i></span>
            <div class="list-row__body">
              <div class="list-row__title">${esc(e.title)}</div>
              <div class="list-row__sub">${esc(e.meta || EVENT_TYPES[e.type]?.ar || '')}</div>
            </div>
            <span class="badge num">${esc(formatTime(e.at))}</span>
          </div>`).join('') : emptyState({ icon: 'calendar-off', title: 'لا مواعيد في هذا اليوم' })}
      </div>`;
  }

  function renderAgenda(host, date, items) {
    const from = startOfMonth(date).getTime();
    const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59).getTime();
    const rows = items
      .filter((e) => e.at.getTime() >= from && e.at.getTime() <= to)
      .sort((a, b) => a.at - b.at);

    const grouped = {};
    rows.forEach((e) => { (grouped[dayKey(e.at)] ||= []).push(e); });

    host.innerHTML = Object.keys(grouped).length ? Object.entries(grouped).map(([key, group]) => `
      <div class="card mb-3">
        <div class="card__head">
          <div class="card__title">
            ${esc(AR_DAYS[weekdayIndex(new Date(key))])} · ${esc(formatDate(new Date(key)))}
          </div>
          <span class="card__sub">${group.length} عنصر</span>
        </div>
        ${group.map((e) => `
          <div class="list-row" data-event="${attr(e.id)}">
            <span class="stat__icon" style="width:34px;height:34px">
              <i data-lucide="${attr(EVENT_TYPES[e.type]?.icon || 'calendar')}"></i></span>
            <div class="list-row__body">
              <div class="list-row__title truncate">${esc(e.title)}</div>
              <div class="list-row__sub">${esc(e.meta || '')}</div>
            </div>
            <span class="badge num">${esc(formatTime(e.at))}</span>
          </div>`).join('')}
      </div>`).join('') : emptyState({ icon: 'calendar-off', title: 'لا مواعيد هذا الشهر' });
  }

  /**
   * Only offer drag-to-reschedule when the write would actually succeed —
   * Security Rules let an assignee change a task's status but not its deadline,
   * so a draggable chip they cannot move would just produce an error toast.
   */
  function canReschedule(e) {
    if (e.kind === 'task') return can(session.claims, 'tasks.editAll');
    if (e.kind === 'event') {
      return e.raw?.createdBy === session.uid || can(session.claims, 'tasks.create');
    }
    return false;
  }

  function eventChip(e) {
    const cls = EVENT_TYPES[e.type]?.cls || 'meeting';
    return `<div class="cal-event cal-event--${cls}" data-event="${attr(e.id)}"
      draggable="${canReschedule(e)}" title="${attr(e.title)}">${esc(e.title)}</div>`;
  }

  function bindEventClicks(host, items) {
    on(host, 'click', '[data-event]', (ev, node) => {
      const item = items.find((i) => i.id === node.dataset.event);
      if (item) openEventDetail(item, people);
    });
  }

  /** Drag an event chip onto another day to reschedule it. */
  function enableDrop(host, items) {
    let dragId = null;

    $$('[data-event][draggable="true"]', host).forEach((chip) => {
      chip.addEventListener('dragstart', (e) => {
        dragId = chip.dataset.event;
        chip.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('is-dragging');
        dragId = null;
      });
    });

    $$('.cal-cell', host).forEach((cell) => {
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('is-drop-target'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-target'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault();
        cell.classList.remove('is-drop-target');
        if (!dragId) return;
        const item = items.find((i) => i.id === dragId);
        if (!item) return;

        const target = new Date(cell.dataset.date);
        const original = item.at;
        target.setHours(original.getHours(), original.getMinutes(), 0, 0);

        try {
          if (item.kind === 'task') {
            await updateDoc(ref('tasks', item.sourceId), { dueAt: target, updatedAt: ts() });
          } else {
            const duration = item.end && item.end > item.at ? item.end - item.at : 3_600_000;
            await updateDoc(ref('calendarEvents', item.sourceId), {
              startAt: target, endAt: new Date(target.getTime() + duration), updatedAt: ts()
            });
          }
          toastSuccess(`تم النقل إلى ${formatDate(target)}.`);
        } catch (err) {
          reportError(err, 'calendar-drop');
        }
      });
    });
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ------------------------------------------------------------ event detail */

function openEventDetail(item, people = {}) {
  const type = EVENT_TYPES[item.type] || EVENT_TYPES.event;
  const raw = item.raw || {};
  const participants = (raw.participants || raw.assignees || []).map((id) => people[id]).filter(Boolean);
  const canEdit = item.kind === 'event' &&
    (raw.createdBy === session.uid || can(session.claims, 'tasks.create'));

  openModal({
    title: item.title,
    subtitle: type.ar,
    size: 'sm',
    bodyHTML: `
      <div class="kv"><span class="kv__k">التاريخ</span>
        <span class="kv__v">${esc(formatDate(item.at))}</span></div>
      <div class="kv"><span class="kv__k">الوقت</span>
        <span class="kv__v num">${esc(formatTime(item.at))}${
          item.end && item.end > item.at ? ` — ${esc(formatTime(item.end))}` : ''}</span></div>
      ${item.meta ? `<div class="kv"><span class="kv__k">تفاصيل</span>
        <span class="kv__v">${esc(item.meta)}</span></div>` : ''}
      ${raw.description ? `<div class="list-divider"></div>
        <div class="fs-sm" style="white-space:pre-wrap">${esc(raw.description)}</div>` : ''}
      ${participants.length ? `
        <div class="list-divider"></div>
        <div class="fs-xs text-muted mb-2">المشاركون</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${participants.map((u) => `<span class="badge">${esc(u.displayName)}</span>`).join('')}
        </div>` : ''}`,
    footerHTML: `
      ${canEdit ? '<button class="btn btn--outline-danger" id="ev-del">حذف</button>' : ''}
      ${canEdit ? '<button class="btn btn--secondary" id="ev-edit">تعديل</button>' : ''}
      ${item.link ? `<a class="btn btn--primary" href="${attr(item.link)}" data-modal-close>فتح</a>` : ''}
      <button class="btn btn--ghost" data-modal-close>إغلاق</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#ev-edit')?.addEventListener('click', () => {
        api.close();
        openEventModal({ event: { id: item.sourceId, ...raw } });
      });
      api.$('#ev-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'حذف الحدث', message: 'سيتم حذف الحدث من التقويم.', danger: true }))) return;
        try {
          await deleteDoc(ref('calendarEvents', item.sourceId));
          toastSuccess('تم حذف الحدث.');
          api.close();
        } catch (err) { reportError(err, 'delete-event'); }
      });
    }
  });
}

/* ------------------------------------------------------------- event modal */

export async function openEventModal({ event = null, date = new Date() } = {}) {
  const isEdit = !!event;
  const directory = await getDirectory().catch(() => []);
  const clients = can(session.claims, 'clients.view')
    ? await getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
    : [];

  const selected = new Set(event?.participants || [session.uid]);
  const defaultStart = event?.startAt ? toDateTimeInput(event.startAt) : toDateTimeInput(
    new Date(new Date(date).setHours(10, 0, 0, 0))
  );
  const defaultEnd = event?.endAt ? toDateTimeInput(event.endAt) : toDateTimeInput(
    new Date(new Date(date).setHours(11, 0, 0, 0))
  );

  openModal({
    title: isEdit ? 'تعديل الحدث' : 'حدث جديد',
    size: 'lg',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="ev-title">العنوان <span class="req">*</span></label>
        <input class="input" id="ev-title" maxlength="200" value="${attr(event?.title || '')}"
               placeholder="مثال: اجتماع مراجعة حملة العميل">
      </div>

      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="ev-type">نوع الحدث</label>
          <select class="select" id="ev-type">
            ${Object.entries(EVENT_TYPES)
              .filter(([k]) => k !== 'task' && k !== 'leave')
              .map(([k, v]) => `<option value="${k}" ${event?.type === k ? 'selected' : ''}>${esc(v.ar)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="ev-visibility">الظهور</label>
          <select class="select" id="ev-visibility">
            <option value="team" ${(event?.visibility || 'team') === 'team' ? 'selected' : ''}>الفريق بالكامل</option>
            <option value="participants" ${event?.visibility === 'participants' ? 'selected' : ''}>المشاركون فقط</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="ev-start">البداية <span class="req">*</span></label>
          <input class="input" id="ev-start" type="datetime-local" value="${attr(defaultStart)}">
        </div>
        <div class="field">
          <label class="field__label" for="ev-end">النهاية</label>
          <input class="input" id="ev-end" type="datetime-local" value="${attr(defaultEnd)}">
        </div>
        <div class="field">
          <label class="field__label" for="ev-location">المكان / الرابط</label>
          <input class="input" id="ev-location" maxlength="200" value="${attr(event?.location || '')}">
        </div>
        ${clients.length ? `
        <div class="field">
          <label class="field__label" for="ev-client">العميل</label>
          <select class="select" id="ev-client">
            <option value="">— بدون —</option>
            ${clients.map((c) => `<option value="${attr(c.id)}" ${
              event?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>

      <div class="field">
        <label class="field__label">المشاركون</label>
        <div class="chip-select" id="ev-participants">
          ${directory.map((u) => `
            <button type="button" class="chip-toggle${selected.has(u.id) ? ' is-on' : ''}"
                    data-uid="${attr(u.id)}">${esc(u.displayName)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="ev-desc">الوصف</label>
        <textarea class="textarea" id="ev-desc" maxlength="2000">${esc(event?.description || '')}</textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="ev-save"><i data-lucide="check"></i> حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      $$('[data-uid]', api.root).forEach((chip) => chip.addEventListener('click', () => {
        const uid = chip.dataset.uid;
        if (selected.has(uid)) { selected.delete(uid); chip.classList.remove('is-on'); }
        else { selected.add(uid); chip.classList.add('is-on'); }
      }));

      api.$('#ev-save').addEventListener('click', async () => {
        const title = sanitizeText(api.$('#ev-title').value, 200);
        const startValue = api.$('#ev-start').value;
        if (!title) return toastError('عنوان الحدث مطلوب.');
        if (!startValue) return toastError('تاريخ البداية مطلوب.');

        const endValue = api.$('#ev-end').value;
        const startAt = new Date(startValue);
        const endAt = endValue ? new Date(endValue) : new Date(startAt.getTime() + 3_600_000);
        if (endAt < startAt) return toastError('تاريخ النهاية يجب أن يكون بعد البداية.');

        const payload = {
          title,
          type: api.$('#ev-type').value,
          visibility: api.$('#ev-visibility').value,
          startAt,
          endAt,
          location: sanitizeText(api.$('#ev-location').value, 200),
          clientId: api.$('#ev-client')?.value || null,
          participants: [...selected],
          description: sanitizeMultiline(api.$('#ev-desc').value, 2000),
          updatedAt: ts()
        };

        const button = api.$('#ev-save');
        setBusy(button, true);
        try {
          if (isEdit) await updateDoc(ref('calendarEvents', event.id), payload);
          else await addDoc(col('calendarEvents'), { ...payload, createdBy: session.uid, createdAt: ts() });
          toastSuccess(isEdit ? 'تم تحديث الحدث.' : 'تمت إضافة الحدث.');
          api.close();
        } catch (err) {
          reportError(err, 'save-event');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}
