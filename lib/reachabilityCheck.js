// A plain TCP connection attempt - not a real RDP handshake, so this only
// tells you whether *something* is listening on that port, not whether
// RDP itself would actually succeed. Shared between the on-demand
// reachability endpoint and the background history poller so both use
// identical logic.

const net = require('net');

function checkReachable(hostname, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const startedAt = Date.now();

    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({ reachable, latencyMs: reachable ? latencyMs : null });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, hostname);
  });
}

module.exports = { checkReachable };
