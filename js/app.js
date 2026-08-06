/**
 * Luma Agency — application shell.
 *
 * Owns everything that lives outside the routed page: sidebar, topbar, global
 * search, notifications badge, work-status pill, theme, drawer and the router.
 */

import { session, onSession, requireAuth, signOutUser } from './auth.js';
import { visibleNavItems, rolesLabel, ROLE_LABELS, can, isManager } from './permissions.js';
import { startRouter, onRouteChange, navigate, ROUTES } from './router.js';
import {
  $, $$, esc, attr, el, render, refreshIcons, bootIcons, debounce, avatarHTML
} from './utils/dom.js';
import { toastError, toastSuccess, reportError } from './utils/toast.js';
import { confirmDialog, openModal } from './utils/modal.js';
import {
  initPresence, onSelfPresence, setWorkState, confirmStartBreak, confirmEndBreak,
  WORK_STATES, presence
} from './utils/presence.js';
import { formatStopwatch, formatDuration, timeAgo } from './utils/format.js';
import { initSound, playNotificationSound, isAway } from './utils/sound.js';
import {
  col, query, where, orderBy, limit, onSnapshot, getMany, updateDoc, ref, callFn, getDirectory
} from './utils/api.js';

/* -------------------------------------------------------------- elements */

const shell = $('#app-shell');
const pageContainer = $('#page-container');

const teardown = [];
function track(unsub) { if (typeof unsub === 'function') teardown.push(unsub); }

/* ------------------------------------------------------------ bootstrap */

(async function bootstrap() {
  bootIcons();
  initSound();
  if (!(await requireAuth())) return;

  // A temporary password must be replaced before anything else loads.
  if (session.profile?.mustChangePassword) {
    location.replace('index.html');
    return;
  }

  applyStoredSidebarState();
  wireChrome();
  paintIdentity();
  buildNav();

  onSession(() => { paintIdentity(); buildNav(); });

  await initPresence(session.uid, session.profile || {});
  mountStatusPill();
  watchNotifications();
  warmDirectory();

  onRouteChange(onRouteChanged);
  await startRouter(pageContainer);

  window.addEventListener('beforeunload', () => teardown.forEach((fn) => { try { fn(); } catch {} }));
})().catch((err) => {
  console.error('[luma] bootstrap failed', err);
  render(pageContainer, `
    <div class="page__inner"><div class="empty-state error-state">
      <div class="empty-state__icon"><i data-lucide="alert-triangle"></i></div>
      <div class="empty-state__title">تعذّر تشغيل النظام</div>
      <p class="empty-state__text">${esc(err?.message || '')}</p>
      <button class="btn btn--secondary" onclick="location.reload()">إعادة التحميل</button>
    </div></div>`);
});

/* -------------------------------------------------------------- identity */

function paintIdentity() {
  const profile = session.profile || {};
  const name = profile.displayName || 'موظف';
  const roleText = profile.roles?.length
    ? rolesLabel(profile.roles)
    : ROLE_LABELS[session.claims?.role] || 'موظف';

  $('#sidebar-name').textContent = name;
  $('#sidebar-role').textContent = roleText;
  $('#topbar-name').textContent = name.split(' ')[0];

  $('#sidebar-avatar').innerHTML =
    `${avatarHTML(profile)}<span class="presence presence--${attr(presence.state)}"></span>`;
  $('#topbar-avatar').innerHTML = avatarHTML(profile, 'sm');
}

/* ------------------------------------------------------------------ nav */

function buildNav() {
  const items = visibleNavItems(session.claims);
  const currentPath = location.hash.replace('#', '') || '/';

  $('#nav-primary').innerHTML = items.map((item) => {
    const isActive = currentPath === item.route.replace('#', '') ||
      (item.route !== '#/' && currentPath.startsWith(item.route.replace('#', '')));
    return `
      <a class="nav-item${isActive ? ' is-active' : ''}" href="${attr(item.route)}"
         data-nav="${attr(item.id)}" data-label="${attr(item.label)}">
        <i data-lucide="${attr(item.icon)}"></i>
        <span class="nav-item__label">${esc(item.label)}</span>
        <span class="nav-item__badge" data-badge="${attr(item.id)}" hidden></span>
      </a>`;
  }).join('');

  // Contextual call-to-action under the nav.
  const cta = $('#sidebar-cta');
  if (can(session.claims, 'tasks.create')) {
    cta.innerHTML = `
      <button class="btn btn--primary btn--block" id="cta-new-task">
        <i data-lucide="plus"></i> مهمة جديدة
      </button>`;
    $('#cta-new-task').addEventListener('click', () => openQuickTask());
  } else {
    cta.innerHTML = `
      <button class="btn btn--secondary btn--block" id="cta-new-personal">
        <i data-lucide="plus"></i> مهمة شخصية
      </button>`;
    $('#cta-new-personal').addEventListener('click', () => openQuickTask({ personal: true }));
  }

  refreshIcons($('#sidebar'));
}

