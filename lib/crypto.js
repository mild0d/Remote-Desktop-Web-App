// Encrypts/decrypts RDP passwords before they are stored in connections.json.
// Uses APP_SECRET_KEY (32 chars) from .env, separate from the key used
// to talk to guacd/guacamole-lite.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const key = process.env.APP_SECRET_KEY;
  if (!key || key.length !== 32) {
    throw new Error('APP_SECRET_KEY must be set in .env and be exactly 32 characters long');
  }
  return Buffer.from(key, 'utf8');
}

function encrypt(text) {
  if (text === null || text === undefined || text === '') return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(payload) {
  if (!payload) return '';
  const [ivB64, dataB64] = payload.split(':');
  if (!ivB64 || !dataB64) return '';
  const iv = Buffer.from(ivB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(dataB64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
