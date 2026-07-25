// In-memory registry of currently-open RDP sessions (one entry per live
// guacamole-lite WebSocket connection), used for the admin "active
// sessions" view and force-disconnect. Deliberately NOT persisted to disk -
// this is live state that only means anything while the server process is
// actually running; a restart naturally clears it, and any genuinely still-
// open sessions get re-registered as guacamole-lite reports them.

const sessions = new Map(); // guacd-lite connectionId -> session info

function register(sessionId, info) {
  sessions.set(sessionId, { ...info, session_id: sessionId });
}

function unregister(sessionId) {
  sessions.delete(sessionId);
}

// Never exposes the raw clientConnection reference to callers outside this
// module - only the plain metadata needed for display.
function listActive() {
  return Array.from(sessions.values()).map(({ clientConnection, ...rest }) => rest);
}

function forceDisconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.clientConnection.close();
  } catch (err) {
    console.warn(`Failed to force-close session ${sessionId}:`, err.message);
  }
  return true;
}

module.exports = { register, unregister, listActive, forceDisconnect };
