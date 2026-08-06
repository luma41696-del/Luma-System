/**
 * Settings: personal preferences, security, the permission matrix and the
 * audit log. Which tabs appear depends on the viewer's claims.
 */

import { session, changeOwnPassword } from './auth.js';
import {
  can, isAdmin, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_PRESETS, ROLE_LABELS,
  JOB_ROLES, DEPARTMENTS, rolesLabel
} from './permissions.js';
import { $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, avatarHTML, debounce } from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, getMany, getDirectory, getUsers,
  updateDoc, setDoc, getOne, callFn, ts, onSnapshot
} from './utils/api.js';
import { formatDateTime, timeAgo, formatDate } from './utils/format.js';
import { checkPassword } from './utils/sanitize.js';
import { FCM_VAPID_KEY, APP_CHECK_SITE_KEY, TIMEZONE } from './firebase-config.js';

const TABS = [
  { id: 'general',       label: 'عام',                icon: 'sliders-horizontal' },
  { id: 'notifications', label: 'الإشعارات',          icon: 'bell' },
  { id: 'security',      label: 'الأمان',             icon: 'shield' },
  { id: 'permissions',   label: 'مصفوفة الصلاحيات',   icon: 'key-round', perm: 'settings.manage' },
  { id: 'audit',         label: 'سجل التدقيق',        icon: 'scroll-text', perm: 'settings.manage' },
  { id: 'system',        label: 'إعدادات النظام',     icon: 'server-cog', perm: 'settings.manage' }
];

