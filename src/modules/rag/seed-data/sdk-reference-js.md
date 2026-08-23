# CloudPulse Node.js SDK Reference

The official Node.js SDK wraps the CloudPulse REST API in a typed, promise-based client. It was
published alongside the public launch of the v1 API, in version 2.4.0 (2025-02-10).

## Installation

```bash
npm install @cloudpulse/sdk
```

The package is published on the public npm registry as `@cloudpulse/sdk` and has no required peer
dependencies.

## Creating a Client

Every SDK call is made through an instance of `CloudPulseClient`, constructed with your API key:

```javascript
const { CloudPulseClient } = require('@cloudpulse/sdk');

const client = new CloudPulseClient({
  apiKey: process.env.CLOUDPULSE_API_KEY,
});
```

Use a `cp_live_...` key for production data or a `cp_test_...` sandbox key (introduced in v3.2.0)
to exercise the SDK against a workspace that resets nightly without touching real data. The
`apiKey` option is the only required field; an optional `baseUrl` option exists for pointing the
client at a non-default API host during testing.

## Tasks

### `client.tasks.create(params)`

Creates a new task on a board.

```javascript
const task = await client.tasks.create({
  boardId: 'brd_123',
  title: 'Write Q3 release notes',
  assignee: 'dana@acme.com',
  dueDate: '2026-09-01',
  labels: ['docs', 'release'],
});

console.log(task.id); // "tsk_..."
```

### `client.tasks.list(params)`

Lists tasks, optionally filtered by `boardId`, `assignee`, `status`, or `dueBefore`. Results are
paginated using a **cursor**, not a page number:

```javascript
let cursor;
const allTasks = [];

do {
  const page = await client.tasks.list({ boardId: 'brd_123', cursor, limit: 50 });
  allTasks.push(...page.data);
  cursor = page.meta.hasMore ? page.meta.cursor : undefined;
} while (cursor);
```

Each response includes a `meta` object with `hasMore` (boolean) and, when `hasMore` is `true`, a
`cursor` value to pass into the next call. There is no way to jump directly to an arbitrary page —
cursor-based pagination only supports moving forward through the result set in order.

### `client.tasks.update(taskId, params)`

Updates one or more fields on an existing task. Only the fields included in `params` are changed;
omitted fields are left untouched.

### `client.tasks.delete(taskId)`

Permanently deletes a task.

## Boards

### `client.boards.create(params)`

Creates a new board in the authenticated workspace.

```javascript
const board = await client.boards.create({
  name: 'Q4 Planning',
  template: 'scrum',
});
```

`template` must be one of `'kanban'`, `'scrum'`, or `'blank'`.

### `client.boards.list(params)`

Lists boards in the workspace. Like `tasks.list()`, results are paginated with a cursor rather
than a page number.

## Error Handling

Every SDK method returns a rejected promise on a non-2xx API response. The rejection is an
instance of `CloudPulseApiError`, which carries the same `code`, `message`, and `requestId` fields
documented in the REST API's error format:

```javascript
try {
  await client.tasks.create({ boardId: 'brd_does_not_exist', title: 'Test' });
} catch (err) {
  if (err instanceof CloudPulseApiError) {
    console.error(err.code, err.message, err.requestId);
  }
}
```

## Rate Limiting

The SDK does not automatically throttle requests to stay under your plan's rate limit — if you
issue requests faster than your plan allows, the API will return `429 Too Many Requests` and the
SDK will surface that as a `CloudPulseApiError` with `code: 'rate_limit_exceeded'`, the same as a
raw `curl` call would. Applications making high volumes of calls should read the
`X-RateLimit-Remaining` header (exposed on the raw response via `response.headers` when needed)
and pace their own requests accordingly.
