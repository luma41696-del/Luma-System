/** Notification centre: list, filter, mark read, and preferences. */

import { session } from './auth.js';
import { $, $$, esc, attr, refreshIcons, render as mount, emptyState } from './utils/dom.js';
import { toastSuccess, reportError } from './utils/toast.js';
import { confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, updateDoc, deleteDoc, ts
} from './utils/api.js';
import { timeAgo, formatDateTime } from './utils/format.js';

const KINDS = {
  task_assigned:   { ar: 'إسناد مهمة',        icon: 'check-square' },
  task_due:        { ar: 'اقتراب موعد',       icon: 'clock' },
  task_overdue:    { ar: 'مهمة متأخرة',       icon: 'alert-triangle' },
  task_comment:    { ar: 'تعليق جديد',        icon: 'message-square' },
  request_decided: { ar: 'قرار على طلب',      icon: 'gavel' },
  request_new:     { ar: 'طلب جديد',          icon: 'inbox' },
  chat_message:    { ar: 'رسالة جديدة',       icon: 'message-circle' },
  chat_mention:    { ar: 'إشارة إليك',        icon: 'at-sign' },
  client_updated:  { ar: 'تحديث بيانات عميل', icon: 'briefcase' },
  system:          { ar: 'النظام',            icon: 'bell' }
};

export async function render(container) {
  const unsubs = [];
  let items = [];
  let filter = 'all';

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">الإشعارات</div>
          <div class="page-head__sub" id="notif-count">…</div>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--secondary" id="mark-all"><i data-lucide="check-check"></i> تعليم الكل كمقروء</button>
          <button class="btn btn--ghost" id="notif-prefs"><i data-lucide="settings"></i> التفضيلات</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="btn-group" id="notif-filter">
          <button data-filter="all" class="is-active">الكل</button>
          <button data-filter="unread">غير المقروءة</button>
          <button data-filter="read">المقروءة</button>
        </div>
      </div>

      <div class="card card--pad-sm" id="notif-list">
        ${'<div class="skeleton skeleton--row"></div>'.repeat(5)}
      </div>
    </div>`;

  refreshIcons(container);

  $('#notif-filter').addEventListener('click', (e) => {
    const button = e.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    $$('#notif-filter button').forEach((b) => b.classList.toggle('is-active', b === button));
    paint();
  });

  $('#mark-all').addEventListener('click', async () => {
    const unread = items.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      await Promise.all(unread.map((n) =>
        updateDoc(ref('notifications', n.id), { read: true, readAt: ts() })));
      toastSuccess('تم تعليم جميع الإشعارات كمقروءة.');
    } catch (err) { reportError(err, 'mark-all'); }
  });

  $('#notif-prefs').addEventListener('click', async () => {
    const mod = await import('./settings.js');
    location.hash = '#/settings/notifications';
  });

  unsubs.push(onSnapshot(
    query(col('notifications'), where('userId', '==', session.uid),
      orderBy('createdAt', 'desc'), limit(150)),
    (snap) => { items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paint(); },
    (err) => mount($('#notif-list'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل الإشعارات', text: err.message
    }))
  ));

  function paint() {
    const rows = items.filter((n) =>
      filter === 'all' ? true : filter === 'unread' ? !n.read : n.read);

    const unreadCount = items.filter((n) => !n.read).length;
    $('#notif-count').textContent = unreadCount
      ? `${unreadCount} إشعار غير مقروء من أصل ${items.length}`
      : `لا إشعارات غير مقروءة (${items.length} إجمالاً)`;

    const host = $('#notif-list');
    if (!rows.length) {
      mount(host, emptyState({
        icon: 'bell-off', title: 'لا إشعارات', text: 'ستظهر هنا التنبيهات الجديدة فور وصولها.'
      }));
      return;
    }

    host.innerHTML = rows.map((n) => {
      const kind = KINDS[n.kind] || KINDS.system;
      return `
        <div class="notif-row${n.read ? '' : ' is-unread'}" data-notif="${attr(n.id)}">
          <span class="notif-row__icon"><i data-lucide="${attr(n.icon || kind.icon)}"></i></span>
          <div class="flex-1" style="min-width:0">
            <div class="notif-row__title">${esc(n.title || kind.ar)}</div>
            <div class="notif-row__text">${esc(n.body || '')}</div>
            <div class="notif-row__time" title="${attr(formatDateTime(n.createdAt))}">
              ${esc(timeAgo(n.createdAt))}
            </div>
          </div>
          <div class="flex gap-1">
            ${n.link ? `<a class="icon-btn" href="${attr(n.link)}" data-open="${attr(n.id)}"
              aria-label="فتح"><i data-lucide="arrow-left"></i></a>` : ''}
            ${!n.read ? `<button class="icon-btn" data-read="${attr(n.id)}" aria-label="تعليم كمقروء">
              <i data-lucide="check"></i></button>` : ''}
            <button class="icon-btn" data-del="${attr(n.id)}" aria-label="حذف">
              <i data-lucide="trash-2"></i></button>
          </div>
        </div>`;
    }).join('');
    refreshIcons(host);

    const markRead = async (id) => {
      try { await updateDoc(ref('notifications', id), { read: true, readAt: ts() }); }
      catch (err) { console.warn('[luma] mark read', err.code); }
    };

    $$('[data-read]', host).forEach((b) => b.addEventListener('click', () => markRead(b.dataset.read)));
    $$('[data-open]', host).forEach((a) => a.addEventListener('click', () => markRead(a.dataset.open)));
    $$('[data-del]', host).forEach((b) => b.addEventListener('click', async () => {
      try { await deleteDoc(ref('notifications', b.dataset.del)); }
      catch (err) { reportError(err, 'delete-notification'); }
    }));
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}
