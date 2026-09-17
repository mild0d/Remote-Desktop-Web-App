# Accounts and security

[← Back to README](../README.md)

## Two-factor authentication (required)

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

## Automatic sign-out after inactivity

**⚙️ Settings → Session** lets you set how many minutes of inactivity
sign you out automatically - between 5 minutes and 8 hours, defaulting
to 1 hour. Entirely under your own control; no admin involvement.

Only mouse/keyboard use on this page itself counts as activity - an
open connection sitting untouched in a background tab does not keep you
signed in on its own. Signing out this way is a real, full sign-out: it
also closes any open connection tabs, the same as manually logging out
would.

This is enforced two ways, deliberately layered: the page itself checks
for inactivity while it's open, and separately, the underlying session
cookie's own expiration is tied to the same setting and rolls forward
with each request your browser makes. The second part matters
specifically for closing a laptop lid or otherwise leaving the browser
running unattended - no JavaScript can run while a laptop is asleep, so
without this, the saved setting would only ever apply while the page
happened to still be open. With it, the session itself expires on the
server after that much time with no activity at all, regardless of
whether the page ever gets a chance to notice.

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
  toggle this off directly from the Admin panel (see below) — no reverse
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

## Admin panel

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
  default, as noted above)
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

## Roles and permissions

Beyond the basic "admin or not," there are four roles:

- **Admin** - everything, unchanged from before this feature existed
- **Helpdesk** - can reset passwords, unlock locked-out accounts, view
  and force-disconnect active sessions - the routine, frequently-needed
  tasks - but cannot delete accounts, change anyone's role, disable
  someone's 2FA, or touch AD/SSO/backup configuration
- **Auditor** - can view the audit log and active sessions, but cannot
  change anything at all
- **User** - the default; no admin panel access

Change someone's role from the dropdown next to their name in **🛡️
Admin**. The admin panel itself only shows the specific buttons a given
role can actually use - a Helpdesk account won't see a "Delete" button
it would just get rejected for clicking, for example.

The last remaining admin can't be changed to any other role (including
Helpdesk) or deleted, the same protection that already existed for the
old admin/not-admin toggle - there has to be at least one full admin
account at all times.

**Upgrading from before this feature existed:** nothing to do - existing
admin accounts stay admins, and everyone else stays a regular user,
automatically. There's no separate migration step or file to edit.
