// Manages per-user directories used for RDP drive redirection (file
// transfer between the browser and an RDP session). The same host folder
// is bind-mounted into both this container (at APP_DRIVE_ROOT, so our own
// upload/download routes can read/write it directly) and the guacd
// container (at a different path, GUACD_DRIVE_ROOT, which is what actually
// gets passed to the RDP session as its mapped drive).

const fs = require('fs');
const path = require('path');

const APP_DRIVE_ROOT = path.join(__dirname, '..', 'drive-data');
const GUACD_DRIVE_ROOT = '/drive-data';

function ensureUserDriveDir(userId) {
  // Ensure the parent directory is writable too, in case it was created
  // with restrictive default permissions before this ever ran (e.g. by
  // Docker itself when first setting up the bind mount).
  fs.mkdirSync(APP_DRIVE_ROOT, { recursive: true });
  try { fs.chmodSync(APP_DRIVE_ROOT, 0o777); } catch (err) { /* best effort */ }

  const dir = path.join(APP_DRIVE_ROOT, `user-${userId}`);
  fs.mkdirSync(dir, { recursive: true });
  // World-writable: guacd's process and this webapp's process likely run
  // as different UIDs inside their respective containers, and the RDP
  // session itself (via drive redirection) needs to be able to write into
  // this folder too. Without this, Windows shows "Destination Folder
  // Access Denied" when trying to copy a file into the mapped drive.
  try { fs.chmodSync(dir, 0o777); } catch (err) { /* best effort */ }
  return dir;
}

function userDrivePathForGuacd(userId) {
  return `${GUACD_DRIVE_ROOT}/user-${userId}`;
}

function deleteAllForUser(userId) {
  const dir = path.join(APP_DRIVE_ROOT, `user-${userId}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { ensureUserDriveDir, userDrivePathForGuacd, deleteAllForUser, APP_DRIVE_ROOT };
