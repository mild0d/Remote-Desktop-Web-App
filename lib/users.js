// Stores registered users in a flat JSON file, consistent with how
// connections are stored. Fine for a small number of users; not designed
// for high concurrency or a large user base.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('./crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
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
  return loadAll().map(({ id, username, is_admin, created_at }) => ({
    id,
    username,
    is_admin: Boolean(is_admin),
    created_at,
  }));
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

module.exports = {
  loadAll,
  findByUsername,
  findById,
  createUser,
  verifyPassword,
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
};
