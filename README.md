# RDP Web App

A minimal, self-hosted web app for opening RDP sessions from a browser.
List, add, and delete RDP connections through a single-page UI; click
"Connect" to open a live RDP session rendered in a `<canvas>`.

**Self-service accounts, no database** — anyone can register their own
account (just a username/password, no email), and each person's saved
connections are private to them. Both users and connections are stored in
flat JSON files rather than a database, and the entire frontend is one HTML
file (`public/index.html`) with inline CSS/JS.

## How it works

```
Browser  <--WebSocket-->  Node app (Express + guacamole-lite)  <--Guacamole protocol-->  guacd  <--RDP-->  target Windows machine
```

- **guacd** is a small native daemon (from the Apache Guacamole project) that
  actually speaks RDP. There's no way around needing something like it — a
  browser can't open a raw RDP/TCP connection by itself, so something has to
  translate the protocol. We run it as an official prebuilt Docker container,
  so there's nothing to compile.
- **guacamole-lite** is a lightweight Node.js library that brokers the
  WebSocket connection between the browser and guacd.
- **Our own app** (Express + flat JSON files + one HTML file) handles
  login/registration, "list / add / delete connections" scoped per user, and
  asks guacamole-lite to open a session on demand.

## Requirements

- **Windows**: Docker Desktop — see the Windows section below
- **macOS / Linux**: Docker + the Docker Compose plugin (the setup script
  can install Docker for you on Debian/Ubuntu-based systems if missing)

## One-click setup — Windows

1. Double-click **`setup.bat`**. It'll prompt for administrator privileges
   (a normal UAC popup) — this is needed because the script checks for and
   automatically installs [Windows Subsystem for
   Linux](https://learn.microsoft.com/windows/wsl/) if it isn't already
   present, since Docker Desktop requires it regardless of which container
   backend (WSL2 or Hyper-V) you end up using.
2. If WSL had to be installed, the script will tell you to **restart your
   computer**, then run `setup.bat` again — this is a genuine Windows/WSL
   requirement, not something the script can skip.
3. If [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   itself isn't installed, the script offers to install it via `winget`.
   Once it's installed, launch it and wait for the whale icon in the system
   tray to go steady (not animating) before running `setup.bat` again.

That script will:
1. Check for and install WSL if needed (see above)
2. Check Docker Desktop is installed and running (offers to install it via
   `winget` if missing)
3. Generate a `.env` file with random encryption keys
4. Build and start the containers (`guacd` + the web app)

Then open the URL it prints (default `https://localhost:8080`). Your browser
will show a security warning the first time — this is expected, since the
app uses a self-signed certificate generated automatically on first run
(see the HTTPS section below for why, and how to change this).

Day to day: double-click **`start.bat`** / **`stop.bat`** (these don't need
administrator rights, since WSL/Docker are already set up by that point).

If Windows blocks the `.bat` from running (SmartScreen), right-click →
Properties → check "Unblock", or run it from a terminal instead:
`powershell -ExecutionPolicy Bypass -File setup.ps1` (as Administrator, if
WSL still needs installing)

## One-click setup — macOS / Linux

```bash
./setup.sh
```

This will check for/offer to install Docker, generate a `.env` file with
random encryption keys, then build and start the containers.

Day-to-day: `./start.sh` / `./stop.sh`

## Using it

1. Open the app — first time, click **Register** and create a username/password (no email needed). You'll be logged in immediately.
2. Click **+ Add connection**, fill in hostname, port (default 3389),
   domain (optional), username, and password.
3. Click **Connect** — it opens a new tab and switches to a live RDP session.
4. Click into the session once to make sure it has keyboard focus.
5. Click **← Back to list** to keep the session running in the background and return to it later via its tab, or **Disconnect**/the tab's **×** to actually end it.

### Default RDP credentials

Click **⚙️ Settings** next to your username to save, per your own account:

- **Default username/password** — any connection whose own username/password
  fields are left blank will automatically use these at connect time, so if
  most of your servers share one admin account, you only have to type it in
  a single place. Individual connections can still set their own
  username/password to override this.
- **Hostname suffix** — auto-appended to short hostnames when adding a
  connection (e.g. typing `server01` becomes `server01.example.local`
  if your suffix is set to `example.local`). Leave blank to disable this and
  always type full hostnames/IPs yourself.
- **Default NetBIOS domain** — used for every connection's RDP login domain.
  There's no per-connection override for this anymore; it's set once here
  and applies to all of your connections.

These are per-user settings, not shared across accounts — everyone on the
same AD domain would set the same values, but nothing stops different users
setting different ones if they connect to different environments.

### Reachability indicator

Each card shows a small dot next to its name — green if the host currently
responds on its configured port, red if it doesn't. This is a plain TCP
connection attempt (not a real RDP handshake), so it tells you whether
*something* is listening there, not whether RDP itself would actually
succeed. Checks run automatically whenever the connections list loads or
refreshes, all in parallel server-side in a single request.

### Two-factor authentication

Click **🔐 2FA** next to your username to turn on two-factor
authentication for your own login (independent of anything else in the
app - it protects signing in, not individual RDP connections). Scan the QR
code with any standard authenticator app (Google Authenticator, Microsoft
Authenticator, Authy, etc.), enter the 6-digit code it shows you to
confirm, and from then on logging in requires both your password and a
fresh code.

A few things worth knowing:
- The code-entry step is rate-limited (10 attempts per 15 minutes) - a
  6-digit code only has a million possibilities, so this matters for it to
  actually be secure rather than just theatre.
- Turning 2FA back off requires re-entering your current password.
- If you lose your authenticator device, an admin can disable 2FA for your
  account from the Admin panel's user table, letting you log in and set it
  up again with a new device.
- The secret is encrypted at rest the same way RDP passwords are - it has
  to be reversible (not hashed) since verifying a code requires the real
  secret, not a one-way hash of it.

### Notes and tags

Each connection can have free-text **notes** (shown as a 📝 icon next to
its name — hover to read them) and comma-separated **tags** (shown as
badges on the card). Click any tag in the row above the connections grid
to filter down to just connections with that tag; click it again to clear
the filter. Both are included in export/import, so a shared server list
keeps its organization when a teammate imports it.

### Export / Import connections

**⬇️ Export** downloads a JSON file of all your saved connections.
**⬆️ Import** reads a JSON file back in and adds those connections to your
own list. This is meant for sharing a server list between team members -
**passwords are never included**, either direction: export strips them out
entirely, and import ignores any password field present in the file even
if one's there. Each person who imports a shared list ends up with blank
per-connection passwords, which fall back to their own default credentials
(see above) - so everyone uses their own login, not someone else's.

### Admin panel

The **first account ever registered** automatically becomes an admin — no
setup step needed. Admins see a **🛡️ Admin** button next to their username,
opening a panel to:

- View every registered user
- Promote/demote admin status for any account
- Reset another user's password (useful if they're locked out)
- Disable another user's 2FA (recovery path if they've lost their
  authenticator device)
