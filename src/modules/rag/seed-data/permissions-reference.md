# CloudPulse Permissions Reference

CloudPulse uses a deliberately simple, three-role permission model at the workspace level. Every
member of a workspace holds exactly one of these three roles; there is no support for custom or
additional roles beyond the three described here.

## The Three Roles

- **Admin** — full control over the workspace, including billing, membership, and security
  configuration.
- **Member** — full control over the day-to-day work in the workspace (boards and tasks), but no
  access to billing, membership management, or security settings.
- **Viewer** — read-only access to boards and tasks, with the single exception that viewers can
  still add comments.

A workspace can have any number of members holding each role, and a single user's role can be
changed at any time by an admin from **Settings → Members**.

## Permission Matrix

| Capability                   | Admin | Member | Viewer |
| ---------------------------- | :---: | :----: | :----: |
| View boards and tasks        |  ✅   |   ✅   |   ✅   |
| Add comments                 |  ✅   |   ✅   |   ✅   |
| Create / edit boards         |  ✅   |   ✅   |   ❌   |
| Delete boards                |  ✅   |   ✅   |   ❌   |
| Create / edit / delete tasks |  ✅   |   ✅   |   ❌   |
| Invite / remove members      |  ✅   |   ❌   |   ❌   |
| Configure SSO                |  ✅   |   ❌   |   ❌   |
| Manage billing               |  ✅   |   ❌   |   ❌   |
| Delete workspace             |  ✅   |   ❌   |   ❌   |

## Admin

Admin is the only role with access to anything that affects the workspace as a whole rather than
its boards and tasks. This includes viewing and changing the billing plan, inviting or removing
team members (and changing their roles), configuring SSO (SAML 2.0 or OIDC, available on
Enterprise), and permanently deleting the entire workspace. Every workspace must have at least one
admin at all times — CloudPulse does not allow the last remaining admin to demote themselves or
be removed by another admin, to prevent a workspace from being left with no one able to manage it.

## Member

Member is the role most day-to-day contributors hold. Members can create, edit, and delete boards
and tasks freely — the full working surface of the product — but have no visibility into or
control over billing, membership, or SSO settings. A member who needs to invite a new teammate or
change the workspace's plan must ask an admin to do it on their behalf.

## Viewer

Viewer is the most restricted role, intended for stakeholders who need visibility into progress
without the ability to change anything. Viewers can open any board and task in the workspace and
read everything on it, and they can add comments to leave feedback — but they cannot create,
edit, or delete boards or tasks, and they have no access to membership, billing, or SSO settings,
identical to a member in that respect.

## Comparing Member and Viewer

Member and Viewer differ specifically in write access to the core work objects: a member can
create, edit, and delete both boards and tasks, while a viewer can only read boards and tasks and
add comments to them — a viewer has no ability to create or modify a board or task at all. Neither
role, however, has any of the admin-only workspace-management capabilities (billing, membership,
SSO, workspace deletion), so the meaningful distinction in practice is entirely about whether a
user can change the work itself, not about workspace administration.

## Role Assignment and API Keys

A member's role also governs what any API key generated under their account can do: an API key
inherits the permissions of the user who created it, so a key created by a viewer can read boards
and tasks and post comments via the API, but any attempt to create or delete a task through that
key is rejected with a `403 Forbidden` response, exactly as it would be if the viewer tried the
same action in the web app.