function onRouteChanged({ route, path }) {
  const item = visibleNavItems(session.claims).find(
    (nav) => nav.route.replace('#', '') === path ||
      (nav.route !== '#/' && path.startsWith(nav.route.replace('#', '')))
  );

  $$('.nav-item').forEach((node) => {
    node.classList.toggle('is-active', !!item && node.dataset.nav === item.id);
  });

  const title = route?.title || 'لوما';
  $('#page-title').textContent = title;
  document.title = `${title} · نظام إدارة لوما`;

  const crumbs = [['الرئيسية', '#/'], ...(route?.crumbs || [])];
  $('#breadcrumbs').innerHTML = crumbs
    .map(([label, href]) => `<a href="${attr(href)}">${esc(label)}</a>`)
    .concat(route && route.path !== '/' ? [`<span>${esc(title)}</span>`] : [])
    .join('<span class="breadcrumbs__sep">/</span>');

  closeDrawer();
}

/* ---------------------------------------------------------------- chrome */

function wireChrome() {
  /* theme ---------------------------------------------------------------- */
  const themeButton = $('#theme-toggle');
  const syncThemeIcon = () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    themeButton.innerHTML = `<i data-lucide="${isLight ? 'sun' : 'moon'}"></i>`;
    themeButton.classList.toggle('is-on', isLight);
    refreshIcons(themeButton);
  };
  syncThemeIcon();
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('luma.theme', next); } catch {}
    syncThemeIcon();
    window.dispatchEvent(new CustomEvent('luma:theme', { detail: next }));
  });

  /* sidebar collapse ------------------------------------------------------ */
  $('#collapse-toggle').addEventListener('click', () => {
    const collapsed = shell.classList.toggle('is-collapsed');
    try { localStorage.setItem('luma.sidebarCollapsed', collapsed ? '1' : '0'); } catch {}
    $('#collapse-toggle').innerHTML =
      `<i data-lucide="${collapsed ? 'panel-right-open' : 'panel-right-close'}"></i>`;
    refreshIcons($('#collapse-toggle'));
  });

  /* mobile drawer --------------------------------------------------------- */
  $('#drawer-toggle').addEventListener('click', () => {
    shell.classList.toggle('is-drawer-open');
    $('#drawer-backdrop').classList.toggle('is-open', shell.classList.contains('is-drawer-open'));
  });
  $('#drawer-backdrop').addEventListener('click', closeDrawer);

  /* logout ---------------------------------------------------------------- */
  $('#logout-btn').addEventListener('click', doLogout);

  /* help ------------------------------------------------------------------ */
  $('#help-btn').addEventListener('click', openHelp);

  /* quick add ------------------------------------------------------------- */
  $('#quick-add').addEventListener('click', (e) => openQuickAddMenu(e.currentTarget));
  $('#mobile-fab').addEventListener('click', (e) => openQuickAddMenu(e.currentTarget));

  /* profile menu ---------------------------------------------------------- */
  $('#profile-btn').addEventListener('click', (e) => openProfileMenu(e.currentTarget));

  /* notifications --------------------------------------------------------- */
  $('#notif-btn').addEventListener('click', () => navigate('#/notifications'));

  /* search ---------------------------------------------------------------- */
  wireSearch();

  /* keyboard shortcuts ---------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#global-search').focus();
      $('#global-search').select();
    }
    if (e.key === 'Escape') {
      $('#search-results').hidden = true;
      closeDrawer();
    }
  });

  $('#sidebar-search').addEventListener('focus', () => {
    $('#global-search').focus();
    closeDrawer();
  });
}

function closeDrawer() {
  shell.classList.remove('is-drawer-open');
  $('#drawer-backdrop').classList.remove('is-open');
}

function applyStoredSidebarState() {
  if (document.documentElement.dataset.sidebar === 'collapsed') {
    shell.classList.add('is-collapsed');
    $('#collapse-toggle').innerHTML = '<i data-lucide="panel-right-open"></i>';
  }
}

async function doLogout() {
  const ok = await confirmDialog({
    title: 'تسجيل الخروج',
    message: 'هل تريد إنهاء الجلسة الحالية والخروج من النظام؟',
    confirmText: 'تسجيل الخروج',
    danger: true,
    icon: 'log-out'
  });
  if (!ok) return;
  teardown.forEach((fn) => { try { fn(); } catch {} });
  await signOutUser();
  location.replace('index.html');
}

/* -------------------------------------------------------- work status pill */

