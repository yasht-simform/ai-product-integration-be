# CloudPulse REST API Reference

Base URL: `https://api.cloudpulse.io/v1`

All CloudPulse API requests must be made over HTTPS. Requests over plain HTTP are rejected with a
`426 Upgrade Required` response.

## Authentication

CloudPulse uses bearer token authentication. Generate an API key from
**Settings → API Keys → Generate New Key**. Include it in the `Authorization` header on every
request:

```bash
curl https://api.cloudpulse.io/v1/boards \
  -H "Authorization: Bearer cp_live_a1b2c3d4e5f6"
```

API keys are scoped to a single workspace and inherit the permissions of the user who created
them. Keys prefixed `cp_live_` work against production data; keys prefixed `cp_test_` work against
a sandbox workspace that resets nightly.

## Rate Limits

Rate limits are enforced per API key, using a sliding one-minute window:

| Plan       | Requests per minute | Burst allowance |
| ---------- | ------------------- | --------------- |
| Free       | 60                  | 10              |
| Pro        | 300                 | 50              |
| Enterprise | 2,000               | 200             |

When a rate limit is exceeded, the API responds with `429 Too Many Requests` and a `Retry-After`
header indicating the number of seconds to wait before retrying. Every response also includes
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

## Endpoints

### `GET /boards`

Lists all boards in the authenticated workspace. Supports `page` and `limit` query parameters
(default `limit=20`, max `limit=100`).

### `POST /boards`

Creates a new board.

```json
{
  "name": "Q1 Roadmap",
  "template": "kanban"
}
```

Returns `201 Created` with the new board object, including its generated `id` (format `brd_xxx`).

### `GET /tasks`

Lists tasks. Accepts filters `boardId`, `assignee`, `status`, and `dueBefore`.

### `POST /tasks`

Creates a task on a board.

```json
{
  "boardId": "brd_123",
  "title": "Set up CI pipeline",
  "assignee": "jane@acme.com",
  "dueDate": "2026-02-01"
}
```

### `PATCH /tasks/:id`

Updates a task's fields. Only the fields present in the request body are changed.

### `DELETE /tasks/:id`

Deletes a task permanently. This action cannot be undone via the API — deleted tasks are not
recoverable after 30 days even from the workspace trash.

### `GET /webhooks`

Lists configured webhook subscriptions for the workspace.

### `POST /webhooks`

Registers a new webhook. CloudPulse supports the event types `task.created`, `task.updated`,
`task.completed`, and `board.created`. Webhook payloads are signed with HMAC-SHA256 using your
workspace's webhook secret, sent in the `X-CloudPulse-Signature` header.

## Pagination

List endpoints return a `meta` object:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 143, "hasMore": true }
}
```

## Error Format

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Task 'tsk_999' does not exist",
    "requestId": "req_8f3a2b1c"
  }
}
```

Common error codes include `invalid_api_key` (401), `insufficient_permissions` (403),
`resource_not_found` (404), `rate_limit_exceeded` (429), and `internal_error` (500).

## SDKs

Official SDKs are published for Node.js (`@cloudpulse/sdk`), Python (`cloudpulse-python`), and Go
(`github.com/cloudpulse/cloudpulse-go`). All three wrap the REST API described above and handle
retries with exponential backoff automatically.

## Versioning

The current API version is `v1`. Breaking changes are only introduced in a new version prefix
(e.g. `v2`), and CloudPulse commits to supporting each version for at least 18 months after the
next version's release.
