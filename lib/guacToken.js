// Builds the encrypted token guacamole-lite expects on the websocket
// connection. This is what tells guacd which host/user/pass to connect to
// for a given browser session. The token is encrypted so the browser
// never sees the plaintext credentials, only an opaque blob it passes back.

const crypto = require('crypto');

function encryptGuacToken(value) {
  const key = process.env.GUAC_CRYPT_KEY;
  if (!key || key.length !== 32) {
    throw new Error('GUAC_CRYPT_KEY must be set in .env and be exactly 32 characters long');
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
  let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // guacamole-lite's Crypt.decrypt() does JSON.parse(base64decode(tokenString)) -
  // the token itself must be base64-encoded JSON, not raw JSON text. Skipping
  // this base64 layer (as an earlier version of this file did) causes every
  // connection to fail with "Token validation failed".
  const payload = JSON.stringify({ iv: iv.toString('base64'), value: encrypted });
  const base64Payload = Buffer.from(payload, 'utf8').toString('base64');
  return encodeURIComponent(base64Payload);
}

module.exports = { encryptGuacToken };