function mountStatusPill() {
  const host = $('#status-pill-host');

  let timer = null;
  const paint = (state) => {
    const meta = WORK_STATES[state.state] || WORK_STATES.offline;
    const onBreak = state.state === 'break';
    const elapsed = onBreak && state.breakStartedAt ? Date.now() - state.breakStartedAt : 0;

    host.innerHTML = `
      <button class="status-pill" data-state="${attr(state.state)}" id="status-btn"
              title="اضغط لتغيير حالة العمل">
        <span class="status-pill__dot"></span>
        <span>${esc(meta.ar)}</span>
        ${onBreak ? `<span class="num" id="break-timer">${formatStopwatch(elapsed)}</span>` : ''}
      </button>`;

    $('#status-btn').addEventListener('click', () => openStatusMenu($('#status-btn')));

    clearInterval(timer);
    if (onBreak) {
      timer = setInterval(() => {
        const node = $('#break-timer');
        if (!node) { clearInterval(timer); return; }
        node.textContent = formatStopwatch(Date.now() - state.breakStartedAt);
      }, 1000);
      track(() => clearInterval(timer));
    }
  };

  track(onSelfPresence(paint));
}

function openStatusMenu(anchor) {
  const onBreak = presence.state === 'break';
  dropdown(anchor, `
    <div class="dropdown__header">حالة العمل</div>
    ${onBreak
      ? `<button class="dropdown__item" data-act="end-break">
           <i data-lucide="play"></i> إنهاء الاستراحة والعودة للعمل
         </button>`
      : `<button class="dropdown__item" data-act="start-break">
           <i data-lucide="coffee"></i> بدء استراحة
         </button>
         <button class="dropdown__item" data-act="working">
           <i data-lucide="activity"></i> تعيين الحالة: يعمل الآن
         </button>
         <button class="dropdown__item" data-act="online">
           <i data-lucide="circle"></i> تعيين الحالة: متصل
         </button>`}
    <div class="dropdown__sep"></div>
    <div class="dropdown__header">
      مجموع استراحات اليوم: ${esc(formatDuration(presence.todayBreakMs))}
    </div>`,
    async (action, close) => {
      close();
      try {
        if (action === 'start-break') await confirmStartBreak();
        else if (action === 'end-break') await confirmEndBreak();
        else if (action) await setWorkState(action);
      } catch (err) { reportError(err, 'status'); }
    });
}

/* ------------------------------------------------------------ dropdowns */

