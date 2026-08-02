/**
 * Client profile with tabs: overview, contacts, social accounts, credentials
 * vault, tasks, files and activity.
 *
 * The vault tab never touches ciphertext in the browser. `vaultList` returns
 * metadata only; `vaultReveal` requires `clients.viewCredentials` *and* a fresh
 * re-authentication, decrypts server-side with a Secret Manager key, writes an
 * audit entry, and returns the plaintext exactly once.
 */

import { session, reauthenticate } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, avatarHTML, setBusy
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, getOne, getMany, getUsers,
  getDirectory, addDoc, updateDoc, deleteDoc, callFn, ts
} from './utils/api.js';
import {
  summarize, sortTasks, isOverdue, TASK_STATUSES, clientTasksQuery, watchTasks
} from './utils/task-model.js';
import { formatDate, formatDateTime, timeAgo, formatBytes } from './utils/format.js';
import { sanitizeText, sanitizeMultiline, safeUrl } from './utils/sanitize.js';
import { uploadFile, pickFiles, paths, deleteFile } from './utils/upload.js';
import { uploadsEnabled, uploadsDisabledNotice } from './features.js';
import { doughnutChart, barChart, destroyAllCharts } from './utils/charts.js';
import { openClientModal, SERVICES, PLATFORMS } from './clients.js';

export async function render(container, ctx) {
  const clientId = ctx.params.id;
  const unsubs = [];
  let client = null;
  let tasks = [];
  let activeTab = ctx.query.tab || 'overview';

  container.innerHTML = `<div class="page__inner" id="client-root">
    <div class="skeleton" style="height:160px;border-radius:var(--radius-lg)"></div></div>`;
  const root = $('#client-root', container);

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  unsubs.push(onSnapshot(ref('clients', clientId), (snap) => {
    if (!snap.exists()) {
      mount(root, emptyState({ icon: 'briefcase', title: 'العميل غير موجود' }));
      return;
    }
    client = { id: snap.id, ...snap.data() };
    paint();
  }, (err) => mount(root, emptyState({
    icon: 'shield-alert', title: 'تعذّر تحميل ملف العميل', text: err.message
  }))));

  unsubs.push(watchTasks(clientTasksQuery(clientId), (rows) => {
    tasks = rows.filter((t) => !t.deleted);
    if (client) paint();
  }, () => {}));

  function paint() {
    const stats = summarize(tasks);
    const manager = people[client.accountManagerId];
    const STATUS = { active: ['نشط', 'success'], paused: ['متوقف', 'warning'], ended: ['منتهي', ''] };
    const [statusLabel, tone] = STATUS[client.status || 'active'] || STATUS.active;

    root.innerHTML = `
      <div class="card">
        <div class="flex gap-4 items-start" style="flex-wrap:wrap">
          ${client.logoURL
            ? `<img src="${attr(client.logoURL)}" alt="${attr(client.name)}"
                 style="width:84px;height:84px;border-radius:var(--radius-lg);object-fit:cover;flex:none">`
            : `<span class="stat__icon stat__icon--brand" style="width:84px;height:84px;border-radius:var(--radius-lg)">
                 <i data-lucide="briefcase" class="icon-lg"></i></span>`}

          <div class="flex-1" style="min-width:220px">
            <div class="flex items-center gap-3" style="flex-wrap:wrap">
              <h1 style="font-size:var(--fs-2xl);font-weight:800">${esc(client.name)}</h1>
              <span class="badge badge--${attr(tone)}">${esc(statusLabel)}</span>
            </div>
            <div class="fs-sm text-muted">${esc(client.contactPerson || 'بدون مسؤول تواصل')}</div>
            <div class="tag-list mt-3">
              ${(client.services || []).map((s) => `<span class="badge">${esc(SERVICES[s] || s)}</span>`).join('')}
            </div>
          </div>

          <div class="flex-col gap-2" style="min-width:170px">
            ${can(session.claims, 'clients.edit')
              ? '<button class="btn btn--secondary" id="edit-client"><i data-lucide="pencil"></i> تعديل</button>' : ''}
            ${can(session.claims, 'tasks.create')
              ? '<button class="btn btn--primary" id="client-task"><i data-lucide="plus"></i> مهمة للعميل</button>' : ''}
            ${can(session.claims, 'clients.delete')
              ? '<button class="btn btn--outline-danger" id="delete-client"><i data-lucide="trash-2"></i> حذف العميل</button>' : ''}
          </div>
        </div>

        <div class="list-divider"></div>
        <div class="grid grid-4">
          <div class="kv"><span class="kv__k">مدير الحساب</span>
            <span class="kv__v">${esc(manager?.displayName || '—')}</span></div>
          <div class="kv"><span class="kv__k">بداية العقد</span>
            <span class="kv__v">${esc(client.contractStart ? formatDate(client.contractStart) : '—')}</span></div>
          <div class="kv"><span class="kv__k">نهاية العقد</span>
            <span class="kv__v">${esc(client.contractEnd ? formatDate(client.contractEnd) : '—')}</span></div>
          <div class="kv"><span class="kv__k">إجمالي المهام</span>
            <span class="kv__v num">${stats.total}</span></div>
        </div>
      </div>

      <div class="tabs mt-4" id="client-tabs">
        <button class="tab" data-tab="overview"><i data-lucide="layout-dashboard"></i> نظرة عامة</button>
        <button class="tab" data-tab="contact"><i data-lucide="contact"></i> معلومات التواصل</button>
        <button class="tab" data-tab="social"><i data-lucide="share-2"></i> الحسابات</button>
        ${can(session.claims, 'clients.viewCredentials')
          ? '<button class="tab" data-tab="vault"><i data-lucide="key-round"></i> خزنة بيانات الدخول</button>' : ''}
        <button class="tab" data-tab="tasks"><i data-lucide="check-square"></i> المهام</button>
        <button class="tab" data-tab="files"><i data-lucide="folder"></i> الملفات</button>
        <button class="tab" data-tab="activity"><i data-lucide="history"></i> السجل</button>
      </div>
      <div id="client-tab-body"></div>`;

    refreshIcons(root);

    $('#edit-client')?.addEventListener('click', () => openClientModal(client));
    $('#client-task')?.addEventListener('click', async () => {
      (await import('./tasks.js')).openTaskModal({ clientId: client.id });
    });
    $('#delete-client')?.addEventListener('click', () => openDeleteClient(client));

    $('#client-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      activeTab = tab.dataset.tab;
      paintTab(stats);
    });

    paintTab(stats);
  }

  function paintTab(stats) {
    $$('#client-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === activeTab));
    const host = $('#client-tab-body');
    destroyAllCharts();

    if (activeTab === 'overview') overviewTab(host, client, stats, tasks, people);
    else if (activeTab === 'contact') contactTab(host, client);
    else if (activeTab === 'social') socialTab(host, client, unsubs, people);
    else if (activeTab === 'vault') vaultTab(host, client);
    else if (activeTab === 'tasks') tasksTab(host, tasks);
    else if (activeTab === 'files') filesTab(host, client, unsubs);
    else if (activeTab === 'activity') activityTab(host, client, unsubs, people);

    refreshIcons(host);
  }

  return () => {
    unsubs.forEach((fn) => { try { fn(); } catch {} });
    destroyAllCharts();
  };
}

