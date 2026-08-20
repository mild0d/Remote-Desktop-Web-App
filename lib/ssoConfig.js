// Admin-configured SSO (Microsoft Entra ID) settings, shared across the
// whole deployment - one admin sets this up once. Same storage pattern
// as lib/adConfig.js: the client secret is encrypted at rest, and only
// ever decrypted server-side to actually talk to Entra.

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'sso-config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadRaw() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read sso-config.json:', err.message);
    return null;
  }
}

function saveRaw(config) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Full config including the decrypted client secret - only ever used
// server-side to actually talk to Entra, never sent to any client.
function getConfig() {
  const raw = loadRaw();
  if (!raw) return null;
  return {
    tenantId: raw.tenantId,
    clientId: raw.clientId,
    clientSecret: raw.clientSecret ? decrypt(raw.clientSecret) : '',
    enabled: Boolean(raw.enabled),
  };
}

// Safe-to-expose version for the admin settings UI - confirms a client
// secret is saved without ever sending the actual value back to the browser.
function getConfigStatus() {
  const raw = loadRaw();
  if (!raw) {
    return { configured: false, tenantId: '', clientId: '', hasClientSecret: false, enabled: false };
  }
  return {
    configured: true,
    tenantId: raw.tenantId || '',
    clientId: raw.clientId || '',
    hasClientSecret: Boolean(raw.clientSecret),
    enabled: Boolean(raw.enabled),
  };
}

function setConfig({ tenantId, clientId, clientSecret, enabled }) {
  const existing = loadRaw() || {};
  const updated = {
    tenantId,
    clientId,
    // Same "leave blank to keep existing" pattern used everywhere else in
    // this app for secrets - only overwrite if a new one was provided.
    clientSecret: clientSecret ? encrypt(clientSecret) : existing.clientSecret || '',
    enabled: Boolean(enabled),
  };
  saveRaw(updated);
}

module.exports = { getConfig, getConfigStatus, setConfig };
