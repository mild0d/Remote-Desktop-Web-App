# SSH connections

[← Back to README](../README.md)

Alongside RDP, connections can also be set to **SSH** - pick it from the
Protocol dropdown when adding or editing a connection. The fields that
don't apply to SSH (domain, security mode, color depth, certificate
validation) hide themselves automatically once it's selected, and the
port field defaults to 22 instead of 3389.

SSH supports two authentication methods, chosen via the "Authentication
method" dropdown that appears once SSH is selected: **Password** (the
default) or **Private key**. Picking Private key swaps the password
field for a textarea to paste the key, plus an optional passphrase
field if the key itself is encrypted - both are encrypted at rest the
same way saved passwords already are. If a key-auth connection has no
saved key, [the same connect-time prompt used for RDP
passwords](managing-connections.md#connecting-without-saved-credentials)
appears instead, asking you to paste one just for that session.

One deliberate difference from RDP: SSH connections never fall back to
your account's saved default credentials in **⚙️ Settings**, even if
you have some configured. Those are explicitly your *RDP* defaults - for
most real setups, an SSH box's login has nothing to do with a Windows
admin account, so silently reusing it here would connect with the wrong
identity instead of clearly asking for the right one.

Everything else works the same as RDP - the same tabs, the same
fullscreen mode, the same drag-to-reorder - since the underlying
`guacd`/Guacamole stack this app is built on natively speaks SSH just as
fluently as RDP; an SSH session is just Guacamole rendering a terminal
onto the same canvas instead of a Windows desktop. The one exception is
Ctrl+Alt+Del, which hides itself for SSH sessions since it's a
Windows-specific concept with no meaning in a terminal.

## Copying and pasting in an SSH session

To paste something into an SSH session, copy it normally on your own
computer, then press **Ctrl+Shift+V** inside the session. This differs
from RDP (which uses the regular Ctrl+V) for a good reason: in a
standard Linux shell, Ctrl+V isn't a paste shortcut at all - it's
traditionally an entirely different readline control character. This
app translates whatever you press into the right underlying action for
each protocol.

Copying *from* an SSH session back to your own clipboard works
automatically - just select text with the mouse inside the terminal, the
same as any terminal application.