/* ---------------------------------------------------------------- overview */

function overviewTab(host, client, stats, tasks, people) {
  const byEmployee = Object.entries(stats.byAssignee)
    .map(([uid, v]) => ({ user: people[uid], ...v }))
    .filter((r) => r.user)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  host.innerHTML = `
    <div class="grid grid-4 mt-4">
      ${stat('layers', 'brand', stats.total, 'إجمالي المهام')}
      ${stat('check-circle-2', 'success', stats.completed, 'مكتملة')}
      ${stat('loader', 'info', stats.open, 'قيد التنفيذ / متبقية')}
      ${stat('alert-triangle', 'danger', stats.overdue, 'متأخرة')}
    </div>

    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title">توزيع حالات المهام</div></div>
        <div class="chart-box" style="height:250px"><canvas id="cl-status"></canvas></div>
      </div>
      <div class="card">
        <div class="card__head"><div class="card__title">المهام حسب الموظف</div></div>
        <div class="chart-box" style="height:250px"><canvas id="cl-emp"></canvas></div>
      </div>
    </div>

    <div class="card mt-4">
      <div class="card__head"><div class="card__title"><i data-lucide="users"></i> الفريق العامل على الحساب</div></div>
      ${byEmployee.length ? byEmployee.map((r) => `
        <a class="list-row" href="#/employees/${attr(r.user.id)}">
          ${avatarHTML(r.user)}
          <div class="list-row__body">
            <div class="list-row__title">${esc(r.user.displayName)}</div>
            <div class="list-row__sub">${r.completed} مكتملة · ${r.open} مفتوحة</div>
          </div>
          ${r.overdue ? `<span class="badge badge--danger">${r.overdue} متأخرة</span>` : ''}
        </a>`).join('') : emptyState({ icon: 'users', title: 'لا مهام مُسندة بعد' })}
    </div>

    ${client.notes ? `
      <div class="card mt-4">
        <div class="card__head"><div class="card__title"><i data-lucide="sticky-note"></i> ملاحظات</div></div>
        <div class="fs-md" style="white-space:pre-wrap">${esc(client.notes)}</div>
      </div>` : ''}`;

  const keys = Object.keys(TASK_STATUSES).filter((k) => stats.byStatus[k] > 0);
  doughnutChart('cl-status', keys.map((k) => TASK_STATUSES[k].ar), keys.map((k) => stats.byStatus[k]));
  barChart('cl-emp', byEmployee.map((r) => r.user.displayName),
    [{ label: 'مهام', data: byEmployee.map((r) => r.total) }], { horizontal: true });
}

