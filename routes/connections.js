const express = require('express');
const fs = require('fs');
const net = require('net');
const { loadAll, saveAll, nextId } = require('../lib/store');
const { encrypt, decrypt } = require('../lib/crypto');
const { encryptGuacToken } = require('../lib/guacToken');
const { ensureUserDriveDir, userDrivePathForGuacd } = require('../lib/driveStore');
const { thumbnailPath } = require('../lib/thumbnailStore');
const { getDefaultCredentials } = require('../lib/users');
const { logConnectionEvent } = require('../lib/auditLog');

const router = express.Router();

// Quick TCP-level reachability check - just "does something answer on this
// port", not a real RDP handshake. Good enough to distinguish "server is up"
// from "server is off/unreachable" without the overhead of actually
// negotiating RDP.
function checkReachable(hostname, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, hostname);
  });
}

function stripPassword({ password, ...rest }) {
  return rest;
}

// Every route below is mounted behind requireLogin in server.js, so
// req.session.userId is always present here.

router.get('/', (req, res) => {
  const list = loadAll()
    .filter((c) => c.user_id === req.session.userId)
    .map(stripPassword)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

// Must come before GET /:id - otherwise Express would treat "reachability"
// as an :id value and never reach this handler.
router.get('/reachability', async (req, res) => {
  const list = loadAll().filter((c) => c.user_id === req.session.userId);
  const results = {};
  await Promise.all(
    list.map(async (c) => {
      results[c.id] = await checkReachable(c.hostname, c.port);
    })
  );
  res.json(results);
});

// Exports the user's connections as a downloadable JSON file. Deliberately
// excludes passwords - this is meant for sharing a server list between team
// members, who should each use their own credentials (their own default
// credentials, or their own per-connection override) rather than inherit
// someone else's password through a shared export file.
router.get('/export', (req, res) => {
  const list = loadAll().filter((c) => c.user_id === req.session.userId);
  const exported = list.map((c) => ({
    name: c.name,
    hostname: c.hostname,
    port: c.port,
    username: c.username || '',
    domain: c.domain || '',
    security: c.security || 'any',
    ignore_cert: Boolean(c.ignore_cert),
    color_depth: c.color_depth || '16',
    icon: c.icon || '🖥️',
    notes: c.notes || '',
    tags: Array.isArray(c.tags) ? c.tags : [],
  }));

  const payload = { exported_at: new Date().toISOString(), connections: exported };
  res.setHeader('Content-Disposition', 'attachment; filename="rdp-connections-export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
});

// Accepts either our own export format ({ connections: [...] }) or a bare
// array of connection-like objects. Only name/hostname are required per
// entry - anything else missing gets a sensible default, matching what the
// add-connection form itself defaults to. Any password field present in
// the uploaded file is deliberately ignored - imported connections always
// start with a blank password, which falls back to the importing user's
// own default credentials (see lib/users.js). Invalid entries are skipped
// and reported rather than failing the whole batch.
router.post('/import', (req, res) => {
  const body = req.body || {};
  const entries = Array.isArray(body) ? body : Array.isArray(body.connections) ? body.connections : null;

  if (!entries) {
    return res.status(400).json({ error: 'Expected a JSON array of connections, or { connections: [...] }' });
  }

  const list = loadAll();
  let imported = 0;
  const errors = [];

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !entry.name || !entry.hostname) {
      errors.push(`Entry ${index + 1}: missing required "name" or "hostname"`);
      return;
    }

    const conn = {
      id: nextId(list),
      user_id: req.session.userId,
      name: String(entry.name),
      hostname: String(entry.hostname),
      port: parseInt(entry.port, 10) || 3389,
      username: entry.username ? String(entry.username) : '',
      password: '', // intentionally never imported - see comment above
      domain: entry.domain ? String(entry.domain) : '',
      security: entry.security || 'any',
      ignore_cert: entry.ignore_cert === false ? 0 : 1,
      color_depth: entry.color_depth || '16',
      icon: entry.icon || '🖥️',
      notes: entry.notes ? String(entry.notes) : '',
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      created_at: new Date().toISOString(),
    };
    list.push(conn);
    imported += 1;
  });

  saveAll(list);
  res.json({ ok: true, imported, skipped: errors.length, errors });
});

router.get('/:id', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });
  res.json(stripPassword(conn));
});

