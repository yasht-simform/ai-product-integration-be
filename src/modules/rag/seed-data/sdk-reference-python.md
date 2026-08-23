# CloudPulse Python SDK Reference

The official Python SDK provides a typed client for the CloudPulse REST API, following Python's
`snake_case` naming conventions throughout rather than mirroring the API's camelCase JSON fields
directly. It was published alongside the v1 API's public launch, in version 2.4.0 (2025-02-10),
the same release that introduced the Node.js and Go SDKs.

## Installation

```bash
pip install cloudpulse-sdk
```

The package is published on PyPI as `cloudpulse-sdk` and supports Python 3.9 and later.

## Creating a Client

```python
from cloudpulse import CloudPulseClient

client = CloudPulseClient(api_key="cp_live_a1b2c3d4e5f6")
```

The `api_key` keyword argument is required. As with the Node.js SDK, a `cp_test_` prefixed key
routes requests to a nightly-reset sandbox workspace instead of production data.

## Tasks

### `client.tasks.create(**kwargs)`

```python
task = client.tasks.create(
    board_id="brd_123",
    title="Write Q3 release notes",
    assignee="dana@acme.com",
    due_date="2026-09-01",
    labels=["docs", "release"],
)

print(task.id)  # "tsk_..."
```

Note that every field name uses `snake_case` (`board_id`, `due_date`) even though the underlying
REST API accepts `boardId`/`dueDate` in camelCase — the SDK translates between the two
conventions transparently.

### `client.tasks.list(**kwargs)`

```python
cursor = None
all_tasks = []

while True:
    page = client.tasks.list(board_id="brd_123", cursor=cursor, limit=50)
    all_tasks.extend(page.data)
    if not page.meta.has_more:
        break
    cursor = page.meta.cursor
```

Like the Node.js SDK, pagination is cursor-based: each `list()` call returns a `meta.has_more`
flag and, when true, a `meta.cursor` value to pass into the next call to continue forward through
the result set.

### `client.tasks.update(task_id, **kwargs)`

Updates only the fields explicitly passed as keyword arguments; any field not included in the
call is left unchanged on the task.

### `client.tasks.delete(task_id)`

Permanently deletes a task. This mirrors the REST API's `DELETE /tasks/:id` — deleted tasks are
not recoverable through the SDK any more than they are through a raw API call.

## Boards

### `client.boards.create(**kwargs)`

```python
board = client.boards.create(name="Q4 Planning", template="scrum")
```

`template` accepts `"kanban"`, `"scrum"`, or `"blank"` — passing any other string raises a
`CloudPulseValidationError` locally, before the SDK even sends a request, since template names are
validated client-side.

### `client.boards.list(**kwargs)`

Lists boards in the authenticated workspace, using the same cursor-based pagination as
`tasks.list()`.

## Error Handling

All SDK methods raise a `CloudPulseApiError` on a non-2xx response, exposing `.code`, `.message`,
and `.request_id` attributes that mirror the REST API's JSON error body:

```python
from cloudpulse.errors import CloudPulseApiError

try:
    client.tasks.create(board_id="brd_does_not_exist", title="Test")
except CloudPulseApiError as err:
    print(err.code, err.message, err.request_id)
```

## Method Naming Compared to the Node.js SDK

The Python and Node.js SDKs expose an identical set of resources and methods —
`client.tasks.create()`, `client.tasks.list()`, `client.boards.create()`, and so on — so switching
between the two mainly means switching naming conventions rather than relearning the API surface.
Where the Node.js SDK takes a single object argument (`client.tasks.create({ boardId, title })`),
the Python SDK takes keyword arguments directly (`client.tasks.create(board_id=..., title=...)`),
and every multi-word field name is written in `snake_case` instead of `camelCase`. Both SDKs
translate their respective naming convention to and from the REST API's camelCase JSON on the
wire, so the two clients are fully interoperable against the same workspace.