- Delete an account — this also removes all of that user's saved
  connections, cached thumbnails, and shared-drive files
- Toggle whether new self-registration is allowed at all, letting you close
  signups once your team is fully set up (registration is wide open by
  default, as noted in Security below)
- View the **📋 Audit log** — every RDP connection attempt across every
  user, with timestamp, who connected, and to which server. Kept to the
  most recent 5000 entries to avoid unbounded growth on flat-file storage.
- View **🖥️ Active sessions** — RDP sessions genuinely open *right now*
  across every user (not just attempted - actually connected), with a
  **Force disconnect** button per session. This is a different thing from
  the audit log: the audit log records every connection *attempt*, while
  active sessions only shows ones currently live, and disappears the
  moment a session actually ends.

A few built-in safety rails: you can't delete your own account from this
panel (avoids an accidental self-lockout click — have another admin do it
if you really need to), and the app won't let the last remaining admin be
demoted or deleted, so there's always at least one admin account.

If you're upgrading an existing install from before this feature existed,
the earliest-registered account becomes admin automatically the next time
the server starts — no manual migration needed.

### Clipboard and file transfer

- **Clipboard**: text copied inside an RDP session is written to your real
  system clipboard automatically. A genuine Ctrl+V while a session is
  focused sends your local clipboard text into that session.
- **Files**: click **📁 Files** in the session toolbar to open your personal
  shared drive panel. Anything you upload there appears as a mapped drive
  inside every RDP session you open; anything you copy into that mapped
  drive from inside a session shows up there for download. Each user has
  their own private folder — nothing is shared between accounts.

## HTTPS

The app serves HTTPS only (not plain HTTP), using a self-signed certificate
that's generated automatically the first time it starts and then reused on
every subsequent restart (stored in `data/tls/` — the same persisted volume
used for connection/user data, so it survives container rebuilds). This
avoids requiring `openssl` or any manual certificate setup on your host
machine, at the cost of your browser showing a one-time security warning
that you'll need to click through/accept, since a self-signed certificate
isn't trusted by default.

If you're on a Windows domain with Active Directory Certificate Services
already running, you can get a properly trusted certificate (no browser
warning at all, for anyone on a domain-joined machine) by requesting one
from your internal CA for whatever hostname you access this app by, and
placing the resulting `cert.pem`/`key.pem` at `data/tls/cert.pem` and
`data/tls/key.pem` before starting the app — it'll use those instead of
generating its own self-signed one, since it only generates a new
certificate when those files don't already exist.

## Security notes — please read

Registration is wide open by design (no email verification, no admin
approval) — anyone who can reach the app can create their own account.
That's a deliberate simplicity tradeoff, not an oversight. Given that:

- Keep this on a trusted local network / localhost only. Do not port-forward
  it to the internet — an open registration page on the public internet
  means literally anyone can create an account and start saving RDP
  credentials into it.
