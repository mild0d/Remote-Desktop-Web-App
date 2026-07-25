// Generates a self-signed TLS certificate the first time the app runs, and
// reuses it on every subsequent start (persisted in the same data/ volume
// used for connections.json/users.json). Regenerating a new certificate on
// every restart would force you to re-accept the browser's security
// warning every time, which defeats the point of persisting anything.
//
// This intentionally avoids requiring `openssl` on the host machine -
// generation happens inside the container using a pure-JS implementation,
// so it works identically whether the host is Windows, macOS, or Linux.

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const TLS_DIR = path.join(__dirname, '..', 'data', 'tls');
const CERT_PATH = path.join(TLS_DIR, 'cert.pem');
const KEY_PATH = path.join(TLS_DIR, 'key.pem');

function getOrCreateCertificate() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return {
      cert: fs.readFileSync(CERT_PATH, 'utf8'),
      key: fs.readFileSync(KEY_PATH, 'utf8'),
    };
  }

  fs.mkdirSync(TLS_DIR, { recursive: true });

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    days: 3650, // 10 years - this is a self-signed cert for a self-hosted tool, not something needing frequent rotation
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          { type: 7, ip: '127.0.0.1' }, // IP
        ],
      },
    ],
  });

  fs.writeFileSync(CERT_PATH, pems.cert, 'utf8');
  fs.writeFileSync(KEY_PATH, pems.private, 'utf8');

  console.log(`Generated a new self-signed TLS certificate at ${CERT_PATH}`);

  return { cert: pems.cert, key: pems.private };
}

module.exports = { getOrCreateCertificate };
