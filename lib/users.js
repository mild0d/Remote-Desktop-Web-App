// Stores registered users in a flat JSON file, consistent with how
// connections are stored. Fine for a small number of users; not designed
// for high concurrency or a large user base.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('./crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Single source of truth for the minimum password length, referenced by
// routes/auth.js (register, change-password) and routes/admin.js (admin
// password reset), so it can't drift out of sync between them. 10 rather
// than a longer number with forced complexity rules (uppercase/symbol/etc)
// - length matters more than character-class requirements, and forced
// complexity rules tend to just produce predictable patterns like
// "Password1!" rather than genuinely stronger passwords.
const MIN_PASSWORD_LENGTH = 10;

// Account-level lockout, distinct from the IP-based rate limiter on the
// login route: that one can't stop a distributed attempt (many different
// source IPs against one specific account), since it tracks per-IP, not
// per-account. This tracks failed PASSWORD attempts specifically (not
// failed 2FA codes, which are a different, already-protected surface with
// its own risk profile) and locks the account itself regardless of where
// the attempts came from.
const MAX_FAILED_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]', 'utf8');

function loadAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read users.json, treating it as empty:', err.message);
    return [];
  }
}

function saveAll(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function nextId(list) {
  return list.reduce((max, u) => Math.max(max, u.id || 0), 0) + 1;
}

function findByUsername(username) {
  const list = loadAll();
  return list.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
}

function findById(id) {
  const list = loadAll();
  return list.find((u) => u.id === id);
}

function createUser(username, password) {
  const list = loadAll();
  if (findByUsername(username)) {
    const err = new Error('That username is already taken');
    err.code = 'USERNAME_TAKEN';
    throw err;
  }
  const user = {
    id: nextId(list),
    username,
    password_hash: bcrypt.hashSync(password, 10),
    // The very first account ever created becomes admin automatically -
    // this has to happen here, not just in ensureAtLeastOneAdmin() at
    // startup, since a fresh install has zero users at startup time and
    // the first registration happens well after the server is running.
    is_admin: list.length === 0,
    created_at: new Date().toISOString(),
  };
  list.push(user);
  saveAll(list);
  return user;
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

// Precomputed once at module load. bcrypt.compareSync's cost comes mainly
// from the hash's own work factor, not which password it was originally
// set for - comparing against this dummy hash costs roughly the same as
// comparing against a real user's actual hash.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-constant-time-comparison', 10);

// Always performs a real bcrypt comparison, even when no user was found.
// Without this, a nonexistent username would skip the (deliberately slow)
// bcrypt step entirely and return measurably faster than a real username
// with a wrong password - letting an attacker determine which usernames
// exist purely by timing the response, even though both cases return the
// identical error message text.
function verifyLoginPassword(user, password) {
  if (!user) {
    bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    return false;
  }
  return bcrypt.compareSync(password, user.password_hash);
}

function changePassword(userId, newPassword) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].password_hash = bcrypt.hashSync(newPassword, 10);
  saveAll(list);
}

// Default RDP credentials, used as a fallback for any connection that
// doesn't have its own username/password set. Password is encrypted with
// the same mechanism used for per-connection passwords (lib/crypto.js),
// not the bcrypt hash used for the account login password - this needs to
// be reversible, since the app has to send the real password to guacd.
//
// Also saves two related, non-sensitive per-user preferences used when
// adding a connection: the hostname suffix auto-appended to short names
// (e.g. "example.local"), and the NetBIOS domain pre-filled into new
// connections (e.g. "example"). Neither needs encryption - they're not
// secrets, just convenience defaults.
function setDefaultCredentials(userId, username, password, hostnameSuffix, netbiosDomain) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].default_rdp_username = username || '';
  // Only overwrite the stored password if a new one was actually provided,
  // same "leave blank to keep existing" pattern used for connections.
  if (password) {
    list[idx].default_rdp_password = encrypt(password);
  }
  list[idx].default_hostname_suffix = hostnameSuffix || '';
  list[idx].default_netbios_domain = netbiosDomain || '';
  saveAll(list);
}

function getDefaultCredentials(userId) {
  const user = findById(userId);
  if (!user) return { username: '', password: '', netbios_domain: '' };
  return {
    username: user.default_rdp_username || '',
    password: user.default_rdp_password ? decrypt(user.default_rdp_password) : '',
    netbios_domain: user.default_netbios_domain || '',
  };
}

// Safe-to-expose version for the settings UI - confirms whether a default
// password is saved without ever sending the actual value back to the browser.
function getDefaultCredentialsStatus(userId) {
  const user = findById(userId);
  if (!user) return { username: '', hasPassword: false, hostname_suffix: '', netbios_domain: '' };
  return {
    username: user.default_rdp_username || '',
    hostname_suffix: user.default_hostname_suffix || '',
    netbios_domain: user.default_netbios_domain || '',
    hasPassword: Boolean(user.default_rdp_password),
  };
}

// Called once at server startup. If no user has admin rights yet (true for
// every install that existed before this feature, and briefly true for a
// fresh install's very first account), the earliest-registered user
// becomes admin automatically - guarantees there's always at least one
// admin without requiring any manual migration step.
function ensureAtLeastOneAdmin() {
  const list = loadAll();
  if (list.length === 0) return;
  if (list.some((u) => u.is_admin)) return;

  const earliest = list.reduce((a, b) => (a.id < b.id ? a : b));
  earliest.is_admin = true;
  saveAll(list);
  console.log(`No admin existed yet - granted admin rights to "${earliest.username}" (earliest registered account).`);
}

function isAdmin(userId) {
  const user = findById(userId);
  return Boolean(user && user.is_admin);
}

function countAdmins() {
  return loadAll().filter((u) => u.is_admin).length;
}