export async function render(container, ctx) {
  const unsubs = [];
  const tabs = TABS.filter((t) => !t.perm || can(session.claims, t.perm) || isAdmin(session.claims));
  let active = ctx.params.tab && tabs.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : tabs[0].id;

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">الإعدادات</div>
          <div class="page-head__sub">تفضيلاتك الشخصية وإعدادات النظام</div>
        </div>
      </div>

      <div class="tabs" id="settings-tabs">
        ${tabs.map((t) => `
          <button class="tab" data-tab="${attr(t.id)}">
            <i data-lucide="${attr(t.icon)}"></i> ${esc(t.label)}
          </button>`).join('')}
      </div>

      <div id="settings-body"></div>
    </div>`;

  refreshIcons(container);

  $('#settings-tabs').addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button) return;
    active = button.dataset.tab;
    history.replaceState(null, '', `#/settings/${active}`);
    paint();
  });

  function paint() {
    $$('#settings-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === active));
    const host = $('#settings-body');
    if (active === 'general') generalTab(host);
    else if (active === 'notifications') notificationsTab(host);
    else if (active === 'security') securityTab(host);
    else if (active === 'permissions') permissionsTab(host, unsubs);
    else if (active === 'audit') auditTab(host, unsubs);
    else if (active === 'system') systemTab(host);
    refreshIcons(host);
  }

  paint();
  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ---------------------------------------------------------------- general */

function generalTab(host) {
  const theme = document.documentElement.dataset.theme || 'dark';
  host.innerHTML = `
    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="palette"></i> المظهر</div></div>
        <label class="switch mb-4">
          <input type="checkbox" id="s-theme" ${theme === 'light' ? 'checked' : ''}>
          <span class="switch__track"></span>
          <span>الوضع النهاري</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="s-collapsed"
            ${localStorage.getItem('luma.sidebarCollapsed') === '1' ? 'checked' : ''}>
          <span class="switch__track"></span>
          <span>بدء القائمة الجانبية مطوية</span>
        </label>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="languages"></i> اللغة والمنطقة</div></div>
        <div class="field">
          <label class="field__label" for="s-lang">لغة الواجهة</label>
          <select class="select" id="s-lang">
            <option value="ar" selected>العربية (RTL)</option>
            <option value="en" disabled>English (LTR) — قريباً</option>
          </select>
          <div class="field__hint">
            الواجهة مبنية بخصائص CSS المنطقية، لذا تفعيل الإنجليزية لاحقاً لا يتطلب إعادة تصميم.
          </div>
        </div>
        <div class="kv"><span class="kv__k">المنطقة الزمنية</span>
          <span class="kv__v ltr">${esc(TIMEZONE)}</span></div>
        <div class="kv"><span class="kv__k">بداية الأسبوع</span><span class="kv__v">الأحد</span></div>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="user"></i> حسابي</div></div>
        <div class="flex gap-3 items-center mb-3">
          ${avatarHTML(session.profile || {}, 'lg')}
          <div>
            <div class="fw-700">${esc(session.profile?.displayName || '')}</div>
            <div class="fs-xs text-muted ltr">@${esc(session.profile?.username || '')}</div>
          </div>
        </div>
        <div class="kv"><span class="kv__k">نوع الحساب</span>
          <span class="kv__v">${esc(ROLE_LABELS[session.claims?.role] || 'موظف')}</span></div>
        <div class="kv"><span class="kv__k">المسميات</span>
          <span class="kv__v">${esc(rolesLabel(session.profile?.roles))}</span></div>
        <div class="kv"><span class="kv__k">القسم</span>
          <span class="kv__v">${esc(DEPARTMENTS[session.profile?.department] || '—')}</span></div>
        <a class="btn btn--secondary btn--block mt-3" href="#/profile">
          <i data-lucide="pencil"></i> تعديل ملفي الشخصي</a>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="key-round"></i> صلاحياتي</div></div>
        <div class="tag-list">
          ${isAdmin(session.claims)
            ? '<span class="badge badge--brand">جميع الصلاحيات (مدير النظام)</span>'
            : (session.permissions.map((p) => `<span class="badge">${esc(PERMISSIONS[p]?.ar || p)}</span>`).join('')
               || '<span class="text-muted fs-sm">لا صلاحيات إضافية.</span>')}
        </div>
      </div>
    </div>`;

  $('#s-theme').addEventListener('change', (e) => {
    const next = e.target.checked ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('luma.theme', next); } catch {}
    window.dispatchEvent(new CustomEvent('luma:theme', { detail: next }));
  });

  $('#s-collapsed').addEventListener('change', (e) => {
    try { localStorage.setItem('luma.sidebarCollapsed', e.target.checked ? '1' : '0'); } catch {}
    document.getElementById('app-shell')?.classList.toggle('is-collapsed', e.target.checked);
  });
}

/* ---------------------------------------------------------- notifications */

