const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ensureUserDriveDir } = require('../lib/driveStore');

const router = express.Router();

// Rejects anything that isn't a plain filename - no path separators, no
// "..", no null bytes. This is the primary defense against path traversal;
// the resolved-path check in each route below is a second, independent
// layer in case this ever gets bypassed by an unusual filename.
function isSafeFilename(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  if (name.includes('\0')) return false;
  return true;
}

// Resolves filename against the user's drive dir and verifies the result
// actually stays inside that directory (defense in depth alongside
// isSafeFilename above).
function safeResolve(userDir, filename) {
  const resolved = path.resolve(userDir, filename);
  if (!resolved.startsWith(path.resolve(userDir) + path.sep)) return null;
  return resolved;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ensureUserDriveDir(req.session.userId));
  },
  filename: (req, file, cb) => {
    // Strip any directory components the client might have sent and keep
    // just the base filename.
    const base = path.basename(file.originalname);
    if (!isSafeFilename(base)) {
      return cb(new Error('Invalid filename'));
    }
    cb(null, base);
  },
});
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10GB - deployment images, WIM files, and installer packages routinely exceed the old 1GB limit
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

router.get('/', (req, res) => {
  const dir = ensureUserDriveDir(req.session.userId);
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const stat = fs.statSync(path.join(dir, entry.name));
      return { name: entry.name, size: stat.size, modified: stat.mtime };
    });
  res.json(entries);
});

router.post('/', (req, res, next) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      // Handled here specifically rather than letting these fall through
      // to the app's generic catch-all error handler, which would
      // otherwise report an unhelpful "Something went wrong" for what
      // are actually clear, expected (if unwelcome) conditions.
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024 * 1024)}GB per-file limit.` });
      }
      if (err.code === 'ENOSPC') {
        return res.status(507).json({ error: 'The server has run out of disk space. Free up some room and try again.' });
      }
      return next(err);
    }
    res.status(201).json({ ok: true, uploaded: (req.files || []).map((f) => f.filename) });
  });
});

router.get('/:filename', (req, res) => {
  if (!isSafeFilename(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const dir = ensureUserDriveDir(req.session.userId);
  const filePath = safeResolve(dir, req.params.filename);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.download(filePath, req.params.filename);
});

router.delete('/:filename', (req, res) => {
  if (!isSafeFilename(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const dir = ensureUserDriveDir(req.session.userId);
  const filePath = safeResolve(dir, req.params.filename);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

module.exports = router;
