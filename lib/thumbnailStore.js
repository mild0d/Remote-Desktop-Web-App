// Manages per-user directories for cached desktop-preview screenshots,
// one PNG per connection, captured client-side and uploaded here.

const fs = require('fs');
const path = require('path');

const THUMBNAIL_ROOT = path.join(__dirname, '..', 'data', 'thumbnails');

function ensureUserThumbnailDir(userId) {
  const dir = path.join(THUMBNAIL_ROOT, `user-${userId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function thumbnailPath(userId, connectionId) {
  return path.join(ensureUserThumbnailDir(userId), `${connectionId}.png`);
}

function deleteAllForUser(userId) {
  const dir = path.join(THUMBNAIL_ROOT, `user-${userId}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { ensureUserThumbnailDir, thumbnailPath, deleteAllForUser };
