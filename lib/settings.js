// Simple global (not per-user) app settings, currently just whether new
// self-registration is allowed. Stored the same flat-JSON way as
// everything else in this app.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = { registration_enabled: true };

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), 'utf8');

function getSettings() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw || '{}') };
  } catch (err) {
    console.error('Failed to read settings.json, using defaults:', err.message);
    return { ...DEFAULTS };
  }
}

function updateSettings(partial) {
  const current = getSettings();
  const updated = { ...current, ...partial };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  return updated;
}

module.exports = { getSettings, updateSettings };
