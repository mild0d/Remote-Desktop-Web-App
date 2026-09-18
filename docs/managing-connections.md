# Managing connections

[← Back to README](../README.md)

## Default RDP credentials

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

## Connecting without saved credentials

If a connection has no saved username/password of its own, and your
account has no default credentials set either, clicking **Connect**
prompts for a username and password right there instead of connecting
with nothing - useful if you'd simply rather not save credentials at
all and don't mind entering them each time. Whatever's typed in is used
for that one connection attempt only and is never saved anywhere, not to
the connection and not to your account's defaults.

## Notes and tags

Each connection can have free-text **notes** (shown as a 📝 icon next to
its name — hover to read them) and comma-separated **tags** (shown as
badges on the card). Click any tag in the row above the connections grid
to filter down to just connections with that tag; click it again to clear
the filter. Both are included in export/import, so a shared server list
keeps its organization when a teammate imports it.

## Bulk actions

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

## Import from Active Directory

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

## Knowing whether a connection has its own saved password

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

The same applies to your account's own default password, in **⚙️
Settings** - if one is currently saved, a **"Clear the saved default
password"** checkbox appears there too, for anyone who'd simply rather
not have a default password saved at all and prefers being prompted at
connect time instead (see "Connecting without saved credentials" above).

## Share a connection with a teammate

Click the **⋮** menu on any connection card → **Share** → pick a teammate
from the list. This drops a copy of that connection straight into their
own list — same principle as export/import (name, hostname, tags, and
notes carry over, but never a password), just one click instead of a
download/upload round trip. They'll use their own credentials to connect
(their own default credentials, or their own per-connection override) —
sharing a connection never shares your password.

## Export as .rdp file (RDP only)

Click the **⋮** menu on any RDP connection card → **Export as .rdp
file** to download it as a standard Windows .rdp file - the same
plain-text format Remote Desktop Connection (mstsc.exe) itself reads
and saves. Double-clicking the downloaded file opens that connection
directly in Windows' native RDP client, outside the browser entirely.

Like every other export in this app, it never includes a password -
RDP will just prompt for credentials normally when you open the file.
Not available for SSH connections, since there's no equivalent
standard file format for SSH the way .rdp is for RDP.

## Export / Import connections

**⬇️ Export** downloads a JSON file of all your saved connections.
**⬆️ Import** reads a JSON file back in and adds those connections to your
own list. This is meant for sharing a server list between team members -
**passwords are never included**, either direction: export strips them out
entirely, and import ignores any password field present in the file even
if one's there. Each person who imports a shared list ends up with blank
per-connection passwords, which fall back to their own default credentials
(see above) - so everyone uses their own login, not someone else's.
