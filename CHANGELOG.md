# Changelog

All notable changes to this project are documented here. Versioning
follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- **MAJOR** - breaking changes (something you'd need to adjust your setup for)
- **MINOR** - new features, backward-compatible
- **PATCH** - bug fixes, backward-compatible

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
