// Stores connections in a single flat JSON file instead of a database.
// Good enough for a personal/single-user tool with a modest number of
// saved connections; not designed for concurrent multi-writer use.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'connections.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]', 'utf8');

function loadAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read connections.json, treating it as empty:', err.message);
    return [];
  }
}

function saveAll(list) {
  // Write to a temp file then rename over the real one, so a crash or
  // power loss mid-write can't leave connections.json half-written/corrupt.
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function nextId(list) {
  return list.reduce((max, c) => Math.max(max, c.id || 0), 0) + 1;
}

function deleteAllForUser(userId) {
  const list = loadAll();
  saveAll(list.filter((c) => c.user_id !== userId));
}

module.exports = { loadAll, saveAll, nextId, deleteAllForUser };
