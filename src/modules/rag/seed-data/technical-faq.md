# CloudPulse Technical FAQ

Answers to common technical questions about browser support, offline capability, and how the
CloudPulse API's versioning policy works.

## Which browsers does the CloudPulse web app support?

The web app officially supports the latest 2 versions of Chrome, Firefox, Safari, and Edge. Older
browser versions may work but are not tested or guaranteed, and CloudPulse support cannot
troubleshoot rendering or functionality issues on unsupported browser versions. There is no
Internet Explorer support of any kind.

## Does the web app work offline?

No. The CloudPulse web app requires an active internet connection at all times and has no offline
mode. This is a deliberate distinction from CloudPulse Mobile (v3.5.0 and later), which supports
read-only offline board viewing with sync-on-reconnect for edits made while offline — that
capability exists only on the iOS and Android apps, not in the browser.

## What happens if I lose connectivity while using the web app?

Any unsaved edits in progress (for example, typing a task description) may be lost if the
connection drops before the change is saved to the server, since the web app has no local offline
store to fall back to. CloudPulse recommends the mobile app for scenarios where connectivity is
expected to be unreliable, such as working during a commute.

## How does CloudPulse version its API?

The CloudPulse API follows a strict versioning policy: breaking changes are only ever shipped in a
new major version. The current version, v1, has been stable at `https://api.cloudpulse.io/v1` since
its public launch in v2.4.0 (February 10, 2025) — no breaking change has been introduced to v1
since that release. Non-breaking additions, such as new response headers or new optional fields,
are added to v1 continuously without a version bump.

## What was the most recent breaking API change?

The legacy `GET /v0/tasks` endpoint was removed as a breaking change in v3.0.0, released
January 8, 2026. Any integration still calling `/v0/tasks` after that release began receiving 404
responses. All current integrations should use the `/v1` endpoints, which have never had a
comparable breaking removal.

## Are there official SDKs for the API?

Yes. Node.js, Python, and Go SDKs were published alongside the v1 API's public launch in v2.4.0
(February 10, 2025). All three SDKs are maintained in lockstep with the `/v1` API and reflect
non-breaking additions (like new headers or fields) as soon as they ship.

## Is there a command-line interface?

Yes, the `@cloudpulse/cli` npm package provides a CLI for common operations, including
authentication (`cloudpulse login --workspace <slug>`) and data export (`cloudpulse export`). The
login command opens a temporary local server on port 8734 to receive the OAuth callback from your
browser.

## Where can I check the status of the CloudPulse platform?

`status.cloudpulse.io` shows real-time uptime for the API, web app, and webhook delivery pipeline,
along with a history of past incidents. Enterprise customers additionally receive an SLA of 99.9%
uptime with service credits for qualifying downtime, tracked against this same status page's
historical data.

## Does CloudPulse support webhooks?

Yes. Webhook endpoints must respond with a `2xx` status within 5 seconds of delivery; a webhook is
automatically disabled after 10 consecutive delivery failures and must be re-enabled manually from
**Settings → Webhooks** once the underlying issue is fixed.

## Why do large boards feel slow in the browser?

Boards with more than 2,000 tasks can experience UI slowdown in the web app, since all task data
for a board is loaded into the browser at once with no offline/local caching layer to fall back on.
Archiving tasks older than 90 days or splitting a large board into multiple linked boards typically
resolves the slowdown.
