# Team Management in CloudPulse

This guide covers user roles, permissions, inviting team members, and configuring SSO for your
CloudPulse workspace.

## Roles

Every workspace member is assigned exactly one role:

- **Admin** — full access: billing, member management, SSO configuration, workspace deletion, and
  all board/task permissions.
- **Member** — can create, edit, and delete boards and tasks, and connect integrations. Cannot
  access billing or security settings.
- **Viewer** — read-only access to all boards and tasks the workspace grants them visibility into.
  Cannot create, edit, or comment.

A workspace must always have at least one Admin — CloudPulse blocks demoting or removing the last
remaining admin from **Settings → Team**.

## Seat Limits by Plan

| Plan       | Max team members |
| ---------- | ---------------- |
| Free       | 5                |
| Pro        | 50               |
| Enterprise | Unlimited        |

Viewers do not count against the Free and Pro seat limits — only Admin and Member roles consume a
seat.

## Inviting Team Members

1. Go to **Settings → Team → Invite Members**.
2. Enter one or more email addresses, comma-separated.
3. Select a role for the batch (you can change individual roles later).
4. Click **Send Invites**.

Invited members receive an email containing a join link. The link expires after **7 days** — if it
expires, an admin must resend the invite from **Settings → Team → Pending Invites**.

## Removing Team Members

Admins can remove a member from **Settings → Team → Members → Remove**. Removing a member
immediately revokes their access to all boards and API keys they created remain active but
attributed to a "removed user" — admins should manually revoke any API keys created by a departing
member as a separate step.

## Board-Level Permissions

By default, all Members and Viewers can see all boards in a workspace. Admins can restrict a
specific board to a subset of members from the board's **Settings → Access** panel, switching it
from "workspace visible" to "restricted" and adding individual members or a role.

## Single Sign-On (SSO)

SSO is available on the **Enterprise plan only** and supports both SAML 2.0 and OIDC.

### Setting Up SAML SSO

1. From **Settings → Security → SSO**, click **Configure SAML**.
2. CloudPulse displays an Assertion Consumer Service (ACS) URL and an Entity ID to enter into your
   identity provider (Okta, Azure AD, OneLogin, etc.).
3. Upload your identity provider's metadata XML, or manually enter the SSO URL and X.509
   certificate.
4. Test the connection using the **Test SSO Login** button before enforcing it workspace-wide.
5. Once verified, toggle **Enforce SSO** to require all members to authenticate via SSO — this
   disables email/password login for the workspace (admins retain a break-glass recovery option).

### Just-in-Time Provisioning

When SSO is enabled, CloudPulse can automatically create accounts for new users on first login
(JIT provisioning), assigning them a default role configured in **Settings → Security → SSO →
Default Role for New SSO Users**.

### SCIM User Provisioning

Enterprise workspaces can additionally enable SCIM 2.0 to sync user provisioning and de-
provisioning directly from the identity provider, so removing a user in Okta automatically removes
their CloudPulse access within a few minutes, without an admin needing to do so manually in
CloudPulse.

## Team Activity

Admins can view a per-member activity summary from **Settings → Team → Activity**, showing task
completions, comments, and login history for the last 90 days (or unlimited history on Enterprise,
via the full Audit Log).
