# Tutorial: Inviting Your Team and Assigning Roles

In this tutorial you will invite teammates to your CloudPulse workspace, choose the right role for
each person, and learn what to do when someone's invite link expires before they click it. This
takes about 5 minutes per batch of invites.

## Before You Start

You'll need a workspace already created (see the **Create Your First CloudPulse Board** tutorial
if you haven't made one yet) and the email addresses of the teammates you want to invite. Keep in
mind your plan's member limit: the Free plan allows up to 5 members per workspace, Pro allows 50,
and Enterprise is unlimited. If you're on Free and already at 5 members, you'll need to upgrade
before adding more.

## Step 1: Open the Team Settings Page

From inside your workspace, click **Settings** in the sidebar, then select **Team** from the
settings menu. This page lists every current member of the workspace along with their role and the
date they joined.

## Step 2: Start an Invite

Click **Invite Members** at the top of the Team page. A dialog opens with a text field for email
addresses — you can paste in multiple addresses separated by commas to invite several people at
once — and a role selector next to each address.

## Step 3: Choose the Right Role for Each Person

CloudPulse supports three roles, and choosing correctly up front saves you from having to fix
permissions later:

- **admin** — full control over the workspace, including billing, integrations, automation rules,
  and the ability to invite or remove other members. Reserve this for people who need to configure
  the workspace itself, not just work within it.
- **member** — can create and edit boards, tasks, and comments, but cannot change workspace-level
  settings like billing or integrations. This is the right choice for most individual contributors.
- **viewer** — read-only access. Viewers can see boards and tasks and leave comments, but cannot
  create or edit tasks themselves. This role suits stakeholders who need visibility without needing
  to make changes — for example, a manager who wants to track progress without touching the board.

Select a role for each address in the invite dialog, then click **Send Invites**.

## Step 4: What Happens Next

Each invited address receives an email containing a unique join link. When a teammate clicks the
link, they're prompted to create a CloudPulse account (if they don't already have one) and are
automatically added to your workspace with the role you assigned. **Invite links expire after 7
days** — if a teammate doesn't click the link within that window, they'll see an "invite expired"
message and won't be added to the workspace.

While an invite is pending, it shows up on the Team page with a status of **Pending** instead of a
join date, so you can see at a glance who hasn't accepted yet.

## Step 5: Resend an Expired Invite

If a week has passed and a teammate still hasn't joined, you don't need to guess whether the link
is still valid — the Team page tells you directly. Find the pending invite row (it will now show a
status of **Expired** rather than **Pending**), and click the **Resend** button next to it. This
generates a brand-new join link, valid for another 7 days from the moment you click Resend, and
sends it to the same email address. The role you originally selected carries over automatically, so
you don't need to re-choose admin, member, or viewer.

## Step 6: Adjust a Role After the Fact

Roles aren't fixed once someone joins. From the Team page, find the member's row and use the role
dropdown next to their name to change it — for example, promoting a `member` to `admin` once they
take on workspace configuration duties, or moving someone to `viewer` if they've shifted to a
stakeholder-only capacity. Only admins can change another member's role.

## What's Next

With your team invited and roles assigned, a good next step is setting up automation so that
incoming tasks get routed to the right person automatically — see the **Creating Your First
Automation Rule** tutorial. If you're connecting the team's existing tools, the **Connecting Slack
to CloudPulse** and **Linking GitHub Commits to Tasks** tutorials show how to wire up the
integrations your team is probably already using day to day.
