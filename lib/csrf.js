// CSRF protection, layered on top of the SameSite=Lax session cookie
// already in place - that alone blocks most cross-site request forgery,
// but this adds an explicit, verifiable second layer using the
// double-submit cookie pattern.
//
// csrf-csrf (actively maintained) rather than the more commonly-known
// csurf, which is archived/no longer maintained - verified via the npm
// registry before choosing this, the same way ldapjs was ruled out
// earlier in this project for the same reason.

const { doubleCsrf } = require('csrf-csrf');

const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'change-this-session-secret',
  getSessionIdentifier: (req) => req.session.id,
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

module.exports = { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError };
