/// The permission codes, mirroring `js/permissions.js`.
///
/// Claims carry short codes, not the readable names — `cv`, not
/// `clients.view` — because a token has a size limit and this list is long.
/// The map has to live on both sides, so it is written the same way in both.
///
/// These decide what gets *drawn*. Every privileged action is re-checked by
/// Security Rules or by the callable behind it, so a client that lies about
/// its claims gets a screen full of buttons that all fail.
abstract final class Perm {
  static const codes = <String, String>{
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
    'tasks.ai': 'tai',
    'knowledge.view': 'kv',
    'knowledge.manage': 'km',
    'requests.approve': 'ra',
    'chat.manage': 'cm',
    'reports.view': 'rv',
    'reports.export': 'rx',
    'finance.view': 'fv',
    'finance.manage': 'fm',
    'finance.void': 'fx',
    'finance.approve': 'fa',
    'finance.ai': 'fai',
    'finance.treasury': 'ft',
    'finance.payroll': 'fp',
    'announcements.manage': 'am',
    'settings.manage': 'sm',
  };

  /// Null for a name that does not exist, so a typo denies rather than allows.
  static String? code(String permission) => codes[permission];
}
