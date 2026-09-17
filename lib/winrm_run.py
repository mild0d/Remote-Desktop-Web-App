#!/usr/bin/env python3
"""
Runs an arbitrary PowerShell script on a Windows machine over WinRM and
prints its JSON output.

Invoked by lib/winrmRun.js as a subprocess. Reads a single JSON object from
stdin: {"hostname": ..., "port": ..., "username": ..., "password": ...,
"use_ssl": bool, "powershell": "<script text>"}. Credentials travel over
stdin rather than as command-line arguments, same reasoning as
winrm_specs.py - argv is visible to other processes on the same host via
`ps aux` / /proc/<pid>/cmdline, stdin isn't.

Always exits 0 and prints exactly one JSON object to stdout - either the
script's parsed output, or {"error": "..."} - so the Node side has one
simple, uniform way to parse the result.

This is the general-purpose counterpart to winrm_specs.py, which stays as
its own separate, already-tested script rather than being rewritten to
call through this one - lower risk than refactoring something that's
already confirmed working end-to-end against a real machine.
"""
import sys
import json
import winrm
from winrm.exceptions import WinRMTransportError, InvalidCredentialsError


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
    powershell = params.get("powershell", "")

    scheme = "https" if use_ssl else "http"
    endpoint = f"{scheme}://{hostname}:{port}/wsman"

    try:
        session = winrm.Session(endpoint, auth=(username, password), transport="ntlm", server_cert_validation="ignore")
        result = session.run_ps(powershell)
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
    if not stdout_text:
        # A valid, empty result (e.g. Get-Service returning zero rows via
        # @(...) | ConvertTo-Json) still prints "[]" - genuinely empty
        # stdout means the command produced no output at all, worth
        # distinguishing from an actual empty list.
        print(json.dumps({"error": "The remote command produced no output."}))
        return
    try:
        parsed = json.loads(stdout_text)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Got a response, but couldn't parse it as JSON."}))
        return

    print(json.dumps(parsed))


if __name__ == "__main__":
    main()
