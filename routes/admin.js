const express = require('express');
const {
  listAllUsers,
  setAdminStatus,
  adminResetPassword,
  deleteUser,
  findById,
  disableTotp,
  MIN_PASSWORD_LENGTH,
} = require('../lib/users');
const { getSettings, updateSettings } = require('../lib/settings');
const { getRecentEvents } = require('../lib/auditLog');
const { listActive, forceDisconnect } = require('../lib/activeSessions');
const { getConfig: getADConfig, getConfigStatus: getADConfigStatus, setConfig: setADConfig } = require('../lib/adConfig');
const { testConnection: testADConnection } = require('../lib/adBrowser');
const { deleteAllForUser: deleteConnectionsForUser } = require('../lib/store');
const { deleteAllForUser: deleteThumbnailsForUser } = require('../lib/thumbnailStore');
const { deleteAllForUser: deleteDriveForUser } = require('../lib/driveStore');

const router = express.Router();

// Every route here is mounted behind requireLogin + requireAdmin in
// server.js, so req.session.userId is always present and always an admin.

router.get('/users', (req, res) => {
  res.json(listAllUsers());
});

router.post('/users/:id/toggle-admin', (req, res) => {
  const userId = Number(req.params.id);
  const user = findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    setAdminStatus(userId, !user.is_admin);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'LAST_ADMIN') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to update admin status' });
  }
});

router.post('/users/:id/reset-password', (req, res) => {
  const userId = Number(req.params.id);
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const user = findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  adminResetPassword(userId, newPassword);
  res.json({ ok: true });
});

// Recovery path for someone who's lost their authenticator device - lets
// an admin turn 2FA back off for them so they can log in and re-enable it
// with a new device.
router.post('/users/:id/disable-2fa', (req, res) => {
  const userId = Number(req.params.id);
  const user = findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  disableTotp(userId);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const userId = Number(req.params.id);

  // Simple safety rail: don't let an admin delete their own account from
  // this panel, to avoid an accidental self-lockout click. If they really
  // want their account gone, another admin can remove it instead.
  if (userId === req.session.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account from here' });
  }

  const user = findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    deleteUser(userId);
  } catch (err) {
    if (err.code === 'LAST_ADMIN') {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to delete user' });
  }

  // Best-effort cleanup of the deleted user's data. Failures here don't
  // block the account deletion itself from having already succeeded.
  try { deleteConnectionsForUser(userId); } catch (err) { console.warn('Cleanup failed (connections):', err.message); }
  try { deleteThumbnailsForUser(userId); } catch (err) { console.warn('Cleanup failed (thumbnails):', err.message); }
  try { deleteDriveForUser(userId); } catch (err) { console.warn('Cleanup failed (drive data):', err.message); }

  res.json({ ok: true });
});

router.get('/settings', (req, res) => {
  res.json(getSettings());
});

router.post('/settings', (req, res) => {
  const { registration_enabled } = req.body || {};
  const updated = updateSettings({ registration_enabled: Boolean(registration_enabled) });
  res.json(updated);
});

router.get('/audit-log', (req, res) => {
  res.json(getRecentEvents());
});

router.get('/active-sessions', (req, res) => {
  res.json(listActive());
});

router.post('/active-sessions/:sessionId/disconnect', (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const found = forceDisconnect(sessionId);
  if (!found) return res.status(404).json({ error: 'Session not found (it may have already ended)' });
  res.json({ ok: true });
});

router.get('/ad-config', (req, res) => {
  res.json(getADConfigStatus());
});

router.post('/ad-config', (req, res) => {
  const { url, bindDN, bindPassword, baseDN } = req.body || {};
  if (!url || !bindDN || !baseDN) {
    return res.status(400).json({ error: 'Server URL, bind DN, and base DN are all required' });
  }
  setADConfig({ url, bindDN, bindPassword, baseDN });
  res.json({ ok: true });
});

router.post('/ad-config/test', async (req, res) => {
  const config = getADConfig();
  if (!config) return res.status(400).json({ error: 'Active Directory is not configured yet' });

  try {
    await testADConnection(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Connection failed: ${err.message}` });
  }
});

module.exports = router;