function notificationsTab(host) {
  const prefs = session.profile?.notifPrefs || {};
  const OPTIONS = [
    ['taskAssigned', 'إسناد مهمة جديدة لي'],
    ['taskDue', 'اقتراب موعد تسليم مهمة'],
    ['taskOverdue', 'تأخر مهمة عن موعدها'],
    ['taskComment', 'تعليق جديد على مهامي'],
    ['requestDecision', 'قرار على طلباتي الإدارية'],
    ['requestNew', 'طلب إداري جديد بانتظار قراري'],
    ['chatMessage', 'رسائل الدردشة الخاصة'],
    ['chatMention', 'الإشارة إليّ في الدردشة'],
    ['clientUpdated', 'تحديث بيانات عميل']
  ];

  const permission = 'Notification' in window ? Notification.permission : 'unsupported';

  host.innerHTML = `
    <div class="grid grid-main mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="bell"></i> تفضيلات الإشعارات</div></div>
        ${OPTIONS.map(([key, label]) => `
          <label class="switch" style="display:flex;justify-content:space-between;padding:10px 0;
                 border-bottom:1px solid var(--border-soft)">
            <span>${esc(label)}</span>
            <span style="display:flex;align-items:center">
              <input type="checkbox" data-pref="${attr(key)}" ${prefs[key] !== false ? 'checked' : ''}>
              <span class="switch__track"></span>
            </span>
          </label>`).join('')}
        <button class="btn btn--primary mt-4" id="save-prefs"><i data-lucide="save"></i> حفظ التفضيلات</button>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="volume-2"></i> صوت التنبيه</div></div>
        <label class="switch" style="display:flex;justify-content:space-between;padding:10px 0">
          <span>تشغيل صوت عند وصول مهمة أو رسالة جديدة</span>
          <span style="display:flex;align-items:center">
            <input type="checkbox" id="s-sound">
            <span class="switch__track"></span>
          </span>
        </label>
        <p class="fs-xs text-muted" style="line-height:1.8">
          الصوت يعمل فقط عندما تكون خارج الموقع (تبويب آخر أو نافذة أخرى) — تماماً مثل واتساب،
          فلا يزعجك وأنت تعمل داخل النظام.
        </p>
        <button class="btn btn--secondary btn--block mt-3" id="s-sound-test">
          <i data-lucide="play"></i> تجربة الصوت
        </button>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="monitor-smartphone"></i> إشعارات المتصفح</div></div>
        <div class="kv"><span class="kv__k">الحالة</span><span class="kv__v">${
          permission === 'granted' ? 'مفعّلة' :
          permission === 'denied' ? 'محظورة من المتصفح' :
          permission === 'unsupported' ? 'غير مدعومة' : 'لم تُطلب بعد'
        }</span></div>
        ${permission === 'default'
          ? '<button class="btn btn--secondary btn--block mt-3" id="ask-perm">تفعيل إشعارات المتصفح</button>' : ''}
        ${permission === 'denied'
          ? '<p class="fs-xs text-muted mt-3">لتفعيلها، اسمح بالإشعارات من إعدادات الموقع في المتصفح.</p>' : ''}
        <div class="list-divider"></div>
        <div class="kv"><span class="kv__k">Web Push (FCM)</span>
          <span class="kv__v">${FCM_VAPID_KEY ? 'مُعدّ' : 'غير مُعدّ'}</span></div>
        ${FCM_VAPID_KEY && permission === 'granted'
          ? '<button class="btn btn--ghost btn--block mt-3" id="reg-fcm">تسجيل هذا الجهاز للإشعارات</button>' : ''}
      </div>
    </div>`;

  $('#save-prefs').addEventListener('click', async () => {
    const next = {};
    $$('[data-pref]', host).forEach((box) => { next[box.dataset.pref] = box.checked; });
    const button = $('#save-prefs');
    setBusy(button, true);
    try {
      await updateDoc(ref('users', session.uid), { notifPrefs: next, updatedAt: ts() });
      toastSuccess('تم حفظ تفضيلات الإشعارات.');
    } catch (err) { reportError(err, 'notif-prefs'); }
    finally { setBusy(button, false); }
  });

  const soundBox = $('#s-sound');
  if (soundBox) {
    import('./utils/sound.js').then(({ soundEnabled, setSoundEnabled, playNotificationSound }) => {
      soundBox.checked = soundEnabled();
      soundBox.addEventListener('change', () => {
        setSoundEnabled(soundBox.checked);
        if (soundBox.checked) playNotificationSound({ force: true });
        toastSuccess(soundBox.checked ? 'تم تفعيل صوت التنبيه.' : 'تم كتم صوت التنبيه.');
      });
      $('#s-sound-test')?.addEventListener('click', () => playNotificationSound({ force: true }));
    });
  }

  $('#ask-perm')?.addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    if (result === 'granted') toastSuccess('تم تفعيل إشعارات المتصفح.');
    else toastError('لم يتم منح الإذن.');
    notificationsTab(host);
    refreshIcons(host);
  });

  $('#reg-fcm')?.addEventListener('click', async () => {
    try {
      const { getMessaging, getToken } =
        await import('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging.js');
      const { app } = await import('./firebase-config.js');
      const token = await getToken(getMessaging(app), { vapidKey: FCM_VAPID_KEY });
      await callFn('registerPushToken', { token });
      toastSuccess('تم تسجيل الجهاز لاستقبال الإشعارات.');
    } catch (err) {
      reportError(err, 'fcm');
    }
  });
}