function contactTab(host, client) {
  const website = safeUrl(client.website);
  host.innerHTML = `
    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="contact"></i> بيانات التواصل</div></div>
        <div class="kv"><span class="kv__k">مسؤول التواصل</span><span class="kv__v">${esc(client.contactPerson || '—')}</span></div>
        <div class="kv"><span class="kv__k">الهاتف</span>
          <span class="kv__v ltr">${client.phone ? `<a href="tel:${attr(client.phone)}">${esc(client.phone)}</a>` : '—'}</span></div>
        <div class="kv"><span class="kv__k">البريد</span>
          <span class="kv__v ltr">${client.email ? `<a href="mailto:${attr(client.email)}">${esc(client.email)}</a>` : '—'}</span></div>
        <div class="kv"><span class="kv__k">الموقع</span>
          <span class="kv__v ltr">${website
            ? `<a href="${attr(website)}" target="_blank" rel="noopener noreferrer nofollow">${esc(website)}</a>` : '—'}</span></div>
        <div class="kv"><span class="kv__k">العنوان</span><span class="kv__v">${esc(client.address || '—')}</span></div>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="file-signature"></i> العقد والخدمات</div></div>
        <div class="kv"><span class="kv__k">بداية العقد</span><span class="kv__v">${esc(client.contractStart ? formatDate(client.contractStart) : '—')}</span></div>
        <div class="kv"><span class="kv__k">نهاية العقد</span><span class="kv__v">${esc(client.contractEnd ? formatDate(client.contractEnd) : '—')}</span></div>
        <div class="list-divider"></div>
        <div class="tag-list">
          ${(client.services || []).map((s) => `<span class="badge badge--brand">${esc(SERVICES[s] || s)}</span>`).join('')
            || '<span class="text-muted fs-sm">لم تُحدد خدمات.</span>'}
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ social */

function socialTab(host, client, unsubs, people) {
  const canEdit = can(session.claims, 'clients.edit');

  host.innerHTML = `
    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="share-2"></i> حسابات التواصل الاجتماعي</div>
        ${canEdit ? '<button class="btn btn--ghost btn--sm" id="add-social"><i data-lucide="plus"></i> إضافة حساب</button>' : ''}
      </div>
      <div class="security-note mb-4">
        <i data-lucide="shield-check"></i>
        <div>
          يُفضَّل دائماً الوصول عبر <strong>Meta Business Manager</strong> أو دعوات المنصات أو OAuth
          بدلاً من تخزين كلمات المرور. لا تُحفظ أي كلمة مرور في هذا القسم.
        </div>
      </div>
      <div id="social-list">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
    </div>`;

  refreshIcons(host);
  $('#add-social')?.addEventListener('click', () => openSocialModal(client, null, people));

  unsubs.push(onSnapshot(col('clients', client.id, 'social'), (snap) => {
    const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const node = $('#social-list');
    if (!node) return;
    node.innerHTML = accounts.length ? accounts.map((a) => {
      const platform = PLATFORMS[a.platform] || { ar: a.platform, icon: 'globe' };
      const url = safeUrl(a.url);
      const assigned = (a.assignees || []).map((id) => people[id]).filter(Boolean);
      return `
        <div class="list-row" style="cursor:default">
          <span class="stat__icon" style="width:38px;height:38px">
            <i data-lucide="${attr(platform.icon)}"></i></span>
          <div class="list-row__body">
            <div class="list-row__title">${esc(a.pageName || platform.ar)}</div>
            <div class="list-row__sub ltr">${esc(a.username || '—')}</div>
            ${assigned.length ? `<div class="fs-2xs text-muted mt-2">المسؤولون:
              ${esc(assigned.map((u) => u.displayName).join('، '))}</div>` : ''}
            ${a.accessNotes ? `<div class="fs-2xs text-muted">${esc(a.accessNotes)}</div>` : ''}
          </div>
          <div class="flex gap-1">
            ${url ? `<a class="icon-btn" href="${attr(url)}" target="_blank" rel="noopener noreferrer nofollow"
                       aria-label="فتح"><i data-lucide="external-link"></i></a>` : ''}
            ${canEdit ? `
              <button class="icon-btn" data-edit-social="${attr(a.id)}" aria-label="تعديل">
                <i data-lucide="pencil"></i></button>
              <button class="icon-btn" data-del-social="${attr(a.id)}" aria-label="حذف">
                <i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </div>`;
    }).join('') : emptyState({ icon: 'share-2', title: 'لا حسابات مضافة' });
    refreshIcons(node);

    $$('[data-edit-social]', node).forEach((b) => b.addEventListener('click', () => {
      openSocialModal(client, accounts.find((a) => a.id === b.dataset.editSocial), people);
    }));
    $$('[data-del-social]', node).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'حذف الحساب', message: 'سيتم حذف بيانات هذا الحساب.', danger: true }))) return;
      await deleteDoc(ref('clients', client.id, 'social', b.dataset.delSocial));
      toastSuccess('تم الحذف.');
    }));
  }, () => {}));
}