router.post('/', (req, res) => {
  const { name, hostname, port, username, password, domain, security, ignore_cert, color_depth, icon, notes, tags } = req.body || {};
  if (!name || !hostname) {
    return res.status(400).json({ error: 'name and hostname are required' });
  }

  const list = loadAll();
  const conn = {
    id: nextId(list),
    user_id: req.session.userId,
    name,
    hostname,
    port: parseInt(port, 10) || 3389,
    username: username || '',
    password: password ? encrypt(password) : '',
    domain: domain || '',
    security: security || 'any',
    ignore_cert: ignore_cert === false ? 0 : 1,
    color_depth: color_depth || '16',
    icon: icon || '🖥️',
    notes: notes || '',
    tags: Array.isArray(tags) ? tags : [],
    created_at: new Date().toISOString(),
  };
  list.push(conn);
  saveAll(list);
  res.status(201).json({ id: conn.id });
});

router.put('/:id', (req, res) => {
  const list = loadAll();
  const idx = list.findIndex(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const existing = list[idx];
  const { name, hostname, port, username, password, domain, security, ignore_cert, color_depth, icon, notes, tags } = req.body || {};

  list[idx] = {
    ...existing,
    name: name ?? existing.name,
    hostname: hostname ?? existing.hostname,
    port: port ? parseInt(port, 10) : existing.port,
    username: username ?? existing.username,
    password: password ? encrypt(password) : existing.password,
    domain: domain ?? existing.domain,
    security: security ?? existing.security,
    ignore_cert: ignore_cert === undefined ? existing.ignore_cert : ignore_cert ? 1 : 0,
    color_depth: color_depth ?? existing.color_depth ?? '16',
    icon: icon ?? existing.icon ?? '🖥️',
    notes: notes ?? existing.notes ?? '',
    tags: Array.isArray(tags) ? tags : existing.tags ?? [],
  };

  saveAll(list);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const list = loadAll();
  const target = list.find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!target) return res.status(404).json({ error: 'Not found' });
  saveAll(list.filter((c) => c.id !== target.id));
  res.json({ ok: true });
});

// Generates the encrypted token guacamole-lite needs to open a session.
// The ownership check here matters: without it, a logged-in user could
// open ANY connection by guessing/incrementing ids, even ones never shown
// in their own list.
router.get('/:id/token', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });

  ensureUserDriveDir(req.session.userId);

  const settings = {
    hostname: conn.hostname,
    port: String(conn.port),
    'ignore-cert': conn.ignore_cert ? 'true' : 'false',
    security: conn.security || 'any',
    width: String(req.query.width || '1280'),
    height: String(req.query.height || '800'),
    dpi: '96',
    'resize-method': 'display-update',
    'color-depth': String(conn.color_depth || '16'),
    'enable-drive': 'true',
    'drive-path': userDrivePathForGuacd(req.session.userId),
    'create-drive-path': 'true',
    'drive-name': 'Shared Drive',
    'disable-download': 'false',
    'disable-upload': 'false',
    'enable-clipboard': 'true',
  };
  // A connection's own username/password take precedence; if either is
  // left blank, fall back to the user's centrally-saved default credentials.
  // Domain is always sourced from Settings now - there's no per-connection
  // override for it anymore.
  const defaults = getDefaultCredentials(req.session.userId);
  const effectiveUsername = conn.username || defaults.username;
  const effectivePassword = conn.password ? decrypt(conn.password) : defaults.password;

  if (effectiveUsername) settings.username = effectiveUsername;
  if (effectivePassword) settings.password = effectivePassword;
  if (defaults.netbios_domain) settings.domain = defaults.netbios_domain;

  try {
    // Extra metadata alongside `connection` - guacamole-lite only reads
    // known keys off the decrypted payload and ignores the rest, so this
    // rides along safely and becomes available via clientConnection
    // .connectionSettings in the server's 'open'/'close' event handlers,
    // letting us track active sessions without a separate lookup.
    const token = encryptGuacToken({
      connection: { type: 'rdp', settings },
      user_id: req.session.userId,
      username: req.session.username,
      connection_id: conn.id,
      connection_name: conn.name,
      hostname: conn.hostname,
    });
    logConnectionEvent({
      userId: req.session.userId,
      username: req.session.username,
      connectionId: conn.id,
      connectionName: conn.name,
      hostname: conn.hostname,
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cached "last seen" desktop screenshot, captured client-side while
// connected and uploaded here. Not a live preview - just whatever the
// screen looked like the last time this connection's tab captured one.
router.post('/:id/thumbnail', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });

  const { image } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Expected a base64 PNG data URL' });
  }

  const base64Data = image.slice('data:image/png;base64,'.length);
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(thumbnailPath(req.session.userId, conn.id), buffer);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid image data' });
  }
});

router.get('/:id/thumbnail', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).end();

  const filePath = thumbnailPath(req.session.userId, conn.id);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  res.setHeader('Cache-Control', 'no-store'); // always re-check, since a fresher screenshot may exist
  res.sendFile(filePath);
});

module.exports = router;
