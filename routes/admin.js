const express = require('express');
const {
  listAllUsers,
  setAdminStatus,
  adminResetPassword,
  deleteUser,
  findById,
  disableTotp,
  adminUnlockAccount,
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
const backup = require('../lib/backup');

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

// Immediately clears an account lockout, rather than making someone wait
// out the full auto-unlock window.
router.post('/users/:id/unlock', (req, res) => {
  const userId = Number(req.params.id);
  const user = findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  adminUnlockAccount(userId);
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
  const { url, bindDN, bindPassword, baseDN, caCert, skipCertValidation } = req.body || {};
  if (!url || !bindDN || !baseDN) {
    return res.status(400).json({ error: 'Server URL, bind DN, and base DN are all required' });
  }
  setADConfig({ url, bindDN, bindPassword, baseDN, caCert, skipCertValidation });
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

router.get('/backup-settings', (req, res) => {
  res.json({
    settings: backup.getSettings(),
    backups: backup.listBackups(),
  });
});

router.post('/backup-settings', (req, res) => {
  const { enabled, interval_hours, retention_count } = req.body || {};

  if (interval_hours !== undefined && (!Number.isFinite(interval_hours) || interval_hours < 1)) {
    return res.status(400).json({ error: 'Interval must be at least 1 hour' });
  }
  if (retention_count !== undefined && (!Number.isFinite(retention_count) || retention_count < 1)) {
    return res.status(400).json({ error: 'Retention count must be at least 1' });
  }

  const updated = backup.setSettings({
    enabled: Boolean(enabled),
    ...(interval_hours !== undefined ? { interval_hours } : {}),
    ...(retention_count !== undefined ? { retention_count } : {}),
  });
  res.json({ ok: true, settings: updated });
});

router.post('/backup/create', async (req, res) => {
  try {
    const result = await backup.createBackup();
    const settings = backup.getSettings();
    backup.setSettings({ last_backup_at: new Date().toISOString() });
    const pruned = backup.pruneOldBackups(settings.retention_count);
    res.json({ ok: true, filename: result.filename, size: result.size, pruned });
  } catch (err) {
    console.error('Manual backup failed:', err);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

router.get('/backup/:filename/download', (req, res) => {
  const fullPath = backup.getBackupPath(req.params.filename);
  if (!fullPath) return res.status(404).json({ error: 'Backup not found' });
  res.download(fullPath, req.params.filename);
});

router.delete('/backup/:filename', (req, res) => {
  try {
    backup.deleteBackup(req.params.filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

module.exports = router;
