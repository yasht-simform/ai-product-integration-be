# CloudPulse API FAQ

Answers to common questions about authenticating with, paginating through, and versioning against
the CloudPulse API.

## What is the base URL for the CloudPulse API?

All CloudPulse API requests are made against `https://api.cloudpulse.io/v1`. This has been the
stable v1 base URL since the API's public launch in v2.4.0 on February 10, 2025.

## How do I authenticate API requests?

The CloudPulse API uses Bearer token authentication. Generate an API key from
**Settings → API Keys**, then include it in the `Authorization` header of every request as
`Authorization: Bearer <your-api-key>`. There is no alternative authentication scheme (no basic
auth, no query-string API keys) supported by the `/v1` API.

## What are sandbox API keys, and how are they different?

Sandbox API keys are prefixed `cp_test_` and were introduced in v3.2.0. They let you test API
integrations against a non-production environment without affecting real workspace data. A sandbox
key is generated from the same **Settings → API Keys** screen as a live key — look for the
`cp_test_` prefix to confirm you're using a sandbox key rather than a production one.

## Do API keys expire?

API keys do not expire automatically based on age, but they are revoked if unused for 12
consecutive months. If a key stops working unexpectedly, check whether it's been more than a year
since its last use, and generate a replacement from **Settings → API Keys** if so.

## How does pagination work in the CloudPulse API?

The API uses cursor-based pagination via `cursor` and `limit` query parameters, with the response
including a `meta.hasMore` field to indicate whether additional pages exist. In v3.1.x and earlier,
a bug caused `meta.hasMore` to incorrectly report `true` on the final page of results; this was
fixed in v3.2.0, so pagination should be considered fully reliable from that version onward.

## How do I know how many requests I have left before hitting the rate limit?

Every API response includes an `X-RateLimit-Remaining` header, added in v3.1.0, showing how many
requests remain in your current rate-limit window. Rate limits vary by plan: 60 requests/minute on
Free, 300 requests/minute on Pro, and 2,000 requests/minute on Enterprise.

## What happens if I exceed my rate limit?

Exceeding your plan's rate limit returns a `429 Too Many Requests` response. Check the
`Retry-After` header on the 429 response and back off accordingly before retrying — repeatedly
retrying without honoring `Retry-After` does not increase your effective throughput and simply
triggers more 429 responses.

## Is the legacy `/v0/tasks` endpoint still available?

No. `GET /v0/tasks` was removed as a breaking change in v3.0.0, released January 8, 2026. Any
request to that endpoint after that release returns a 404. All task-related operations should use
the equivalent endpoints under `/v1`.

## Will CloudPulse ever introduce breaking changes to the current API without a version bump?

No. CloudPulse's versioning policy guarantees that breaking changes are only ever shipped in a new
major version — `/v1` has not had a breaking change since its launch in v2.4.0, and any future
breaking change would ship as a new major version (e.g. `/v2`) rather than altering `/v1`'s
existing behavior.

## Are there official client libraries for the API?

Yes. Node.js, Python, and Go SDKs were published alongside the v1 API's public launch in v2.4.0
(February 10, 2025), and all three are kept up to date with `/v1`'s ongoing non-breaking additions,
such as new response headers and optional fields.

## Can I use the API to build a custom integration beyond the built-in ones?

Yes. Beyond the built-in Slack, GitHub, Jira, and Zapier integrations, Enterprise customers can
also purchase custom integration development support (starting at $2,000 one-time) for
integrations built directly against the `/v1` API and its Node.js, Python, or Go SDKs.
