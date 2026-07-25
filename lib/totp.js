// Wraps otplib (TOTP generation/verification) and qrcode (QR code image
// generation) with a clean interface, based on directly testing the
// actual installed library APIs rather than assuming them.

const otplib = require('otplib');
const QRCode = require('qrcode');

function generateSecret() {
  return otplib.generateSecret();
}

// otplib.verifySync THROWS on malformed input (empty string, non-numeric,
// wrong length, null/undefined) rather than returning { valid: false } -
// confirmed by direct testing. Since this receives raw user input from a
// login form, it must never let a throw escape and crash the request.
function verifyToken(secret, token) {
  if (!secret || !token) return false;
  try {
    const result = otplib.verifySync({ secret, token: String(token) });
    return Boolean(result && result.valid);
  } catch (err) {
    return false;
  }
}

async function generateQrCodeDataUrl(username, secret) {
  const uri = otplib.generateURI({ issuer: 'RDP Web App', label: username, secret });
  return QRCode.toDataURL(uri);
}

module.exports = { generateSecret, verifyToken, generateQrCodeDataUrl };
