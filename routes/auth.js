const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  findByUsername,
  findById,
  createUser,
  verifyPassword,
  changePassword,
  setDefaultCredentials,
  getDefaultCredentialsStatus,
  isAdmin,
  isTotpEnabled,
  getTotpStatus,
  setPendingTotpSecret,
  getPendingTotpSecret,
  getTotpSecret,
  confirmTotp,
  disableTotp,
  MIN_PASSWORD_LENGTH,
} = require('../lib/users');
const { getSettings } = require('../lib/settings');
const { generateSecret, verifyToken, generateQrCodeDataUrl } = require('../lib/totp');
const { logLoginEvent } = require('../lib/auditLog');

const router = express.Router();

// Applies to both the password step and the 2FA code step - a 6-digit TOTP
// code only has a million possibilities, so without this, "2FA" would be
// brute-forceable in a short amount of time. Combined with each code only
// being valid for ~30-90 seconds, this makes brute-forcing genuinely
// impractical rather than just inconvenient.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

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
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const user = createUser(username.trim(), password);
    req.session.userId = user.id;
    req.session.username = user.username;
    logLoginEvent({ username: user.username, success: true, reason: 'Account created', ip: req.ip });
    res.status(201).json({ ok: true, username: user.username });
  } catch (err) {
    if (err.code === 'USERNAME_TAKEN') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', authRateLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    // Logs the username as typed, even if it doesn't correspond to a real
    // account - useful for spotting brute-force/enumeration attempts.
    logLoginEvent({ username, success: false, reason: 'Invalid username or password', ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (isTotpEnabled(user.id)) {
    // Password was correct, but don't establish a real session yet - only
    // a marker saying "this user passed step one," which by itself grants
    // no access (requireLogin checks session.userId, which stays unset).
    // The real success/failure outcome gets logged at /verify-2fa instead,
    // once we actually know whether they completed the second factor.
    req.session.pending2FAUserId = user.id;
    return res.json({ requires2FA: true });
  }

  logLoginEvent({ username: user.username, success: true, reason: 'Login successful', ip: req.ip });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

router.post('/verify-2fa', authRateLimiter, (req, res) => {
  const pendingUserId = req.session.pending2FAUserId;
  if (!pendingUserId) {
    return res.status(401).json({ error: 'No pending login to verify' });
  }

  const { code } = req.body || {};
  const secret = getTotpSecret(pendingUserId);
  const user = findById(pendingUserId);

  if (!user || !secret || !verifyToken(secret, code)) {
    logLoginEvent({
      username: user ? user.username : `user #${pendingUserId}`,
      success: false,
      reason: 'Invalid 2FA code',
      ip: req.ip,
    });
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  logLoginEvent({ username: user.username, success: true, reason: 'Login successful (2FA)', ip: req.ip });
  delete req.session.pending2FAUserId;
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// /api/auth isn't mounted behind requireLogin (login/register/me must work
// without a session), so these routes check for one themselves.
router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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

// --- Two-factor authentication setup/management ---

router.get('/2fa/status', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(getTotpStatus(req.session.userId));
});

// Generates a new secret and returns a QR code to scan, but doesn't enable
// 2FA yet - that only happens once /2fa/confirm proves the user actually
// scanned it correctly, avoiding a self-lockout from a botched scan.
router.post('/2fa/setup', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const secret = generateSecret();
  setPendingTotpSecret(req.session.userId, secret);

  try {
    const qrCodeDataUrl = await generateQrCodeDataUrl(req.session.username, secret);
    res.json({ secret, qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

router.post('/2fa/confirm', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { code } = req.body || {};
  const pendingSecret = getPendingTotpSecret(req.session.userId);

  if (!pendingSecret) {
    return res.status(400).json({ error: 'No pending 2FA setup - click "Enable 2FA" first' });
  }
  if (!verifyToken(pendingSecret, code)) {
    return res.status(400).json({ error: 'Incorrect code - check your authenticator app and try again' });
  }

  confirmTotp(req.session.userId);
  res.json({ ok: true });
});

router.post('/2fa/disable', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { password } = req.body || {};
  const user = findById(req.session.userId);
  if (!user || !verifyPassword(user, password || '')) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  disableTotp(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
