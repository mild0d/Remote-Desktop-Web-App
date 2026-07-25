// Append-only audit log of RDP connection attempts (who connected to what,
// and when). Flat JSON file like everything else in this app, capped to
// the most recent MAX_ENTRIES so it can't grow unbounded over months/years
// of use without needing any date-based cleanup logic.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'audit-log.json');
const MAX_ENTRIES = 5000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]', 'utf8');

function loadAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read audit-log.json, treating it as empty:', err.message);
    return [];
  }
}

function saveAll(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Logs a connection attempt. Snapshots the connection's name/hostname at
// the time of connecting rather than just storing its id, so the log stays
// historically accurate even if the connection is later renamed or deleted.
function logConnectionEvent({ userId, username, connectionId, connectionName, hostname }) {
  const list = loadAll();
  list.push({
    timestamp: new Date().toISOString(),
    user_id: userId,
    username,
    connection_id: connectionId,
    connection_name: connectionName,
    hostname,
  });

  // Trim from the front (oldest first, since we always push newest to the
  // end) if we've exceeded the cap.
  const trimmed = list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
  saveAll(trimmed);
}

// Most recent first, capped to `limit`.
function getRecentEvents(limit = 500) {
  const list = loadAll();
  return list.slice(-limit).reverse();
}

module.exports = { logConnectionEvent, getRecentEvents };
