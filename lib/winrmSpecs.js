const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'winrm_specs.py');
const TIMEOUT_MS = 20000; // WinRM to an unreachable/misconfigured host can otherwise hang well past what anyone would wait on a popup

// Credentials are passed to the Python script over stdin, not as command-
// line arguments - argv is visible to any other process on the same host
// via `ps aux` / /proc/<pid>/cmdline, stdin isn't.
function fetchWinrmSpecs({ hostname, port, username, password, useSsl }) {
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
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      // Most likely python3 itself isn't installed/on PATH in this
      // container - a deployment problem worth surfacing distinctly
      // from a normal WinRM connection failure.
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

    child.stdin.write(JSON.stringify({ hostname, port, username, password, use_ssl: Boolean(useSsl) }));
    child.stdin.end();
  });
}

module.exports = { fetchWinrmSpecs };
