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
- **Default NetBIOS domain** — used as the RDP login domain for any
  connection that doesn't set its own. Same fallback pattern as
  username/password: a connection's own Domain field (in the Add/Edit
  form) takes precedence if set, otherwise this default applies.

These are per-user settings, not shared across accounts — everyone on the
same AD domain would set the same values, but nothing stops different users
setting different ones if they connect to different environments.

### Screenshot

**📷 Screenshot** in the session toolbar captures the current session at
full resolution and saves it as a PNG. In Chrome or Edge, this opens a
real "Save As" dialog letting you pick the exact folder and filename; in
browsers without that capability (Firefox, Safari), it falls back to a
normal download into your default Downloads folder instead.

### Send Ctrl+Alt+Del

**⌨️ Ctrl+Alt+Del** in the session toolbar sends that key combination to
the remote session. This can't work as a real keypress no matter how
keyboard forwarding is implemented - Ctrl+Alt+Del is intercepted by the
operating system itself, beneath the browser entirely - so this button
simulates the sequence directly instead, the same approach every other
remote desktop tool uses for this specific combination.

### Reachability indicator

Each card shows a small dot next to its name — green if the host currently
responds on its configured port, red if it doesn't. This is a plain TCP
connection attempt (not a real RDP handshake), so it tells you whether
*something* is listening there, not whether RDP itself would actually
succeed. Checks run automatically whenever the connections list loads or
refreshes, all in parallel server-side in a single request. Hover over the
dot for a bit more detail: response time in milliseconds (for a reachable
host) and how long ago the check was actually performed.

**Click the dot** for its uptime history - a background check runs every
5 minutes for every connection, independent of whether anyone has the app
open, so the trend reflects genuine continuous monitoring rather than only
whenever someone happened to be looking. The popover shows the most recent
30 checks as a bar strip (green/red, hover a bar for its exact time) and an
overall uptime percentage across the full recorded history (up to about
41 hours' worth, at the 5-minute check interval).

### Two-factor authentication (required)

Every account must have two-factor authentication set up — there's no way
to opt out. New accounts are walked through setup immediately after
registering, before they get any other access to the app. If you're
upgrading from a version of this app that predates this feature, any
existing account without 2FA yet gets the same treatment automatically:
the next time it logs in with the correct password, it's required to set
up 2FA on the spot before reaching anything else.

Setup itself: scan the QR code with any standard authenticator app (Google
Authenticator, Microsoft Authenticator, Authy, etc.), then enter the
6-digit code it shows you to confirm. From then on, logging in requires
both your password and a fresh code.

A few things worth knowing:
- The code-entry step is rate-limited (10 attempts per 15 minutes) - a
  6-digit code only has a million possibilities, so this matters for it to
  actually be secure rather than just theatre.
- There's no self-service way to turn 2FA off, since it's mandatory. If
  you lose your authenticator device, an admin can reset 2FA for your
  account from the Admin panel's user table — this doesn't exempt the
  account from the policy, it just clears the way for you to set it up
  again (on a new device) the next time you log in.
- The secret is encrypted at rest the same way RDP passwords are - it has
  to be reversible (not hashed) since verifying a code requires the real
  secret, not a one-way hash of it.
- Click **🔐 2FA** next to your username any time to confirm it's active
  on your account.

### Notes and tags

Each connection can have free-text **notes** (shown as a 📝 icon next to
its name — hover to read them) and comma-separated **tags** (shown as
badges on the card). Click any tag in the row above the connections grid
to filter down to just connections with that tag; click it again to clear
the filter. Both are included in export/import, so a shared server list
keeps its organization when a teammate imports it.

### Bulk actions

Click **☑️ Select** above the connections grid to reveal a checkbox on
every card. Select as many as you like, and a bar appears with:

- **Add tag** — adds one or more tags to every selected connection at
  once, merging with whatever tags each one already has (never replaces
  existing tags)
- **Share** — shares copies of every selected connection with one
  teammate in a single action (same no-password-transfer rule as sharing
  one at a time)
- **Delete** — deletes every selected connection at once, with a single
  confirmation

Click **Clear selection** (or toggle **☑️ Select** off) to exit selection
mode.

### Import from Active Directory

An admin configures this once (**🛡️ Admin → 🗂️ Active Directory**): your
domain controller's address, a read-only bind account, and the base DN to
browse from. Once set up, **any** user can click the **⋮** menu next to
"+ Add connection" → **Import from Active Directory** for a dual-pane
browser — folders (OUs) on the left to click into, servers/workstations in
the currently-selected folder on the right with checkboxes to select. Click
**Import selected** to add them to your own list. Imported connections get
no password (same rule as sharing and file import - you use your own
default credentials) and no tags/notes - a plain starting point you can
edit afterward if you'd like.

A few things worth knowing:

- Use `ldaps://` in the server URL if your domain controller supports
  encrypted LDAP (recommended); `ldap://` otherwise.
- For `ldaps://`, paste your internal CA's certificate (e.g. from AD
  Certificate Services) into the **CA certificate** field so this
  connection can genuinely verify your domain controller's identity. By
  default, `ldaps://` connections are validated the same way any browser
  validates HTTPS - if your domain controller's certificate was issued by
  an internal CA (the normal case for AD), the connection will correctly
  refuse to proceed until you provide that CA's certificate here. **Skip
  certificate validation** is available as an explicit, clearly-labeled
  fallback if you genuinely can't provide it, but that means this
  connection can no longer confirm it's really talking to your actual
  domain controller rather than something impersonating it.
