const express = require('express');
const fs = require('fs');
const { loadAll, saveAll, nextId } = require('../lib/store');
const { encrypt, decrypt } = require('../lib/crypto');
const { encryptGuacToken } = require('../lib/guacToken');
const { ensureUserDriveDir, userDrivePathForGuacd } = require('../lib/driveStore');
const { thumbnailPath } = require('../lib/thumbnailStore');
const { getDefaultCredentials, listAllUsers, findById: findUserById } = require('../lib/users');
const { logConnectionEvent } = require('../lib/auditLog');
const { checkReachable } = require('../lib/reachabilityCheck');
const { getHistoryForConnection } = require('../lib/reachabilityHistory');

const router = express.Router();

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
  const checkedAt = new Date().toISOString();
  await Promise.all(
    list.map(async (c) => {
      const { reachable, latencyMs } = await checkReachable(c.hostname, c.port);
      results[c.id] = { reachable, latencyMs, checkedAt };
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

// Any logged-in user can see who else is on the system, for the purpose of
// picking a recipient to share a connection with - this is a peer-to-peer
// action between regular teammates, not an admin capability, so it's
// deliberately not behind requireAdmin the way the admin user list is.
router.get('/share-targets', (req, res) => {
  const targets = listAllUsers()
    .filter((u) => u.id !== req.session.userId)
    .map(({ id, username }) => ({ id, username }));
  res.json(targets);
});

// Every bulk endpoint below individually ownership-checks each id against
// the current user, rather than trusting the list wholesale - the ids come
// from the user's own already-filtered UI, but a tampered request
// shouldn't be able to affect another user's connections just by
// including their ids in the array.

router.post('/bulk-delete', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'Expected an array of ids' });
  }

  const list = loadAll();
  const idSet = new Set(ids.map(Number));
  let deleted = 0;

  const kept = list.filter((c) => {
    const isTargeted = idSet.has(c.id) && c.user_id === req.session.userId;
    if (isTargeted) deleted += 1;
    return !isTargeted;
  });

  saveAll(kept);
  res.json({ ok: true, deleted });
});

router.post('/bulk-tag', (req, res) => {
  const { ids, tags } = req.body || {};
  if (!Array.isArray(ids) || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Expected an array of ids and a non-empty array of tags' });
  }

  const list = loadAll();
  const idSet = new Set(ids.map(Number));
  let tagged = 0;

  list.forEach((c) => {
    if (idSet.has(c.id) && c.user_id === req.session.userId) {
      const existing = new Set(Array.isArray(c.tags) ? c.tags : []);
      tags.forEach((t) => existing.add(String(t)));
      c.tags = Array.from(existing);
      tagged += 1;
    }
  });

  saveAll(list);
  res.json({ ok: true, tagged });
});

router.post('/bulk-share', (req, res) => {
  const { ids, targetUserId } = req.body || {};
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'Expected an array of ids' });
  }

  const targetUser = findUserById(Number(targetUserId));
  if (!targetUser) return res.status(400).json({ error: 'That user was not found' });
  if (targetUser.id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot share a connection with yourself' });
  }

  const list = loadAll();
  const idSet = new Set(ids.map(Number));
  const ownedConnections = list.filter((c) => idSet.has(c.id) && c.user_id === req.session.userId);

  ownedConnections.forEach((conn) => {
    list.push({
      id: nextId(list),
      user_id: targetUser.id,
      name: conn.name,
      hostname: conn.hostname,
      port: conn.port,
      // Intentionally always blank, regardless of what the original
      // connection had set - the recipient should fall back entirely to
      // their own default credentials (Settings), not partially inherit
      // the sharer's username/domain while only password gets excluded.
      username: '',
      password: '',
      domain: '',
      security: conn.security || 'any',
      ignore_cert: conn.ignore_cert,
      color_depth: conn.color_depth || '16',
      icon: conn.icon || '🖥️',
      notes: conn.notes || '',
      tags: Array.isArray(conn.tags) ? conn.tags : [],
      created_at: new Date().toISOString(),
    });
  });

  saveAll(list);
  res.json({ ok: true, shared: ownedConnections.length, sharedWith: targetUser.username });
});

router.get('/:id', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });
  res.json(stripPassword(conn));
});

router.get('/:id/reachability-history', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });

  const { entries, uptimePercent } = getHistoryForConnection(conn.id);
  res.json({ entries, uptimePercent });
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

// Shares a copy of this connection into another user's list. Deliberately
// excludes the password, same principle as export/import - the recipient
// should use their own credentials (their own default credentials, or
// their own per-connection override), not inherit whoever shared it with
// them. The ownership check matters here too: without it, any logged-in
// user could share (i.e. read the structural details of) a connection
// they don't actually own, just by guessing/incrementing ids.
router.post('/:id/share', (req, res) => {
  const conn = loadAll().find(
    (c) => c.id === Number(req.params.id) && c.user_id === req.session.userId
  );
  if (!conn) return res.status(404).json({ error: 'Not found' });

  const { targetUserId } = req.body || {};
  const targetUser = findUserById(Number(targetUserId));
  if (!targetUser) return res.status(400).json({ error: 'That user was not found' });
  if (targetUser.id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot share a connection with yourself' });
  }

  const list = loadAll();
  const copy = {
    id: nextId(list),
    user_id: targetUser.id,
    name: conn.name,
    hostname: conn.hostname,
    port: conn.port,
    // Intentionally always blank, regardless of what the original
    // connection had set - the recipient should fall back entirely to
    // their own default credentials (Settings), not partially inherit
    // the sharer's username/domain while only password gets excluded.
    username: '',
    password: '',
    domain: '',
    security: conn.security || 'any',
    ignore_cert: conn.ignore_cert,
    color_depth: conn.color_depth || '16',
    icon: conn.icon || '🖥️',
    notes: conn.notes || '',
    tags: Array.isArray(conn.tags) ? conn.tags : [],
    created_at: new Date().toISOString(),
  };
  list.push(copy);
  saveAll(list);
  res.json({ ok: true, sharedWith: targetUser.username });
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

  try {
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
    // A connection's own username/password/domain take precedence; if any
    // are left blank, fall back to the user's centrally-saved defaults.
    const defaults = getDefaultCredentials(req.session.userId);
    const effectiveUsername = conn.username || defaults.username;
    const effectivePassword = conn.password ? decrypt(conn.password) : defaults.password;
    const effectiveDomain = conn.domain || defaults.netbios_domain;

    if (effectiveUsername) settings.username = effectiveUsername;
    if (effectivePassword) settings.password = effectivePassword;
    if (effectiveDomain) settings.domain = effectiveDomain;

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
    console.error('Failed to generate connection token:', err);
    res.status(500).json({ error: 'Failed to generate connection token' });
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
