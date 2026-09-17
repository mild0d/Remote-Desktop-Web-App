# Single sign-on (Microsoft Entra ID)

[← Back to README](../README.md)

Lets people sign in with their existing Microsoft/Entra account instead
of a separate app-specific password. This app never sees or handles their
actual credentials at any point - the entire authentication happens on
Microsoft's own login page, and this app only ever receives a signed
token back proving who they are afterward.

**Local login always stays available, for everyone, regardless of this
setting.** This is deliberate - SSO is additive, never a replacement. If
anything about the Entra side goes wrong, nobody is locked out; the app
behaves exactly as it did before this feature existed, with only the
"Sign in with Microsoft" button disappearing.

## Setting it up on the Entra side

1. In the [Azure Portal](https://portal.azure.com), go to **Microsoft
   Entra ID → App registrations → New registration**.
2. Give it any name (e.g. "RDP Web App"). Leave the default account type
   ("Accounts in this organizational directory only") unless you have a
   specific reason not to.
3. Under **Redirect URI**, select platform type **Web** and enter:
   ```
   https://your-actual-hostname/api/auth/sso/callback
   ```
   replacing `your-actual-hostname` with whatever hostname you actually
   use to reach this app (matching the certificate/DNS name you use
   today). This must match exactly, including `https://`.
4. Click **Register**. On the app's **Overview** page, note down the
   **Application (client) ID** and the **Directory (tenant) ID** - you'll
   need both in a moment.
5. Go to **Certificates & secrets → Client secrets → New client secret**.
   Give it a description and an expiration, then click **Add**. **Copy
   the secret's Value immediately** - it's only ever shown once, the same
   way this app's own recovery codes work.
6. (Recommended) Go to **Entra ID → Enterprise applications**, find this
   same app, and under **Properties**, set **Assignment required?** to
   **Yes**. Then under **Users and groups**, add exactly the people (or
   groups) who should be allowed to sign in this way. This restricts who
   can even reach this app at the identity-provider level, independent of
   anything configured here.

## Configuring it in this app

In **🛡️ Admin → 🔑 Single sign-on**, enter the **Tenant ID**, **Client
ID**, and **Client secret** from above, then check **Enable SSO login**
and save. The "Sign in with Microsoft" button will now appear on the
login page for everyone.

## How accounts get created

The first time someone signs in via SSO, an account is created for them
automatically (matching their email as the username, non-admin by
default) - there's no separate admin action needed to let a new person
in. This is safe specifically because access is expected to already be
restricted at the Entra level (step 6 above) - unlike a fully open door,
whoever can complete this flow at all has already been vetted by your
organization's own identity provider.

Once created, a person's account stays linked to their specific Entra
identity (not just their email, which can change) - if they show up
again later, they get the same account back rather than a duplicate.

## Two-factor authentication for SSO users

By default, SSO logins skip this app's own 2FA entirely - the usual
point of SSO is centralizing authentication policy (including MFA) at
the identity provider, not enforcing it a second time here. Whatever MFA
policy your organization already has configured in Entra applies as
normal.

An admin can override this per account, though, in **🛡️ Admin** - a
**"Require app 2FA"** checkbox appears next to each SSO account, for
anyone who wants real defense-in-depth beyond whatever Entra alone
considers sufficient (compromising both the Microsoft account *and* this
app's separate authenticator code becomes necessary, not just one).
This is purely admin-controlled - an SSO user can't turn it on for
themselves, only an admin can.

Turning it on for an account that's never set up 2FA before means their
very next login stops right after Microsoft confirms their identity,
requiring 2FA setup on the spot before they get real access - the same
mandatory flow local account registration already uses. From then on,
every login asks for the code too, on top of Microsoft's own
authentication. Turning the requirement back off only stops asking for
the code - it deliberately never deletes their actual 2FA setup, so
turning it back on later works immediately without them setting it up
again.

## Passwords for SSO accounts

SSO accounts have no usable local password - the one created internally
at auto-provisioning is a random placeholder nobody ever saw. So the
change-password control is hidden for them, and the admin panel won't
offer "Reset password" on them either (they show a small "SSO" badge
instead). All of this is enforced server-side too, not just hidden:
giving an SSO account a working local password would quietly create a
second way in that Entra doesn't control - including for someone who's
since been removed from Entra. If someone needs their password reset,
that happens in Entra, where their sign-in actually lives.

The person's own self-service 2FA button is hidden too, for the same
reason - but this is specifically about the *button*, not necessarily
the feature. If an admin has required this app's own 2FA for a
particular SSO account (see above), that's a genuinely separate,
app-managed second factor - distinct from whatever MFA policy Entra
itself enforces, and reset the same way a local account's would be (an
admin can disable it for them in the admin panel if they lose access to
their authenticator).

## If something goes wrong

Uncheck **Enable SSO login** in the admin panel and save - this
immediately removes the "Sign in with Microsoft" button and disables the
login/callback routes, with zero effect on local accounts or anyone
already using them. There's no scenario where an Entra-side problem locks
someone out of local login.
