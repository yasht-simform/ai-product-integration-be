# CloudPulse Search API Reference

CloudPulse provides a full-text search endpoint for finding tasks and comments across an entire
workspace, without needing to know which board a piece of content lives on. This document
describes the endpoint, its query parameters, and its filter syntax.

## Endpoint

```
GET /v1/search?q=<query>
```

This endpoint was added in version 3.5.0. Like every other endpoint under `/v1`, it requires a
valid bearer token in the `Authorization` header and is subject to the same per-plan rate limits
as the rest of the API (60/300/2,000 requests per minute for Free/Pro/Enterprise).

## What Gets Searched

The search endpoint indexes and searches three text fields across the workspace:

- Task **titles**
- Task **descriptions**
- **Comment** bodies

Search results are served from an Elasticsearch index maintained by the Search Service (see the
architecture overview), which is kept up to date via Kafka events rather than being queried
directly against Postgres — under normal load, a newly created task or comment becomes searchable
within a few seconds.

## Query Parameters

| Parameter | Required | Description                                                                            |
| --------- | :------: | -------------------------------------------------------------------------------------- |
| `q`       |    ✅    | The search text. Supports plain keywords as well as quoted-phrase syntax (see below).  |
| `type`    |    ❌    | Restricts results to one content type: `task` or `comment`. Omitting it searches both. |

## Filter Syntax

In addition to the `type` parameter, the `q` value itself supports two inline filters that narrow
results without requiring a separate query parameter:

- **`label:<name>`** — restricts results to tasks (or the tasks a comment belongs to) carrying the
  given label. For example, `q=label:billing` returns only content associated with tasks labeled
  `billing`.
- **`assignee:<email>`** — restricts results to tasks assigned to the given user. For example,
  `q=assignee:dana@acme.com` returns only tasks (and their comments) assigned to that user.

Both filters can be combined with free-text keywords and with each other in the same query, for
example:

```
GET /v1/search?q=webhook+retry+label:backend+assignee:priya@acme.com
```

This example searches for the keywords "webhook" and "retry", narrowed to tasks labeled `backend`
and assigned to `priya@acme.com`.

## Quoted-Phrase Search

Wrapping part of the `q` value in double quotes performs an **exact phrase match** rather than
matching each word independently. For example:

```
GET /v1/search?q="signature verification failed"
```

This returns only results where that exact three-word sequence appears, rather than results that
merely contain "signature", "verification", and "failed" somewhere in the text. Quoted-phrase
search can be combined with `label:`/`assignee:` filters and with additional unquoted keywords in
the same query.

## Example Request and Response

```bash
curl "https://api.cloudpulse.io/v1/search?q=%22rate+limit%22+type=task" \
  -H "Authorization: Bearer cp_live_a1b2c3d4e5f6"
```

```json
{
  "data": [
    {
      "type": "task",
      "id": "tsk_7f2a9c1d",
      "boardId": "brd_123",
      "title": "Handle 429 rate limit responses in retry middleware",
      "highlight": "...gracefully handle 'rate limit' errors from the API..."
    }
  ],
  "meta": { "total": 1 }
}
```

Each result includes a `highlight` field showing the matched snippet in context, in addition to
enough identifying information (`type`, `id`, and `boardId` for a task result) to fetch the full
resource with a follow-up request if needed.

## Relationship to List Endpoints

The search endpoint is not a replacement for `GET /tasks`'s own filters (`boardId`, `assignee`,
`status`, `dueBefore`) — those filters operate on structured task fields and are best suited to
building board views, while `GET /v1/search` is designed for free-text queries across titles,
descriptions, and comments spanning the whole workspace, independent of which board or column the
matching content lives in.
