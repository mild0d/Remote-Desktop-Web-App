const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  findByUsername,
  findById,
  createUser,
  verifyPassword,
  verifyLoginPassword,
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
  MIN_PASSWORD_LENGTH,
  isAccountLocked,
  getLockoutMinutesRemaining,
  recordFailedLogin,
  recordSuccessfulLogin,
  LOCKOUT_DURATION_MS,
} = require('../lib/users');
const { getSettings } = require('../lib/settings');
const { generateSecret, verifyToken, generateQrCodeDataUrl } = require('../lib/totp');
const { logLoginEvent } = require('../lib/auditLog');
const { generateCsrfToken } = require('../lib/csrf');

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

// Separate instance (not the same one used for login/2FA) - registration
// abuse and login brute-forcing are different concerns, and sharing one
// counter would mean a few failed login attempts eat into someone's
// ability to register a new account, or vice versa.
const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// 2FA is mandatory: nobody reaches req.session.userId (real access) without
// having totp_enabled. There are two ways into the setup flow that need to
// share the same /2fa/setup and /2fa/confirm endpoints:
//   1. A brand new account, immediately after /register.
//   2. An existing account (created before this policy, or reset by an
//      admin for recovery) that tries to log in and doesn't have 2FA yet.
// Both cases set req.session.pendingSetupUserId rather than userId - this
// grants zero access to anything else, same principle as pending2FAUserId.
function getSetupUserId(req) {
  return (req.session && (req.session.pendingSetupUserId || req.session.userId)) || null;
}

// Reachable without a session - even a brand new, anonymous visitor needs
// a token before their very first login/register attempt. Explicitly
// marks the session as touched before generating the token: with
// saveUninitialized:false, a session that's never actually modified never
// gets its cookie sent to the client, which would mean the session ID
// this token is bound to could never be recognized by the browser's next
// request. Confirmed this exact failure mode via direct testing before
// settling on this fix.
router.get('/csrf-token', (req, res) => {
  req.session.csrfTokenIssued = true;
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
});

router.post('/register', registerRateLimiter, (req, res) => {
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
    // A fresh session ID is issued here, before the session gains any
    // privilege at all (even the limited pendingSetupUserId capability) -
    // standard defense against session fixation, since regenerate()
    // guarantees an attacker couldn't have pre-set/known this session ID
    // in advance.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Failed to create session' });
      // No real session yet - 2FA setup is mandatory before this account
      // can do anything else. The frontend follows this up immediately
      // with a call to /2fa/setup to get the QR code.
      req.session.pendingSetupUserId = user.id;
      logLoginEvent({ username: user.username, success: true, reason: 'Account created - 2FA setup required', ip: req.ip });
      res.status(201).json({ requiresSetup2FA: true, username: user.username });
    });
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

  // Checked before even looking at the password - an account-level lock
  // stops a distributed attempt (many different source IPs against one
  // specific account) that the IP-based rate limiter above can't catch,
  // since that one only tracks per-IP, not per-account.
  if (user && isAccountLocked(user)) {
    const minutes = getLockoutMinutesRemaining(user);
    logLoginEvent({ username: user.username, success: false, reason: 'Blocked - account is locked', ip: req.ip });
    return res.status(423).json({
      error: `This account is temporarily locked due to too many failed attempts. Try again in ${minutes} minute(s), or contact an admin.`,
    });
  }

  if (!verifyLoginPassword(user, password)) {
    // Logs the username as typed, even if it doesn't correspond to a real
    // account - useful for spotting brute-force/enumeration attempts.
    if (user) {
      const justLocked = recordFailedLogin(user.username);
      if (justLocked) {
        logLoginEvent({ username: user.username, success: false, reason: 'Account locked - too many failed attempts', ip: req.ip });
        return res.status(423).json({
          error: `Too many failed attempts. This account is now locked for ${Math.ceil(LOCKOUT_DURATION_MS / 60000)} minutes, or until an admin unlocks it.`,
        });
      }
    }
    logLoginEvent({ username, success: false, reason: 'Invalid username or password', ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Password was correct - clear any accumulated failed-attempt count so
  // old typos don't linger toward some future lockout.
  recordSuccessfulLogin(user.id);

  // Fresh session ID before granting any privilege at all - same
  // fixation-defense principle as /register.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Failed to create session' });

    if (isTotpEnabled(user.id)) {
      // Password correct, 2FA already set up - proceed to the code-entry step.
      req.session.pending2FAUserId = user.id;
      return res.json({ requires2FA: true });
    }

    // Password correct, but this account doesn't have 2FA yet (pre-existing
    // account from before this policy, or reset by an admin for recovery).
    // Mandatory setup, same as a fresh registration - no real access until
    // it's completed.
    req.session.pendingSetupUserId = user.id;
    logLoginEvent({ username: user.username, success: false, reason: 'Password correct - 2FA setup required before access', ip: req.ip });
    res.json({ requiresSetup2FA: true, username: user.username });
  });
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

  // Fresh session ID before granting real access - regenerate() creates an
  // entirely new session, so the old pending2FAUserId is naturally gone
  // without needing an explicit delete.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Failed to create session' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });
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

// --- Two-factor authentication (mandatory) ---

router.get('/2fa/status', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(getTotpStatus(req.session.userId));
});

// Generates a new secret and returns a QR code to scan. Works both for the
// mandatory setup flow (pendingSetupUserId, not yet fully logged in) and,
// defensively, an already-logged-in session - though under a mandatory
// policy the latter shouldn't normally happen, since reaching userId
// already implies totp_enabled is true.
router.post('/2fa/setup', async (req, res) => {
  const userId = getSetupUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = findById(userId);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const secret = generateSecret();
  setPendingTotpSecret(userId, secret);

  try {
    const qrCodeDataUrl = await generateQrCodeDataUrl(user.username, secret);
    res.json({ secret, qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

router.post('/2fa/confirm', (req, res) => {
  const userId = getSetupUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { code } = req.body || {};
  const pendingSecret = getPendingTotpSecret(userId);
  const user = findById(userId);

  if (!pendingSecret || !user) {
    return res.status(400).json({ error: 'No pending 2FA setup - click "Enable 2FA" first' });
  }
  if (!verifyToken(pendingSecret, code)) {
    return res.status(400).json({ error: 'Incorrect code - check your authenticator app and try again' });
  }

  confirmTotp(userId);

  // If this completed the mandatory pre-login setup flow, promote the
  // session to real access now that 2FA is genuinely confirmed. Captured
  // before regenerate() below, since that creates an entirely fresh
  // session and would wipe this flag before we got a chance to check it.
  const wasPendingSetup = Boolean(req.session.pendingSetupUserId);

  if (wasPendingSetup) {
    // Fresh session ID before granting real access - same fixation-defense
    // principle used at every other privilege-transition point in this file.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Failed to create session' });
      req.session.userId = user.id;
      req.session.username = user.username;
      logLoginEvent({ username: user.username, success: true, reason: 'Login successful (2FA setup completed)', ip: req.ip });
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

module.exports = router;
