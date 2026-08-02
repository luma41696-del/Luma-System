/**
 * Employee directory + account creation.
 *
 * Accounts are never created from the browser: `createEmployee` is a callable
 * Cloud Function running the Admin SDK, which re-checks that the caller holds
 * `employees.create` and refuses to grant admin unless the caller is an admin.
 */

import { session } from './auth.js';
import { can, isAdmin, JOB_ROLES, DEPARTMENTS, PERMISSION_PRESETS, PERMISSIONS,
         PERMISSION_GROUPS, rolesLabel, ROLE_LABELS } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, avatarHTML, avatarWithPresence,
  emptyState, debounce, setBusy
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, query, orderBy, limit, onSnapshot, getDirectory, invalidateDirectory, callFn
} from './utils/api.js';
import { watchAllPresence, WORK_STATES } from './utils/presence.js';
import { formatDate, formatNumber } from './utils/format.js';
import {
  sanitizeText, isValidEmail, isValidPhone, isValidUsername, normalizeUsername
} from './utils/sanitize.js';

export async function render(container) {
  const unsubs = [];
  let employees = [];
  let statuses = {};
  let filters = { search: '', role: 'all', department: 'all', status: 'all' };

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">الموظفون</div>
          <div class="page-head__sub" id="emp-count">…</div>
        </div>
        <div class="page-head__actions">
          ${can(session.claims, 'employees.create')
            ? '<button class="btn btn--primary" id="new-employee"><i data-lucide="user-plus"></i> إضافة موظف</button>'
            : ''}
          ${isAdmin(session.claims)
            ? '<a class="btn btn--secondary" href="#/settings/permissions"><i data-lucide="shield"></i> مصفوفة الصلاحيات</a>'
            : ''}
        </div>
      </div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
        <input class="input" id="f-search" type="search" placeholder="ابحث بالاسم أو اسم المستخدم…">
        <select class="select" id="f-role">
          <option value="all">كل المسميات</option>
          ${Object.entries(JOB_ROLES).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('')}
        </select>
        <select class="select" id="f-dept">
          <option value="all">كل الأقسام</option>
          ${Object.entries(DEPARTMENTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
        <select class="select" id="f-status">
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="disabled">معطّل</option>
        </select>
      </div>

      <div class="grid grid-4 mb-4" id="emp-stats"></div>
      <div id="emp-list">${'<div class="skeleton skeleton--row"></div>'.repeat(6)}</div>
    </div>`;

  refreshIcons(container);

  $('#new-employee')?.addEventListener('click', () => openEmployeeModal());

  const applyFilters = () => {
    filters = {
      search: $('#f-search').value.trim().toLowerCase(),
      role: $('#f-role').value,
      department: $('#f-dept').value,
      status: $('#f-status').value
    };
    paint();
  };
  $('#f-search').addEventListener('input', debounce(applyFilters, 220));
  ['#f-role', '#f-dept', '#f-status'].forEach((s) => $(s).addEventListener('change', applyFilters));

  unsubs.push(onSnapshot(
    query(col('users'), orderBy('displayName'), limit(300)),
    (snap) => { employees = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paint(); },
    (err) => mount($('#emp-list'), emptyState({
      icon: 'shield-alert', title: 'لا تملك صلاحية عرض الموظفين', text: err.message
    }))
  ));

  unsubs.push(watchAllPresence((value) => { statuses = value; paint(); }));

  function paint() {
    const rows = employees.filter((u) => {
      if (filters.search) {
        const hay = `${u.displayName} ${u.username} ${u.personalEmail || ''}`.toLowerCase();
        if (!hay.includes(filters.search)) return false;
      }
      if (filters.role !== 'all' && !(u.roles || []).includes(filters.role)) return false;
      if (filters.department !== 'all' && u.department !== filters.department) return false;
      if (filters.status !== 'all' && (u.status || 'active') !== filters.status) return false;
      return true;
    });

    $('#emp-count').textContent = `${rows.length} موظف من أصل ${employees.length}`;

    const online = employees.filter((u) => ['working', 'online'].includes(statuses[u.id]?.state)).length;
    const onBreak = employees.filter((u) => statuses[u.id]?.state === 'break').length;
    $('#emp-stats').innerHTML = `
      ${chip('users', 'brand', employees.length, 'إجمالي الموظفين')}
      ${chip('activity', 'success', online, 'متصلون الآن')}
      ${chip('coffee', 'warning', onBreak, 'في استراحة')}
      ${chip('user-x', 'danger', employees.filter((u) => u.status === 'disabled').length, 'حسابات معطّلة')}`;
    refreshIcons($('#emp-stats'));

    const host = $('#emp-list');
    if (!rows.length) {
      mount(host, emptyState({ icon: 'users', title: 'لا يوجد موظفون مطابقون' }));
      return;
    }

    host.innerHTML = `<div class="grid grid-auto">${rows.map((u) => {
      const state = statuses[u.id]?.state || 'offline';
      const meta = WORK_STATES[state];
      const disabled = u.status === 'disabled';
      return `
        <a class="card" href="#/employees/${attr(u.id)}"
           style="text-decoration:none;color:inherit;${disabled ? 'opacity:.6' : ''}">
          <div class="flex gap-3 items-start">
            ${avatarWithPresence(u, state, 'lg')}
            <div class="flex-1" style="min-width:0">
              <div class="fw-700 truncate">${esc(u.displayName)}</div>
              <div class="fs-xs text-muted ltr truncate">@${esc(u.username)}</div>
              <div class="tag-list mt-2">
                ${(u.roles || []).slice(0, 3).map((r) => `
                  <span class="badge" style="color:${JOB_ROLES[r]?.color || 'inherit'}">
                    ${esc(JOB_ROLES[r]?.ar || r)}</span>`).join('')}
              </div>
            </div>
          </div>
          <div class="list-divider"></div>
          <div class="flex justify-between items-center fs-xs">
            <span style="color:${meta.color}">● ${esc(meta.ar)}</span>
            <span class="text-muted">${esc(DEPARTMENTS[u.department] || '—')}</span>
          </div>
          ${disabled ? '<div class="badge badge--danger mt-3">حساب معطّل</div>' : ''}
        </a>`;
    }).join('')}</div>`;
    refreshIcons(host);
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

function chip(icon, tone, value, label) {
  return `
    <div class="stat">
      <span class="stat__icon stat__icon--${attr(tone)}"><i data-lucide="${attr(icon)}"></i></span>
      <div class="stat__body">
        <div class="stat__value num">${formatNumber(value)}</div>
        <div class="stat__label">${esc(label)}</div>
      </div>
    </div>`;
}

/* ========================================================================== */
/* Create employee                                                            */
/* ========================================================================== */

export function openEmployeeModal() {
  if (!can(session.claims, 'employees.create')) {
    toastError('لا تملك صلاحية إنشاء حسابات الموظفين.');
    return;
  }

  const selectedRoles = new Set();
  const selectedPerms = new Set(PERMISSION_PRESETS.employee.perms);
  let accountRole = 'employee';

  openModal({
    title: 'إضافة موظف جديد',
    subtitle: 'يتم إنشاء الحساب عبر الخادم بشكل آمن، وتُرسل كلمة مرور مؤقتة يجب تغييرها عند أول دخول.',
    size: 'lg',
    bodyHTML: `
      <form id="emp-form">
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="e-name">الاسم الكامل <span class="req">*</span></label>
            <input class="input" id="e-name" required maxlength="120" placeholder="مثال: أحمد خالد العمري">
          </div>
          <div class="field">
            <label class="field__label" for="e-username">اسم المستخدم <span class="req">*</span></label>
            <input class="input ltr" id="e-username" required maxlength="24"
                   placeholder="ahmad.omari" autocapitalize="none" spellcheck="false">
            <div class="field__hint">أحرف لاتينية صغيرة وأرقام و . _ - فقط (3-24).</div>
            <div class="field__error" id="e-username-err" hidden></div>
          </div>
          <div class="field">
            <label class="field__label" for="e-email">البريد الإلكتروني <span class="req">*</span></label>
            <input class="input ltr" id="e-email" type="email" required placeholder="ahmad@lumaagency.com">
            <div class="field__hint">يُستخدم لاستعادة كلمة المرور والإشعارات.</div>
          </div>
          <div class="field">
            <label class="field__label" for="e-phone">رقم الهاتف</label>
            <input class="input ltr" id="e-phone" type="tel" placeholder="+962 7X XXX XXXX">
          </div>
          <div class="field">
            <label class="field__label" for="e-dept">القسم</label>
            <select class="select" id="e-dept">
              ${Object.entries(DEPARTMENTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="e-join">تاريخ المباشرة</label>
            <input class="input" id="e-join" type="date" value="${new Date().toISOString().slice(0, 10)}">
          </div>
        </div>

        <div class="field">
          <label class="field__label">المسميات الوظيفية <span class="req">*</span></label>
          <div class="chip-select" id="e-roles">
            ${Object.entries(JOB_ROLES).map(([k, v]) => `
              <button type="button" class="chip-toggle" data-role="${attr(k)}">${esc(v.ar)}</button>`).join('')}
          </div>
          <div class="field__hint">يمكن اختيار أكثر من مسمى (مثل: مصمم جرافيك + مونتير).</div>
        </div>

        <div class="divider-label">الصلاحيات</div>

        <div class="field">
          <label class="field__label" for="e-preset">قالب الصلاحيات</label>
          <select class="select" id="e-preset">
            ${Object.entries(PERMISSION_PRESETS)
              .filter(([key]) => key !== 'admin' || isAdmin(session.claims))
              .map(([key, preset]) => `
                <option value="${attr(key)}" ${key === 'employee' ? 'selected' : ''}>${esc(preset.ar)}</option>`).join('')}
          </select>
          ${!isAdmin(session.claims)
            ? '<div class="field__hint">منح صلاحية «مدير النظام» متاح للمدير العام فقط.</div>' : ''}
        </div>

        <div class="field">
          <label class="field__label">صلاحيات مخصصة</label>
          <div id="e-perms" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);
               border-radius:var(--radius-sm);padding:var(--sp-3)"></div>
        </div>

        <div class="security-note">
          <i data-lucide="shield-alert"></i>
          <div>
            سيتم إنشاء كلمة مرور مؤقتة عشوائية وعرضها لك مرة واحدة فقط.
            لا يتم تخزين كلمات المرور في قاعدة البيانات إطلاقاً.
          </div>
        </div>
      </form>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="e-save"><i data-lucide="user-plus"></i> إنشاء الحساب</button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      /* roles */
      $$('[data-role]', api.root).forEach((chipButton) => {
        chipButton.addEventListener('click', () => {
          const role = chipButton.dataset.role;
          if (selectedRoles.has(role)) { selectedRoles.delete(role); chipButton.classList.remove('is-on'); }
          else { selectedRoles.add(role); chipButton.classList.add('is-on'); }
        });
      });

      /* permission checkboxes */
      const permHost = api.$('#e-perms');
      const paintPerms = () => {
        permHost.innerHTML = Object.entries(PERMISSION_GROUPS).map(([groupKey, groupLabel]) => `
          <div class="mb-3">
            <div class="fs-xs fw-700 text-brand mb-2">${esc(groupLabel)}</div>
            ${Object.entries(PERMISSIONS)
              .filter(([, meta]) => meta.group === groupKey)
              .map(([name, meta]) => `
                <label class="checkbox" style="display:flex;padding:3px 0">
                  <input type="checkbox" data-perm="${attr(name)}" ${selectedPerms.has(name) ? 'checked' : ''}>
                  <span class="fs-sm">${esc(meta.ar)}</span>
                </label>`).join('')}
          </div>`).join('');
        permHost.querySelectorAll('[data-perm]').forEach((box) => {
          box.addEventListener('change', () => {
            if (box.checked) selectedPerms.add(box.dataset.perm);
            else selectedPerms.delete(box.dataset.perm);
          });
        });
      };
      paintPerms();

      api.$('#e-preset').addEventListener('change', (e) => {
        const preset = PERMISSION_PRESETS[e.target.value];
        accountRole = preset.role;
        selectedPerms.clear();
        preset.perms.forEach((p) => selectedPerms.add(p));
        paintPerms();
      });

      /* username validation */
      const usernameInput = api.$('#e-username');
      usernameInput.addEventListener('input', () => {
        const value = normalizeUsername(usernameInput.value);
        usernameInput.value = value;
        const err = api.$('#e-username-err');
        const invalid = value && !isValidUsername(value);
        err.textContent = invalid ? 'اسم المستخدم غير صالح.' : '';
        err.hidden = !invalid;
        usernameInput.classList.toggle('has-error', invalid);
      });

      /* auto-suggest a username from the full name */
      api.$('#e-name').addEventListener('blur', () => {
        if (usernameInput.value) return;
        const parts = api.$('#e-name').value.trim().split(/\s+/);
        if (parts.length >= 2) {
          const guess = normalizeUsername(`${transliterate(parts[0])}.${transliterate(parts[1])}`);
          if (isValidUsername(guess)) usernameInput.value = guess;
        }
      });

      /* save */
      api.$('#e-save').addEventListener('click', async () => {
        const displayName = sanitizeText(api.$('#e-name').value, 120);
        const username = normalizeUsername(api.$('#e-username').value);
        const email = api.$('#e-email').value.trim();
        const phone = api.$('#e-phone').value.trim();

        if (!displayName) return toastError('الاسم الكامل مطلوب.');
        if (!isValidUsername(username)) return toastError('اسم المستخدم غير صالح.');
        if (!isValidEmail(email)) return toastError('البريد الإلكتروني غير صالح.');
        if (phone && !isValidPhone(phone)) return toastError('رقم الهاتف غير صالح.');
        if (!selectedRoles.size) return toastError('اختر مسمى وظيفياً واحداً على الأقل.');

        const button = api.$('#e-save');
        setBusy(button, true);
        try {
          const result = await callFn('createEmployee', {
            displayName,
            username,
            email,
            phone,
            department: api.$('#e-dept').value,
            joinDate: api.$('#e-join').value,
            roles: [...selectedRoles],
            accountRole,
            permissions: [...selectedPerms]
          });
          api.close();
          invalidateDirectory();
          showTemporaryPassword(result);
        } catch (err) {
          reportError(err, 'create-employee');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}

/** Shown once — the password is never stored anywhere we can read it again. */
function showTemporaryPassword({ username, tempPassword, uid }) {
  openModal({
    title: 'تم إنشاء الحساب بنجاح',
    size: 'sm',
    closeOnBackdrop: false,
    bodyHTML: `
      <div class="security-note mb-4">
        <i data-lucide="key-round"></i>
        <div>هذه كلمة المرور المؤقتة، تُعرض <strong>مرة واحدة فقط</strong>. سلّمها للموظف عبر قناة آمنة.</div>
      </div>
      <div class="field">
        <label class="field__label">اسم المستخدم</label>
        <div class="secret-field"><span class="secret-field__value">${esc(username)}</span></div>
      </div>
      <div class="field">
        <label class="field__label">كلمة المرور المؤقتة</label>
        <div class="secret-field">
          <span class="secret-field__value" id="temp-pw">${esc(tempPassword)}</span>
          <button class="icon-btn" id="copy-pw" aria-label="نسخ"><i data-lucide="copy"></i></button>
        </div>
      </div>
      <p class="fs-xs text-muted mt-3">
        سيُطلب من الموظف تغييرها إجبارياً عند أول تسجيل دخول.
      </p>`,
    footerHTML: `
      <a class="btn btn--secondary" href="#/employees/${attr(uid)}" data-modal-close>عرض الملف</a>
      <button class="btn btn--primary" data-modal-close>تم</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#copy-pw').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(api.$('#temp-pw').textContent);
          toastSuccess('تم نسخ كلمة المرور.');
        } catch { toastError('تعذّر النسخ — انسخها يدوياً.'); }
      });
    }
  });
}

/** Rough Arabic → latin mapping, only used to suggest a username. */
function transliterate(text) {
  const map = {
    'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
    'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
    'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
    'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a',
    'ة': 'a', 'ء': '', 'ئ': 'e', 'ؤ': 'o'
  };
  return [...String(text)].map((ch) => map[ch] ?? (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : '')).join('');
}
