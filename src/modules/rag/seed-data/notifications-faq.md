# CloudPulse Notifications FAQ

Answers to common questions about how CloudPulse delivers notifications and how to configure them.

## What channels does CloudPulse use to deliver notifications?

CloudPulse delivers notifications through three channels: email, in-app, and Slack. Slack
notifications support threaded replies, a capability added in v3.1.0 — before that release, Slack
notifications were posted as standalone messages without threading.

## Can I control notifications separately for each board?

Yes. Notification preferences are configurable per-board from **Settings → Notifications**. This
means you can, for example, receive real-time notifications for a high-priority board while muting
notifications entirely for a low-activity board, all within the same workspace.

## What is a digest email, and how do I turn one on?

A digest email is an optional summary of board activity, configurable per-board alongside your
other notification preferences under **Settings → Notifications**. You can choose either a daily
or a weekly digest cadence; digests are off by default and must be explicitly enabled per board.

## Can I use a digest email instead of real-time notifications?

Yes. Since digest cadence (daily or weekly) is a separate setting from real-time in-app, email, and
Slack notifications, you can disable real-time email notifications for a board while keeping a
daily or weekly digest enabled, giving you a lower-frequency summary instead of per-event alerts.

## Why aren't I receiving email notifications for a task I'm assigned to?

Check **Settings → Notifications** — email notifications can be disabled per-user and per-board.
Also confirm your email address is verified; an unverified email shows a banner on your profile and
blocks email notification delivery until verification is complete.

## Do notification preferences apply across email, in-app, and Slack equally?

Each of the three channels — email, in-app, and Slack — can be configured independently per board.
Disabling email notifications for a board does not automatically disable in-app or Slack
notifications for that same board; each channel's toggle is separate.

## Why did my Slack notifications suddenly stop working?

This is almost always caused by an expired Slack access token, which can happen if the CloudPulse
Slack app is uninstalled from the workspace, or if Slack's own token rotation runs. Reconnect the
integration from **Settings → Integrations → Slack** to restore notification delivery.

## Do notifications respect my workspace role?

Notification preferences are set per-user and per-board regardless of role — `admin`, `member`,
and `viewer` accounts all have access to the same **Settings → Notifications** configuration for
boards they can see. A `viewer` can still receive notifications about activity on boards they have
read access to, even though they cannot make edits themselves.

## Is there a limit to how many boards can have notifications enabled?

No. There is no cap on the number of boards you can configure notification preferences for — you
can independently set email, in-app, Slack, and digest preferences for every board you're a member
of, across every workspace you belong to.

## Are push notifications on mobile controlled by the same settings?

Yes. CloudPulse Mobile's push notifications (added in v3.5.0) follow the same per-board preferences
configured under **Settings → Notifications** on the web — there is no separate mobile-only
notification settings screen for choosing which boards trigger a push notification.
