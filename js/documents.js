/**
 * Documents & requests: leave, early departure, salary advance and sick leave.
 * Includes the approval workflow, the private manager thread attached to each
 * request, and Arabic RTL PDF export.
 */

import { session } from './auth.js';
import { can, rolesLabel, DEPARTMENTS } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, avatarHTML, setBusy, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, getOne, getUsers, getDirectory,
  addDoc, updateDoc, callFn, ts
} from './utils/api.js';
import {
  formatDate, formatDateTime, timeAgo, daysBetween, toDateInput, formatMoney, formatBytes
} from './utils/format.js';
import { sanitizeText, sanitizeMultiline } from './utils/sanitize.js';
import { uploadFile, pickFiles, paths } from './utils/upload.js';
import { uploadsEnabled } from './features.js';
import { buildRequestSheet, downloadPdf, printSheet } from './utils/pdf.js';
import { createPagedFeed, mountLoadMore } from './utils/paging.js';

export const REQUEST_TYPES = {
  leave:     { ar: 'طلب إجازة',              icon: 'palmtree',    color: 'var(--purple)' },
  departure: { ar: 'طلب مغادرة / خروج مبكر', icon: 'log-out',     color: 'var(--info)' },
  advance:   { ar: 'طلب سلفة على الراتب',    icon: 'wallet',      color: 'var(--yellow)' },
  sick:      { ar: 'طلب إجازة مرضية',        icon: 'stethoscope', color: 'var(--danger)' }
};

export const REQUEST_STATUS = {
  draft:     { ar: 'مسودة',        badge: '' },
  submitted: { ar: 'مقدَّم',        badge: 'warning' },
  review:    { ar: 'قيد المراجعة', badge: 'info' },
  approved:  { ar: 'موافق عليه',   badge: 'success' },
  rejected:  { ar: 'مرفوض',        badge: 'danger' },
  cancelled: { ar: 'ملغى',         badge: '' }
};

export async function render(container, ctx) {
  if (ctx.params.id) return renderDetail(container, ctx.params.id);
  return renderList(container, ctx);
}

/* ========================================================================== */
/* List                                                                       */
/* ========================================================================== */

