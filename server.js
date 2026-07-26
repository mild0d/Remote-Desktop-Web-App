require('dotenv').config();

const path = require('path');
const https = require('https');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const GuacamoleLite = require('guacamole-lite');

const { requireLogin, requireAdmin } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const connectionRoutes = require('./routes/connections');
const filesRoutes = require('./routes/files');
const adminRoutes = require('./routes/admin');
const adRoutes = require('./routes/ad');
const { getOrCreateCertificate } = require('./lib/tls');
const { ensureAtLeastOneAdmin } = require('./lib/users');
const { register: registerSession, unregister: unregisterSession } = require('./lib/activeSessions');

ensureAtLeastOneAdmin();

const app = express();

// Off by default - only enable this (via TRUST_PROXY=true in .env) if this
// app is genuinely running behind a trusted reverse proxy (e.g. Traefik,
// nginx). Without a real proxy in front, blindly trusting the
// X-Forwarded-For header would let anyone connecting directly just spoof
// their own IP in that header, defeating rate limiting and making the
// audit log's IP field meaningless. With trust set, req.ip correctly
// reflects the real client IP as reported by the proxy instead of the
// proxy's own IP.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Helmet's default Content-Security-Policy would block this app's own
// frontend outright - the whole thing is built as inline <script
// type="module"> blocks rather than external .js files, and CSP's default
// script-src only permits same-origin *files*, not inline script content.
// scriptSrc is relaxed here specifically for that reason - a real
// limitation of this app's current structure, not a default we're
// casually loosening. Everything else keeps Helmet's normal secure
// defaults: style-src and img-src already permit the inline styles and
// data: URIs (thumbnails, QR codes) this app uses without needing any
// override, and script-src-attr stays at its secure 'none' default now
// that the one inline event-handler attribute in this app (an onerror on
// thumbnail images) has been replaced with a real addEventListener.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

app.use(express.json({ limit: '10mb' })); // base64 PNG screenshots exceed the 100kb default
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      secure: true, // only sent over HTTPS, which is now the only mode this app serves
      sameSite: 'lax', // blocks cross-site POST/PUT/DELETE requests from ever carrying this cookie,
      // while still allowing normal same-site navigation - the standard recommended
      // default for session cookies (stricter than leaving this unset entirely, without
      // 'strict''s occasional UX friction on direct/bookmarked links)
    },
  })
);

// Auth routes (login/register/logout/me) are open; everything else under
// /api requires a session.
app.use('/api/auth', authRoutes);
app.use('/api/connections', requireLogin, connectionRoutes);
app.use('/api/files', requireLogin, filesRoutes);
app.use('/api/admin', requireLogin, requireAdmin, adminRoutes);
app.use('/api/ad', requireLogin, adRoutes);

// Serve the guacamole-common-js ESM build so it can be `import`ed directly
// by the inline <script type="module"> in index.html.
app.use(
  '/vendor/guacamole-common-js',
  express.static(path.join(__dirname, 'node_modules', 'guacamole-common-js', 'dist', 'esm'), {
    setHeaders: (res) => res.setHeader('Content-Type', 'application/javascript'),
  })
);

// Self-hosted Bootstrap (not a CDN) so the UI still works without internet
// access from the browser - this app is meant to run on trusted local/LAN
// networks where that shouldn't be assumed.
app.use('/vendor/bootstrap/css', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css')));
app.use('/vendor/bootstrap/js', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js')));

// This must come BEFORE express.static below - static would otherwise serve
// index.html directly for "/" without ever hitting the login gate.
app.get('/', requireLogin, (req, res, next) => next());

app.use(express.static(path.join(__dirname, 'public')));

const { cert, key } = getOrCreateCertificate();
const server = https.createServer({ cert, key }, app);

// guacd connection details (in Docker Compose this is the "guacd" service name)
const guacdOptions = {
  host: process.env.GUACD_HOST || '127.0.0.1',
  port: parseInt(process.env.GUACD_PORT || '4822', 10),
};

// guacamole-lite decrypts the token the browser sends on the websocket
// using this same key/cipher, then opens the RDP connection via guacd.
const clientOptions = {
  crypt: {
    cypher: 'AES-256-CBC',
    key: process.env.GUAC_CRYPT_KEY,
  },
};

// Attaches its own websocket server to the same HTTP server, on path /webtunnel
const guacServer = new GuacamoleLite({ server, path: '/webtunnel' }, guacdOptions, clientOptions);

// Tracks currently-open sessions for the admin "active sessions" view and
// force-disconnect. clientConnection.connectionSettings is the same
// decrypted token payload we built in routes/connections.js - since it
// tolerates arbitrary extra fields alongside `connection`, the user/
// connection metadata we embedded there is available here directly.
guacServer.on('open', (clientConnection) => {
  const meta = clientConnection.connectionSettings || {};
  registerSession(clientConnection.connectionId, {
    user_id: meta.user_id,
    username: meta.username,
    connection_id: meta.connection_id,
    connection_name: meta.connection_name,
    hostname: meta.hostname,
    started_at: new Date().toISOString(),
    clientConnection,
  });
});

guacServer.on('close', (clientConnection) => {
  unregisterSession(clientConnection.connectionId);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`RDP web app listening on https://localhost:${PORT}`);
  console.log('Using a self-signed certificate - your browser will show a security warning the first time; this is expected.');
});
