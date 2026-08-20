// Central definition of RBAC roles and what each one can actually do.
// Kept as one file specifically so "what can a Helpdesk do" has a single,
// readable answer rather than being scattered across every route file.

const ROLES = ['admin', 'helpdesk', 'auditor', 'user'];

// user gets an explicit all-false entry rather than being treated as "any
// unlisted role" - this way a typo'd/unknown role value fails safe.
const PERMISSIONS = {
  admin: {
    manageUsers: true, // toggle admin/helpdesk/auditor role, delete accounts
    resetPasswords: true,
    unlockAccounts: true,
    disable2FA: true,
    viewAuditLog: true,
    viewActiveSessions: true,
    forceDisconnect: true,
    manageAD: true,
    manageSSO: true,
    manageBackups: true,
    toggleRegistration: true,
  },
  helpdesk: {
    manageUsers: false,
    resetPasswords: true,
    unlockAccounts: true,
    disable2FA: false,
    viewAuditLog: false,
    viewActiveSessions: true,
    forceDisconnect: true,
    manageAD: false,
    manageSSO: false,
    manageBackups: false,
    toggleRegistration: false,
  },
  auditor: {
    manageUsers: false,
    resetPasswords: false,
    unlockAccounts: false,
    disable2FA: false,
    viewAuditLog: true,
    viewActiveSessions: true,
    forceDisconnect: false,
    manageAD: false,
    manageSSO: false,
    manageBackups: false,
    toggleRegistration: false,
  },
  user: {
    manageUsers: false,
    resetPasswords: false,
    unlockAccounts: false,
    disable2FA: false,
    viewAuditLog: false,
    viewActiveSessions: false,
    forceDisconnect: false,
    manageAD: false,
    manageSSO: false,
    manageBackups: false,
    toggleRegistration: false,
  },
};

function hasPermission(role, permission) {
  return Boolean(PERMISSIONS[role] && PERMISSIONS[role][permission]);
}

// Any role other than plain "user" gets into the admin panel in some
// capacity - individual actions inside it are then gated by the specific
// permission checks above.
function canAccessAdminPanel(role) {
  return role !== 'user' && ROLES.includes(role);
}

module.exports = { ROLES, PERMISSIONS, hasPermission, canAccessAdminPanel };