async function renderList(container, ctx) {
  const unsubs = [];
  const isApprover = can(session.claims, 'requests.approve');
  let scope = isApprover ? (ctx.query.scope || 'inbox') : 'mine';
  let requests = [];
  let filters = { status: 'all', type: 'all' };

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">المستندات والطلبات</div>
          <div class="page-head__sub" id="req-count">…</div>
        </div>
        <div class="page-head__actions">
          ${isApprover ? `
            <div class="btn-group" id="scope-switch">
              <button data-scope="inbox">الوارد للإدارة</button>
              <button data-scope="mine">طلباتي</button>
            </div>` : ''}
          <button class="btn btn--primary" id="new-request"><i data-lucide="file-plus"></i> طلب جديد</button>
        </div>
      </div>

      <div class="grid grid-4 mb-4" id="req-stats"></div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
        <select class="select" id="f-status">
          <option value="all">كل الحالات</option>
          ${Object.entries(REQUEST_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
        <select class="select" id="f-type">
          <option value="all">كل الأنواع</option>
          ${Object.entries(REQUEST_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
      </div>

      <div class="grid grid-4 mb-4">
        ${Object.entries(REQUEST_TYPES).map(([key, meta]) => `
          <button class="card" data-quick-type="${attr(key)}" style="text-align:start;cursor:pointer">
            <span class="stat__icon" style="background:var(--bg-inset);color:${meta.color}">
              <i data-lucide="${attr(meta.icon)}"></i></span>
            <div class="fw-700 mt-3">${esc(meta.ar)}</div>
            <div class="fs-xs text-muted">اضغط لتقديم الطلب</div>
          </button>`).join('')}
      </div>

      <div id="req-list">${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div>
    </div>`;

  refreshIcons(container);

  $('#new-request').addEventListener('click', () => openRequestModal());
  $$('[data-quick-type]', container).forEach((card) =>
    card.addEventListener('click', () => openRequestModal({ type: card.dataset.quickType })));

  if (isApprover) {
    const syncScope = () => $$('#scope-switch button')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.scope === scope));
    syncScope();
    $('#scope-switch').addEventListener('click', (e) => {
      const button = e.target.closest('[data-scope]');
      if (!button) return;
      scope = button.dataset.scope;
      syncScope();
      subscribe();
    });
  }

  ['#f-status', '#f-type'].forEach((sel) => $(sel).addEventListener('change', () => {
    filters = { status: $('#f-status').value, type: $('#f-type').value };
    paint();
  }));

  // Requests accumulate indefinitely, so the archive is paged rather than
  // pulled in one read; switching scope rebuilds the feed from page one.
  let feed = null;
  let detachLoadMore = null;

  function subscribe() {
    feed?.stop();
    feed = createPagedFeed({
      pageSize: 25,
      buildQuery: (max) => (scope === 'mine'
        ? query(col('requests'), where('employeeId', '==', session.uid), orderBy('createdAt', 'desc'), limit(max))
        : query(col('requests'), orderBy('createdAt', 'desc'), limit(max))),
      subscribe: (q, onRows, onErr) => onSnapshot(q,
        (snap) => onRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr),
      onData: (rows) => { requests = rows; paint(); },
      onError: (err) => mount($('#req-list'), emptyState({
        icon: 'shield-alert', title: 'تعذّر تحميل الطلبات', text: err.message
      }))
    });
    unsubs.push(() => feed?.stop());
  }
  subscribe();

  function paint() {
    // A listener can still deliver after the route has been torn down.
    if (!$('#req-count')) return;
    detachLoadMore?.();
    const rows = requests.filter((r) => {
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.type !== 'all' && r.type !== filters.type) return false;
      return true;
    });

    $('#req-count').textContent = feed.state.hasMore
      ? `${rows.length} من ${requests.length} محمّلة — انزل لتحميل المزيد`
      : `${rows.length} طلب`;

    const pending = requests.filter((r) => ['submitted', 'review'].includes(r.status)).length;
    $('#req-stats').innerHTML = `
      ${stat('inbox', 'brand', requests.length, 'إجمالي الطلبات')}
      ${stat('clock', 'warning', pending, 'بانتظار القرار')}
      ${stat('check-circle-2', 'success', requests.filter((r) => r.status === 'approved').length, 'موافق عليها')}
      ${stat('x-circle', 'danger', requests.filter((r) => r.status === 'rejected').length, 'مرفوضة')}`;
    refreshIcons($('#req-stats'));

    const host = $('#req-list');
    if (!rows.length) {
      mount(host, emptyState({
        icon: 'file-text', title: 'لا توجد طلبات', text: 'اختر نوع الطلب أعلاه للبدء.'
      }));
      detachLoadMore = mountLoadMore(host, feed);
      return;
    }

    host.innerHTML = `<div class="card card--pad-0">${rows.map((r) => {
      const type = REQUEST_TYPES[r.type] || {};
      const status = REQUEST_STATUS[r.status] || {};
      const employee = people[r.employeeId];
      return `
        <a class="list-row" href="#/documents/${attr(r.id)}" style="padding:var(--sp-4);border-bottom:1px solid var(--border-soft)">
          <span class="stat__icon" style="background:var(--bg-inset);color:${type.color}">
            <i data-lucide="${attr(type.icon || 'file')}"></i></span>
          <div class="list-row__body">
            <div class="list-row__title">${esc(type.ar || r.type)}
              ${r.requestNo ? `<span class="fs-2xs text-muted num">#${esc(r.requestNo)}</span>` : ''}</div>
            <div class="list-row__sub">
              ${esc(employee?.displayName || 'موظف')} ·
              ${esc(r.fromDate ? formatDate(r.fromDate, { short: true }) : formatDate(r.createdAt, { short: true }))}
              ${r.days ? ` · ${r.days} يوم` : ''}
              ${r.amount ? ` · ${esc(formatMoney(r.amount))}` : ''}
            </div>
          </div>
          <div style="text-align:end">
            <span class="badge badge--${attr(status.badge)}">${esc(status.ar)}</span>
            <div class="fs-2xs text-muted mt-2">${esc(timeAgo(r.createdAt))}</div>
          </div>
        </a>`;
    }).join('')}</div>`;
    refreshIcons(host);
    detachLoadMore = mountLoadMore(host, feed);
  }

  return () => {
    detachLoadMore?.();
    unsubs.forEach((fn) => { try { fn(); } catch {} });
  };
}

/* ========================================================================== */
/* Detail                                                                     */
/* ========================================================================== */

async function renderDetail(container, requestId) {
  const unsubs = [];
  container.innerHTML = `<div class="page__inner" id="req-root">
    <div class="skeleton" style="height:280px;border-radius:var(--radius-lg)"></div></div>`;
  const root = $('#req-root', container);

  unsubs.push(onSnapshot(ref('requests', requestId), async (snap) => {
    if (!snap.exists()) {
      mount(root, emptyState({ icon: 'file-x', title: 'الطلب غير موجود' }));
      return;
    }
    const request = { id: snap.id, ...snap.data() };
    const [employee] = await getUsers([request.employeeId]);
    const [decider] = request.decidedBy ? await getUsers([request.decidedBy]) : [null];
    paint(request, employee, decider);
  }, (err) => mount(root, emptyState({
    icon: 'shield-alert', title: 'لا تملك صلاحية عرض هذا الطلب', text: err.message
  }))));

  function paint(request, employee, decider) {
    const type = REQUEST_TYPES[request.type] || {};
    const status = REQUEST_STATUS[request.status] || {};
    const isOwner = request.employeeId === session.uid;
    const isApprover = can(session.claims, 'requests.approve');
    const decidable = isApprover && ['submitted', 'review'].includes(request.status);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="flex items-center gap-3 mb-2" style="flex-wrap:wrap">
            <span class="badge badge--${attr(status.badge)}">${esc(status.ar)}</span>
            ${request.requestNo ? `<span class="fs-sm text-muted num">#${esc(request.requestNo)}</span>` : ''}
          </div>
          <h1 class="page-head__title">${esc(type.ar || request.type)}</h1>
          <div class="page-head__sub">
            ${esc(employee?.displayName || '—')} · قُدِّم ${esc(timeAgo(request.createdAt))}
          </div>
        </div>
        <div class="page-head__actions">
          <a class="btn btn--ghost" href="#/documents"><i data-lucide="arrow-right"></i> رجوع</a>
          <button class="btn btn--secondary" id="req-print"><i data-lucide="printer"></i> طباعة</button>
          <button class="btn btn--secondary" id="req-pdf"><i data-lucide="file-down"></i> تصدير PDF</button>
          ${isOwner && ['draft', 'submitted'].includes(request.status)
            ? '<button class="btn btn--ghost" id="req-cancel">سحب الطلب</button>' : ''}
          ${isApprover || (isOwner && ['draft', 'cancelled', 'rejected'].includes(request.status))
            ? `<button class="btn btn--outline-danger btn--icon" id="req-delete" title="حذف الطلب نهائياً">
                 <i data-lucide="trash-2"></i></button>` : ''}
        </div>
      </div>

      <div class="grid grid-main">
        <div class="flex-col gap-4">
          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="file-text"></i> تفاصيل الطلب</div></div>
            <div class="grid grid-2">
              <div class="kv"><span class="kv__k">نوع الطلب</span><span class="kv__v">${esc(type.ar)}</span></div>
              <div class="kv"><span class="kv__k">تاريخ التقديم</span>
                <span class="kv__v">${esc(formatDate(request.createdAt))}</span></div>
              ${request.fromDate ? `<div class="kv"><span class="kv__k">من تاريخ</span>
                <span class="kv__v">${esc(formatDate(request.fromDate))}</span></div>` : ''}
              ${request.toDate ? `<div class="kv"><span class="kv__k">إلى تاريخ</span>
                <span class="kv__v">${esc(formatDate(request.toDate))}</span></div>` : ''}
              ${request.days ? `<div class="kv"><span class="kv__k">عدد الأيام</span>
                <span class="kv__v num">${request.days}</span></div>` : ''}
              ${request.fromTime ? `<div class="kv"><span class="kv__k">من الساعة</span>
                <span class="kv__v num">${esc(request.fromTime)}</span></div>` : ''}
              ${request.toTime ? `<div class="kv"><span class="kv__k">إلى الساعة</span>
                <span class="kv__v num">${esc(request.toTime)}</span></div>` : ''}
              ${request.amount ? `<div class="kv"><span class="kv__k">المبلغ</span>
                <span class="kv__v num">${esc(formatMoney(request.amount))}</span></div>` : ''}
              ${request.installments ? `<div class="kv"><span class="kv__k">عدد الأقساط</span>
                <span class="kv__v num">${request.installments}</span></div>` : ''}
            </div>

            <div class="list-divider"></div>
            <div class="fs-xs text-muted mb-2">سبب الطلب</div>
            <div class="fs-md" style="white-space:pre-wrap;line-height:1.9">${esc(request.reason || '—')}</div>

            ${request.attachment ? `
              <div class="list-divider"></div>
              <div class="fs-xs text-muted mb-2">المرفق</div>
              <a class="attachment-chip" href="${attr(request.attachment.url)}" target="_blank" rel="noopener noreferrer">
                <i data-lucide="paperclip" class="icon-sm"></i>
                <span>${esc(request.attachment.name)}</span>
                <span class="text-muted fs-2xs">${esc(formatBytes(request.attachment.size))}</span>
              </a>` : ''}
          </div>

          ${request.managerResponse || decider ? `
          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="gavel"></i> قرار الإدارة</div></div>
            <div class="kv"><span class="kv__k">صاحب القرار</span>
              <span class="kv__v">${esc(decider?.displayName || '—')}</span></div>
            <div class="kv"><span class="kv__k">تاريخ القرار</span>
              <span class="kv__v">${esc(request.decidedAt ? formatDateTime(request.decidedAt) : '—')}</span></div>
            ${request.managerResponse ? `
              <div class="list-divider"></div>
              <div class="fs-md" style="white-space:pre-wrap">${esc(request.managerResponse)}</div>` : ''}
          </div>` : ''}

          <div class="card">
            <div class="card__head">
              <div class="card__title"><i data-lucide="message-circle"></i> مراسلة الإدارة</div>
              <span class="card__sub">محادثة خاصة بين الموظف والإدارة حول هذا الطلب</span>
            </div>
            <div id="req-thread" style="max-height:340px;overflow-y:auto">
              ${'<div class="skeleton skeleton--row"></div>'.repeat(2)}
            </div>
            <div class="list-divider"></div>
            <div class="chat-composer">
              <textarea class="textarea" id="thread-input" rows="2" placeholder="اكتب رسالة للإدارة…"></textarea>
              <button class="btn btn--primary btn--icon" id="thread-send" aria-label="إرسال">
                <i data-lucide="send"></i></button>
            </div>
          </div>
        </div>

        <div class="flex-col gap-4">
          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="user"></i> مقدّم الطلب</div></div>
            <a class="list-row" href="#/employees/${attr(request.employeeId)}">
              ${avatarHTML(employee || {})}
              <div class="list-row__body">
                <div class="list-row__title">${esc(employee?.displayName || '—')}</div>
                <div class="list-row__sub">${esc(rolesLabel(employee?.roles))}</div>
              </div>
            </a>
            <div class="list-divider"></div>
            <div class="kv"><span class="kv__k">القسم</span>
              <span class="kv__v">${esc(DEPARTMENTS[employee?.department] || '—')}</span></div>
            <div class="kv"><span class="kv__k">رصيد الإجازات المتبقي</span>
              <span class="kv__v num">${employee?.leave?.remaining ?? '—'} يوم</span></div>
          </div>

          ${decidable ? `
          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="check-square"></i> اتخاذ القرار</div></div>
            <div class="field">
              <label class="field__label" for="decision-note">ملاحظة الإدارة</label>
              <textarea class="textarea" id="decision-note" rows="3"
                placeholder="سبب القبول أو الرفض…"></textarea>
            </div>
            <div class="flex-col gap-2">
              <button class="btn btn--success btn--block" id="req-approve">
                <i data-lucide="check"></i> الموافقة على الطلب</button>
              <button class="btn btn--outline-danger btn--block" id="req-reject">
                <i data-lucide="x"></i> رفض الطلب</button>
              <button class="btn btn--ghost btn--block" id="req-info">
                <i data-lucide="help-circle"></i> طلب معلومات إضافية</button>
            </div>
          </div>` : ''}

          <div class="card">
            <div class="card__head"><div class="card__title"><i data-lucide="clock"></i> مسار الطلب</div></div>
            <div class="timeline">
              <div class="timeline__item">
                <span class="timeline__dot"></span>
                <div class="timeline__text">تم إنشاء الطلب</div>
                <div class="timeline__time">${esc(formatDateTime(request.createdAt))}</div>
              </div>
              ${request.submittedAt ? `
              <div class="timeline__item">
                <span class="timeline__dot"></span>
                <div class="timeline__text">تم تقديم الطلب للإدارة</div>
                <div class="timeline__time">${esc(formatDateTime(request.submittedAt))}</div>
              </div>` : ''}
              ${request.reviewedAt ? `
              <div class="timeline__item">
                <span class="timeline__dot"></span>
                <div class="timeline__text">قيد المراجعة</div>
                <div class="timeline__time">${esc(formatDateTime(request.reviewedAt))}</div>
              </div>` : ''}
              ${request.decidedAt ? `
              <div class="timeline__item">
                <span class="timeline__dot" style="border-color:${
                  request.status === 'approved' ? 'var(--success)' : 'var(--danger)'}"></span>
                <div class="timeline__text">${esc(status.ar)}</div>
                <div class="timeline__time">${esc(formatDateTime(request.decidedAt))}</div>
              </div>` : ''}
            </div>
          </div>
        </div>
      </div>`;

    refreshIcons(root);

    /* ------------------------------------------------------ PDF / print */
    const sheet = () => buildRequestSheet(
      request,
      {
        ...employee,
        rolesLabel: rolesLabel(employee?.roles),
        departmentLabel: DEPARTMENTS[employee?.department]
      },
      decider || {}
    );
    $('#req-pdf').addEventListener('click', async () => {
      const button = $('#req-pdf');
      setBusy(button, true);
      try {
        await downloadPdf(sheet(), `luma-request-${request.requestNo || request.id.slice(0, 6)}`);
      } finally { setBusy(button, false); }
    });
    $('#req-print').addEventListener('click', () => printSheet(sheet()));

    /* ------------------------------------------------------- decisions */
    $('#req-approve')?.addEventListener('click', () => decide('approved'));
    $('#req-reject')?.addEventListener('click', () => decide('rejected'));
    $('#req-info')?.addEventListener('click', () => decide('review'));

    async function decide(nextStatus) {
      const note = sanitizeMultiline($('#decision-note')?.value || '', 2000);
      const labels = { approved: 'الموافقة على', rejected: 'رفض', review: 'إعادة إلى المراجعة' };
      if (nextStatus !== 'review') {
        const ok = await confirmDialog({
          title: `${labels[nextStatus]} الطلب`,
          message: `سيتم إشعار الموظف بالقرار فوراً${
            nextStatus === 'approved' && request.type === 'leave' ? ' وسيُخصم من رصيد إجازاته.' : '.'}`,
          confirmText: 'تأكيد',
          danger: nextStatus === 'rejected'
        });
        if (!ok) return;
      }
      try {
        await callFn('decideRequest', { requestId: request.id, status: nextStatus, response: note });
        toastSuccess('تم تسجيل القرار.');
      } catch (err) {
        reportError(err, 'decide-request');
      }
    }

    /* ----------------------------------------------------------- cancel */
    $('#req-cancel')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'سحب الطلب', message: 'سيتم إلغاء الطلب ولن تتمكن الإدارة من مراجعته.',
        confirmText: 'سحب', danger: true
      });
      if (!ok) return;
      try {
        await updateDoc(ref('requests', request.id), { status: 'cancelled', updatedAt: ts() });
        toastSuccess('تم سحب الطلب.');
      } catch (err) { reportError(err, 'cancel-request'); }
    });

    /* ----------------------------------------------------------- delete */
    $('#req-delete')?.addEventListener('click', async () => {
      const restoresLeave = request.status === 'approved' &&
        ['leave', 'sick'].includes(request.type) && request.days > 0;

      const ok = await confirmDialog({
        title: 'حذف الطلب نهائياً',
        message: `
          سيتم حذف الطلب <strong>${esc(request.requestNo || '')}</strong> ومراسلاته مع الإدارة
          بشكل نهائي، ولا يمكن التراجع.
          ${restoresLeave
            ? `<div class="security-note mt-3"><i data-lucide="rotate-ccw"></i><div>
                 سيتم إرجاع <strong>${request.days}</strong> يوم إلى رصيد إجازات
                 ${esc(employee?.displayName || 'الموظف')}.</div></div>`
            : ''}
          <div class="fs-xs text-muted mt-3">سيبقى سجل الحذف في سجل التدقيق.</div>`,
        confirmText: 'حذف نهائي',
        danger: true
      });
      if (!ok) return;

      try {
        const result = await callFn('deleteRequest', { requestId: request.id });
        toastSuccess(
          result.leaveRestored
            ? `تم حذف الطلب وإرجاع ${result.leaveRestored} يوم إلى رصيد الإجازات.`
            : 'تم حذف الطلب نهائياً.'
        );
        location.hash = '#/documents';
      } catch (err) {
        reportError(err, 'delete-request');
      }
    });

    /* ----------------------------------------------------------- thread */
    const send = async () => {
      const input = $('#thread-input');
      const body = sanitizeMultiline(input.value, 3000);
      if (!body) return;
      input.value = '';
      try {
        await addDoc(col('requests', request.id, 'thread'), {
          authorId: session.uid,
          authorName: session.profile?.displayName || '',
          body,
          createdAt: ts()
        });
      } catch (err) { reportError(err, 'thread'); }
    };
    $('#thread-send').addEventListener('click', send);
    $('#thread-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });

    unsubs.push(onSnapshot(
      query(col('requests', request.id, 'thread'), orderBy('createdAt', 'asc'), limit(100)),
      async (snap) => {
        const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const authors = await getUsers([...new Set(messages.map((m) => m.authorId))]);
        const byId = Object.fromEntries(authors.map((u) => [u.id, u]));
        const node = $('#req-thread');
        if (!node) return;
        node.innerHTML = messages.length ? messages.map((m) => `
          <div class="msg${m.authorId === session.uid ? ' is-own' : ''}" style="max-width:100%">
            ${avatarHTML(byId[m.authorId] || { displayName: m.authorName }, 'sm')}
            <div class="msg__bubble">
              <div class="msg__author">${esc(byId[m.authorId]?.displayName || m.authorName || 'مستخدم')}</div>
              <div class="msg__text">${esc(m.body)}</div>
              <div class="msg__meta">${esc(timeAgo(m.createdAt))}</div>
            </div>
          </div>`).join('') : '<div class="text-muted fs-sm">لا رسائل بعد.</div>';
        node.scrollTop = node.scrollHeight;
      },
      () => {}
    ));
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ========================================================================== */
/* Create request                                                             */
/* ========================================================================== */

export function openRequestModal({ type = 'leave' } = {}) {
  let attachment = null;
  let currentType = type;

  const fieldsFor = (kind) => {
    if (kind === 'departure') {
      return `
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="r-date">التاريخ <span class="req">*</span></label>
            <input class="input" id="r-date" type="date" value="${toDateInput(new Date())}">
          </div>
          <div class="field">
            <label class="field__label" for="r-from-time">من الساعة</label>
            <input class="input" id="r-from-time" type="time" value="13:00">
          </div>
          <div class="field">
            <label class="field__label" for="r-to-time">إلى الساعة</label>
            <input class="input" id="r-to-time" type="time" value="16:00">
          </div>
        </div>`;
    }
    if (kind === 'advance') {
      return `
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="r-amount">المبلغ المطلوب (د.أ) <span class="req">*</span></label>
            <input class="input ltr" id="r-amount" type="number" min="1" step="1" placeholder="200">
          </div>
          <div class="field">
            <label class="field__label" for="r-installments">عدد الأقساط</label>
            <select class="select" id="r-installments">
              ${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join('')}
            </select>
          </div>
        </div>`;
    }
    // leave / sick
    return `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="r-from">من تاريخ <span class="req">*</span></label>
          <input class="input" id="r-from" type="date" value="${toDateInput(new Date())}">
        </div>
        <div class="field">
          <label class="field__label" for="r-to">إلى تاريخ <span class="req">*</span></label>
          <input class="input" id="r-to" type="date" value="${toDateInput(new Date())}">
        </div>
        <div class="field field--full">
          <div class="fs-sm text-muted">
            عدد الأيام: <span class="num fw-700" id="r-days">1</span>
            ${session.profile?.leave
              ? ` · رصيدك المتبقي: <span class="num">${session.profile.leave.remaining ?? 0}</span> يوم` : ''}
          </div>
        </div>
      </div>`;
  };

  openModal({
    title: 'تقديم طلب إداري',
    size: 'lg',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="r-type">نوع الطلب</label>
        <select class="select" id="r-type">
          ${Object.entries(REQUEST_TYPES).map(([k, v]) => `
            <option value="${k}" ${k === type ? 'selected' : ''}>${esc(v.ar)}</option>`).join('')}
        </select>
      </div>

      <div id="r-fields">${fieldsFor(type)}</div>

      <div class="field">
        <label class="field__label" for="r-reason">سبب الطلب <span class="req">*</span></label>
        <textarea class="textarea" id="r-reason" rows="4" maxlength="3000"
          placeholder="اشرح سبب الطلب باختصار…"></textarea>
      </div>

      ${uploadsEnabled() ? `
      <div class="field">
        <label class="field__label">مرفق (اختياري)</label>
        <div class="dropzone" id="r-drop">
          <i data-lucide="paperclip"></i>
          <div class="mt-2" id="r-drop-label">
            اضغط لاختيار ملف (تقرير طبي مثلاً) — حتى 10 ميجابايت
          </div>
        </div>
      </div>` : ''}

      <div class="security-note">
        <i data-lucide="info"></i>
        <div>سيتم إرسال الطلب لمدير الحسابات المسؤول، ويمكنك متابعته ومراسلة الإدارة من صفحة الطلب.</div>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--secondary" id="r-draft">حفظ كمسودة</button>
      <button class="btn btn--primary" id="r-submit"><i data-lucide="send"></i> تقديم الطلب</button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      const wireDynamic = () => {
        const from = api.$('#r-from');
        const to = api.$('#r-to');
        const daysNode = api.$('#r-days');
        if (from && to && daysNode) {
          const recompute = () => {
            const count = from.value && to.value
              ? Math.max(1, daysBetween(new Date(from.value), new Date(to.value))) : 1;
            daysNode.textContent = String(count);
          };
          from.addEventListener('change', recompute);
          to.addEventListener('change', recompute);
          recompute();
        }
      };
      wireDynamic();

      api.$('#r-type').addEventListener('change', (e) => {
        currentType = e.target.value;
        api.$('#r-fields').innerHTML = fieldsFor(currentType);
        refreshIcons(api.$('#r-fields'));
        wireDynamic();
      });

      // Rendered only while uploads are enabled.
      api.$('#r-drop')?.addEventListener('click', async () => {
        const [file] = await pickFiles({ accept: 'image/*,.pdf,.doc,.docx' });
        if (!file) return;
        attachment = file;
        api.$('#r-drop-label').textContent = `تم اختيار: ${file.name} (${formatBytes(file.size)})`;
      });

      const save = async (status) => {
        const reason = sanitizeMultiline(api.$('#r-reason').value, 3000);
        if (!reason) return toastError('سبب الطلب مطلوب.');

        const payload = {
          employeeId: session.uid,
          employeeName: session.profile?.displayName || '',
          managerId: session.profile?.managerId || null,
          type: currentType,
          reason,
          status,
          createdAt: ts(),
          updatedAt: ts()
        };

        if (currentType === 'leave' || currentType === 'sick') {
          const from = api.$('#r-from').value;
          const to = api.$('#r-to').value;
          if (!from || !to) return toastError('حدد تاريخي البداية والنهاية.');
          if (new Date(to) < new Date(from)) return toastError('تاريخ النهاية يجب أن يكون بعد البداية.');
          payload.fromDate = from;
          payload.toDate = to;
          payload.days = Math.max(1, daysBetween(new Date(from), new Date(to)));
        } else if (currentType === 'departure') {
          const date = api.$('#r-date').value;
          if (!date) return toastError('حدد التاريخ.');
          payload.fromDate = date;
          payload.toDate = date;
          payload.fromTime = api.$('#r-from-time').value;
          payload.toTime = api.$('#r-to-time').value;
        } else if (currentType === 'advance') {
          const amount = Number(api.$('#r-amount').value);
          if (!(amount > 0)) return toastError('أدخل مبلغاً صحيحاً.');
          payload.amount = amount;
          payload.installments = Number(api.$('#r-installments').value) || 1;
        }

        if (status === 'submitted') payload.submittedAt = ts();

        const button = api.$(status === 'draft' ? '#r-draft' : '#r-submit');
        setBusy(button, true);
        try {
          const created = await addDoc(col('requests'), payload);

          if (attachment) {
            const uploaded = await uploadFile(attachment, paths.request(session.uid, attachment), {
              maxMB: 10
            });
            await updateDoc(ref('requests', created.id), { attachment: uploaded, updatedAt: ts() });
          }

          toastSuccess(status === 'draft' ? 'تم حفظ المسودة.' : 'تم تقديم الطلب بنجاح.');
          api.close();
          location.hash = `#/documents/${created.id}`;
        } catch (err) {
          reportError(err, 'create-request');
        } finally {
          setBusy(button, false);
        }
      };

      api.$('#r-submit').addEventListener('click', () => save('submitted'));
      api.$('#r-draft').addEventListener('click', () => save('draft'));
    }
  });
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