function openSocialModal(client, account, people) {
  const directory = Object.values(people);
  const selected = new Set(account?.assignees || []);

  openModal({
    title: account ? 'تعديل الحساب' : 'إضافة حساب تواصل',
    size: 'lg',
    bodyHTML: `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="s-platform">المنصة</label>
          <select class="select" id="s-platform">
            ${Object.entries(PLATFORMS).map(([k, v]) => `
              <option value="${k}" ${account?.platform === k ? 'selected' : ''}>${esc(v.ar)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="s-pagename">اسم الصفحة</label>
          <input class="input" id="s-pagename" maxlength="140" value="${attr(account?.pageName || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="s-username">اسم المستخدم</label>
          <input class="input ltr" id="s-username" maxlength="80" value="${attr(account?.username || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="s-url">رابط الصفحة</label>
          <input class="input ltr" id="s-url" type="url" value="${attr(account?.url || '')}">
        </div>
        <div class="field field--full">
          <label class="field__label">الموظفون المسؤولون</label>
          <div class="chip-select" id="s-assignees">
            ${directory.map((u) => `
              <button type="button" class="chip-toggle${selected.has(u.id) ? ' is-on' : ''}"
                      data-uid="${attr(u.id)}">${esc(u.displayName)}</button>`).join('')}
          </div>
        </div>
        <div class="field field--full">
          <label class="field__label" for="s-notes">ملاحظات الوصول</label>
          <textarea class="textarea" id="s-notes" maxlength="600"
            placeholder="مثال: الوصول عبر Business Manager — لا حاجة لكلمة مرور">${esc(account?.accessNotes || '')}</textarea>
        </div>
      </div>
      <div class="security-note">
        <i data-lucide="lock"></i>
        <div>لا يُسمح بإدخال كلمات مرور هنا — استخدم خزنة بيانات الدخول المشفَّرة.</div>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="s-save">حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      $$('[data-uid]', api.root).forEach((chip) => chip.addEventListener('click', () => {
        const uid = chip.dataset.uid;
        if (selected.has(uid)) { selected.delete(uid); chip.classList.remove('is-on'); }
        else { selected.add(uid); chip.classList.add('is-on'); }
      }));

      api.$('#s-save').addEventListener('click', async () => {
        const payload = {
          platform: api.$('#s-platform').value,
          pageName: sanitizeText(api.$('#s-pagename').value, 140),
          username: sanitizeText(api.$('#s-username').value, 80),
          url: safeUrl(api.$('#s-url').value),
          assignees: [...selected],
          accessNotes: sanitizeMultiline(api.$('#s-notes').value, 600),
          updatedAt: ts()
        };
        try {
          if (account) await updateDoc(ref('clients', client.id, 'social', account.id), payload);
          else await addDoc(col('clients', client.id, 'social'), { ...payload, createdAt: ts() });
          toastSuccess('تم الحفظ.');
          api.close();
        } catch (err) { reportError(err, 'social'); }
      });
    }
  });
}

/* ------------------------------------------------------------------- vault */

async function vaultTab(host, client) {
  host.innerHTML = `
    <div class="security-note mt-4">
      <i data-lucide="shield-alert"></i>
      <div>
        <strong>خزنة مشفّرة.</strong> القيم مخزّنة بتشفير AES-256-GCM ومفتاح التشفير محفوظ في
        Google Secret Manager — لا يوجد في الواجهة ولا في قاعدة البيانات.
        فك التشفير يتم على الخادم فقط، ويتطلب إعادة إدخال كلمة مرورك، ويُسجَّل في سجل التدقيق.
      </div>
    </div>

    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="key-round"></i> بيانات الدخول</div>
        <button class="btn btn--primary btn--sm" id="add-cred"><i data-lucide="plus"></i> إضافة</button>
      </div>
      <div id="vault-list">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
    </div>`;

  refreshIcons(host);
  $('#add-cred').addEventListener('click', () => openCredentialModal(client, null, () => loadVault(client)));
  loadVault(client);
}

