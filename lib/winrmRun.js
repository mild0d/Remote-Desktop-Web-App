const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'winrm_run.py');
const TIMEOUT_MS = 20000; // matches winrmSpecs.js - long enough for a real query, short enough not to hang a modal indefinitely on an unreachable host

// General-purpose counterpart to fetchWinrmSpecs - runs whatever
// PowerShell script is passed in, rather than a single hardcoded query.
// Credentials go to the Python helper over stdin, not argv, for the same
// reason as winrmSpecs.js: argv is visible to other processes on the same
// host via `ps aux` / /proc/<pid>/cmdline, stdin isn't.
function runWinrmPowerShell({ hostname, port, username, password, useSsl, powershell, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('python3', [SCRIPT_PATH]);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ error: 'Timed out waiting for a response from the remote machine.' });
    }, timeoutMs || TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      finish({ error: `Could not start the WinRM helper: ${err.message}` });
    });

    child.on('close', () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout.trim());
        finish(parsed);
      } catch (e) {
        finish({ error: stderr.trim() || 'The WinRM helper produced no usable output.' });
      }
    });

    child.stdin.write(JSON.stringify({ hostname, port, username, password, use_ssl: Boolean(useSsl), powershell }));
    child.stdin.end();
  });
}

module.exports = { runWinrmPowerShell };