- Each user's connections are private to them (enforced server-side, not
  just hidden in the UI) — one user cannot view, edit, delete, or open a
  session for another user's saved connections, even by guessing IDs.
- If you need to stop new signups after your team is set up, an admin can
  toggle this off directly from the Admin panel (see above) — no reverse
  proxy or extra configuration needed.
- If you need any access control at all, put a reverse proxy in front of it
  (Caddy, nginx, Traefik) with HTTP Basic Auth or similar, rather than
  exposing the app directly.
- Stored RDP passwords are encrypted at rest in `data/connections.json`
  (AES-256-CBC, key in `.env`), but they're decrypted server-side whenever
  you click Connect. Treat `.env` and `data/connections.json` as sensitive
  files — anyone with read access to either can eventually recover the
  plaintext passwords.
- guacd itself is only reachable on the internal Docker network, not
  published to the host.
- `ignore_cert` defaults to on for convenience with self-signed RDP hosts;
  turn it off for hosts where you want certificate validation enforced.
- The flat-file stores (`data/connections.json`, `data/users.json`) are not
  designed for concurrent multi-writer access — fine for a handful of people
  using the app at once, not built for heavy concurrent load.
- Passwords are hashed with bcrypt before being stored in `data/users.json`.
- Your default RDP password (if set) is encrypted the same way per-connection
  passwords are, and is only ever decrypted server-side at connect time -
  the `/api/auth/default-credentials` endpoint never sends the password
  itself back to the browser, only whether one is currently saved.
- `drive-data/user-<id>/` holds each user's uploaded/downloaded files in
  plaintext on disk (not encrypted) — treat it like any other shared folder
  containing whatever files people transfer through it.

## Project layout

```
server.js               Express app, session middleware, guacamole-lite wiring
lib/auth.js              requireLogin/requireAdmin middleware
lib/users.js             Flat JSON file read/write for users (bcrypt hashing, admin roles)
lib/settings.js           Global app settings (registration on/off)
lib/auditLog.js           Connection attempt logging (who connected to what, when)
lib/totp.js               Two-factor authentication (TOTP generation/verification, QR codes)
lib/activeSessions.js     In-memory tracking of currently-open RDP sessions (admin visibility + force-disconnect)
lib/store.js             Flat JSON file read/write for connections (per-user)
lib/driveStore.js         Per-user shared drive directory helpers (file transfer)
lib/thumbnailStore.js     Per-user cached desktop screenshot storage
lib/tls.js                Self-signed certificate generation/persistence for HTTPS
lib/crypto.js            Encrypt/decrypt stored RDP passwords
lib/guacToken.js          Builds the encrypted token guacamole-lite expects
routes/auth.js            Register/login/logout/me/change-password/default-credentials/2FA (rate-limited)
routes/connections.js     CRUD for connections (scoped to logged-in user) + session token + reachability endpoint
routes/files.js            Shared drive upload/list/download/delete (scoped to logged-in user)
routes/admin.js            User management + registration toggle (admin-only)
public/login.html         Sign in / register page
public/index.html         The rest of the frontend: connections list, add/edit modal, multi-tab session viewer
Dockerfile                Plain node:20-alpine, no native compilation needed
docker-compose.yml        guacd + webapp services
setup.sh / start.sh / stop.sh                    macOS/Linux one-click scripts
setup.ps1+.bat, start.ps1+.bat, stop.ps1+.bat     Windows one-click scripts
```

## Troubleshooting

- **"Failed to start session" / immediate disconnect**: check
  `docker compose logs -f guacd` — it usually reports the RDP-level reason
  (auth failure, NLA mismatch, etc). Try switching "Security mode" to `nla`
  or `tls` explicitly if "Any" doesn't negotiate cleanly with your target.
- **guacamole-lite version differences**: if the websocket connection to
  `/webtunnel` doesn't establish, check
  `docker compose exec webapp cat node_modules/guacamole-lite/README.md`
  for the exact option names expected by the installed version.
- **Black screen but "Connected" status**: usually a resolution/DPI mismatch
  or the RDP host still on its own login screen — try resizing the browser
  window and reconnecting.
- **Something else is answering on the port instead of this app** (e.g. a
  browser login prompt you didn't expect): another local service may already
  be using port 8080. Check with `docker ps` (do you see `rdp-webapp` and
  `rdp-webapp-guacd`?) and `netstat -ano | findstr :8080` (Windows) /
  `lsof -i :8080` (macOS/Linux). If something else owns that port, change
  `APP_PORT` in `.env` to a free port and restart.
- **PowerShell errors on Windows**: if you're troubleshooting `setup.ps1`
  yourself, note that Windows PowerShell 5.1 and PowerShell 7 differ in a
  couple of ways this script works around deliberately: it avoids
  `$ErrorActionPreference = "Stop"` (some versions turn native command
  stderr output into a terminating error even on a zero exit code) and
  avoids `Set-Content -Encoding utf8NoBOM` (only valid in PowerShell 7+).
