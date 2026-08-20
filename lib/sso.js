// Wraps openid-client (actively maintained, verified via the npm
// registry before choosing it) for Entra ID SSO. All security-critical
// work - JWT signature verification against Entra's published keys,
// issuer/audience checks, nonce/state validation - is handled internally
// by the library itself via authorizationCodeGrant()/tokens.claims();
// this module's job is only to correctly orchestrate the flow around it.

const client = require('openid-client');

// discovery() makes a real network call to fetch Entra's OIDC metadata
// (authorization endpoint, token endpoint, signing keys) - caching this
// avoids redoing that on every single login attempt. Cleared whenever
// the admin saves new SSO settings, since a changed tenant/client
// invalidates whatever was previously discovered.
let cachedConfig = null;
let cachedForTenantAndClient = null;

function clearCache() {
  cachedConfig = null;
  cachedForTenantAndClient = null;
}

async function getOidcConfig(ssoConfig) {
  const cacheKey = `${ssoConfig.tenantId}:${ssoConfig.clientId}`;
  if (cachedConfig && cachedForTenantAndClient === cacheKey) return cachedConfig;

  const issuerUrl = new URL(`https://login.microsoftonline.com/${ssoConfig.tenantId}/v2.0`);
  const config = await client.discovery(
    issuerUrl,
    ssoConfig.clientId,
    undefined,
    client.ClientSecretPost(ssoConfig.clientSecret)
  );

  cachedConfig = config;
  cachedForTenantAndClient = cacheKey;
  return config;
}

// Builds the URL to redirect the user's browser to, so they authenticate
// directly with Microsoft. Returns the redirect URL alongside the state,
// nonce, and PKCE verifier the caller must stash in the user's own
// session before redirecting - all three get checked back against the
// callback response, and per the library's own guidance, must be
// randomly generated fresh for every single authorization request.
async function buildAuthorizationRedirect(ssoConfig, redirectUri) {
  const config = await getOidcConfig(ssoConfig);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url: url.toString(), state, nonce, codeVerifier };
}

// Exchanges the authorization code for tokens and returns the validated
// ID token claims. currentUrl must be the exact callback URL as received
// (including its query string, where the code/state actually live).
// expectedState/expectedNonce/codeVerifier must be exactly what
// buildAuthorizationRedirect returned for this same login attempt - a
// mismatch here is exactly the CSRF/replay protection this flow relies on.
async function handleCallback(ssoConfig, currentUrl, { expectedState, expectedNonce, codeVerifier }) {
  const config = await getOidcConfig(ssoConfig);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    expectedNonce,
  });

  return tokens.claims();
}

module.exports = { buildAuthorizationRedirect, handleCallback, clearCache };
