/**
 * Luma Agency — Roles & permissions (client side).
 *
 * IMPORTANT: everything here is for *rendering* decisions only. The browser
 * never decides what it is allowed to do — Security Rules and Cloud Functions
 * re-check the same claims server-side. Hiding a button is UX, not security.
 *
 * The short codes are what actually travels inside the Firebase Auth custom
 * claim (`token.perms`), because custom claims are capped at 1000 bytes.
 * functions/lib/permissions.js and firestore.rules use the identical codes.
 */

/* ----------------------------------------------------------------- roles */

export const JOB_ROLES = {
  graphic_designer: { ar: 'مصمم جرافيك', en: 'Graphic Designer', color: 'var(--accent-1)' },
  it:               { ar: 'دعم تقني',    en: 'IT',               color: 'var(--accent-2)' },
  account_manager:  { ar: 'مدير حسابات', en: 'Account Manager',  color: 'var(--accent-3)' },
  photographer:     { ar: 'مصور',        en: 'Photographer',     color: 'var(--accent-4)' },
  video_editor:     { ar: 'مونتير',      en: 'Video Editor',     color: 'var(--accent-5)' },
  programmer:       { ar: 'مبرمج',       en: 'Programmer',       color: 'var(--accent-6)' },
  sales:            { ar: 'مبيعات',      en: 'Sales',            color: 'var(--info)' }
};

export const DEPARTMENTS = {
  creative:  'القسم الإبداعي',
  tech:      'القسم التقني',
  accounts:  'إدارة الحسابات',
  media:     'الإنتاج والتصوير',
  sales:     'المبيعات',
  admin:     'الإدارة'
};

/* ----------------------------------------------------------- permissions */

/** name -> { code, ar, group } */
export const PERMISSIONS = {
  'dashboard.viewCompany':  { code: 'dvc', ar: 'عرض لوحة الشركة الكاملة',           group: 'dashboard' },
  'dashboard.viewTeam':     { code: 'dvt', ar: 'عرض لوحة الفريق',                   group: 'dashboard' },

  'employees.view':         { code: 'ev',  ar: 'عرض الموظفين',                      group: 'employees' },
  'employees.create':       { code: 'ec',  ar: 'إنشاء حسابات الموظفين',             group: 'employees' },
  'employees.edit':         { code: 'ee',  ar: 'تعديل بيانات الموظفين',             group: 'employees' },
  'employees.delete':       { code: 'ex',  ar: 'تعطيل / حذف الموظفين',              group: 'employees' },
  'employees.viewSalary':   { code: 'evs', ar: 'عرض الرواتب',                       group: 'employees' },
  'employees.editSalary':   { code: 'ees', ar: 'تعديل الرواتب',                     group: 'employees' },
  'employees.viewBanking':  { code: 'evb', ar: 'عرض البيانات البنكية (IBAN/CliQ)',  group: 'employees' },

  'clients.view':           { code: 'cv',  ar: 'عرض العملاء',                       group: 'clients' },
  'clients.create':         { code: 'cc',  ar: 'إضافة عملاء',                       group: 'clients' },
  'clients.edit':           { code: 'ce',  ar: 'تعديل بيانات العملاء',              group: 'clients' },
  'clients.delete':         { code: 'cx',  ar: 'حذف العملاء نهائياً',               group: 'clients' },
  'clients.viewCredentials':{ code: 'cvc', ar: 'الوصول إلى خزنة بيانات الدخول',     group: 'clients' },

  'tasks.create':           { code: 'tc',  ar: 'إنشاء المهام',                      group: 'tasks' },
  'tasks.assign':           { code: 'ta',  ar: 'إسناد المهام للموظفين',             group: 'tasks' },
  'tasks.editAll':          { code: 'te',  ar: 'تعديل جميع المهام',                 group: 'tasks' },
  'tasks.delete':           { code: 'tx',  ar: 'حذف المهام',                        group: 'tasks' },

  'requests.approve':       { code: 'ra',  ar: 'اعتماد أو رفض الطلبات',             group: 'requests' },
  'chat.manage':            { code: 'cm',  ar: 'إدارة الدردشة والمجموعات',          group: 'chat' },

  'reports.view':           { code: 'rv',  ar: 'عرض التقارير',                      group: 'reports' },
  'reports.export':         { code: 'rx',  ar: 'تصدير التقارير',                    group: 'reports' },

  'settings.manage':        { code: 'sm',  ar: 'إدارة إعدادات النظام',              group: 'settings' }
};

export const PERMISSION_GROUPS = {
  dashboard: 'لوحة التحكم',
  employees: 'الموظفون',
  clients:   'العملاء',
  tasks:     'المهام',
  requests:  'الطلبات',
  chat:      'الدردشة',
  reports:   'التقارير',
  settings:  'الإعدادات'
};