/* --------------------------------------------------------------- security */

function securityTab(host) {
  host.innerHTML = `
    <div class="grid grid-main mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="lock"></i> كلمة المرور</div></div>
        <p class="fs-sm text-muted mb-4">
          يُنصح بتغيير كلمة المرور كل 90 يوماً وعدم استخدامها في أي خدمة أخرى.
        </p>
        <button class="btn btn--primary" id="change-pw"><i data-lucide="key-round"></i> تغيير كلمة المرور</button>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="shield-check"></i> حالة الحماية</div></div>
        <div class="kv"><span class="kv__k">App Check</span>
          <span class="kv__v">${APP_CHECK_SITE_KEY
            ? '<span class="badge badge--success">مفعّل</span>'
            : '<span class="badge badge--warning">غير مُعدّ</span>'}</span></div>
        <div class="kv"><span class="kv__k">تشفير النقل</span>
          <span class="kv__v"><span class="badge badge--success">HTTPS / TLS</span></span></div>
        <div class="kv"><span class="kv__k">التشفير عند التخزين</span>
          <span class="kv__v"><span class="badge badge--success">مفعّل (Firebase)</span></span></div>
        <div class="kv"><span class="kv__k">خزنة بيانات العملاء</span>
          <span class="kv__v"><span class="badge badge--success">AES-256-GCM</span></span></div>
        <div class="kv"><span class="kv__k">سجل التدقيق</span>
          <span class="kv__v"><span class="badge badge--success">فعّال</span></span></div>
        <div class="list-divider"></div>
        <p class="fs-xs text-muted">
          لا يتم تخزين كلمات المرور في قاعدة البيانات إطلاقاً — التحقق يتم عبر Firebase Authentication.
        </p>
      </div>
    </div>`;

  $('#change-pw').addEventListener('click', openPasswordModal);
}

