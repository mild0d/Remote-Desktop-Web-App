#!/usr/bin/env python3
"""
Fetches basic hardware/OS specs from a Windows machine over WinRM.

Invoked by lib/winrmSpecs.js as a subprocess. Reads a single JSON object
from stdin: {"hostname": ..., "port": ..., "username": ..., "password": ...,
"use_ssl": bool}. Credentials are passed via stdin rather than as command-
line arguments specifically so they never appear in `ps aux` or
/proc/<pid>/cmdline on the shared host.

Always exits 0 and prints exactly one JSON object to stdout - either the
gathered specs, or {"error": "..."} - so the Node side has one simple,
uniform way to parse the result rather than needing to branch on exit code
as well as output.
"""
import sys
import json
import winrm
from winrm.exceptions import WinRMTransportError, InvalidCredentialsError

# One combined CIM query rather than several separate WinRM calls - each
# call is its own round trip to the target, and round trips are the slow
# part here, not the query itself. ConvertTo-Json gives structured,
# reliable output to parse, instead of scraping PowerShell's default
# table-formatted text.
POWERSHELL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [PSCustomObject]@{
    drive = $_.DeviceID
    sizeGB = [math]::Round($_.Size / 1GB, 1)
    freeGB = [math]::Round($_.FreeSpace / 1GB, 1)
  }
}
$result = [PSCustomObject]@{
  os = $os.Caption
  osVersion = $os.Version
  totalMemoryGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  cpu = $cpu.Name
  cores = $cpu.NumberOfCores
  logicalProcessors = $cpu.NumberOfLogicalProcessors
  disks = @($disks)
}
$result | ConvertTo-Json -Depth 3 -Compress
"""


def main():
    try:
        params = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Internal error reading request: {e}"}))
        return

    hostname = params.get("hostname")
    port = params.get("port", 5985)
    username = params.get("username")
    password = params.get("password")
    use_ssl = params.get("use_ssl", False)

    scheme = "https" if use_ssl else "http"
    endpoint = f"{scheme}://{hostname}:{port}/wsman"

    try:
        # NTLM is the most broadly compatible transport for a local
        # (non-domain) Windows account without extra configuration on the
        # target - the same reasoning most third-party WinRM tooling
        # (Ansible included) defaults to for non-domain-joined targets.
        session = winrm.Session(endpoint, auth=(username, password), transport="ntlm", server_cert_validation="ignore")
        result = session.run_ps(POWERSHELL_SCRIPT)
    except InvalidCredentialsError:
        print(json.dumps({"error": "Authentication failed - check the username and password."}))
        return
    except WinRMTransportError as e:
        print(json.dumps({"error": f"Could not reach WinRM on {hostname}:{port} - {e}"}))
        return
    except Exception as e:
        print(json.dumps({"error": f"Could not reach WinRM on {hostname}:{port} - {e}"}))
        return

    if result.status_code != 0:
        stderr_text = result.std_err.decode("utf-8", errors="replace").strip()
        print(json.dumps({"error": stderr_text or "The remote command failed with no error output."}))
        return

    stdout_text = result.std_out.decode("utf-8", errors="replace").strip()
    try:
        specs = json.loads(stdout_text)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Got a response, but couldn't parse it as JSON."}))
        return

    print(json.dumps(specs))


if __name__ == "__main__":
    main()
