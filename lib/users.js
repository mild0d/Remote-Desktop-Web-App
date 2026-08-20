// Stores registered users in a flat JSON file, consistent with how
// connections are stored. Fine for a small number of users; not designed
// for high concurrency or a large user base.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('./crypto');
const { ROLES, hasPermission } = require('./roles');

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
function setDefaultCredentials(userId, username, password, hostnameSuffix, netbiosDomain, clearPassword) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  list[idx].default_rdp_username = username || '';
  // Same "leave blank to keep existing" pattern used for connections -
  // clearPassword is a separate, explicit signal specifically for
  // wiping it, since a blank field alone only ever preserves whatever's
  // already saved.
  if (clearPassword) {
    list[idx].default_rdp_password = '';
  } else if (password) {
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
  if (list.some((u) => getUserRole(u) === 'admin')) return;

  const earliest = list.reduce((a, b) => (a.id < b.id ? a : b));
  earliest.role = 'admin';
  earliest.is_admin = true;
  saveAll(list);
  console.log(`No admin existed yet - granted admin rights to "${earliest.username}" (earliest registered account).`);
}

// Existing records from before roles existed only ever had is_admin set,
// with no role field at all - those are correctly read as 'admin'/'user'
// based on that boolean, so nothing needs a migration step to keep
// working. New/updated records get an explicit role going forward.
function getUserRole(user) {
  if (user.role && ROLES.includes(user.role)) return user.role;
  return user.is_admin ? 'admin' : 'user';
}

function isAdmin(userId) {
  const user = findById(userId);
  return Boolean(user && getUserRole(user) === 'admin');
}

// Whether this specific user can perform a specific action, per the
// central role/permission definitions in lib/roles.js.
function userHasPermission(userId, permission) {
  const user = findById(userId);
  return Boolean(user && hasPermission(getUserRole(user), permission));
}

function countAdmins() {
  return loadAll().filter((u) => getUserRole(u) === 'admin').length;
}

// Safe fields only - never the password hash or encrypted RDP password.
function listAllUsers() {
  return loadAll().map((u) => {
    const locked = isAccountLocked(u);
    return {
      id: u.id,
      username: u.username,
      role: getUserRole(u),
      is_admin: getUserRole(u) === 'admin', // kept for any older code/UI still reading this directly
      created_at: u.created_at,
      totp_enabled: Boolean(u.totp_enabled),
      locked,
      lockoutMinutesRemaining: locked ? getLockoutMinutesRemaining(u) : 0,
    };
  });
}

// Replaces the old binary setAdminStatus(userId, makeAdmin) - handles
// admin/helpdesk/auditor/user uniformly, with the same last-admin
// protection as before, now correctly checking role rather than just
// the is_admin flag (demoting the last admin to ANY other role,
// helpdesk included, is still blocked, not just demoting to "user").
function setUserRole(userId, newRole) {
  if (!ROLES.includes(newRole)) {
    const err = new Error('Invalid role');
    err.code = 'INVALID_ROLE';
    throw err;
  }

  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');

  const currentRole = getUserRole(list[idx]);
  if (currentRole === 'admin' && newRole !== 'admin' && countAdmins() <= 1) {
    const err = new Error('Cannot remove the last remaining admin');
    err.code = 'LAST_ADMIN';
    throw err;
  }

  list[idx].role = newRole;
  list[idx].is_admin = newRole === 'admin'; // kept in sync for any older code/UI still reading this directly
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

  if (getUserRole(target) === 'admin' && countAdmins() <= 1) {
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

// Avoids visually ambiguous characters (0/O, 1/I/L) since these codes
// may need to be typed by hand if someone is genuinely locked out of
// their authenticator app.
const RECOVERY_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_CODES_COUNT = 8;

function generateSingleRecoveryCode() {
  const randomChars = (length) => {
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += RECOVERY_CODE_CHARS[bytes[i] % RECOVERY_CODE_CHARS.length];
    }
    return result;
  };
  return `${randomChars(5)}-${randomChars(5)}`;
}

// Generates a fresh batch of 8 recovery codes, REPLACING any existing
// batch entirely - there's no unbounded pile of old codes to track, and
// no old code remains valid once a new batch is generated. Returns the
// plaintext codes - the ONLY moment they're ever available anywhere;
// only bcrypt hashes of them are stored afterward, the same treatment
// given to actual passwords.
function generateRecoveryCodes(userId) {
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('User not found');

  const plaintextCodes = [];
  const storedCodes = [];
  for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
    const code = generateSingleRecoveryCode();
    plaintextCodes.push(code);
    storedCodes.push({ hash: bcrypt.hashSync(code, 10), used: false });
  }

  list[idx].recovery_codes = storedCodes;
  saveAll(list);
  return plaintextCodes;
}

