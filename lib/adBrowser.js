// Wraps ldapts (actively maintained - verified this isn't the case for the
// more commonly-known `ldapjs`, which is officially decommissioned) for
// browsing Active Directory one level at a time: sub-OUs to drill into,
// and computer objects (servers/workstations) available to import.

const { Client } = require('ldapts');

async function withClient(config, fn) {
  let tlsOptions;
  if (config.url.startsWith('ldaps://')) {
    if (config.skipCertValidation) {
      // Explicit, admin-chosen opt-out - not the default behavior.
      tlsOptions = { rejectUnauthorized: false };
    } else if (config.caCert) {
      // Validates the AD server's certificate against the admin-provided
      // CA (e.g. their internal AD Certificate Services root) - this is
      // real validation, not a bypass. rejectUnauthorized stays at
      // Node's secure default (true) here.
      tlsOptions = { ca: config.caCert };
    }
    // If neither is set, tlsOptions stays undefined - Node's default TLS
    // behavior applies, which means validating against its built-in
    // trusted root store. For a typical internal AD deployment using a
    // private CA, this will correctly FAIL until the admin either
    // provides that CA's certificate above, or explicitly opts out of
    // validation - it does not silently downgrade to an insecure
    // connection.
  }

  const client = new Client({
    url: config.url,
    connectTimeout: 5000,
    tlsOptions,
  });

  try {
    await client.bind(config.bindDN, config.bindPassword);
    return await fn(client);
  } finally {
    try {
      await client.unbind();
    } catch (err) {
      // Best-effort - the connection may already be closed/broken by this point.
    }
  }
}

// Just proves the bind credentials actually work, without browsing anything.
async function testConnection(config) {
  await withClient(config, async () => true);
}

// Returns the immediate children (one level, not the whole subtree) of the
// given DN - sub-OUs to drill into, and computer objects available to
// import. Deliberately does NOT pass an explicit `attributes` filter to
// the search - confirmed by direct testing that requesting specific
// attribute names hits a casing-sensitivity bug in ldapts's client-side
// response parsing (e.g. requesting "dNSHostName" explicitly silently
// returned empty, while requesting everything and reading the same field
// off the full response worked correctly). Fetching everything and
// parsing client-side avoids that fragility entirely.
async function browseChildren(config, parentDN) {
  const baseDN = parentDN || config.baseDN;

  return withClient(config, async (client) => {
    const { searchEntries } = await client.search(baseDN, {
      scope: 'one',
      filter: '(|(objectClass=organizationalUnit)(objectClass=computer))',
    });

    return searchEntries
      .map((entry) => {
        const rawClasses = entry.objectClass || entry.objectclass || [];
        const objectClasses = Array.isArray(rawClasses) ? rawClasses : [rawClasses];
        const isOU = objectClasses.includes('organizationalUnit');

        return {
          dn: entry.dn,
          type: isOU ? 'ou' : 'computer',
          name: isOU ? entry.ou || entry.name : entry.name || entry.cn,
          dnsHostName: entry.dNSHostName || null,
          operatingSystem: entry.operatingSystem || null,
        };
      })
      .sort((a, b) => {
        // OUs first (folders before files, like a normal file browser), then alphabetical
        if (a.type !== b.type) return a.type === 'ou' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      });
  });
}

module.exports = { testConnection, browseChildren };