// Safe fields only - never the password hash or encrypted RDP password.
function listAllUsers() {
  return loadAll().map((u) => {
    const locked = isAccountLocked(u);
    return {
      id: u.id,
      username: u.username,
      is_admin: Boolean(u.is_admin),
      created_at: u.created_at,
      totp_enabled: Boolean(u.totp_enabled),
      locked,
      lockoutMinutesRemaining: locked ? getLockoutMinutesRemaining(u) : 0,
    };
  });
}

function setAdminStatus(userId, makeAdmin) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');

  if (!makeAdmin && list[idx].is_admin && countAdmins() <= 1) {
    const err = new Error('Cannot remove the last remaining admin');
    err.code = 'LAST_ADMIN';
    throw err;
  }

  list[idx].is_admin = makeAdmin;
  saveAll(list);
}

function adminResetPassword(userId, newPassword) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].password_hash = bcrypt.hashSync(newPassword, 10);
  saveAll(list);
}

function deleteUser(userId) {
  const list = loadAll();
  const target = list.find((u) => u.id === userId);
  if (!target) throw new Error('User not found');

  if (target.is_admin && countAdmins() <= 1) {
    const err = new Error('Cannot delete the last remaining admin');
    err.code = 'LAST_ADMIN';
    throw err;
  }

  saveAll(list.filter((u) => u.id !== userId));
}

// --- Two-factor authentication (TOTP) ---
// The secret is stored encrypted the same way RDP passwords are (reversible,
// since verifying a TOTP code requires the real secret, not a hash of it) -
// NOT with bcrypt, which is one-way and would make verification impossible.
//
// A "pending" secret is generated during setup and only promoted to the
// real, active secret once the user proves they scanned it correctly by
// submitting one valid code - this avoids someone getting locked out of
// their own account from a QR code they scanned wrong.

function isTotpEnabled(userId) {
  const user = findById(userId);
  return Boolean(user && user.totp_enabled);
}

function getTotpStatus(userId) {
  return { enabled: isTotpEnabled(userId) };
}

function setPendingTotpSecret(userId, secret) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].totp_secret_pending = encrypt(secret);
  saveAll(list);
}

function getPendingTotpSecret(userId) {
  const user = findById(userId);
  if (!user || !user.totp_secret_pending) return null;
  return decrypt(user.totp_secret_pending);
}

function getTotpSecret(userId) {
  const user = findById(userId);
  if (!user || !user.totp_secret) return null;
  return decrypt(user.totp_secret);
}

// Promotes the pending secret to active, enabling 2FA for real.
function confirmTotp(userId) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  if (!list[idx].totp_secret_pending) throw new Error('No pending 2FA setup found');
  list[idx].totp_secret = list[idx].totp_secret_pending;
  list[idx].totp_enabled = true;
  delete list[idx].totp_secret_pending;
  saveAll(list);
}

function disableTotp(userId) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  delete list[idx].totp_secret;
  delete list[idx].totp_secret_pending;
  list[idx].totp_enabled = false;
  saveAll(list);
}

// --- Account lockout ---

// Checks whether an account is currently locked. If a lockout has expired
// (locked_until is in the past), lazily clears the stale lockout fields
// right here so future checks don't keep re-deriving "well technically
// it's expired" from stale data forever.
function isAccountLocked(user) {
  if (!user || !user.locked_until) return false;
  if (new Date(user.locked_until).getTime() > Date.now()) return true;

  const list = loadAll();
  const idx = list.findIndex((u) => u.id === user.id);
  if (idx !== -1) {
    list[idx].failed_login_attempts = 0;
    delete list[idx].locked_until;
    saveAll(list);
  }
  return false;
}

// Returns how many minutes remain on an active lockout - only meaningful
// if isAccountLocked() is true; used for the "try again in N minutes" message.
function getLockoutMinutesRemaining(user) {
  if (!user || !user.locked_until) return 0;
  const msRemaining = new Date(user.locked_until).getTime() - Date.now();
  return Math.max(1, Math.ceil(msRemaining / 60000));
}

// Call after a failed password check. Returns true if this specific
// attempt is what pushed the account over the threshold into a new
// lockout (so the caller can log that as a distinct audit event).
function recordFailedLogin(username) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.username === username);
  if (idx === -1) return false; // no such account - nothing to track

  list[idx].failed_login_attempts = (list[idx].failed_login_attempts || 0) + 1;

  let justLocked = false;
  if (list[idx].failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS && !list[idx].locked_until) {
    list[idx].locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    justLocked = true;
  }

  saveAll(list);
  return justLocked;
}

// Call after a successful login - old failed attempts shouldn't linger
// and count toward some future lockout.
function recordSuccessfulLogin(userId) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  list[idx].failed_login_attempts = 0;
  delete list[idx].locked_until;
  saveAll(list);
}

// Admin action - clears a lockout immediately, regardless of how much
// time is left on it.
function adminUnlockAccount(userId) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].failed_login_attempts = 0;
  delete list[idx].locked_until;
  saveAll(list);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  loadAll,
  findByUsername,
  findById,
  createUser,
  verifyPassword,
  verifyLoginPassword,
  changePassword,
  setDefaultCredentials,
  getDefaultCredentials,
  getDefaultCredentialsStatus,
  ensureAtLeastOneAdmin,
  isAdmin,
  countAdmins,
  listAllUsers,
  setAdminStatus,
  adminResetPassword,
  deleteUser,
  isTotpEnabled,
  getTotpStatus,
  setPendingTotpSecret,
  getPendingTotpSecret,
  getTotpSecret,
  confirmTotp,
  disableTotp,
  isAccountLocked,
  getLockoutMinutesRemaining,
  recordFailedLogin,
  recordSuccessfulLogin,
  adminUnlockAccount,
};
