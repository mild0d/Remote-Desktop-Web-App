# Changelog

All notable changes to this project are documented here. Versioning
follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- **MAJOR** - breaking changes (something you'd need to adjust your setup for)
- **MINOR** - new features, backward-compatible
- **PATCH** - bug fixes, backward-compatible

## [1.3.0] - 2026-08-03

### Added
- **⌨️ Ctrl+Alt+Del** button in the session toolbar, next to Screenshot -
  sends that key combination to the remote session by simulating it
  directly, since it's intercepted by the operating system itself and
  can never be captured as a real browser keypress.

## [1.2.3] - 2026-08-03

### Fixed
- Copying text *out of* a session (remote-to-host direction) didn't work
  at all - a genuine JavaScript bug introduced in 1.0.2's echo-detection
  fix, referencing a `session` variable that was never actually declared
  in that scope, throwing an uncaught exception on every single attempt
  before it ever got to writing anything to the host clipboard. Fixed by
  correctly fetching the session object the same way every other part of
  this code already does.

## [1.2.2] - 2026-08-03

### Fixed
- Pasting into a session could paste content twice in a row. Root cause:
  the previous fixes only ever intercepted the single 'V' keydown event
  of a Ctrl+V press, then separately replayed a full Ctrl+V sequence
  afterward - but the Control keydown that precedes it, and the V/Control
  keyup events that follow it, were all still being forwarded to the
  remote session completely normally the whole time. That meant the
  remote machine could receive an overlapping, inconsistent mix of the
  user's real key signals and the separately-simulated ones at the same
  time. Reworked to suppress ALL keyboard forwarding for the entire
  duration of handling a paste, not just the one keystroke, so nothing
  from the user's real keypresses can reach the remote session while a
  clean, single, self-contained Ctrl+V sequence is being sent on its
  behalf - then resumes normal forwarding immediately after.

## [1.2.1] - 2026-08-03

### Added
- A "Clear the saved password" checkbox now appears when editing a
  connection that has its own saved password - previously there was no
  way to actually remove one once set, since leaving the password field
  blank always preserved whatever was already saved. Checking this box
  and saving clears it, so the connection falls back to the account's
  default credentials.

## [1.2.0] - 2026-08-03

### Added
- Editing a connection now shows whether it has its own saved password,
  or whether it's currently falling back to your default credentials -
  there was previously no way to tell the difference, since the password
  field always appeared blank either way. The real password is still
  never sent back or displayed, even masked - only a status indicator.

## [1.1.0] - 2026-07-29

### Added
- **📷 Screenshot** button in the session toolbar, next to Files - captures
  the current session at full resolution and saves it as a PNG. Opens a
  real native "Save As" dialog in Chrome/Edge (via the File System Access
  API); falls back to a normal download in browsers without that support.

## [1.0.3] - 2026-07-29

### Fixed
- A third clipboard issue: even after 1.0.1/1.0.2, pasting could still
  paste a stale value on the first attempt, with a correct paste on a
  second attempt shortly after. The 1.0.1 fix guaranteed the clipboard
  update and the simulated keypress happen in the right *JavaScript*
  execution order, but never accounted for the real time that update
  still needs to travel browser -> guacd -> RDP protocol -> the remote
  machine's own OS clipboard - the simulated keypress could still reach
  the remote session and trigger its native paste before the update had
  actually landed there. Added a short, deliberate delay between pushing
  the clipboard update and simulating the keypress, giving that round-trip
  time to genuinely complete first.

## [1.0.2] - 2026-07-29

### Fixed
- A second clipboard issue, distinct from the 1.0.1 fix: pasting into a
  session would sometimes paste an *older* value that had previously been
  copied *from* the remote session, rather than what was just copied on
  the host - and pasting a second time (without copying anything new)
  would then paste the correct value. The likely cause: RDP clipboard
  redirection can echo back a change notification for content this app
  itself just pushed into the remote session, and if that echo arrived
  after the user had already copied something new on their own host in
  the meantime, it would silently overwrite that fresh copy with the
  stale, already-pasted value. Fixed by tracking what was most recently
  pushed to the remote session and ignoring the next incoming
  notification if it's an exact echo of that, while still syncing
  anything genuinely new copied inside the session.

## [1.0.1] - 2026-07-29

### Fixed
- Clipboard paste into a session was unreliable ("sometimes works,
  sometimes pastes the last thing copied") - caused by a genuine race
  condition, not a browser permission issue: the app's keyboard-forwarding
  mechanism and its clipboard-sync mechanism both independently reacted to
  Ctrl+V, and the literal keystroke forwarding (fast, synchronous) almost
  always reached the remote machine before the clipboard content
  (asynchronous) had actually finished updating there - so the remote
  machine pasted whatever was already in its clipboard buffer from the
  last successful sync. Fixed by intercepting the keystroke before it's
  forwarded, updating the remote clipboard first, and only then manually
  simulating the actual keypress once that update is confirmed complete.

## [1.0.0] - 2026-07-29

First release. A self-hosted, browser-based RDP gateway with full Active
Directory integration and Windows-tool-grade security hardening.

### Core RDP gateway
- Browser-based RDP sessions via guacamole-lite/guacd - no client software needed
- Multi-tab sessions with background persistence, auto-fit resizing, bidirectional clipboard
- Per-user default RDP credentials, with per-connection overrides (username, password, domain)
- Automatic hostname suffix appending, connection notes and tags
- Per-connection reachability indicator (TCP check) with hover history and a live uptime trend, refreshed automatically in the background every 5 minutes
- Per-connection thumbnail previews, captured automatically during sessions
- Shared file drive per user for transferring files into/out of RDP sessions
- Bulk actions (tag, share, delete) across multiple connections at once
- Export/import connection lists (passwords never included)
- Share a connection directly with a teammate (no password included)

### Active Directory integration
- Browse and import servers/workstations directly from AD by OU, dual-pane folder browser
- Full certificate validation for LDAPS (CA certificate support, with an explicit
  opt-out for environments that can't provide one)
- Uses `ldapts` (actively maintained) rather than the archived `ldapjs`

### Security
- Mandatory two-factor authentication (TOTP) for every account
- Account lockout after repeated failed attempts, resistant to distributed
  (multi-IP) attacks, independent of IP-based rate limiting
- CSRF protection (double-submit cookie) on every state-changing request
- Timing-safe login - response time doesn't reveal whether a username exists
- Encrypted secrets at rest (RDP passwords, AD bind password, TOTP secrets)
- Global error handler - internal errors never leak to the client
- HTTPS-only, with support for your own real (e.g. wildcard) certificate
- Helmet security headers, `SameSite` session cookie
- Non-root Docker container
- Full audit log - every login attempt, every RDP connection, and every
  sensitive admin action (password resets, 2FA disables, deletions,
  AD/backup configuration changes)

### Administration
- Full admin panel: user management, registration toggle, active session
  monitoring (with force-disconnect), audit log viewer
- Automated backups (scheduled or on-demand) with configurable retention,
  downloadable from the admin panel
- Dependabot configured for automatic dependency update PRs

### Setup
- One-click setup scripts for Windows and macOS/Linux (WSL2/Docker handling included)
- Self-signed HTTPS certificate generated automatically on first run
