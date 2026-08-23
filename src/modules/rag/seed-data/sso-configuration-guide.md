# Configuring SSO for CloudPulse Enterprise

Single sign-on lets your identity provider control who can authenticate into CloudPulse, instead of
relying on individually managed CloudPulse passwords. SSO is available exclusively on the
Enterprise plan — it is not available on Free or Pro workspaces. CloudPulse supports two SSO
protocols: SAML 2.0, most commonly used with providers like Okta and Azure AD, and OIDC, which is
the recommended path for Google Workspace. This guide walks through both.

## Before You Start

You'll need:

- An Enterprise workspace with the `admin` role (SSO configuration is an admin-only setting — it is
  not exposed to the `member` or `viewer` roles)
- Administrative access to your identity provider (Okta, Azure AD, Google Workspace, or another
  SAML 2.0/OIDC-compliant provider)
- Two fixed CloudPulse values you'll need to enter into your identity provider, regardless of which
  provider you use:

  | Field     | Value                                         |
  | --------- | --------------------------------------------- |
  | ACS URL   | `https://app.cloudpulse.io/sso/saml/callback` |
  | Entity ID | `https://app.cloudpulse.io/sso/saml/metadata` |

## SAML 2.0 Setup with Okta

1. In the Okta Admin Console, create a new SAML 2.0 application integration.
2. Set the **Single sign-on URL** (Okta's name for the ACS URL) to
   `https://app.cloudpulse.io/sso/saml/callback`.
3. Set the **Audience URI (SP Entity ID)** to `https://app.cloudpulse.io/sso/saml/metadata`.
4. Under attribute statements, map at minimum an `email` attribute to the user's Okta email — this
   is how CloudPulse matches an authenticated SSO session to an existing workspace member.
5. Assign the application to the Okta groups or individuals who should be able to sign in via SSO.
6. From Okta's application setup page, copy the **Identity Provider metadata URL** (or download the
   metadata XML) and paste it into CloudPulse's workspace SSO settings under
   **Settings → Security → SSO**.
7. Save, then test with a single test user before enabling SSO enforcement workspace-wide.

## SAML 2.0 Setup with Azure AD

1. In the Azure Active Directory admin center, create a new **Enterprise Application** and choose
   "non-gallery application," then configure single sign-on as **SAML**.
2. Under **Basic SAML Configuration**, set the **Reply URL (Assertion Consumer Service URL)** to
   `https://app.cloudpulse.io/sso/saml/callback`.
3. Set the **Identifier (Entity ID)** to `https://app.cloudpulse.io/sso/saml/metadata`.
4. Under **Attributes & Claims**, confirm the `emailaddress` claim maps to the user's Azure AD
   email (this is Azure AD's default claim mapping, so it usually needs no change).
5. Download the **Federation Metadata XML** from the app's SAML setup page and upload it into
   CloudPulse's **Settings → Security → SSO** page.
6. Assign users or groups to the enterprise application in Azure AD.
7. Test with one account before turning on SSO enforcement for the whole workspace.

Both providers follow the same underlying shape: your identity provider needs the ACS URL and
Entity ID above, and CloudPulse needs your provider's metadata (either a URL or an XML document) in
return.

## OIDC Setup for Google Workspace

For workspaces standardized on Google Workspace, OIDC is the recommended alternative to SAML 2.0 —
Google Workspace supports OIDC natively and it generally requires less manual field-mapping than a
SAML integration.

1. In CloudPulse's **Settings → Security → SSO** page, choose **OIDC** instead of SAML as the
   protocol.
2. In the Google Cloud Console, create an OAuth 2.0 client ID for a web application.
3. Add `https://app.cloudpulse.io/sso/saml/callback` as an authorized redirect URI — CloudPulse
   uses the same callback endpoint for both SAML and OIDC flows.
4. Copy the generated **Client ID** and **Client Secret** into CloudPulse's OIDC configuration
   fields.
5. Restrict sign-in to your Google Workspace domain in the OAuth consent screen configuration, so
   personal Gmail accounts outside your organization can't authenticate against your CloudPulse
   workspace.

## Enforcing SSO

Once a test login succeeds for at least one account, an `admin` can enable SSO enforcement from the
same **Settings → Security → SSO** page. With enforcement on, workspace members are required to
authenticate through the configured identity provider rather than a CloudPulse password — existing
members who haven't yet linked their identity-provider account are prompted to do so on their next
login.

## Troubleshooting

- **Login redirects back to CloudPulse with an error immediately after IdP authentication** — the
  ACS URL or Entity ID in your identity provider's configuration doesn't exactly match the values
  above; check for trailing slashes or protocol mismatches (`http` vs `https`).
- **User authenticates successfully but isn't matched to a CloudPulse account** — confirm the
  `email` (SAML) or default profile email (OIDC) attribute matches the email address the user was
  invited to the CloudPulse workspace with.
- **Need to roll back** — disabling SSO enforcement from the same settings page immediately restores
  password-based login for all members; it does not delete the underlying SSO configuration, so it
  can be re-enabled without redoing the identity-provider setup.

SSO configuration, like all Enterprise security settings, is scoped to the `admin` role only — it
is one of the specific admin-only capabilities alongside billing management and workspace deletion.
