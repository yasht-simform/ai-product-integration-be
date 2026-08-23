# CloudPulse Account FAQ

Answers to common questions about managing your personal account and workspace membership,
including changing your email, deleting your account, and transferring workspace ownership.

## How do I change the email address on my account?

Go to **Settings → Account → Email**, enter your new email address, and confirm the change via a
verification link sent to the new address. Your login email is not changed until you click the
verification link, so your old email continues to work for login until the switch is confirmed.
If you signed up via Google or GitHub SSO, your email is managed by that SSO provider and cannot
be changed directly within CloudPulse.

## What are the three roles a workspace member can have?

CloudPulse has exactly three roles: `admin`, `member`, and `viewer`. Admins can manage billing,
invite or remove members, configure SSO, delete the workspace, and transfer workspace ownership.
Members can create, edit, and delete boards and tasks but have no access to billing or security
settings. Viewers have read-only access to boards and tasks and cannot make any changes.

## How do I transfer ownership of a workspace?

Workspace ownership transfer is available only to users with the `admin` role, from
**Settings → Workspace → Transfer Ownership**. Select the member you want to transfer ownership to
(they must already be a workspace member) and confirm the transfer. The new owner immediately
gains full `admin` privileges, including billing access; the previous owner retains their existing
role unless it is separately changed.

## How long do team invite links stay valid?

Invite links expire 7 days after they're generated. If a link expires before the invitee accepts
it, an admin or member with invite permissions must generate a new invite link from
**Settings → Workspace → Members → Invite**.

## Can I delete my CloudPulse account?

Yes, from **Settings → Account → Delete Account**. Deleting your personal account removes your
login credentials and profile, but any workspace you were part of continues to exist for its
remaining members. If you are the sole `admin` of a workspace, you must transfer ownership or
delete the workspace first before your personal account can be deleted.

## What happens to workspace data after I delete an account or cancel a subscription?

Workspace data is retained for 90 days after subscription cancellation before permanent deletion —
deleting an account does not immediately erase workspace data; it is only permanently removed once
that 90-day retention window elapses. Reactivating the subscription within the 90-day window
restores full access with no data loss.

## Can I be a member of more than one workspace?

Yes. There's no limit on how many workspaces a single CloudPulse account can belong to as a member
or viewer. Workspace-level limits, such as the Free plan's cap of 10 workspaces per account, apply
to workspaces you own or create, not to workspaces you've been invited into by another admin.

## How do I remove a member from my workspace?

An `admin` can remove any member or viewer from **Settings → Workspace → Members**, next to the
member's name. Removing a member immediately revokes their access to all boards and tasks in that
workspace; it does not delete any tasks they created or were assigned, which remain in the
workspace.

## I forgot my password and don't use SSO. What do I do?

Click **Forgot Password** on the login page. A reset link is emailed to your account's email
address and expires after 1 hour. If the link expires before you use it, request a new one from
the same **Forgot Password** page.

## Can a `viewer` be upgraded to a `member` or `admin`?

Yes. Any `admin` of the workspace can change another member's role from
**Settings → Workspace → Members**. Role changes take effect immediately — a `viewer` upgraded to
`member` gains create/edit/delete access to boards and tasks as soon as the change is saved, with
no need to re-invite them.