export function openPasswordModal() {
  openModal({
    title: 'تغيير كلمة المرور',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="cp-current">كلمة المرور الحالية</label>
        <input class="input" id="cp-current" type="password" autocomplete="current-password">
      </div>
      <div class="field">
        <label class="field__label" for="cp-new">كلمة المرور الجديدة</label>
        <input class="input" id="cp-new" type="password" autocomplete="new-password">
        <div class="progress mt-2"><div class="progress__bar" id="cp-bar" style="width:0"></div></div>
        <ul class="field__hint" id="cp-rules" style="line-height:1.9;margin-top:8px"></ul>
      </div>
      <div class="field">
        <label class="field__label" for="cp-confirm">تأكيد كلمة المرور</label>
        <input class="input" id="cp-confirm" type="password" autocomplete="new-password">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="cp-save">حفظ</button>`,
    onMount: (api) => {
      const RULES = [
        [(p) => p.length >= 10, '10 أحرف على الأقل'],
        [(p) => /[a-z]/.test(p), 'حرف إنجليزي صغير'],
        [(p) => /[A-Z]/.test(p), 'حرف إنجليزي كبير'],
        [(p) => /\d/.test(p), 'رقم'],
        [(p) => /[^A-Za-z0-9]/.test(p), 'رمز خاص']
      ];
      const paint = (value) => {
        api.$('#cp-rules').innerHTML = RULES.map(([test, label]) => {
          const ok = test(value);
          return `<li style="color:${ok ? 'var(--success)' : 'var(--text-muted)'}">
            ${ok ? '✓' : '○'} ${esc(label)}</li>`;
        }).join('');
        const score = RULES.filter(([test]) => test(value)).length;
        const bar = api.$('#cp-bar');
        bar.style.width = `${(score / RULES.length) * 100}%`;
        bar.className = 'progress__bar' + (score <= 2 ? ' progress__bar--danger'
          : score === RULES.length ? ' progress__bar--success' : '');
      };
      paint('');
      api.$('#cp-new').addEventListener('input', (e) => paint(e.target.value));

      api.$('#cp-save').addEventListener('click', async () => {
        const current = api.$('#cp-current').value;
        const next = api.$('#cp-new').value;
        const confirmValue = api.$('#cp-confirm').value;

        const policy = checkPassword(next);
        if (!policy.ok) return toastError(policy.issues[0]);
        if (next !== confirmValue) return toastError('كلمتا المرور غير متطابقتين.');

        const button = api.$('#cp-save');
        setBusy(button, true);
        try {
          await changeOwnPassword(current, next);
          toastSuccess('تم تغيير كلمة المرور.');
          api.close();
        } catch (err) { reportError(err, 'change-password'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

/* ------------------------------------------------------ permission matrix */

async function permissionsTab(host, unsubs) {
  host.innerHTML = `
    <div class="security-note mt-4">
      <i data-lucide="shield-alert"></i>
      <div>
        تعديل الصلاحيات ينعكس على الموظف عبر Firebase custom claims، ويُطبَّق فعلياً على
        قواعد الأمان في الخادم — إخفاء زر في الواجهة ليس حماية بحد ذاته.
      </div>
    </div>

    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="key-round"></i> مصفوفة الصلاحيات</div>
        <div class="flex gap-2">
          <input class="input" id="pm-search" placeholder="بحث عن موظف…" style="min-height:34px;width:200px">
          <button class="btn btn--primary btn--sm" id="pm-save"><i data-lucide="save"></i> حفظ التغييرات</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="perm-matrix" id="pm-table">
          <thead><tr><th>الصلاحية</th></tr></thead>
          <tbody><tr><td>جارٍ التحميل…</td></tr></tbody>
        </table>
      </div>
    </div>`;

  refreshIcons(host);

  const directory = (await getDirectory().catch(() => [])).filter((u) => u.status !== 'disabled');
  const changed = new Map();   // uid -> Set(permission names)

  const state = new Map(directory.map((u) => [
    u.id,
    new Set(Object.entries(PERMISSIONS)
      .filter(([, meta]) => (u.perms || []).includes(meta.code))
      .map(([name]) => name))
  ]));

  const build = (filterTerm = '') => {
    const people = directory.filter((u) =>
      !filterTerm || u.displayName.toLowerCase().includes(filterTerm.toLowerCase()));

    const table = $('#pm-table');
    table.querySelector('thead').innerHTML = `
      <tr>
        <th style="min-width:220px">الصلاحية</th>
        ${people.map((u) => `
          <th style="text-align:center;min-width:88px">
            <div class="fs-2xs">${esc(u.displayName.split(' ')[0])}</div>
            <div class="fs-2xs text-muted">${esc(ROLE_LABELS[u.accountRole] || '')}</div>
          </th>`).join('')}
      </tr>`;

    table.querySelector('tbody').innerHTML = Object.entries(PERMISSION_GROUPS).map(([groupKey, groupLabel]) => `
      <tr class="perm-group"><td colspan="${people.length + 1}">${esc(groupLabel)}</td></tr>
      ${Object.entries(PERMISSIONS).filter(([, m]) => m.group === groupKey).map(([name, meta]) => `
        <tr>
          <td>${esc(meta.ar)}<div class="fs-2xs text-muted ltr">${esc(name)}</div></td>
          ${people.map((u) => {
            const isAdminAccount = u.accountRole === 'admin';
            return `<td style="text-align:center">
              <input type="checkbox" data-uid="${attr(u.id)}" data-perm="${attr(name)}"
                ${isAdminAccount || state.get(u.id)?.has(name) ? 'checked' : ''}
                ${isAdminAccount ? 'disabled title="مدير النظام يملك كل الصلاحيات"' : ''}>
            </td>`;
          }).join('')}
        </tr>`).join('')}`).join('');

    $$('[data-perm]', table).forEach((box) => box.addEventListener('change', () => {
      const uid = box.dataset.uid;
      const set = state.get(uid);
      if (box.checked) set.add(box.dataset.perm);
      else set.delete(box.dataset.perm);
      changed.set(uid, set);
      $('#pm-save').classList.add('is-dirty');
    }));
  };

  build();
  $('#pm-search').addEventListener('input', debounce((e) => build(e.target.value), 250));

  $('#pm-save').addEventListener('click', async () => {
    if (!changed.size) return toastError('لا توجد تغييرات للحفظ.');
    const ok = await confirmDialog({
      title: 'حفظ الصلاحيات',
      message: `سيتم تحديث صلاحيات ${changed.size} موظف. ستُطبَّق خلال دقيقة على أكثر تقدير.`,
      confirmText: 'حفظ'
    });
    if (!ok) return;

    const button = $('#pm-save');
    setBusy(button, true);
    try {
      for (const [uid, perms] of changed.entries()) {
        const user = directory.find((u) => u.id === uid);
        await callFn('updateEmployeeAccess', {
          uid,
          roles: user?.roles || [],
          accountRole: user?.accountRole || 'employee',
          permissions: [...perms]
        });
      }
      changed.clear();
      toastSuccess('تم حفظ الصلاحيات.');
    } catch (err) {
      reportError(err, 'permissions-save');
    } finally {
      setBusy(button, false);
    }
  });
}

/* -------------------------------------------------------------- audit log */

function auditTab(host, unsubs) {
  host.innerHTML = `
    <div class="card mt-4">
      <div class="card__head">
        <div class="card__title"><i data-lucide="scroll-text"></i> سجل التدقيق</div>
        <span class="card__sub">سجل غير قابل للتعديل — يُكتب من الخادم فقط</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الوقت</th><th>المنفّذ</th><th>الإجراء</th><th>السجل</th><th>تفاصيل</th></tr></thead>
          <tbody id="audit-rows">
            <tr><td colspan="5"><div class="skeleton skeleton--row"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
  refreshIcons(host);

  const ACTIONS = {
    'employee.create': 'إنشاء حساب موظف',
    'employee.access': 'تعديل الصلاحيات',
    'employee.status': 'تغيير حالة الحساب',
    'employee.password_reset': 'إعادة تعيين كلمة المرور',
    'employee.salary': 'تعديل الراتب',
    'employee.banking': 'تعديل البيانات البنكية',
    'employee.leave': 'تعديل رصيد الإجازات',
    'employee.delete': 'حذف موظف نهائياً',
    'client.delete': 'حذف عميل نهائياً',
    'request.delete': 'حذف طلب نهائياً',
    'vault.add': 'إضافة بيانات دخول',
    'vault.update': 'تعديل بيانات دخول',
    'vault.delete': 'حذف بيانات دخول',
    'vault.reveal': 'عرض بيانات دخول',
    'request.decide': 'قرار على طلب',
    'auth.password_changed': 'تغيير كلمة المرور',
    'auth.login_locked': 'إيقاف مؤقت بعد محاولات فاشلة'
  };

  unsubs.push(onSnapshot(
    query(col('auditLogs'), orderBy('at', 'desc'), limit(200)),
    async (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const actors = await getUsers([...new Set(rows.map((r) => r.actorId).filter(Boolean))]);
      const byId = Object.fromEntries(actors.map((u) => [u.id, u]));
      const node = $('#audit-rows');
      if (!node) return;
      node.innerHTML = rows.length ? rows.map((r) => `
        <tr>
          <td class="num" style="white-space:nowrap">${esc(formatDateTime(r.at))}</td>
          <td class="is-strong">${esc(byId[r.actorId]?.displayName || r.actorName || '—')}</td>
          <td>${esc(ACTIONS[r.action] || r.action)}</td>
          <td class="fs-xs ltr">${esc(r.targetId || '—')}</td>
          <td class="fs-xs text-muted">${esc(summarizeMeta(r.meta))}</td>
        </tr>`).join('')
        : '<tr><td colspan="5">لا توجد سجلات بعد.</td></tr>';
    },
    (err) => {
      $('#audit-rows').innerHTML =
        `<tr><td colspan="5">${esc(err.message)}</td></tr>`;
    }
  ));
}

function summarizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return '—';
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || '—';
}

/* ----------------------------------------------------------------- system */

async function systemTab(host) {
  host.innerHTML = `
    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="building"></i> بيانات الوكالة</div></div>
        <div class="field">
          <label class="field__label" for="sys-name">اسم الوكالة</label>
          <input class="input" id="sys-name" value="وكالة لوما">
        </div>
        <div class="field">
          <label class="field__label" for="sys-quota">رصيد الإجازات السنوي الافتراضي</label>
          <input class="input ltr" id="sys-quota" type="number" min="0" max="60" value="14">
        </div>
        <div class="field">
          <label class="field__label" for="sys-break">الحد اليومي لمدة الاستراحات (دقيقة)</label>
          <input class="input ltr" id="sys-break" type="number" min="0" max="240" value="60">
        </div>
        <div class="field">
          <label class="field__label" for="sys-workday">ساعات العمل اليومية</label>
          <input class="input ltr" id="sys-workday" type="number" min="1" max="16" value="8">
        </div>
        <button class="btn btn--primary" id="sys-save"><i data-lucide="save"></i> حفظ الإعدادات</button>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title"><i data-lucide="info"></i> معلومات النظام</div></div>
        <div class="kv"><span class="kv__k">مشروع Firebase</span><span class="kv__v ltr">luma-web-d3550</span></div>
        <div class="kv"><span class="kv__k">المنطقة الزمنية</span><span class="kv__v ltr">${esc(TIMEZONE)}</span></div>
        <div class="kv"><span class="kv__k">إصدار الواجهة</span><span class="kv__v ltr">1.0.0</span></div>
        <div class="kv"><span class="kv__k">App Check</span>
          <span class="kv__v">${APP_CHECK_SITE_KEY ? 'مفعّل' : 'غير مُعدّ'}</span></div>
        <div class="list-divider"></div>
        <p class="fs-xs text-muted">
          مفاتيح التشفير وحسابات الخدمة محفوظة في Google Secret Manager ولا توجد في كود الواجهة.
        </p>
      </div>
    </div>`;

  try {
    const settings = await getOne('settings', 'app');
    if (settings) {
      $('#sys-name').value = settings.agencyName || 'وكالة لوما';
      $('#sys-quota').value = settings.defaultLeaveQuota ?? 14;
      $('#sys-break').value = settings.dailyBreakLimitMin ?? 60;
      $('#sys-workday').value = settings.workdayHours ?? 8;
    }
  } catch { /* first run — defaults stay */ }

  $('#sys-save').addEventListener('click', async () => {
    const button = $('#sys-save');
    setBusy(button, true);
    try {
      await setDoc(ref('settings', 'app'), {
        agencyName: $('#sys-name').value.trim().slice(0, 120),
        defaultLeaveQuota: Number($('#sys-quota').value) || 14,
        dailyBreakLimitMin: Number($('#sys-break').value) || 60,
        workdayHours: Number($('#sys-workday').value) || 8,
        updatedAt: ts(),
        updatedBy: session.uid
      }, { merge: true });
      toastSuccess('تم حفظ إعدادات النظام.');
    } catch (err) { reportError(err, 'system-settings'); }
    finally { setBusy(button, false); }
  });
}
