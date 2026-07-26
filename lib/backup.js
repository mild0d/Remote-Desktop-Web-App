// Creates timestamped zip backups of the data/ directory. Backups
// themselves are stored in a SEPARATE sibling directory (backups/, not
// data/backups/) - if they lived inside data/, every new backup would
// recursively include every previous backup, growing unboundedly.

const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const BACKUPS_DIR = path.resolve(__dirname, '..', 'backups');
const SETTINGS_FILE = path.join(DATA_DIR, 'backup-settings.json');

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  enabled: false,
  interval_hours: 24,
  retention_count: 7,
  last_backup_at: null,
};

function getSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function setSettings(partial) {
  const updated = { ...getSettings(), ...partial };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

function listBackups() {
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.zip'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, filename));
      return { filename, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at)); // newest first
}

// Deletes the oldest backups beyond the retention count. Returns how many
// were actually removed.
function pruneOldBackups(retentionCount) {
  const backups = listBackups(); // already newest-first
  const toDelete = backups.slice(retentionCount);
  toDelete.forEach((b) => fs.unlinkSync(path.join(BACKUPS_DIR, b.filename)));
  return toDelete.length;
}

function createBackup() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const outputPath = path.join(BACKUPS_DIR, filename);
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve({ filename, size: archive.pointer() }));
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => console.warn('Backup warning:', err.message));

    archive.pipe(output);
    archive.directory(DATA_DIR, false);
    archive.finalize();
  });
}

// Only matches exactly the filename pattern this module itself generates -
// rejects anything else, including any path traversal attempt, before it
// ever gets used to build a filesystem path.
function isValidBackupFilename(filename) {
  return typeof filename === 'string' && /^backup-[0-9TZ-]+\.zip$/.test(filename);
}

// Resolves a filename to a real path, or null if it's invalid, doesn't
// exist, or - as a defense-in-depth check even though the regex above
// should already prevent this - somehow resolves outside BACKUPS_DIR.
function getBackupPath(filename) {
  if (!isValidBackupFilename(filename)) return null;
  const fullPath = path.join(BACKUPS_DIR, filename);
  if (!fullPath.startsWith(BACKUPS_DIR + path.sep)) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function deleteBackup(filename) {
  const fullPath = getBackupPath(filename);
  if (!fullPath) throw new Error('Backup not found');
  fs.unlinkSync(fullPath);
}

// --- Scheduler ---
let schedulerInterval = null;

async function checkAndRunScheduledBackup() {
  const settings = getSettings();
  if (!settings.enabled) return;

  const intervalMs = settings.interval_hours * 60 * 60 * 1000;
  const lastBackup = settings.last_backup_at ? new Date(settings.last_backup_at).getTime() : 0;
  const due = Date.now() - lastBackup >= intervalMs;
  if (!due) return;

  try {
    await createBackup();
    setSettings({ last_backup_at: new Date().toISOString() });
    const deleted = pruneOldBackups(settings.retention_count);
    console.log(`Scheduled backup created${deleted > 0 ? ` - pruned ${deleted} old backup(s)` : ''}`);
  } catch (err) {
    console.error('Scheduled backup failed:', err);
  }
}

function startScheduler() {
  if (schedulerInterval) return;
  // Checks hourly rather than computing an exact next-run time - simpler,
  // and more than precise enough for a daily/weekly cadence.
  schedulerInterval = setInterval(checkAndRunScheduledBackup, 60 * 60 * 1000);
  checkAndRunScheduledBackup(); // also check once immediately at startup
}

module.exports = {
  getSettings,
  setSettings,
  listBackups,
  createBackup,
  deleteBackup,
  pruneOldBackups,
  getBackupPath,
  startScheduler,
};
