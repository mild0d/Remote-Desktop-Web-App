// Checks every connection's reachability on a fixed schedule, independent
// of whether anyone has the app open - this is what makes the resulting
// uptime trend trustworthy. A check that only ran while someone was
// actively looking at the page could show a misleadingly clean history
// for an outage that happened, and fully recovered, while nobody was
// watching.

const fs = require('fs');
const path = require('path');
const { checkReachable } = require('./reachabilityCheck');
const { loadAll } = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'reachability-history.json');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES_PER_CONNECTION = 500; // ~41 hours of history at the interval above

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read reachability-history.json:', err.message);
    return {};
  }
}

function saveHistory(history) {
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(history), 'utf8');
  fs.renameSync(tmp, HISTORY_FILE);
}

// Returns { entries, uptimePercent } for a specific connection, or an
// empty result if nothing has been recorded for it yet.
function getHistoryForConnection(connectionId) {
  const history = loadHistory();
  const entries = history[connectionId] || [];
  if (entries.length === 0) return { entries: [], uptimePercent: null };

  const reachableCount = entries.filter((e) => e.reachable).length;
  const uptimePercent = Math.round((reachableCount / entries.length) * 100);
  return { entries, uptimePercent };
}

async function checkAllConnections() {
  const connections = loadAll();
  const history = loadHistory();

  await Promise.all(
    connections.map(async (conn) => {
      const { reachable, latencyMs } = await checkReachable(conn.hostname, conn.port);
      const entry = { timestamp: new Date().toISOString(), reachable, latencyMs };

      const existing = history[conn.id] || [];
      existing.push(entry);
      // Rolling cap - drop the oldest once past the retention limit.
      history[conn.id] = existing.slice(-MAX_ENTRIES_PER_CONNECTION);
    })
  );

  // Also prune history for any connection that no longer exists (deleted
  // since the last check), so this file doesn't grow forever with
  // orphaned entries.
  const liveIds = new Set(connections.map((c) => String(c.id)));
  Object.keys(history).forEach((id) => {
    if (!liveIds.has(String(id))) delete history[id];
  });

  saveHistory(history);
}

let schedulerInterval = null;

function startScheduler() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    checkAllConnections().catch((err) => console.error('Reachability history check failed:', err));
  }, CHECK_INTERVAL_MS);
  // Also run once shortly after startup, rather than waiting a full
  // interval for the first data point.
  setTimeout(() => {
    checkAllConnections().catch((err) => console.error('Reachability history check failed:', err));
  }, 5000);
}

module.exports = {
  getHistoryForConnection,
  checkAllConnections,
  startScheduler,
  CHECK_INTERVAL_MS,
};
