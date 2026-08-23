# CloudPulse Troubleshooting FAQ

Common issues and their solutions, organized by category.

## Login & Authentication

### Why does the CLI say `ERR_AUTH_TIMEOUT`?

The CLI runs a temporary local server on port 8734 to receive the OAuth login callback. If that
port is blocked by a firewall or already in use, login times out after 60 seconds. Free the port
or set `CLOUDPULSE_AUTH_PORT` to an alternate port before retrying.

### I forgot my password. How do I reset it?

Click **Forgot Password** on the login page at `app.cloudpulse.io/login`. A reset link is emailed
within 2 minutes and expires after 1 hour. If you signed up via Google or GitHub SSO, there is no
CloudPulse password to reset — use the SSO provider's own account recovery instead.

### Why am I getting `401 Unauthorized` on every API call?

Your API key may have been revoked or expired. API keys do not expire automatically, but they are
revoked if unused for 12 consecutive months. Generate a new key from **Settings → API Keys**.

## Billing

### My card was charged but the plan didn't upgrade. What happened?

This is usually a webhook delay between the payment processor and CloudPulse's billing system,
which typically resolves within 5 minutes. If your plan hasn't updated after 15 minutes, contact
`billing@cloudpulse.io` with your charge ID.

### Can I get a refund after the 30-day window?

Refund requests after 30 days are evaluated case-by-case by the billing team — see the Return &
Refund Policy document for the full policy. Annual plans are prorated after 30 days, minus a 10%
early-cancellation fee.

### Why was my workspace suspended?

Workspaces are suspended for two reasons: a failed payment after 3 retry attempts over 7 days, or
an active chargeback dispute. Check **Settings → Billing** for the specific reason and next steps.

## Boards & Tasks

### I deleted a task by accident. Can I recover it?

Deleted tasks remain in the workspace trash for 30 days and can be restored from
**Settings → Trash**. After 30 days, tasks are permanently deleted and cannot be recovered, even
via the API or by contacting support.

### Why can't I create a 4th board on the Free plan?

The Free plan is capped at 3 boards per workspace. Upgrade to Pro for unlimited boards, or delete
an existing board to free up a slot.

### Task assignees aren't receiving email notifications. Why?

Check **Settings → Notifications** — email notifications can be disabled per-user. Also confirm
the assignee's email is verified (a banner appears on their profile if it isn't).

## Integrations

### My GitHub integration stopped linking commits to tasks.

This is almost always caused by a revoked GitHub OAuth grant. Reconnect from
**Settings → Integrations → GitHub → Reconnect**. Commit messages must include the task ID in
square brackets, e.g. `[CP-142]`, to be linked.

### Slack notifications suddenly stopped working.

Slack access tokens expire if the CloudPulse Slack app is uninstalled from the workspace, or if
Slack's own token rotation runs (every 12 hours for some workspace tiers). Reconnect from
**Settings → Integrations → Slack**.

## API & Webhooks

### Why am I getting `429 Too Many Requests`?

You've exceeded your plan's rate limit (60/min Free, 300/min Pro, 2,000/min Enterprise). Check the
`Retry-After` header and back off accordingly. Consider batching requests or upgrading your plan.

### My webhook isn't firing.

Verify the webhook URL responds with a `2xx` status within 5 seconds — CloudPulse disables
webhooks automatically after 10 consecutive delivery failures. Re-enable a disabled webhook from
**Settings → Webhooks**.

## Performance

### The web app feels slow with large boards.

Boards with more than 2,000 tasks can experience UI slowdown in the browser. We recommend
archiving completed tasks older than 90 days, or splitting very large boards into multiple boards
linked by a shared label.

### Is there a status page for outages?

Yes — `status.cloudpulse.io` shows real-time uptime for the API, web app, and webhook delivery
pipeline, along with historical incident reports.