// Checks a submitted code against every currently-unused stored code. If
// it matches one, marks that specific code as used (so it can never be
// used a second time) and returns true; otherwise returns false without
// modifying anything.
function verifyRecoveryCode(userId, submittedCode) {
  if (!submittedCode) return false;
  const list = loadAll();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx === -1) return false;

  const codes = list[idx].recovery_codes || [];
  const match = codes.find((c) => !c.used && bcrypt.compareSync(submittedCode, c.hash));
  if (!match) return false;

  match.used = true;
  saveAll(list);
  return true;
}

// How many codes remain, without ever exposing the codes themselves -
// used to show "5 of 8 remaining" in account settings.
function getRecoveryCodesStatus(userId) {
  const user = findById(userId);
  if (!user || !Array.isArray(user.recovery_codes)) {
    return { total: 0, remaining: 0 };
  }
  return {
    total: user.recovery_codes.length,
    remaining: user.recovery_codes.filter((c) => !c.used).length,
  };
}

// Looks up an existing account by its stored SSO subject (Entra's "oid"
// claim - a stable, permanent per-user identifier, unlike email which
// can change). Returns undefined if no account is linked to this subject
// yet.
function findBySSOSubject(subject) {
  return loadAll().find((u) => u.sso_subject === subject);
}

// First-time SSO login for this subject - creates a new local account
// automatically. This is safe specifically because access to this app's
// Entra app registration is expected to already be restricted at the
// Entra level (via "Assignment required" on the enterprise application) -
// unlike the earlier direct-AD-bind approach, whoever can complete this
// flow at all has already been vetted by the identity provider itself.
// The account gets a random, internal password that's never shown to
// anyone and never needed - this account will only ever authenticate via
// SSO - purely so it fits the existing user record shape without
// changing createUser() itself.
function createUserFromSSO({ subject, email, name }) {
  const list = loadAll();

  // Prefer the email as the username (falls back to the subject itself
  // if no email claim was provided) - if that's somehow already taken by
  // an unrelated local account, append a short random suffix rather than
  // silently taking over that existing account.
  let username = email || subject;
  if (list.some((u) => u.username === username)) {
    username = `${username}-${crypto.randomBytes(3).toString('hex')}`;
  }

  const randomInternalPassword = crypto.randomBytes(32).toString('hex');
  const user = createUser(username, randomInternalPassword);

  // createUser() already re-read and saved the list once - re-load fresh
  // rather than reusing the stale `list` from before that save.
  const freshList = loadAll();
  const freshIdx = freshList.findIndex((u) => u.id === user.id);
  freshList[freshIdx].sso_subject = subject;
  freshList[freshIdx].sso_name = name || '';
  saveAll(freshList);

  return freshList[freshIdx];
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
  setUserRole,
  getUserRole,
  userHasPermission,
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
  generateRecoveryCodes,
  verifyRecoveryCode,
  getRecoveryCodesStatus,
  findBySSOSubject,
  createUserFromSSO,
  recordSuccessfulLogin,
  adminUnlockAccount,
};
