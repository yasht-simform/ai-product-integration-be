# CloudPulse Security FAQ

Answers to common questions about compliance certifications, data protection, penetration testing,
and where CloudPulse hosts your data.

## Is CloudPulse SOC 2 certified?

CloudPulse maintains a SOC 2 Type II report covering security controls over an extended
observation period. The report is available on request to Enterprise customers — contact your
named account manager or `security@cloudpulse.io` to request a copy, typically under NDA. SOC 2
Type II reports are not available to Free or Pro customers.

## Is CloudPulse GDPR compliant?

Yes, CloudPulse is GDPR-compliant and offers a Data Processing Addendum (DPA) on request for any
customer subject to GDPR, regardless of plan tier. The DPA can be requested from
**Settings → Billing → Legal Documents** or by emailing `legal@cloudpulse.io`. GDPR data
portability (export) requests are fulfilled within 30 days of submission.

## How often does CloudPulse conduct penetration testing?

CloudPulse commissions an annual third-party penetration test covering the web application, API,
and underlying infrastructure. Findings are remediated according to severity, and a summary report
is made available to Enterprise customers on request as part of the SOC 2 Type II documentation
package.

## What data residency options are available?

Enterprise customers can choose between two hosting regions when provisioning a workspace: the US
region (`us-east-1`, the default for all plans) or the EU region (`eu-west-1`). Data residency
selection was introduced in v3.6.0 (released September 3, 2026) and is available only to Enterprise
customers — Free and Pro workspaces are always hosted in `us-east-1`. Once a workspace is
provisioned in a region, migrating it to the other region requires opening a support ticket with
your account manager; it is not a self-service action.

## How are passwords stored?

CloudPulse never stores passwords in plaintext. Passwords are hashed using bcrypt with a cost
factor of 12 before being persisted, and the plaintext password is never logged or transmitted to
any internal system after the initial hash is computed.

## Is data encrypted at rest?

Yes, all customer data at rest — including board content, task descriptions, comments, and file
attachments — is encrypted using AES-256.

## Does CloudPulse support two-factor authentication?

Yes. Two-factor authentication, supporting both TOTP authenticator apps and SMS codes, was added in
v2.7.0 and is available to all plan tiers, including Free. It can be enabled from
**Settings → Security → Two-Factor Authentication**.

## Does CloudPulse support single sign-on (SSO)?

SSO is an Enterprise-only feature. OIDC-based SSO has been available on Enterprise since the tier's
introduction, and SAML 2.0 support was added in v3.1.0. Both protocols can be configured from
**Settings → Workspace → SSO** by a user with the `admin` role.

## What happens to my data if I cancel my subscription?

Workspace data is retained for 90 days after cancellation before being permanently deleted,
matching the retention window described in the CloudPulse Subscription Return & Refund Policy.
Within that 90-day window, reactivating your subscription restores full access to the retained
data with no data loss.

## How long is a password reset link valid?

A password reset link is valid for 1 hour after it's requested. After that, the link expires and
you'll need to request a new one from the login page's **Forgot Password** flow.

## Who do I contact to report a security vulnerability?

Email `security@cloudpulse.io` with details of the suspected vulnerability. CloudPulse's security
team investigates all reports and, where a report leads to a fix, may credit the reporter in the
`status.cloudpulse.io` incident history at the reporter's discretion.
