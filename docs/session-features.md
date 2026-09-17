# Session features

[← Back to README](../README.md)

## Command palette

Press **Ctrl+K** (or **Cmd+K** on Mac) anywhere in the app to open a
quick search - type a connection's name, hostname, or tag to jump
straight to it, or search for an action like "Settings", "Add
connection", or "Log out". Arrow keys move the selection, Enter opens
it, Escape closes the palette.

It works the same way whether you're on the connections list or
already inside a session - pressing Ctrl+K while a remote session has
keyboard focus opens the palette instead of sending the keystroke into
the remote session.

## Screenshot

**📷 Screenshot** in the session toolbar captures the current session at
full resolution and saves it as a PNG. In Chrome or Edge, this opens a
real "Save As" dialog letting you pick the exact folder and filename; in
browsers without that capability (Firefox, Safari), it falls back to a
normal download into your default Downloads folder instead.

## Send Ctrl+Alt+Del

**⌨️ Ctrl+Alt+Del** in the session toolbar sends that key combination to
the remote session. This can't work as a real keypress no matter how
keyboard forwarding is implemented - Ctrl+Alt+Del is intercepted by the
operating system itself, beneath the browser entirely - so this button
simulates the sequence directly instead, the same approach every other
remote desktop tool uses for this specific combination.

## Fullscreen

**⛶ Fullscreen** in the session toolbar fills the whole screen with that
session - everything else, including the tab bar, is hidden the way any
fullscreen video player hides its own browser chrome. Move the mouse to
the very top of the screen to reveal a thin bar with an **Exit
fullscreen** button; it hides itself again after a few seconds. The
usual way out also always works - press Esc, same as leaving fullscreen
video.

## Reordering open session tabs

Drag any open session tab left or right to reorder it. The **☰
Connections** tab always stays put on the far left - it's not
draggable, so open sessions can be freely reordered among themselves
without ever displacing it.

## Split view

Drag an open session tab and drop it directly onto another session's
pane to view both side by side, instead of reordering it in the tab
bar. Click either pane to move keyboard focus between them - a
highlighted border shows which one is currently receiving your
keystrokes. The toolbar (Ctrl+Alt+Del, Fullscreen, Screenshot,
Disconnect) always acts on whichever pane is focused.

Only two sessions can be split at once; dropping a third tab in
replaces the current split. To leave split view, click the **Exit
split** button, or click any other tab - either returns to normal
single-session view. Closing one side of a split collapses back to
the remaining session at full width.

## Clipboard and file transfer

- **Clipboard**: text copied inside an RDP session is written to your real
  system clipboard automatically. A genuine Ctrl+V while a session is
  focused sends your local clipboard text into that session.
- **Files**: click **📁 Files** in the session toolbar to open your personal
  shared drive panel. Anything you upload there appears as a mapped drive
  inside every RDP session you open; anything you copy into that mapped
  drive from inside a session shows up there for download. Each user has
  their own private folder — nothing is shared between accounts.

## Themes

**⚙️ Settings → Appearance** has a theme dropdown: Dark (the original
default), Light, Windows 11, Windows 10, and Windows XP. It applies
immediately and is saved to your account - it'll follow you to any
device you sign in from, not just this browser.

The three Windows-styled themes are deliberately evocative rather than
literal recreations - each aims to capture that era's actual defining
details (Windows 11's rounded corners and Mica-like surfaces, Windows
10's flatter and sharper-edged chrome, XP's iconic Luna blue gradient
title bars and beveled buttons) rather than just recoloring the same
flat look three times.

Existing accounts see no change at all until someone actively picks a
different theme - the saved default is Dark, matching the app's only
appearance before this feature existed.