- The bind account only needs read access to browse the directory - it
  doesn't need to be a domain admin.
- Use **Test connection** in the config screen to confirm the bind
  credentials (and certificate, for `ldaps://`) actually work before saving.

### Knowing whether a connection has its own saved password

Editing a connection now shows clearly whether it has its own password
saved, or whether it's currently falling back to your default
credentials - useful after changing your own password, since any
connection *without* its own saved password picks up the new default
automatically, while one *with* its own saved password needs updating
separately. The real password itself is still never sent back or
displayed, even masked - only this status.

If a connection does have its own saved password, a **"Clear the saved
password"** checkbox appears - checking it and saving removes that
connection's own password entirely, so it falls back to using your
default credentials instead. Leaving the password field blank *without*
checking this box still just preserves whatever's already saved,
unchanged - the checkbox is what actually clears it.

### Share a connection with a teammate

Click the **⋮** menu on any connection card → **Share** → pick a teammate
from the list. This drops a copy of that connection straight into their
own list — same principle as export/import (name, hostname, tags, and
notes carry over, but never a password), just one click instead of a
download/upload round trip. They'll use their own credentials to connect
(their own default credentials, or their own per-connection override) —
sharing a connection never shares your password.

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
- View the **📋 Audit log** — every RDP connection attempt, every web
  app login attempt (success or failure, including failed attempts against
  usernames that don't even exist - useful for spotting brute-force
  attempts), *and* every sensitive admin action (password resets, 2FA
  disables, account unlocks/deletions, admin-status changes, registration
  toggling, AD/backup configuration changes) - who did it and to whom.
  Kept to the most recent 5000 entries to avoid unbounded growth on
  flat-file storage.
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

