# Changelog

All notable changes to this project are documented here. Versioning
follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- **MAJOR** - breaking changes (something you'd need to adjust your setup for)
- **MINOR** - new features, backward-compatible
- **PATCH** - bug fixes, backward-compatible

## [1.12.4] - 2026-08-23

### Changed
- Documented how to copy/paste in SSH sessions: Ctrl+Shift+V to paste,
  confirmed reliable; select-to-copy back to the local clipboard works
  automatically, same as any terminal. Plain Ctrl+V is intended to work
  identically (the app doesn't distinguish between the two), but wasn't
  reliably reaching the app in testing on at least one setup - the
  underlying cause wasn't something in this app's own code, so
  Ctrl+Shift+V is the documented, confirmed-working shortcut for now.

## [1.12.3] - 2026-08-23

### Fixed
- The actual root cause of paste working once and then never again,
  found via a real browser stack trace rather than another guess:
  `disableKeyboardForwarding()` set Guacamole's shared keyboard object's
  `onkeydown`/`onkeyup` to `null` while a paste was being simulated. But
  pressing a paste shortcut with modifier keys (e.g. Ctrl+Shift+V) means
  Control and Shift are pressed *before* "v" - those keydowns aren't
  paste shortcuts themselves, so they were never intercepted, and
  reached Guacamole's own keyboard handling completely normally,
  including its internal timer for tracking held keys. When that timer
  later tried to call `onkeyup` and found `null` instead of a function,
  it crashed outright inside Guacamole's own library code - corrupting
  its internal keyboard state for the rest of the session, which is
  exactly why paste (and general typing reliability) degraded after the
  first attempt and never recovered without reconnecting. Fixed by using
  harmless no-op functions instead of `null`, so a late call from
  Guacamole's own internal timer is absorbed safely instead of crashing.
  Confirmed directly: reproduced the exact error message pattern from
  the reported crash, and confirmed it no longer occurs with this fix.

## [1.12.2] - 2026-08-23

### Fixed
- SSH paste worked once, then stopped working until reconnecting.
  Confirmed the actual cause with direct diagnostic evidence rather than
  guessing again: an SSH terminal's own cursor/selection handling
  occasionally fires a spurious "clipboard changed" report containing
  nothing but a newline - not a deliberate copy by the person using it.
  That was being blindly synced to the browser's clipboard, silently
  overwriting whatever had actually been copied moments earlier with an
  empty value. The next paste attempt then correctly pasted exactly
  that - nothing - which looked like paste had simply stopped working.
  Now ignores empty/whitespace-only clipboard reports from the remote
  side entirely, for both protocols - nobody ever deliberately copies
  nothing, so this can only prevent the problem, never discard a real
  copy.

## [1.12.1] - 2026-08-23

### Fixed
- Copy/paste didn't work in SSH sessions, introduced in 1.12.0. Cause:
  the fix forwarded a literal Ctrl+V keystroke to the terminal, on the
  assumption that would work like it does on Windows - but Ctrl+V isn't
  a paste shortcut in a standard shell at all; it's traditionally an
  entirely different readline control character. Now correctly
  simulates Shift+Insert instead, the standard paste shortcut across the
  xterm/Linux terminal family and what Guacamole's own SSH handling
  recognizes for pasting from its synced clipboard. RDP sessions are
  unaffected - still the same Ctrl+V sequence as before.

## [1.12.0] - 2026-08-23

### Added
- SSH connections, alongside RDP - pick it from a new Protocol dropdown
  when adding or editing a connection. Password authentication only for
  now, no private key support yet. RDP-specific fields (domain, security
  mode, color depth, certificate validation) hide themselves
  automatically when SSH is selected, and the port defaults to 22
  instead of 3389. The connect-time credential prompt and Ctrl+Alt+Del
  button both adapt correctly per session protocol.
- Deliberately, SSH connections never fall back to the account's saved
  default credentials in ⚙️ Settings, even if some are configured -
  those are explicitly the account's *RDP* defaults, an unrelated
  identity for most real setups. Confirmed directly: generated a real
  session token for an SSH connection with an RDP default password set
  on the account, and verified the decrypted token correctly has no
  credentials at all rather than silently reusing the RDP default.
- Existing connections are entirely unaffected and need no changes -
  they're correctly treated as RDP, exactly as before this feature
  existed, whether or not they have an explicit protocol saved.

## [1.11.2] - 2026-08-23

### Fixed
- Pasting would intermittently spam a burst of repeated "v" characters
  into the remote session until manually interrupted. Cause: holding
  Ctrl+V down even slightly longer than instantaneous - completely
  normal, not a mistake - triggers the browser's own native key-repeat,
  firing additional keydown events every ~30-50ms for as long as it's
  held. Nothing distinguished those from a genuine fresh keypress, so
  each one independently ran the full paste-handling sequence again,
  sending its own simulated Ctrl+V to the remote - multiple overlapping
  paste sequences landing in quick succession, which is what actually
  produced the repeated characters. Explains why it was intermittent:
  it only happened on presses that happened to last past the browser's
  key-repeat threshold. Fixed by ignoring auto-repeated keydown events
  for this shortcut specifically, using the standard KeyboardEvent.repeat
  property built for exactly this.

## [1.11.1] - 2026-08-20

### Fixed
- Buttons were nearly invisible on the Light, Windows 11, and Windows 10
  themes - Connect, Sort, Select, tag filter chips, kebab menus, and
  most footer buttons, all using the same button style throughout the
  app. Cause: that style was designed for the original dark theme, where
  light-colored text and borders read clearly - on a light background,
  it's light-on-light. Windows XP was accidentally unaffected, since it
  already gives every button a distinct visible background. Fixed for
  all three affected themes.

## [1.11.0] - 2026-08-20

### Added
- Themes: Dark (unchanged, the original default), Light, Windows 11,
  Windows 10, and Windows XP. Selectable from a new dropdown in ⚙️
  Settings → Appearance, applies immediately, and is saved per account -
  follows you to any device you sign in from. The three Windows-styled
  themes aim for genuine period character (Windows 11's rounded corners
  and Mica-like surfaces, Windows 10's flatter and sharper chrome, XP's
  iconic Luna blue title-bar gradient and beveled buttons) rather than
  just three recolors of the same look. Existing accounts default to
  Dark and see no change until someone actively picks something else.

## [1.10.0] - 2026-08-20

### Added
- ⛶ Fullscreen button in the session toolbar, next to Ctrl+Alt+Del. Fills
  the screen with that session; move the mouse to the top edge to reveal
  a thin, auto-hiding bar with an Exit fullscreen button (Esc also always
  works, as usual). The RDP session's resolution renegotiates to match
  automatically, both entering and leaving.
- Open session tabs can now be dragged left or right to reorder them.
  The ☰ Connections tab always stays fixed on the far left and can't be
  dragged or displaced - only the open session tabs reorder among
  themselves.

## [1.9.2] - 2026-08-20

### Fixed
- The 🛡️ Admin → 🖥️ Active sessions table required horizontal scrolling
  to reach the "Force disconnect" button - the same class of problem
  fixed for the admin user table back in 1.5.1, this time in a
  different table: long SSO email usernames and long FQDN hostnames
  pushed a plain table wider than its modal, with nothing to stop it.
  Switched to a fixed-width table layout with ellipsis truncation (full
  value still available by hovering) on the two columns most likely to
  contain long values, so this can't happen again regardless of how
  long any future username or hostname is.

## [1.9.1] - 2026-08-20

### Fixed
- Uploading a file over the per-file size limit showed a generic
  "Something went wrong" instead of saying what actually happened - the
  underlying error was reaching the app's catch-all error handler
  instead of being recognized for what it was. Now returns a specific
  "File exceeds the Xgb per-file limit" message. A separate, similar fix
  now gives a clear "server has run out of disk space" message instead
  of the same generic error, if the server's disk actually fills up
  mid-upload.
- Raised the per-file limit itself from 1GB to 10GB - OS deployment
  images, WIM files, and installer packages routinely exceed the
  original limit.

## [1.9.0] - 2026-08-20

### Added
- A progress bar for uploads to the shared drive, showing a running "X
  of Y uploaded" count instead of a blank wait with no feedback.

### Fixed
- Large shared-drive uploads that intermittently failed partway through
  - working sometimes, timing out other times. The actual cause: Node's
  default request timeout is 5 minutes, which a large file can easily
  exceed on anything but a fast connection - not a UI issue, a real
  server-side timeout aborting the request mid-upload. Removed for this
  app specifically, since it's self-hosted for a known set of people
  rather than a public API that benefits from a strict ceiling here.
  The 1GB per-file limit is unchanged. Uploading uses XMLHttpRequest
  instead of fetch() now too, since fetch has no upload-progress event
  at all - needed for the progress bar above to show real progress
  rather than a fake animation.

## [1.8.0] - 2026-08-20

### Changed
- Sharing multiple connections at once (via Select mode) now uses the
  same proper username dropdown as sharing a single connection, instead
  of a numbered text prompt asking you to type "1", "2", "3"...
- Adding tags - both to a single connection and to several at once -
  now has a small dropdown of tags already in use elsewhere, so you can
  pick an existing one instead of retyping its exact spelling. Typing a
  brand new tag still works exactly as before; the dropdown is purely an
  added shortcut, not a restriction. Bulk-tagging also moved out of a
  plain text prompt into a proper modal with the same dropdown.

## [1.7.1] - 2026-08-20

### Fixed
- SSO accounts no longer see local credential controls that don't apply
  to them: the username in the top bar is no longer a change-password
  button (their internal password is a random placeholder they never
  saw), and the 🔐 2FA button is hidden (app 2FA only ever applies at
  local login, which SSO accounts never use - their MFA policy lives in
  Entra). Both are also enforced server-side, not just hidden.
- The admin panel no longer offers "Reset password" on SSO accounts,
  and the backend rejects it outright - setting a local password on an
  SSO account would quietly create a second way in that Entra doesn't
  control, including for someone who's since been removed from Entra.
  SSO accounts now show a small "SSO" badge in the user list so it's
  clear at a glance why.

## [1.7.0] - 2026-08-20

### Added
- **Role-based access control** - four roles (Admin, Helpdesk, Auditor,
  User) replacing the old strict admin-or-not binary. Helpdesk can reset
  passwords, unlock accounts, and manage active sessions without also
  getting account deletion, role changes, 2FA resets, or AD/SSO/backup
  configuration access. Auditor can view the audit log and active
  sessions without being able to change anything. The admin panel only
  shows the specific actions a given role can actually perform. The
  last remaining admin still can't be changed to any other role or
  deleted, the same protection that existed before for the old
  admin/not-admin toggle.
- Existing installations upgrade automatically with no migration step -
  accounts that predate this feature (which only ever had the old
  is_admin flag, no role field) are correctly read as Admin or User
  based on that flag, exactly as before.

## [1.6.2] - 2026-08-20

### Fixed
- The connect-time credential prompt (1.6.0) wasn't showing up even after
  clearing both a connection's own password and the account's default
  password. Cause: the app checked a cached copy of the account's default
  credential status that was only ever fetched once, at page load, and
  never refreshed afterward - so clearing the default password via
  Settings had no effect on that check until a full page reload. Fixed
  by updating the cached status immediately after saving Settings,
  instead of only at page load.

## [1.6.1] - 2026-08-20

### Added
- A "Clear the saved default password" checkbox in ⚙️ Settings, when one
  is currently saved - the same gap that existed for connection-level
  passwords before 1.2.1 also existed for the account-level default,
  since leaving the field blank there only ever preserved whatever was
  already saved, with no way to actually remove it. Useful for anyone
  who'd rather not have a default password saved at all and prefers
  being prompted at connect time instead (1.6.0).

## [1.6.0] - 2026-08-20

### Added
- A connect-time credential prompt for connections with no saved
  username/password and no account-level defaults either - previously
  this would silently connect with no credentials at all, leaving the
  remote machine's own login screen to handle it inside the session.
  Useful for anyone who'd simply rather not save credentials in the app
  at all. Whatever's entered is used for that one connection attempt
  only and is never saved anywhere - not to the connection, not to the
  account's defaults.

### Changed
- The session-token endpoint (`POST /api/connections/:id/token`) changed
  from GET to POST, to safely accept these one-time credentials in the
  request body rather than a query string. This is an internal endpoint
  only ever called by this app's own frontend, so this has no impact on
  anything else.

## [1.5.1] - 2026-08-20

### Fixed
- The admin panel's user table required horizontal scrolling to see all
  the action buttons - a side effect of SSO accounts naturally using
  full email addresses as usernames (significantly longer than typical
  short usernames), combined with Bootstrap's button group component,
  which deliberately never wraps onto a new line by design. Switched to
  a wrapping button layout and widened the panel slightly, so this can no
  longer happen regardless of username length or how many action buttons
  a given row has.

## [1.5.0] - 2026-08-20

### Added
- **True single sign-on with Microsoft Entra ID** - people can sign in
  with their existing Microsoft account instead of a separate
  app-specific password. Unlike an earlier, reverted attempt at
  AD-based login, this app never handles credentials directly at all -
  authentication happens entirely on Microsoft's own login page, and this
  app only ever receives a signed token back. Uses `openid-client`
  (actively maintained) with the standard authorization code + PKCE flow.
  Local login always stays fully available regardless of this setting,
  for everyone - SSO is additive, never a replacement, and a single
  admin-panel toggle can disable it instantly if needed. First-time SSO
  logins auto-provision a local account (non-admin by default), matched
  to the person's stable Entra identity rather than just their email.
  SSO logins skip this app's own mandatory 2FA, trusting whatever MFA
  policy the organization already enforces in Entra instead.

## [1.4.0] - 2026-08-03

### Added
- **2FA recovery codes** - a set of 8 one-time codes shown once right
  after 2FA setup completes, letting you log in without your
  authenticator app if you ever lose access to it, without needing an
  admin to reset your 2FA. Stored as bcrypt hashes, never in plaintext,
  same treatment as passwords. Existing accounts can generate their own
  first batch anytime from ⚙️ 2FA, since there's no way to retroactively
  show codes that should have been shown at original setup time.

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