function dropdown(anchor, html, onSelect) {
  $$('.dropdown').forEach((node) => node.remove());

  const menu = el('div', { class: 'dropdown', role: 'menu', html });
  document.body.append(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 8}px`;
  const isRtl = document.documentElement.dir === 'rtl';
  if (isRtl) menu.style.left = `${Math.max(12, window.innerWidth - rect.right)}px`;
  else menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.position = 'fixed';

  refreshIcons(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  };
  const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-act]');
    if (item) onSelect?.(item.dataset.act, close);
  });

  return close;
}

function openProfileMenu(anchor) {
  dropdown(anchor, `
    <div class="dropdown__header">${esc(session.profile?.displayName || '')}</div>
    <a class="dropdown__item" href="#/profile"><i data-lucide="user"></i> ملفي الشخصي</a>
    <a class="dropdown__item" href="#/my-tasks"><i data-lucide="check-square"></i> مهامي</a>
    <a class="dropdown__item" href="#/documents"><i data-lucide="file-text"></i> طلباتي</a>
    <a class="dropdown__item" href="#/settings"><i data-lucide="settings"></i> الإعدادات</a>
    <div class="dropdown__sep"></div>
    <button class="dropdown__item" data-act="password"><i data-lucide="key-round"></i> تغيير كلمة المرور</button>
    <button class="dropdown__item dropdown__item--danger" data-act="logout">
      <i data-lucide="log-out"></i> تسجيل الخروج
    </button>`,
    async (action, close) => {
      close();
      if (action === 'logout') doLogout();
      if (action === 'password') (await import('./settings.js')).openPasswordModal();
    });
}

function openQuickAddMenu(anchor) {
  const claims = session.claims;
  dropdown(anchor, `
    <div class="dropdown__header">إضافة سريعة</div>
    <button class="dropdown__item" data-act="task"><i data-lucide="check-square"></i> مهمة جديدة</button>
    ${can(claims, 'clients.create')
      ? '<button class="dropdown__item" data-act="client"><i data-lucide="briefcase"></i> عميل جديد</button>' : ''}
    ${can(claims, 'employees.create')
      ? '<button class="dropdown__item" data-act="employee"><i data-lucide="user-plus"></i> موظف جديد</button>' : ''}
    <button class="dropdown__item" data-act="request"><i data-lucide="file-plus"></i> طلب إداري</button>
    <button class="dropdown__item" data-act="event"><i data-lucide="calendar-plus"></i> حدث في التقويم</button>`,
    async (action, close) => {
      close();
      try {
        if (action === 'task') return openQuickTask({ personal: !can(claims, 'tasks.create') });
        if (action === 'client') return (await import('./clients.js')).openClientModal();
        if (action === 'employee') return (await import('./employees.js')).openEmployeeModal();
        if (action === 'request') return (await import('./documents.js')).openRequestModal();
        if (action === 'event') return (await import('./calendar.js')).openEventModal();
      } catch (err) { reportError(err, 'quick-add'); }
    });
}

async function openQuickTask(options = {}) {
  try {
    const mod = await import('./tasks.js');
    mod.openTaskModal(options);
  } catch (err) { reportError(err, 'task-modal'); }
}

/* --------------------------------------------------------- notifications */

function watchNotifications() {
  const q = query(
    col('notifications'),
    where('userId', '==', session.uid),
    orderBy('createdAt', 'desc'),
    limit(30)
  );

  track(onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const unread = items.filter((n) => !n.read);

    $('#notif-dot').hidden = unread.length === 0;
    const badge = $('[data-badge="notifications"]');
    if (badge) {
      badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
      badge.hidden = unread.length === 0;
    }

    // Anything that genuinely just arrived — not the initial snapshot, and not
    // an old unread being re-delivered.
    const arrivals = snap.docChanges()
      .filter((change) => change.type === 'added')
      .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
      .filter((n) => !n.read && Date.now() - (n.createdAt?.toMillis?.() || 0) < 15000);

    if (arrivals.length) {
      // Sound only when the employee is looking elsewhere, so it behaves like a
      // messaging app rather than beeping at someone already reading the screen.
      if (isAway()) playNotificationSound();

      if (Notification?.permission === 'granted') {
        arrivals.forEach((n) => {
          try {
            new Notification(n.title || 'إشعار جديد', {
              body: n.body || '',
              icon: 'assets/logo/favicon.png',
              tag: n.id
            });
          } catch { /* not supported in this context */ }
        });
      }
    }

    window.dispatchEvent(new CustomEvent('luma:notifications', { detail: items }));
  }, (err) => console.warn('[luma] notifications listener', err.code)));

  // Unread request count for managers.
  if (can(session.claims, 'requests.approve')) {
    track(onSnapshot(
      query(col('requests'), where('status', '==', 'submitted'), limit(50)),
      (snap) => {
        const badge = $('[data-badge="documents"]');
        if (badge) {
          badge.textContent = String(snap.size);
          badge.hidden = snap.size === 0;
        }
      },
      () => {}
    ));
  }
}

/* --------------------------------------------------------------- search */

function wireSearch() {
  const input = $('#global-search');
  const results = $('#search-results');

  const run = debounce(async () => {
    const term = input.value.trim().toLowerCase();
    if (term.length < 2) { results.hidden = true; return; }

    results.hidden = false;
    results.innerHTML = '<div class="search-results__group">جارٍ البحث…</div>';

    try {
      const groups = await globalSearch(term);
      if (!groups.length) {
        results.innerHTML = `<div class="search-results__group">لا توجد نتائج لـ "${esc(term)}"</div>`;
        return;
      }
      results.innerHTML = groups.map((group) => `
        <div class="search-results__group">${esc(group.label)}</div>
        ${group.items.map((item) => `
          <a class="search-result" href="${attr(item.href)}">
            <i data-lucide="${attr(item.icon)}"></i>
            <span class="flex-1 truncate">${esc(item.title)}</span>
            ${item.meta ? `<span class="fs-xs text-muted">${esc(item.meta)}</span>` : ''}
          </a>`).join('')}`).join('');
      refreshIcons(results);
    } catch (err) {
      results.innerHTML = `<div class="search-results__group">تعذّر البحث: ${esc(err.message)}</div>`;
    }
  }, 300);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) results.hidden = false; });
  document.addEventListener('mousedown', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
  results.addEventListener('click', () => { results.hidden = true; input.value = ''; });
}

/**
 * Firestore has no full-text search, so we do prefix matching on the fields we
 * index (`titleLower`, `nameLower`, `displayNameLower`) — enough for a directory
 * of this size and far cheaper than shipping every document to the client.
 */
async function globalSearch(term) {
  const end = `${term}`;
  const groups = [];
  const claims = session.claims;

  const tasks = getMany(query(
    col('tasks'), orderBy('titleLower'), where('titleLower', '>=', term),
    where('titleLower', '<=', end), limit(5)
  )).catch(() => []);

  const people = can(claims, 'employees.view')
    ? getMany(query(
        col('users'), orderBy('displayNameLower'), where('displayNameLower', '>=', term),
        where('displayNameLower', '<=', end), limit(5)
      )).catch(() => [])
    : Promise.resolve([]);

  const clients = can(claims, 'clients.view')
    ? getMany(query(
        col('clients'), orderBy('nameLower'), where('nameLower', '>=', term),
        where('nameLower', '<=', end), limit(5)
      )).catch(() => [])
    : Promise.resolve([]);

  const [taskRows, peopleRows, clientRows] = await Promise.all([tasks, people, clients]);

  if (taskRows.length) {
    groups.push({
      label: 'المهام',
      items: taskRows.map((t) => ({
        title: t.title, href: `#/tasks/${t.id}`, icon: 'check-square', meta: t.clientName || ''
      }))
    });
  }
  if (peopleRows.length) {
    groups.push({
      label: 'الموظفون',
      items: peopleRows.map((u) => ({
        title: u.displayName, href: `#/employees/${u.id}`, icon: 'user', meta: rolesLabel(u.roles)
      }))
    });
  }
  if (clientRows.length) {
    groups.push({
      label: 'العملاء',
      items: clientRows.map((c) => ({
        title: c.name, href: `#/clients/${c.id}`, icon: 'briefcase', meta: c.status === 'active' ? 'نشط' : 'متوقف'
      }))
    });
  }

  // Always offer matching pages.
  const pages = ROUTES
    .filter((r) => !r.path.includes(':') && r.title.includes(term))
    .slice(0, 3)
    .map((r) => ({ title: r.title, href: `#${r.path}`, icon: 'arrow-left-circle' }));
  if (pages.length) groups.push({ label: 'الصفحات', items: pages });

  return groups;
}

