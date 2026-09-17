# Deployment and maintenance

[← Back to README](../README.md)

## Project layout

```
server.js               Express app, session middleware, guacamole-lite wiring
lib/auth.js              requireLogin/requireAdmin middleware
lib/users.js             Flat JSON file read/write for users (bcrypt hashing, admin roles)
lib/settings.js           Global app settings (registration on/off)
lib/auditLog.js           Connection attempt logging (who connected to what, when)
lib/totp.js               Two-factor authentication (TOTP generation/verification, QR codes)
lib/adConfig.js           Admin-configured Active Directory connection settings (encrypted bind password)
lib/adBrowser.js          LDAP browsing of AD OUs/computers via ldapts
lib/activeSessions.js     In-memory tracking of currently-open RDP sessions (admin visibility + force-disconnect)
lib/store.js             Flat JSON file read/write for connections (per-user)
lib/driveStore.js         Per-user shared drive directory helpers (file transfer)
lib/thumbnailStore.js     Per-user cached desktop screenshot storage
lib/tls.js                Self-signed certificate generation/persistence for HTTPS
lib/crypto.js            Encrypt/decrypt stored RDP passwords
lib/guacToken.js          Builds the encrypted token guacamole-lite expects
lib/winrmSpecs.js / lib/winrm_specs.py   Hardware specs over WinRM (RDP connections)
lib/winrmRun.js / lib/winrm_run.py       General-purpose WinRM PowerShell runner, used by the admin tools menu
lib/winrmTools.js         PowerShell query + display metadata for each read-only admin tool
routes/auth.js            Register/login/logout/me/change-password/default-credentials/2FA (rate-limited)
routes/connections.js     CRUD for connections (scoped to logged-in user) + session token, reachability, specs, and admin tools endpoints
routes/files.js            Shared drive upload/list/download/delete (scoped to logged-in user)
routes/admin.js            User management + registration toggle + Active Directory config (admin-only)
routes/ad.js               Browse/import from Active Directory (any logged-in user)
public/login.html         Sign in / register page
public/index.html         The rest of the frontend: connections list, add/edit modal, multi-tab session viewer
Dockerfile                node:20-alpine, runs as a non-root user (see accounts-and-security.md); also installs Python3/pywinrm for the WinRM-based features
docker-entrypoint.sh      Fixes mounted-volume ownership at container startup, then drops to the non-root user
docker-compose.yml.example   Template - setup copies this to docker-compose.yml on first run
setup.sh / start.sh / stop.sh                    macOS/Linux one-click scripts
setup.ps1+.bat, start.ps1+.bat, stop.ps1+.bat     Windows one-click scripts
```

## Customizing your deployment

`docker-compose.yml` is generated from `docker-compose.yml.example` the
first time you run setup, and is gitignored from there on. This means you
can freely edit the real `docker-compose.yml` afterward — for example,
adding labels for a reverse proxy like Traefik or nginx-proxy-manager — and
`git pull`ing future updates to this repo won't conflict with or overwrite
your local customizations, since git was never tracking your copy in the
first place. If you ever want to see what changed in the template itself,
compare against `docker-compose.yml.example`.

If you're maintaining your own fork/clone of this repo in git, one other
thing worth doing once: make sure `setup.sh`, `start.sh`, and `stop.sh` are
tracked as executable in git itself, not just on your local filesystem —
otherwise anyone who clones the repo fresh will need to manually
`chmod +x` those files before running them, and on Windows in particular,
git often ignores local `chmod` changes entirely by default (controlled by
the `core.fileMode` setting) unless told explicitly:
```bash
git update-index --chmod=+x setup.sh start.sh stop.sh
git commit -m "Track setup/start/stop scripts as executable"
```

## Shared drive uploads

Uploading a large file to the shared drive (📁 in a session) shows a
progress bar with a running "X of Y uploaded" count, rather than leaving
you guessing whether anything is happening.

Large uploads that used to intermittently fail partway through - working
sometimes, timing out other times, with no clear pattern - were hitting
a genuine server-side limit: Node's default request timeout is 5
minutes, which a large file can easily exceed on anything but a fast
connection. That ceiling has been removed for this app specifically,
since it's self-hosted for a known set of people rather than a public
API that benefits from a strict timeout.

The per-file limit is 10GB, raised from an original 1GB that turned out
to be too small for real-world deployment images, WIM files, and
installer packages. A file over that limit is rejected with a clear
"File exceeds the 10GB per-file limit" message rather than a generic
upload failure.

## Backups

**🛡️ Admin → 💾 Backups** creates a zip snapshot of everything in
`data/` - users, connections (with their encrypted passwords, exactly as
stored), settings, the audit log, and the TLS certificate. It does not
include the shared drive's contents (`drive-data`), which is treated as
working/transient storage rather than something that needs point-in-time
snapshots.

- **Automatic backups** run on a schedule (every 24 hours or weekly),
  keeping only the most recent N (configurable) and deleting older ones
  automatically.
- **Backup now** creates one immediately, useful before a risky change.
- Backups are stored on the host at `./backups/` (a plain folder, not
  hidden inside a Docker volume), so you can easily copy them off to
  external/offsite storage using whatever backup tooling you already use.

**Restoring is a deliberate manual process, not a one-click button** -
stop the app (`docker compose down`), replace the contents of `./data/`
with what's inside a backup zip, then start it again
(`docker compose up -d`). This is intentional: an automated one-click
restore is a much higher-risk feature to get wrong than reliably creating
backups in the first place, and restoring is rare enough that a deliberate
manual step is the safer design.

## Keeping dependencies patched (Dependabot)

`.github/dependabot.yml` is already set up to open weekly pull requests
keeping this project's npm dependencies and the Dockerfile's base image
current (routine minor/patch bumps get grouped into one PR to keep the
list manageable; major version bumps still get their own PR, since those
can include breaking changes worth reviewing individually).

That file only handles routine updates, though - two related features are
separate GitHub repo *settings* that a committed file can't turn on for
you:

- **Settings -> Code security -> Dependabot alerts** - notifies you when a
  dependency has a known security vulnerability
- **Settings -> Code security -> Dependabot security updates** - has
  Dependabot automatically open a PR to patch a vulnerable dependency as
  soon as one's disclosed, independent of the weekly schedule above

Both are free, and worth enabling on this repo if you haven't already.
