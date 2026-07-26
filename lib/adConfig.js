// Admin-configured Active Directory connection settings, shared across the
// whole deployment (unlike per-user default credentials) - it's the same
// directory server for every user, so one admin sets this up once.

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'ad-config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadRaw() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read ad-config.json:', err.message);
    return null;
  }
}

function saveRaw(config) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Full config including the decrypted bind password - only ever used
// server-side to actually connect, never sent to any client.
function getConfig() {
  const raw = loadRaw();
  if (!raw) return null;
  return {
    url: raw.url,
    bindDN: raw.bindDN,
    bindPassword: raw.bindPassword ? decrypt(raw.bindPassword) : '',
    baseDN: raw.baseDN,
  };
}

// Safe-to-expose version for the admin settings UI - confirms a bind
// password is saved without ever sending the actual value back to the browser.
function getConfigStatus() {
  const raw = loadRaw();
  if (!raw) return { configured: false, url: '', bindDN: '', baseDN: '', hasPassword: false };
  return {
    configured: true,
    url: raw.url || '',
    bindDN: raw.bindDN || '',
    baseDN: raw.baseDN || '',
    hasPassword: Boolean(raw.bindPassword),
  };
}

function setConfig({ url, bindDN, bindPassword, baseDN }) {
  const existing = loadRaw() || {};
  const updated = {
    url,
    bindDN,
    baseDN,
    // Same "leave blank to keep existing" pattern used everywhere else in
    // this app for passwords - only overwrite if a new one was provided.
    bindPassword: bindPassword ? encrypt(bindPassword) : existing.bindPassword || '',
  };
  saveRaw(updated);
}

module.exports = { getConfig, getConfigStatus, setConfig };
