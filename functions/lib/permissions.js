/**
 * Server-side permission model. This is the authority — the browser copy in
 * js/permissions.js exists only to decide what to render.
 *
 * The short codes are what goes into the Firebase Auth custom claim, because
 * claims are limited to 1000 bytes.
 */

const { HttpsError } = require('firebase-functions/v2/https');

const PERMISSION_CODES = {
  'dashboard.viewCompany': 'dvc',
  'dashboard.viewTeam': 'dvt',
  'employees.view': 'ev',
  'employees.create': 'ec',
  'employees.edit': 'ee',
  'employees.delete': 'ex',
  'employees.viewSalary': 'evs',
  'employees.editSalary': 'ees',
  'employees.viewBanking': 'evb',
  'clients.view': 'cv',
  'clients.create': 'cc',
  'clients.edit': 'ce',
  'clients.delete': 'cx',
  'clients.viewCredentials': 'cvc',
  'tasks.create': 'tc',
  'tasks.assign': 'ta',
  'tasks.editAll': 'te',
  'tasks.delete': 'tx',
  'requests.approve': 'ra',
  'chat.manage': 'cm',
  'reports.view': 'rv',
  'reports.export': 'rx',
  'finance.view': 'fv',
  'finance.manage': 'fm',
  'finance.void': 'fx',
  'finance.approve': 'fa',
  'finance.ai': 'fai',
  'settings.manage': 'sm'
};

const ALL_PERMISSIONS = Object.keys(PERMISSION_CODES);
const CODE_TO_PERMISSION = Object.fromEntries(
  Object.entries(PERMISSION_CODES).map(([name, code]) => [code, name])
);

const ACCOUNT_ROLES = ['admin', 'manager', 'employee'];

const JOB_ROLES = [
  'graphic_designer', 'it', 'account_manager',
  'photographer', 'video_editor', 'programmer', 'sales', 'accountant'
];

const DEPARTMENTS = ['creative', 'tech', 'accounts', 'media', 'sales', 'admin'];

function permsToCodes(names = []) {
  return [...new Set(names.map((n) => PERMISSION_CODES[n]).filter(Boolean))];
}

function codesToPerms(codes = []) {
  return codes.map((c) => CODE_TO_PERMISSION[c]).filter(Boolean);
}

/* -------------------------------------------------------------- guards */

/**
 * Every callable starts here. Rejects unauthenticated callers and disabled
 * accounts, and returns a normalised context.
 */
function requireAuth(request) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول لتنفيذ هذا الإجراء.');
  }
  const token = auth.token || {};
  if ((token.status || 'active') !== 'active') {
    throw new HttpsError('permission-denied', 'هذا الحساب معطّل.');
  }
  return {
    uid: auth.uid,
    role: token.role || 'employee',
    perms: Array.isArray(token.perms) ? token.perms : [],
    isAdmin: token.role === 'admin',
    email: token.email || '',
    name: token.name || ''
  };
}

function has(caller, permission) {
  if (caller.isAdmin) return true;
  const code = PERMISSION_CODES[permission];
  return !!code && caller.perms.includes(code);
}

function requirePermission(caller, permission) {
  if (!has(caller, permission)) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية تنفيذ هذا الإجراء.');
  }
  return true;
}

function requireAnyPermission(caller, permissions) {
  if (!permissions.some((p) => has(caller, p))) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية تنفيذ هذا الإجراء.');
  }
  return true;
}

function requireAdmin(caller) {
  if (!caller.isAdmin) {
    throw new HttpsError('permission-denied', 'هذا الإجراء متاح لمدير النظام فقط.');
  }
  return true;
}

/**
 * Privilege-escalation guard: a non-admin may never hand out a permission they
 * do not themselves hold, and may never create or promote an admin.
 */
function assertCanGrant(caller, { accountRole, permissions = [] }) {
  if (accountRole === 'admin' && !caller.isAdmin) {
    throw new HttpsError('permission-denied', 'منح صلاحية «مدير النظام» متاح للمدير العام فقط.');
  }
  if (caller.isAdmin) return true;

  const callerPermissions = codesToPerms(caller.perms);
  const escalated = permissions.filter((p) => !callerPermissions.includes(p));
  if (escalated.length) {
    throw new HttpsError(
      'permission-denied',
      'لا يمكنك منح صلاحيات لا تملكها بنفسك.'
    );
  }
  return true;
}

/** Build the custom-claims object written to the Auth user record. */
function buildClaims({ accountRole = 'employee', permissions = [], status = 'active' }) {
  const role = ACCOUNT_ROLES.includes(accountRole) ? accountRole : 'employee';
  const claims = {
    role,
    perms: role === 'admin' ? [] : permsToCodes(permissions),   // admin implies everything
    status
  };
  // Custom claims are capped at 1000 bytes — fail loudly rather than silently
  // truncating someone's access.
  if (JSON.stringify(claims).length > 900) {
    throw new HttpsError('invalid-argument', 'عدد الصلاحيات المحددة كبير جداً.');
  }
  return claims;
}

module.exports = {
  PERMISSION_CODES,
  CODE_TO_PERMISSION,
  ALL_PERMISSIONS,
  ACCOUNT_ROLES,
  JOB_ROLES,
  DEPARTMENTS,
  permsToCodes,
  codesToPerms,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireAdmin,
  assertCanGrant,
  buildClaims,
  has
};