**HTTP security headers** (via [Helmet](https://helmetjs.github.io/)) are
applied to every response: a Content-Security-Policy, clickjacking
protection (X-Frame-Options), MIME-sniffing protection, HSTS, and a few
others. One deliberate exception: `script-src` allows `'unsafe-inline'`,
since this app's entire frontend is built as inline `<script type="module">`
blocks rather than external `.js` files — CSP's default only permits
same-origin *files*, not inline script content, so a stricter setting
would break the app outright. Everything else keeps Helmet's secure
defaults; the one inline event-handler attribute this app used to have
(an `onerror` on thumbnail images) was replaced with a real
`addEventListener` specifically so that directive could stay locked down.

The session cookie is also `SameSite=Lax`, `HttpOnly`, and `Secure` -
blocking cross-site requests from ever carrying it, inaccessible to
JavaScript, and never sent over plain HTTP.

**The container runs as a non-root user**, not root. A small entrypoint
script (`docker-entrypoint.sh`) fixes ownership of the mounted volumes
(`./data` and the `drive-data` volume) at every container start - both a
fresh install and an existing install upgrading from before this change
are handled automatically, without needing to manually `chown` anything on
the host yourself. If you're upgrading an existing deployment, just
`docker compose up -d --build` as usual; the entrypoint script takes care
of the rest the first time the new container starts.

**Registration is now rate-limited** (10 attempts per 15 minutes per IP,
tracked separately from the login/2FA limiter), preventing automated mass
account creation.

**The session ID is regenerated at every privilege transition** - after
registering, after a successful password check, and after 2FA completes.
This is standard defense against session fixation: it guarantees an
attacker could never have pre-set or predicted the session ID a user ends
up authenticated under.

**`TRUST_PROXY`** (set in `.env`, off by default) - only enable this if
this app is genuinely running behind a trusted reverse proxy (e.g.
Traefik, nginx). It tells the app to trust the `X-Forwarded-For` header
for determining the real client IP, which rate limiting and the audit log
both rely on. Leave this off if you're accessing the app directly -
trusting that header without an actual proxy in front would let anyone
connecting directly just spoof their own IP in it.

**Account-level lockout**, separate from the IP-based rate limiter above -
that one can't stop a distributed attempt (many different source IPs
against one specific account), since it only tracks per-IP. After 10
failed password attempts against the same account (tracked regardless of
where the attempts came from), that account locks for 30 minutes. An admin
can unlock it immediately from the admin panel (a **Locked** badge and an
**Unlock** button appear automatically next to any locked account) rather
than making someone wait out the full window. The failed-attempt count
resets to zero after any successful login, so occasional typos over time
don't quietly accumulate toward a lockout.

**Errors never leak internal detail to the browser.** A global catch-all
error handler guarantees this regardless of environment configuration -
verified by deliberately triggering a real server error and confirming
only a generic message ever reaches the client, while the actual error
(with its full stack trace) still lands in the server's own log for
debugging.

**Login timing is constant regardless of whether the username exists.**
Without this, a nonexistent username would skip the deliberately-slow
bcrypt password check entirely and respond measurably faster than a real
username with a wrong password - letting an attacker figure out which
usernames exist just by timing responses, even though both cases show the
identical error message. Measured directly: the real difference this
closed was about 28ms, now within about 2-3ms (ordinary network/JS
jitter, not a meaningful signal).

**CSRF protection** (via [csrf-csrf](https://github.com/Psifi-Solutions/csrf-csrf)),
layered on top of the `SameSite=Lax` cookie above as a second,
independently-verifiable layer against cross-site request forgery. Every
state-changing request (not just GET reads) requires a valid, freshly-
issued token tied to your actual session - verified directly that a
request with a missing, wrong, or session-mismatched token is rejected
before anything changes, while normal use (including through login, 2FA,
and everything in the admin panel) is completely unaffected.

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
  Minimum length is 10 characters (no forced complexity rules like
  requiring symbols/uppercase - length matters more, and complexity rules
  tend to just produce predictable patterns like "Password1!").
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
lib/adConfig.js           Admin-configured Active Directory connection settings (encrypted bind password)
lib/adBrowser.js          LDAP browsing of AD OUs/computers via ldapts
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
routes/admin.js            User management + registration toggle + Active Directory config (admin-only)
routes/ad.js               Browse/import from Active Directory (any logged-in user)
public/login.html         Sign in / register page
public/index.html         The rest of the frontend: connections list, add/edit modal, multi-tab session viewer
Dockerfile                node:20-alpine, runs as a non-root user (see Security below)
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

## 2FA recovery codes

Right after setting up two-factor authentication (either during account
creation, or from **⚙️ 2FA** in an existing account), you'll see a set of
8 one-time recovery codes - **this is the only time they're ever shown**,
since only a hashed version is kept afterward, the same treatment given
to your actual password. Save them somewhere safe, like a password
manager.

If you ever lose access to your authenticator app, click **"Use a
recovery code instead"** on the login verification screen and enter one
in place of the 6-digit code - this lets you get back into your own
account without needing an admin to intervene. Each code works exactly
once; using one crosses it off permanently.

Generate a fresh batch anytime from **⚙️ 2FA → Generate new recovery
codes** - this immediately invalidates every existing code, so there's
never an unbounded pile of old ones to keep track of.

**Existing accounts don't get recovery codes automatically** - there's no
way to retroactively show you something you should have seen when you
first set up 2FA. Generate a batch yourself from **⚙️ 2FA** whenever's
convenient.

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