/* ------------------------------------------------------------ misc setup */

function warmDirectory() {
  // Pre-fetch the employee directory once — pickers across the app reuse it.
  getDirectory().catch((err) => console.warn('[luma] directory prefetch', err.code || err.message));

  // Ask for browser notification permission at a calm moment, once.
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      try { Notification.requestPermission(); } catch {}
    }, 12_000);
  }
}

function openHelp() {
  openModal({
    title: 'المساعدة واختصارات لوحة المفاتيح',
    size: 'sm',
    bodyHTML: `
      <div class="kv"><span class="kv__k">بحث شامل</span><span class="kv__v">Ctrl + K</span></div>
      <div class="kv"><span class="kv__k">إغلاق النوافذ</span><span class="kv__v">Esc</span></div>
      <div class="list-divider"></div>
      <p class="fs-sm text-muted">
        لعرض بيانات الرواتب أو البيانات البنكية أو خزنة بيانات العملاء تحتاج صلاحيات
        خاصة يمنحها مدير النظام من صفحة الإعدادات ← مصفوفة الصلاحيات.
      </p>
      <p class="fs-sm text-muted">
        جميع العمليات الحساسة تُسجَّل في سجل التدقيق مع اسم المنفّذ ووقت التنفيذ.
      </p>`,
    footerHTML: '<button class="btn btn--primary" data-modal-close>حسناً</button>'
  });
}

/* Re-export helpers used by page modules. */
export { dropdown };
