function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

// Assumes requireLogin already ran (req.session.userId is set). Requires
// lib/users to avoid a circular require at module load time.
//
// Gates entry to the admin router as a whole - any role with SOME
// admin-panel access (admin, helpdesk, auditor) gets in; individual
// routes inside routes/admin.js then gate themselves further with
// requirePermission below, since helpdesk/auditor can each only do part
// of what a full admin can.
function requireAdmin(req, res, next) {
  const { findById, getUserRole } = require('./users');
  const { canAccessAdminPanel } = require('./roles');
  const user = findById(req.session.userId);
  if (!user || !canAccessAdminPanel(getUserRole(user))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Gates a specific route by a specific permission - e.g. a helpdesk role
// can reach /api/admin/users/:id/reset-password (resetPasswords) but not
// /api/admin/ad-config (manageAD), even though requireAdmin above lets
// them into the router at all.
function requirePermission(permission) {
  return (req, res, next) => {
    const { userHasPermission } = require('./users');
    if (!userHasPermission(req.session.userId, permission)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { requireLogin, requireAdmin, requirePermission };
