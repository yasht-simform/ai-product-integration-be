# CloudPulse Webhooks Reference

CloudPulse can push real-time notifications to an external URL whenever specific events occur in a
workspace. This document covers the supported events, how to verify that a delivered payload
genuinely came from CloudPulse, and the retry and auto-disable behavior for unreachable endpoints.

## Supported Events

| Event             | Fired when...                                        | Since  |
| ----------------- | ---------------------------------------------------- | ------ |
| `task.created`    | A new task is created on any board in the workspace. | v1     |
| `task.updated`    | Any field on an existing task changes.               | v1     |
| `task.completed`  | A task's status moves into the `Done` column.        | v1     |
| `task.deleted`    | A task is permanently deleted.                       | v1     |
| `board.created`   | A new board is created in the workspace.             | v2.8.0 |
| `comment.created` | A comment is added to a task.                        | v1     |

A single webhook subscription can be registered for one or more of these event types; CloudPulse
will only deliver events the subscription explicitly opted into.

## Verifying Webhook Signatures

Every webhook delivery includes an `X-CloudPulse-Signature` header. Its value is an
**HMAC-SHA256** digest of the raw, unparsed request body, computed using the signing secret that
was generated when the webhook was created. Verifying this signature is the only reliable way to
confirm that a request claiming to be from CloudPulse was not forged or replayed by a third party.

Because the signature is computed over the _raw_ body, always verify it before your framework
parses the JSON — re-serializing a parsed body will not reliably reproduce the exact bytes that
were signed.

### Node.js Example

```javascript
const crypto = require('crypto');

function verifyCloudPulseSignature(rawBody, signatureHeader, signingSecret) {
  const expected = crypto.createHmac('sha256', signingSecret).update(rawBody, 'utf8').digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHeader, 'hex'));
}

// Example usage in an Express raw-body route handler:
app.post('/webhooks/cloudpulse', express.raw({ type: 'application/json' }), (req, res) => {
  const isValid = verifyCloudPulseSignature(
    req.body, // raw Buffer, not parsed JSON
    req.header('X-CloudPulse-Signature'),
    process.env.CLOUDPULSE_WEBHOOK_SECRET,
  );

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);
  // ... handle event.type, event.data, etc.
  res.status(200).send('ok');
});
```

Using `crypto.timingSafeEqual` (rather than `===`) avoids leaking timing information that could
help an attacker guess a valid signature byte-by-byte.

## Retry Policy

If your endpoint does not respond with a `2xx` status code — or does not respond at all within a
reasonable timeout — CloudPulse retries the delivery using **exponential backoff**, for up to
**5 attempts spread over roughly 30 minutes**. Each failed attempt increases the delay before the
next retry, so the first retry happens quickly while later retries are spaced much further apart.

## Auto-Disable After Repeated Failures

The 5-attempt retry window applies to a single event delivery. Separately, CloudPulse tracks
**consecutive delivery failures across all events** sent to a given webhook endpoint. If an
endpoint fails **10 consecutive deliveries in a row** (each of which may itself have already
exhausted its own 5-attempt retry budget), the webhook subscription is automatically disabled.
A disabled webhook stops receiving new events entirely until a workspace admin manually
re-enables it from the webhook settings page — CloudPulse does not automatically re-enable a
disabled webhook once your endpoint recovers.

This two-tier behavior — per-event retries, plus a cumulative failure counter across events —
exists so that a single slow response doesn't trigger a full disable, while a genuinely broken or
permanently unreachable endpoint stops generating wasted delivery attempts after a bounded number
of failures.

## Managing Webhooks

Webhook subscriptions are managed via the `GET /v1/webhooks` and `POST /v1/webhooks` API
endpoints (see the API reference), or from the workspace's **Settings → Webhooks** page in the web
app. Each webhook has its own independently generated signing secret — rotating a webhook's secret
(from the same settings page) invalidates the old secret immediately, so any in-flight deliveries
signed with the previous secret will fail verification on the receiving end if they arrive after
rotation.
