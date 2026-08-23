# CloudPulse Integrations Guide

CloudPulse connects to Slack, GitHub, Jira, and Zapier out of the box. All integrations are
configured from **Settings → Integrations** and are available starting on the Pro plan (Free
workspaces can connect Slack only, in read-only notification mode).

## Slack

### Setup

1. Go to **Settings → Integrations → Slack → Connect**.
2. Authorize the CloudPulse Slack app for your Slack workspace.
3. Choose a default channel for board notifications, or configure per-board channels from each
   board's **Settings → Notifications**.

### What Gets Posted

By default, Slack receives a message when a task is created, completed, or reassigned. As of
version 3.1.0, task status changes post as **threaded replies** to the original task message
instead of new top-level messages, to reduce channel noise.

### Slash Commands

The Slack app supports `/cloudpulse create <title>` to create a task in the default board directly
from Slack, and `/cloudpulse status <task-id>` to check a task's current status without leaving
Slack.

## GitHub

### Setup

1. Go to **Settings → Integrations → GitHub → Connect** and authorize the CloudPulse GitHub App
   for the relevant organization or repositories.
2. Select which repositories to link — you can link multiple repositories to a single workspace.

### Linking Commits and Pull Requests

Include a task ID in square brackets in a commit message or PR title, e.g. `[CP-142] Fix login
timeout`, and CloudPulse automatically links that commit or PR to task `CP-142`. When a linked pull
request is merged, the task automatically moves to the "In Review" column if it's on a `kanban`
template board.

Note: linking works for squash-merged PRs as of version 2.9.0 — earlier versions only recognized
individual commit messages, not the squash-merge commit message GitHub generates.

## Jira

### Setup

Jira sync is configured from **Settings → Integrations → Jira → Connect**, using an Atlassian
OAuth grant scoped to a specific Jira project.

### Sync Behavior

As of version 2.8.0, Jira sync is **two-way**: creating or updating a task in CloudPulse creates or
updates the linked Jira issue, and vice versa. Prior to 2.8.0, sync was import-only (Jira →
CloudPulse). Sync runs on a 5-minute polling interval; there is no instant webhook-based sync for
Jira due to Atlassian API rate limit constraints.

### Field Mapping

CloudPulse task fields map to Jira issue fields as follows: `title` → `summary`,
`description` → `description`, `assignee` → `assignee`, `status` → a configurable status mapping
you define during setup (since CloudPulse and Jira workflows rarely match one-to-one).

## Zapier

CloudPulse's official Zapier integration launched in version 2.6.0 with 15 triggers (e.g. "New
Task Created", "Task Status Changed") and 10 actions (e.g. "Create Task", "Update Task Status").
Zapier access requires a Pro or Enterprise API key connected during the Zap setup flow.

Common Zaps customers build include: creating a CloudPulse task from a new Typeform response,
posting a Discord message when a task is completed, and syncing completed tasks into a Google
Sheet for reporting.

## Webhooks (Build Your Own Integration)

If none of the built-in integrations fit your workflow, register a custom webhook from
**Settings → Integrations → Webhooks → Add Webhook**, subscribing to any of `task.created`,
`task.updated`, `task.completed`, or `board.created`. See the API Reference guide for the webhook
payload signature format (`X-CloudPulse-Signature`, HMAC-SHA256).

## Disconnecting an Integration

Disconnecting an integration from **Settings → Integrations** immediately revokes its OAuth grant
and stops all future syncing, but does not delete data already synced (e.g. previously-linked
GitHub commits stay linked to their tasks).
