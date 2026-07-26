const express = require('express');
const { loadAll, saveAll, nextId } = require('../lib/store');
const { getConfig } = require('../lib/adConfig');
const { browseChildren } = require('../lib/adBrowser');

const router = express.Router();

// Every route here is mounted behind requireLogin in server.js.

router.get('/browse', async (req, res) => {
  const config = getConfig();
  if (!config) {
    return res.status(400).json({ error: 'Active Directory has not been configured yet. Ask an admin to set it up.' });
  }

  try {
    const children = await browseChildren(config, req.query.dn || null);
    res.json({
      baseDN: config.baseDN,
      ous: children.filter((c) => c.type === 'ou'),
      computers: children.filter((c) => c.type === 'computer'),
    });
  } catch (err) {
    res.status(400).json({ error: `Failed to browse Active Directory: ${err.message}` });
  }
});

// Imports selected computer objects as new connections in the current
// user's own list. Deliberately no password (same principle as sharing
// and file import) - the user connects with their own default
// credentials, or sets a per-connection override afterward. Deliberately
// no auto-assigned tags/notes either - a plain, blank starting point.
router.post('/import', (req, res) => {
  const { computers } = req.body || {};
  if (!Array.isArray(computers) || computers.length === 0) {
    return res.status(400).json({ error: 'Expected a non-empty array of computers to import' });
  }

  const list = loadAll();
  let imported = 0;

  computers.forEach((computer) => {
    const hostname = computer.dnsHostName || computer.name;
    if (!computer.name || !hostname) return; // skip malformed entries rather than fail the whole batch

    list.push({
      id: nextId(list),
      user_id: req.session.userId,
      name: computer.name,
      hostname,
      port: 3389,
      username: '',
      password: '',
      domain: '',
      security: 'any',
      ignore_cert: 1,
      color_depth: '16',
      icon: computer.operatingSystem && computer.operatingSystem.toLowerCase().includes('server') ? '🖥️' : '💻',
      notes: '',
      tags: [],
      created_at: new Date().toISOString(),
    });
    imported += 1;
  });

  saveAll(list);
  res.json({ ok: true, imported });
});

module.exports = router;
