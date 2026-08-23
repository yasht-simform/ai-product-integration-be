# CloudPulse Security Best Practices

This guide covers recommended security configuration for CloudPulse workspaces, API usage, and
integrations.

## Authentication

CloudPulse supports three authentication methods:

1. **Email + password** — passwords must be at least 12 characters and are hashed with bcrypt
   (cost factor 12) before storage. CloudPulse never stores plaintext passwords.
2. **OAuth SSO** — Google and GitHub OAuth are available on all plans.
3. **SAML 2.0 / OIDC SSO** — available on the Enterprise plan only, allowing workspace admins to
   enforce login exclusively through a corporate identity provider (Okta, Azure AD, OneLogin, etc.)

We strongly recommend enabling **two-factor authentication (2FA)** for all workspace admins.
2FA can be enabled from **Settings → Security → Two-Factor Authentication** and supports both
TOTP apps (Google Authenticator, Authy) and SMS-based codes.

## API Key Management

- Treat API keys as secrets — never commit them to source control or client-side code.
- Use `cp_test_` keys during development; they operate against a sandbox workspace that resets
  nightly and cannot access production data.
- Rotate API keys at least every 90 days. Keys can be rotated without downtime by generating a new
  key, updating your integration, and revoking the old key once traffic has fully migrated.
- Scope keys to the minimum required permission level — CloudPulse supports `read-only`,
  `read-write`, and `admin` scopes per key.

## Encryption

All data in transit is encrypted with TLS 1.2 or higher; CloudPulse rejects TLS 1.0/1.1 connections
entirely as of 2025. Data at rest is encrypted using AES-256. Enterprise customers can additionally
request a customer-managed encryption key (CMEK) for their workspace's stored data.

## CORS Configuration

If you're building a browser-based integration against the CloudPulse API, note that the API does
**not** support arbitrary cross-origin requests from client-side JavaScript — CORS is restricted to
origins explicitly allow-listed per API key from **Settings → API Keys → Allowed Origins**. Server-
to-server requests (no `Origin` header) are unaffected by this restriction.

## Recommended HTTP Headers

When embedding CloudPulse content (e.g. board widgets) in your own application, set the following
headers on your own server to reduce clickjacking and injection risk:

```
Content-Security-Policy: frame-src https://app.cloudpulse.io
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=63072000; includeSubDomains
```

## Webhook Signature Verification

Every webhook payload includes an `X-CloudPulse-Signature` header, an HMAC-SHA256 signature of the
raw request body using your workspace's webhook secret. Always verify this signature before
processing a webhook payload — never trust an unverified payload, since webhook endpoints are
public URLs. Reject any request where the computed signature doesn't match, and reject requests
older than 5 minutes (checked via the `X-CloudPulse-Timestamp` header) to prevent replay attacks.

## Role-Based Access Control

CloudPulse workspaces support three roles: `admin`, `member`, and `viewer`.

- **Admins** can manage billing, invite/remove members, configure SSO, and delete the workspace.
- **Members** can create and edit boards and tasks but cannot access billing or security settings.
- **Viewers** have read-only access to boards and tasks.

Enterprise workspaces can additionally define custom roles with granular per-board permissions.

## Audit Logging

Enterprise workspaces have access to a full audit log (**Settings → Security → Audit Log**)
recording every login, permission change, API key creation/revocation, and data export. Audit logs
are retained for 2 years and can be exported as CSV or streamed to an external SIEM via webhook.

## Data Deletion

When a workspace is deleted, all associated data (boards, tasks, files, integration credentials)
is queued for permanent deletion after a 90-day grace period, matching the retention window
described in the Return & Refund Policy for canceled subscriptions.
