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

## Setting up WinRM

Both [hardware specs](#hardware-specs-rdp-only) and the [admin tools](#admin-tools-rdp-only)
below run over WinRM (Windows Remote Management) - Windows' own remote
management protocol, not something this app invented. It needs a bit of
one-time setup on each Windows machine you want these features for. This
section is the one place that setup is documented - both features below
just link back here rather than repeating it.

### 1. Enable WinRM

On the target machine, run as Administrator:

```
winrm quickconfig
```

This starts the WinRM service, creates a listener on **port 5985 (HTTP)**,
and adds a Windows Firewall exception for it.

**If the machine's network connection is set to the "Public" profile**,
`winrm quickconfig` will refuse to add that firewall exception
automatically, and may print a message like *"WinRM firewall exception
will not work since this is a public network"*. Either change the
network's profile to Private (Settings → Network & Internet → the
connection's properties), or add the firewall rule yourself:

```
netsh advfirewall firewall add rule name="WinRM-HTTP" dir=in localport=5985 protocol=TCP action=allow
```

### 2. Confirm the firewall actually allows it from this app

Port 5985 is separate from RDP's own port - a firewall rule that only
allows 3389 (or 22, for SSH) won't be enough. Make sure 5985/TCP is
reachable specifically from wherever this app's container runs, not just
open on the target machine's local network in general.

### 3. For local (non-domain) accounts: disable UAC remote restrictions

**This is the single most common reason WinRM looks correctly configured
but most of the tools still fail** with access-denied-style errors. By
default, Windows strips administrative rights from a *local* account's
token for any remote connection (WinRM included) unless that account is
the actual built-in Administrator account (not just a local account
that's a member of the Administrators group) - a security feature called
UAC remote restrictions. Domain accounts on a domain-joined machine
aren't affected by this at all; this step only matters for local
accounts.

To disable it for a local admin account, run on the target machine:

```
New-ItemProperty -Path HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force
```

If you're already using a domain account, or the actual built-in
Administrator account specifically, you can skip this step.

### 4. Authentication

This app authenticates over WinRM using **NTLM** specifically (not
Kerberos, Basic, or CredSSP) - the most broadly compatible option for a
local account without further configuration, and it also works for
domain accounts via NTLM fallback. NTLM is enabled by default as part of
WinRM's "Negotiate" authentication, so there's usually nothing extra to
turn on for this specifically. The one exception: some hardened
Active Directory environments disable NTLM entirely via a "Network
security: Restrict NTLM" group policy - if that's been set in your
environment, WinRM connections from this app will fail authentication
regardless of how correctly everything else here is configured, and
re-enabling NTLM (at least for this specific target) is the only fix.

There's nothing to configure in this app itself for credentials - it
authenticates with whichever username/password the connection would
normally use to actually connect (its own saved password, or your
account's default RDP credentials if the connection doesn't have its
own).

### 5. Verify it works before troubleshooting through this app

Confirming WinRM itself is working, independent of this app, makes it
much faster to tell "WinRM isn't set up right" apart from "something in
the app is wrong" if a tool doesn't work. From another Windows machine
with network access to the target:

```
Test-NetConnection -ComputerName <target> -Port 5985
```

confirms the port itself is reachable. If you have credentials handy and
want to confirm authentication too, not just connectivity:

```
Invoke-Command -ComputerName <target> -Credential (Get-Credential) -ScriptBlock { whoami }
```

If that works, this app connecting with the same credentials should too.

### Current limitations

- **HTTP only, port 5985 only** - HTTPS (port 5986) and custom WinRM
  ports aren't supported yet, it's hardcoded to plain HTTP on 5985.
- **RDP connections only** - not available for SSH connections.

## Hardware specs (RDP only)

For RDP connections, **click the connection's name** on its card to see
its OS, CPU, memory, and disk usage, fetched live from the machine over
WinRM ([setup instructions above](#setting-up-winrm)). Results are cached
for 10 minutes per connection - click **↻ Refresh** in the popup to
bypass the cache and re-check immediately.

## Admin tools (RDP only)

Each RDP connection's dropdown menu (**⋮** on its card) has a **Tools ▸**
entry with read-only tools, all running over the same WinRM setup as
hardware specs above ([setup instructions above](#setting-up-winrm)) - no
extra configuration needed if specs are already working:

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
state, so every open (and every refresh) is a fresh query. All ten
are strictly read-only - nothing here changes anything on the remote
machine.
