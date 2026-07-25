const express = require('express');
const {
  findByUsername,
  findById,
  createUser,
  verifyPassword,
  changePassword,
  setDefaultCredentials,
  getDefaultCredentialsStatus,
  isAdmin,
} = require('../lib/users');
const { getSettings } = require('../lib/settings');

const router = express.Router();

router.post('/register', (req, res) => {
  if (!getSettings().registration_enabled) {
    return res.status(403).json({ error: 'New registrations are currently disabled' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const user = createUser(username.trim(), password);
    req.session.userId = user.id;
    req.session.username = user.username;
    res.status(201).json({ ok: true, username: user.username });
  } catch (err) {
    if (err.code === 'USERNAME_TAKEN') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// /api/auth isn't mounted behind requireLogin (login/register/me must work
// without a session), so this route checks for one itself.
router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = findById(req.session.userId);
  if (!user || !verifyPassword(user, currentPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  changePassword(user.id, newPassword);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({
      authenticated: true,
      id: req.session.userId,
      username: req.session.username,
      is_admin: isAdmin(req.session.userId),
    });
  }
  res.json({ authenticated: false });
});

// Returns whether default credentials are set and the saved username, but
// never the actual password - same principle as never sending a
// connection's stored password back to the browser.
router.get('/default-credentials', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(getDefaultCredentialsStatus(req.session.userId));
});

router.post('/default-credentials', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { username, password, hostname_suffix, netbios_domain } = req.body || {};
  try {
    setDefaultCredentials(req.session.userId, username, password, hostname_suffix, netbios_domain);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save default credentials' });
  }
});

module.exports = router;
