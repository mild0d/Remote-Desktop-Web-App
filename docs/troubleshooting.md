# Troubleshooting

[← Back to README](../README.md)

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
