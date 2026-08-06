/**
 * Hash router with lazy-loaded page modules and permission guards.
 *
 * Routes are declared with `perm` (any-of). A blocked route renders a 403 page
 * instead of navigating — the real enforcement is in Security Rules; this keeps
 * the UI honest about what the user can reach.
 *
 * Page modules export:  render(container, ctx) -> optional cleanup function
 */

import { session } from './auth.js';
import { canAny } from './permissions.js';
import { render, refreshIcons, esc } from './utils/dom.js';

/**
 * `title`/`crumbs` stay Arabic — a page's own content isn't translated yet,
 * and `title` also feeds the topbar search's page-name matching. `titleKey`/
 * `crumbKeys` translate the chrome (topbar title, breadcrumbs, document.title)
 * independently of that.
 */
const ROUTES = [
  { path: '/',              title: 'الرئيسية',           titleKey: 'route.home',            module: () => import('./dashboard.js'),        crumbs: [] },
  { path: '/my-tasks',      title: 'مهامي',              titleKey: 'route.myTasks',         module: () => import('./tasks.js'),            crumbs: [['المهام', '#/my-tasks']], crumbKeys: [['nav.tasksSection', '#/my-tasks']] },
  { path: '/tasks',         title: 'كل المهام',          titleKey: 'route.allTasks',        module: () => import('./tasks.js'),            crumbs: [['المهام', '#/tasks']], crumbKeys: [['nav.tasksSection', '#/tasks']] },
  { path: '/tasks/:id',     title: 'تفاصيل المهمة',      titleKey: 'route.taskDetail',      module: () => import('./tasks.js'),            crumbs: [['المهام', '#/tasks']], crumbKeys: [['nav.tasksSection', '#/tasks']] },
  { path: '/calendar',      title: 'التقويم',            titleKey: 'route.calendar',        module: () => import('./calendar.js'),         crumbs: [] },
  { path: '/team',          title: 'الفريق',             titleKey: 'route.team',            module: () => import('./team.js'),             crumbs: [] },
  { path: '/employees',     title: 'الموظفون',           titleKey: 'route.employees',       module: () => import('./employees.js'),        perm: ['employees.view'], crumbs: [] },
  { path: '/employees/:id', title: 'ملف الموظف',         titleKey: 'route.employeeProfile', module: () => import('./employee-profile.js'), crumbs: [['الموظفون', '#/employees']], crumbKeys: [['nav.employees', '#/employees']] },
  { path: '/clients',       title: 'العملاء',            titleKey: 'route.clients',         module: () => import('./clients.js'),          perm: ['clients.view'], crumbs: [] },
  { path: '/clients/:id',   title: 'ملف العميل',         titleKey: 'route.clientProfile',   module: () => import('./client-profile.js'),   perm: ['clients.view'], crumbs: [['العملاء', '#/clients']], crumbKeys: [['nav.clients', '#/clients']] },
  { path: '/documents',     title: 'المستندات والطلبات', titleKey: 'route.documents',       module: () => import('./documents.js'),        crumbs: [] },
  { path: '/documents/:id', title: 'تفاصيل الطلب',       titleKey: 'route.documentDetail',  module: () => import('./documents.js'),        crumbs: [['المستندات والطلبات', '#/documents']], crumbKeys: [['nav.documents', '#/documents']] },
  { path: '/chat',          title: 'الدردشة',            titleKey: 'route.chat',            module: () => import('./chat.js'),             crumbs: [] },
  { path: '/chat/:id',      title: 'الدردشة',            titleKey: 'route.chat',            module: () => import('./chat.js'),             crumbs: [] },
  { path: '/reports',       title: 'التقارير',           titleKey: 'route.reports',         module: () => import('./reports.js'),          perm: ['reports.view'], crumbs: [] },
  { path: '/notifications', title: 'الإشعارات',          titleKey: 'route.notifications',   module: () => import('./notifications.js'),    crumbs: [] },
  { path: '/settings',      title: 'الإعدادات',          titleKey: 'route.settings',        module: () => import('./settings.js'),         crumbs: [] },
  { path: '/settings/:tab', title: 'الإعدادات',          titleKey: 'route.settings',        module: () => import('./settings.js'),         crumbs: [['الإعدادات', '#/settings']], crumbKeys: [['nav.settings', '#/settings']] },
  { path: '/profile',       title: 'ملفي الشخصي',        titleKey: 'route.profile',         module: () => import('./employee-profile.js'), crumbs: [] }
];