/** code -> permission name (reverse index). */
export const CODE_TO_PERM = Object.fromEntries(
  Object.entries(PERMISSIONS).map(([name, meta]) => [meta.code, name])
);

export const ALL_PERMISSION_NAMES = Object.keys(PERMISSIONS);
export const ALL_PERMISSION_CODES = Object.values(PERMISSIONS).map((p) => p.code);

/* -------------------------------------------------------- preset bundles */

/** Ready-made permission sets offered when creating an employee. */
export const PERMISSION_PRESETS = {
  admin: {
    ar: 'مدير النظام',
    role: 'admin',
    perms: ALL_PERMISSION_NAMES
  },
  account_manager: {
    ar: 'مدير حسابات',
    role: 'manager',
    perms: [
      'dashboard.viewCompany', 'dashboard.viewTeam',
      'employees.view', 'employees.create', 'employees.edit',
      'clients.view', 'clients.create', 'clients.edit', 'clients.viewCredentials',
      'tasks.create', 'tasks.assign', 'tasks.editAll', 'tasks.delete',
      'requests.approve', 'chat.manage', 'reports.view', 'reports.export'
    ]
  },
  team_lead: {
    ar: 'مسؤول فريق',
    role: 'manager',
    perms: [
      'dashboard.viewTeam', 'employees.view', 'clients.view',
      'tasks.create', 'tasks.assign', 'tasks.editAll', 'reports.view'
    ]
  },
  employee: {
    ar: 'موظف',
    role: 'employee',
    perms: ['clients.view']
  }
};

export const ROLE_LABELS = {
  admin: 'مدير النظام',
  manager: 'مدير',
  employee: 'موظف'
};

/* ---------------------------------------------------------- conversions */

export function permsToCodes(names = []) {
  return names.map((n) => PERMISSIONS[n]?.code).filter(Boolean);
}

export function codesToPerms(codes = []) {
  return codes.map((c) => CODE_TO_PERM[c]).filter(Boolean);
}

export function permLabel(name) {
  return PERMISSIONS[name]?.ar || name;
}

export function roleLabel(roleKey) {
  return JOB_ROLES[roleKey]?.ar || roleKey;
}

export function rolesLabel(roles = []) {
  return roles.map(roleLabel).join(' + ') || '—';
}

/* -------------------------------------------------------- runtime checks */

/**
 * Permission gate used across the UI.
 * @param {{role?:string, perms?:string[]}} claims decoded custom claims
 * @param {string} permission full permission name, e.g. 'tasks.create'
 */
export function can(claims, permission) {
  if (!claims) return false;
  if (claims.role === 'admin') return true;             // admin holds everything
  if (claims.status && claims.status !== 'active') return false;
  const code = PERMISSIONS[permission]?.code;
  if (!code) return false;
  return Array.isArray(claims.perms) && claims.perms.includes(code);
}

export function canAny(claims, permissions = []) {
  return permissions.some((p) => can(claims, p));
}

export function canAll(claims, permissions = []) {
  return permissions.every((p) => can(claims, p));
}

export function isAdmin(claims) {
  return claims?.role === 'admin';
}

export function isManager(claims) {
  return claims?.role === 'admin' || claims?.role === 'manager';
}

/* --------------------------------------------------------- navigation */

/**
 * Sidebar definition. `perm` (any-of) decides whether the item is rendered.
 * Items with no `perm` are visible to every active employee.
 */
export const NAV_ITEMS = [
  { id: 'home',        route: '#/',           labelKey: 'nav.home',        icon: 'layout-dashboard' },
  { id: 'my-tasks',    route: '#/my-tasks',   labelKey: 'nav.myTasks',     icon: 'check-square' },
  { id: 'calendar',    route: '#/calendar',   labelKey: 'nav.calendar',    icon: 'calendar-days' },
  { id: 'team',        route: '#/team',       labelKey: 'nav.team',        icon: 'users' },
  { id: 'employees',   route: '#/employees',  labelKey: 'nav.employees',   icon: 'id-card',
    perm: ['employees.view'] },
  { id: 'clients',     route: '#/clients',    labelKey: 'nav.clients',     icon: 'briefcase',
    perm: ['clients.view'] },
  { id: 'documents',   route: '#/documents',  labelKey: 'nav.documents',   icon: 'file-text' },
  { id: 'chat',        route: '#/chat',       labelKey: 'nav.chat',        icon: 'message-circle' },
  { id: 'reports',     route: '#/reports',    labelKey: 'nav.reports',     icon: 'bar-chart-3',
    perm: ['reports.view'] },
  { id: 'notifications', route: '#/notifications', labelKey: 'nav.notifications', icon: 'bell' },
  { id: 'settings',    route: '#/settings',   labelKey: 'nav.settings',    icon: 'settings' }
];

export function visibleNavItems(claims) {
  return NAV_ITEMS.filter((item) => !item.perm || canAny(claims, item.perm));
}