async function loadVault(client) {
  const node = $('#vault-list');
  if (!node) return;
  try {
    // Returns metadata only — no ciphertext ever reaches the browser.
    const { items } = await callFn('vaultList', { clientId: client.id });
    node.innerHTML = items.length ? items.map((item) => `
      <div class="list-row" style="cursor:default">
        <span class="stat__icon" style="width:38px;height:38px">
          <i data-lucide="${attr(PLATFORMS[item.platform]?.icon || 'key')}"></i></span>
        <div class="list-row__body">
          <div class="list-row__title">${esc(item.label)}</div>
          <div class="list-row__sub ltr">${esc(item.username || '—')}</div>
          <div class="fs-2xs text-muted mt-2">
            آخر تعديل ${esc(timeAgo(item.updatedAt))}
            ${item.lastViewedAt ? ` · آخر عرض ${esc(timeAgo(item.lastViewedAt))}` : ''}
          </div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn--secondary btn--sm" data-reveal="${attr(item.id)}">
            <i data-lucide="eye"></i> إظهار</button>
          <button class="icon-btn" data-edit-cred="${attr(item.id)}" aria-label="تعديل">
            <i data-lucide="pencil"></i></button>
          <button class="icon-btn" data-del-cred="${attr(item.id)}" aria-label="حذف">
            <i data-lucide="trash-2"></i></button>
        </div>
      </div>`).join('') : emptyState({
        icon: 'key-round',
        title: 'الخزنة فارغة',
        text: 'يُفضَّل استخدام دعوات المنصات بدلاً من تخزين كلمات المرور.'
      });
    refreshIcons(node);

    $$('[data-reveal]', node).forEach((b) =>
      b.addEventListener('click', () => revealCredential(client.id, b.dataset.reveal)));
    $$('[data-edit-cred]', node).forEach((b) =>
      b.addEventListener('click', () => openCredentialModal(
        client, items.find((i) => i.id === b.dataset.editCred), () => loadVault(client))));
    $$('[data-del-cred]', node).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({
        title: 'حذف بيانات الدخول',
        message: 'سيتم حذف السجل نهائياً وتسجيل العملية في سجل التدقيق.',
        danger: true
      }))) return;
      try {
        await callFn('vaultDelete', { clientId: client.id, credId: b.dataset.delCred });
        toastSuccess('تم الحذف.');
        loadVault(client);
      } catch (err) { reportError(err, 'vault-delete'); }
    }));
  } catch (err) {
    node.innerHTML = emptyState({
      icon: 'shield-alert', title: 'تعذّر فتح الخزنة', text: err.message
    });
    refreshIcons(node);
  }
}