let container = null;
let cleanup = null;
let currentPath = '';
const changeListeners = new Set();

export function onRouteChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Match "/clients/abc123" against "/clients/:id". */
function match(hashPath) {
  const parts = hashPath.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const routeParts = route.path.split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;
    const params = {};
    const ok = routeParts.every((segment, i) => {
      if (segment.startsWith(':')) { params[segment.slice(1)] = decodeURIComponent(parts[i]); return true; }
      return segment === parts[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

export function parseHash(hash = location.hash) {
  const raw = (hash || '#/').replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  return {
    path: pathPart.startsWith('/') ? pathPart : `/${pathPart}`,
    query: Object.fromEntries(new URLSearchParams(queryPart || ''))
  };
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

function notFound(path) {
  render(container, `
    <div class="page__inner">
      <div class="empty-state">
        <div class="empty-state__icon"><i data-lucide="map-pin-off"></i></div>
        <div class="empty-state__title">${esc(t('router.notFoundTitle'))}</div>
        <p class="empty-state__text">${esc(t('router.notFoundText', { path: `“${path}”` }))}</p>
        <a class="btn btn--primary" href="#/"><i data-lucide="home"></i> ${esc(t('router.backHome'))}</a>
      </div>
    </div>`);
}

function forbidden() {
  render(container, `
    <div class="page__inner">
      <div class="empty-state">
        <div class="empty-state__icon"><i data-lucide="shield-alert"></i></div>
        <div class="empty-state__title">${esc(t('router.forbiddenTitle'))}</div>
        <p class="empty-state__text">${esc(t('router.forbiddenText'))}</p>
        <a class="btn btn--secondary" href="#/"><i data-lucide="home"></i> ${esc(t('router.backHome'))}</a>
      </div>
    </div>`);
}

function loading() {
  render(container, `
    <div class="page__inner">
      <div class="skeleton skeleton--title"></div>
      <div class="grid grid-4 mt-4">
        ${'<div class="skeleton skeleton--card"></div>'.repeat(4)}
      </div>
      <div class="grid grid-main mt-4">
        <div class="skeleton" style="height:320px;border-radius:var(--radius-lg)"></div>
        <div class="skeleton" style="height:320px;border-radius:var(--radius-lg)"></div>
      </div>
    </div>`);
}

async function resolve() {
  const { path, query } = parseHash();
  const found = match(path);

  // Tear down the previous page (listeners, intervals, Firestore snapshots).
  try { cleanup?.(); } catch (err) { console.error('[luma] cleanup', err); }
  cleanup = null;
  container.scrollTop = 0;

  if (!found) { currentPath = path; notFound(path); emitChange(null, path); return; }

  const { route, params } = found;
  if (route.perm && !canAny(session.claims, route.perm)) {
    currentPath = path;
    forbidden();
    emitChange(route, path, params);
    return;
  }

  currentPath = path;
  emitChange(route, path, params);
  loading();

  try {
    const mod = await route.module();
    if (currentPath !== path) return;              // user navigated away meanwhile
    const result = await mod.render(container, { params, query, route, path });
    cleanup = typeof result === 'function' ? result : null;
    refreshIcons(container);
  } catch (err) {
    console.error('[luma] route render failed', path, err);
    render(container, `
      <div class="page__inner">
        <div class="empty-state error-state">
          <div class="empty-state__icon"><i data-lucide="alert-triangle"></i></div>
          <div class="empty-state__title">${esc(t('router.loadFailedTitle'))}</div>
          <p class="empty-state__text">${esc(err?.message || t('router.unknownError'))}</p>
          <button class="btn btn--secondary" onclick="location.reload()">
            <i data-lucide="rotate-cw"></i> ${esc(t('boot.reload'))}
          </button>
        </div>
      </div>`);
  }
}

function emitChange(route, path, params = {}) {
  changeListeners.forEach((cb) => {
    try { cb({ route, path, params }); } catch (err) { console.error('[luma] route listener', err); }
  });
}

export function startRouter(mountPoint) {
  container = mountPoint;
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.replace('#/');
  return resolve();
}

export function currentRoute() {
  return match(parseHash().path)?.route || null;
}

export { ROUTES };
