# Monitoring and admin tools

[← Back to README](../README.md)

## Reachability indicator

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

## Hardware specs (RDP only)

For RDP connections, **click the connection's name** on its card to see
its OS, CPU, memory, and disk usage, fetched live from the machine over
WinRM. Results are cached for 10 minutes per connection - click
**↻ Refresh** in the popup to bypass the cache and re-check immediately.

This needs a bit of one-time setup on each Windows machine you want specs
for:

1. Enable WinRM: `winrm quickconfig` (run as Administrator)
2. Make sure port 5985 is reachable from wherever this app's container
   runs - it isn't the same port as RDP itself, so a firewall rule that
   only allows 3389 won't be enough
3. Uses NTLM auth with whichever credentials the connection would
   normally use to actually connect (its own saved password, or your
   account's default RDP credentials if the connection doesn't have its
   own) - there's nothing separate to configure for this

HTTPS (port 5986) and custom WinRM ports aren't supported yet - it's
hardcoded to plain HTTP on 5985 for now. Not available for SSH
connections.

## Admin tools (RDP only)

Each RDP connection's dropdown menu (**⋮** on its card) has a **Tools ▸**
entry with eight read-only tools, all running over the same WinRM setup
as hardware specs above (so the same one-time setup applies - no extra
configuration needed if specs are already working):

- **Event Viewer** - browse any of the 5 standard Windows Logs
  (Application, Security, Setup, System, Forwarded Events, shown even
  if empty, matching the real Event Viewer's tree) or an active
  Applications and Services log, filterable by level
  (Error/Warning/Information). Defaults to the System log, showing its
  most recent 100 events.
- **Running Processes** - like Task Manager's Processes tab
- **Running Services** - every service and its current status
- **Disk Usage** - per-volume usage
- **Installed Software** - what's installed, with version numbers
- **Network Configuration** - IPs, adapters, and DNS
- **Windows Update Status** - last installed update, and whether a
  reboot is pending
- **Pending Updates** - updates not yet installed, using whatever the
  machine already knows from its last normal check (fast, no live
  network contact)
- **Check for Updates** - forces a fresh live check against Windows
  Update/WSUS right now instead of using the last known state - this one
  can genuinely take a minute or two, unlike everything else in this list
- **Local User Accounts** - local (non-domain) accounts and whether
  each is enabled

Each opens in its own window with a **↻ Refresh** button. Unlike
hardware specs, none of these are cached - they're live, fast-changing
state, so every open (and every refresh) is a fresh query. All eight
are strictly read-only - nothing here changes anything on the remote
machine.
