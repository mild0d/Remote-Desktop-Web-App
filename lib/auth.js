function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

// Assumes requireLogin already ran (req.session.userId is set). Requires
// lib/users to avoid a circular require at module load time.
function requireAdmin(req, res, next) {
  const { isAdmin } = require('./users');
  if (!isAdmin(req.session.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