/** Step-up authentication, then a one-shot reveal that auto-hides. */
function revealCredential(clientId, credId) {
  openModal({
    title: 'تأكيد الهوية',
    size: 'sm',
    closeOnBackdrop: false,
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="shield-alert"></i>
        <div>لعرض بيانات الدخول أعد إدخال كلمة مرورك. سيتم تسجيل هذه العملية باسمك.</div>
      </div>
      <div class="field">
        <label class="field__label" for="v-pw">كلمة المرور</label>
        <input class="input" id="v-pw" type="password" autocomplete="current-password">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="v-go"><i data-lucide="unlock"></i> إظهار</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      const go = async () => {
        const password = api.$('#v-pw').value;
        if (!password) return toastError('أدخل كلمة المرور.');
        const button = api.$('#v-go');
        setBusy(button, true);
        try {
          await reauthenticate(password);
          const data = await callFn('vaultReveal', { clientId, credId });
          api.close();
          showSecret(data);
        } catch (err) {
          reportError(err, 'vault-reveal');
        } finally {
          setBusy(button, false);
        }
      };
      api.$('#v-go').addEventListener('click', go);
      api.$('#v-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
  });
}

function showSecret(data) {
  let seconds = 45;
  const modal = openModal({
    title: data.label || 'بيانات الدخول',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label">اسم المستخدم</label>
        <div class="secret-field">
          <span class="secret-field__value">${esc(data.username || '—')}</span>
          <button class="icon-btn" data-copy="username" aria-label="نسخ"><i data-lucide="copy"></i></button>
        </div>
      </div>
      <div class="field">
        <label class="field__label">كلمة المرور</label>
        <div class="secret-field is-masked" id="pw-box">
          <span class="secret-field__value" id="pw-value">${esc('•'.repeat(Math.min(14, (data.password || '').length || 8)))}</span>
          <button class="icon-btn" id="pw-eye" aria-label="إظهار"><i data-lucide="eye"></i></button>
          <button class="icon-btn" data-copy="password" aria-label="نسخ"><i data-lucide="copy"></i></button>
        </div>
      </div>
      ${data.notes ? `<div class="field">
        <label class="field__label">ملاحظات</label>
        <div class="doc-box fs-sm" style="background:var(--bg-inset);border-color:var(--border);
             padding:var(--sp-3);border-radius:var(--radius-sm)">${esc(data.notes)}</div></div>` : ''}
      <p class="fs-xs text-muted mt-3">
        ستُغلق هذه النافذة تلقائياً بعد <span class="num" id="v-timer">45</span> ثانية.
      </p>`,
    footerHTML: '<button class="btn btn--primary" data-modal-close>إغلاق</button>',
    onMount: (api) => {
      refreshIcons(api.root);
      let visible = false;

      api.$('#pw-eye').addEventListener('click', () => {
        visible = !visible;
        api.$('#pw-value').textContent = visible
          ? (data.password || '')
          : '•'.repeat(Math.min(14, (data.password || '').length || 8));
        api.$('#pw-box').classList.toggle('is-masked', !visible);
        api.$('#pw-eye').innerHTML = `<i data-lucide="${visible ? 'eye-off' : 'eye'}"></i>`;
        refreshIcons(api.$('#pw-eye'));
      });

      $$('[data-copy]', api.root).forEach((b) => b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(data[b.dataset.copy] || '');
          toastSuccess('تم النسخ إلى الحافظة.');
        } catch { toastError('تعذّر النسخ.'); }
      }));

      const tick = setInterval(() => {
        seconds--;
        const node = api.$('#v-timer');
        if (node) node.textContent = String(seconds);
        if (seconds <= 0) { clearInterval(tick); api.close(); }
      }, 1000);
    },
    onClose: () => { /* plaintext goes out of scope with the modal */ }
  });
  return modal;
}

function openCredentialModal(client, existing, onDone) {
  openModal({
    title: existing ? 'تعديل بيانات الدخول' : 'إضافة بيانات دخول',
    size: 'sm',
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="lock"></i>
        <div>سيتم تشفير القيمة على الخادم قبل التخزين. لن تظهر مرة أخرى إلا عبر إعادة التحقق.</div>
      </div>
      <div class="field">
        <label class="field__label" for="cr-platform">المنصة</label>
        <select class="select" id="cr-platform">
          ${Object.entries(PLATFORMS).map(([k, v]) => `
            <option value="${k}" ${existing?.platform === k ? 'selected' : ''}>${esc(v.ar)}</option>`).join('')}
          <option value="other" ${existing?.platform === 'other' ? 'selected' : ''}>أخرى</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="cr-label">الوصف <span class="req">*</span></label>
        <input class="input" id="cr-label" maxlength="120" value="${attr(existing?.label || '')}"
               placeholder="مثال: حساب إنستغرام الرئيسي">
      </div>
      <div class="field">
        <label class="field__label" for="cr-username">اسم المستخدم / البريد</label>
        <input class="input ltr" id="cr-username" maxlength="140" value="${attr(existing?.username || '')}">
      </div>
      <div class="field">
        <label class="field__label" for="cr-password">
          كلمة المرور ${existing ? '(اتركها فارغة للإبقاء على الحالية)' : ''}
        </label>
        <div class="input-group">
          <input class="input ltr" id="cr-password" type="password" autocomplete="new-password">
          <button class="input-group__btn" type="button" id="cr-eye" aria-label="إظهار">
            <i data-lucide="eye"></i></button>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="cr-notes">ملاحظات</label>
        <textarea class="textarea" id="cr-notes" maxlength="600">${esc(existing?.notes || '')}</textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="cr-save"><i data-lucide="lock"></i> حفظ مشفّراً</button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      api.$('#cr-eye').addEventListener('click', () => {
        const input = api.$('#cr-password');
        const isText = input.type === 'text';
        input.type = isText ? 'password' : 'text';
        api.$('#cr-eye').innerHTML = `<i data-lucide="${isText ? 'eye' : 'eye-off'}"></i>`;
        refreshIcons(api.$('#cr-eye'));
      });

      api.$('#cr-save').addEventListener('click', async () => {
        const label = sanitizeText(api.$('#cr-label').value, 120);
        if (!label) return toastError('الوصف مطلوب.');
        const password = api.$('#cr-password').value;
        if (!existing && !password) return toastError('كلمة المرور مطلوبة.');

        const button = api.$('#cr-save');
        setBusy(button, true);
        try {
          await callFn(existing ? 'vaultUpdate' : 'vaultAdd', {
            clientId: client.id,
            credId: existing?.id,
            platform: api.$('#cr-platform').value,
            label,
            username: sanitizeText(api.$('#cr-username').value, 140),
            password: password || undefined,
            notes: sanitizeMultiline(api.$('#cr-notes').value, 600)
          });
          toastSuccess('تم الحفظ بشكل مشفّر.');
          api.close();
          onDone?.();
        } catch (err) {
          reportError(err, 'vault-save');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}

/* -------------------------------------------------------------- tasks/files */

function tasksTab(host, tasks) {
  const sorted = sortTasks(tasks);
  host.innerHTML = sorted.length ? `
    <div class="table-wrap mt-4">
      <table class="table">
        <thead><tr><th>المهمة</th><th>المشروع</th><th>الحالة</th><th>الموعد</th></tr></thead>
        <tbody>${sorted.map((t) => `
          <tr onclick="location.hash='#/tasks/${attr(t.id)}'" style="cursor:pointer">
            <td class="is-strong">${esc(t.title)}</td>
            <td>${esc(t.project || '—')}</td>
            <td><span class="badge badge--${attr(isOverdue(t) ? 'danger' : TASK_STATUSES[t.status]?.badge || '')}">
              ${esc(isOverdue(t) ? 'متأخرة' : TASK_STATUSES[t.status]?.ar || '')}</span></td>
            <td class="num">${t.dueAt ? esc(formatDate(t.dueAt, { short: true })) : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : `<div class="mt-4">${emptyState({ icon: 'clipboard-list', title: 'لا مهام لهذا العميل' })}</div>`;
}

function filesTab(host, client, unsubs) {
  const canEdit = can(session.claims, 'clients.edit');
  host.innerHTML = `
    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="folder"></i> ملفات العميل</div>
        ${canEdit && uploadsEnabled()
          ? '<button class="btn btn--ghost btn--sm" id="up-file"><i data-lucide="upload"></i> رفع ملف</button>'
          : ''}
      </div>
      ${uploadsEnabled() ? '' : uploadsDisabledNotice('الملفات المرفوعة سابقاً تبقى متاحة للعرض والتنزيل.')}
      <div id="files-list">${'<div class="skeleton skeleton--row"></div>'.repeat(2)}</div>
    </div>`;
  refreshIcons(host);

  $('#up-file')?.addEventListener('click', async () => {   // absent while uploads are off
    const [file] = await pickFiles({ accept: 'image/*,.pdf,.doc,.docx,.xlsx,.zip' });
    if (!file) return;
    try {
      const uploaded = await uploadFile(file, paths.client(client.id, file), { maxMB: 20 });
      await addDoc(col('clients', client.id, 'files'), {
        ...uploaded, uploadedBy: session.uid, createdAt: ts()
      });
      toastSuccess('تم رفع الملف.');
    } catch (err) { reportError(err, 'client-file'); }
  });

  unsubs.push(onSnapshot(
    query(col('clients', client.id, 'files'), orderBy('createdAt', 'desc'), limit(80)),
    (snap) => {
      const files = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const node = $('#files-list');
      if (!node) return;
      node.innerHTML = files.length ? files.map((f) => `
        <div class="list-row" style="cursor:default">
          <span class="stat__icon" style="width:36px;height:36px">
            <i data-lucide="${f.type?.startsWith('image/') ? 'image' : 'file'}"></i></span>
          <div class="list-row__body">
            <div class="list-row__title truncate">${esc(f.name)}</div>
            <div class="list-row__sub">${esc(formatBytes(f.size))} · ${esc(timeAgo(f.createdAt))}</div>
          </div>
          <a class="icon-btn" href="${attr(f.url)}" target="_blank" rel="noopener noreferrer"
             aria-label="تنزيل"><i data-lucide="download"></i></a>
          ${canEdit ? `<button class="icon-btn" data-del-file="${attr(f.id)}" aria-label="حذف">
            <i data-lucide="trash-2"></i></button>` : ''}
        </div>`).join('') : emptyState({ icon: 'folder-open', title: 'لا ملفات' });
      refreshIcons(node);

      $$('[data-del-file]', node).forEach((b) => b.addEventListener('click', async () => {
        const file = files.find((f) => f.id === b.dataset.delFile);
        if (!(await confirmDialog({ title: 'حذف الملف', message: `حذف «${esc(file.name)}»؟`, danger: true }))) return;
        try {
          await deleteFile(file.path);
          await deleteDoc(ref('clients', client.id, 'files', file.id));
          toastSuccess('تم الحذف.');
        } catch (err) { reportError(err, 'delete-client-file'); }
      }));
    },
    () => {}
  ));
}

function activityTab(host, client, unsubs, people) {
  host.innerHTML = `<div class="card mt-4">
    <div class="card__head"><div class="card__title"><i data-lucide="history"></i> سجل النشاط</div></div>
    <div id="cl-activity">${'<div class="skeleton skeleton--text"></div>'.repeat(4)}</div></div>`;

  unsubs.push(onSnapshot(
    query(col('clients', client.id, 'activity'), orderBy('at', 'desc'), limit(50)),
    (snap) => {
      const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const node = $('#cl-activity');
      if (!node) return;
      node.innerHTML = events.length ? `<div class="timeline">${events.map((e) => `
        <div class="timeline__item">
          <span class="timeline__dot"></span>
          <div class="timeline__text">
            <strong>${esc(people[e.actorId]?.displayName || 'مستخدم')}</strong> ${esc(e.text)}
          </div>
          <div class="timeline__time">${esc(timeAgo(e.at))}</div>
        </div>`).join('')}</div>` : emptyState({ icon: 'history', title: 'لا نشاط مسجّل' });
    },
    () => {}
  ));
}

/**
 * Permanent client deletion.
 * The backend is asked first (without `confirmed`) so the dialog can show the
 * real impact — how many tasks and vault entries are involved — before the
 * user commits.
 */
async function openDeleteClient(client) {
  let impact;
  try {
    impact = await callFn('deleteClient', { clientId: client.id });
  } catch (err) {
    reportError(err, 'delete-client-preview');
    return;
  }

  openModal({
    title: 'حذف العميل نهائياً',
    subtitle: client.name,
    size: 'sm',
    closeOnBackdrop: false,
    bodyHTML: `
      <div class="security-note mb-4" style="background:var(--danger-soft);border-color:rgba(248,113,113,.35)">
        <i data-lucide="alert-triangle" style="color:var(--danger)"></i>
        <div><strong>لا يمكن التراجع عن هذا الإجراء.</strong></div>
      </div>

      <div class="grid grid-2 mb-4">
        <div class="card card--pad-sm" style="padding:var(--sp-3)">
          <div class="fs-xl fw-700 num">${impact.taskCount ?? 0}</div>
          <div class="fs-xs text-muted">مهمة مرتبطة</div>
        </div>
        <div class="card card--pad-sm" style="padding:var(--sp-3)">
          <div class="fs-xl fw-700 num" style="color:${impact.credentialCount ? 'var(--danger)' : 'inherit'}">
            ${impact.credentialCount ?? 0}</div>
          <div class="fs-xs text-muted">بيانات دخول مشفّرة</div>
        </div>
      </div>

      <div class="fs-sm mb-2">سيتم حذف:</div>
      <ul class="fs-sm text-secondary" style="line-height:2;padding-inline-start:18px;list-style:disc">
        <li>ملف العميل وحسابات التواصل الاجتماعي</li>
        <li>الملفات وسجل النشاط</li>
        ${impact.credentialCount
          ? '<li><strong style="color:var(--danger)">كل بيانات الدخول في الخزنة المشفّرة</strong></li>' : ''}
      </ul>

      <div class="fs-sm mt-3 mb-2">وسيتم الاحتفاظ بـ:</div>
      <ul class="fs-sm text-secondary" style="line-height:2;padding-inline-start:18px;list-style:disc">
        <li><strong>${impact.taskCount ?? 0} مهمة</strong> — تبقى في إحصائيات الموظفين مع الاحتفاظ باسم العميل كنص</li>
      </ul>

      <div class="field mt-4">
        <label class="field__label" for="cdel-confirm">
          للتأكيد اكتب اسم العميل: <strong>${esc(client.name)}</strong>
        </label>
        <input class="input" id="cdel-confirm" autocomplete="off" placeholder="${attr(client.name)}">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--danger" id="cdel-go" disabled>
        <i data-lucide="trash-2"></i> حذف نهائي
      </button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      const input = api.$('#cdel-confirm');
      const button = api.$('#cdel-go');
      const target = client.name.trim();

      input.addEventListener('input', () => {
        button.disabled = input.value.trim() !== target;
      });

      button.addEventListener('click', async () => {
        setBusy(button, true);
        try {
          const result = await callFn('deleteClient', { clientId: client.id, confirmed: true });
          api.close();
          const detached = result.removed?.tasksDetached;
          toastSuccess(
            detached ? `تم حذف العميل — ${detached} مهمة تم فصلها والاحتفاظ بها.` : 'تم حذف العميل نهائياً.'
          );
          location.hash = '#/clients';
        } catch (err) {
          reportError(err, 'delete-client');
        } finally {
          setBusy(button, false);
        }
      });
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
