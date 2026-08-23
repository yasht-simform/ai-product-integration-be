# Tutorial: Setting Up a Webhook Receiver

In this tutorial you will register a webhook in CloudPulse, build a small Node.js/Express server
that receives it, and verify the request's `X-CloudPulse-Signature` header so you can be sure a
payload genuinely came from CloudPulse and wasn't forged. This takes about 15 minutes and assumes
basic familiarity with Node.js and Express.

## What Webhooks Are For

Rather than polling the CloudPulse API to check whether anything changed, a webhook lets CloudPulse
push a notification to a URL you control the moment something happens. CloudPulse supports six
webhook events: `task.created`, `task.updated`, `task.completed`, `task.deleted`, `board.created`,
and `comment.created`. Every webhook delivery is signed with an `X-CloudPulse-Signature` header —
an HMAC-SHA256 hash of the raw request body, computed using a signing secret only you and
CloudPulse know — so your receiver can verify the payload hasn't been tampered with and genuinely
originated from CloudPulse.

## Before You Start

You'll need Node.js 18 or later installed locally, and a way to expose a local server to the
internet for testing (a tunneling tool such as ngrok works well, since CloudPulse needs to reach
your receiver over a public URL).

## Step 1: Register a New Webhook

From your CloudPulse workspace, click **Settings** in the sidebar, then select **Webhooks**. Click
**New Webhook**. Enter the public URL where your receiver will be reachable, such as
`https://your-tunnel.ngrok.io/webhooks/cloudpulse`, and under **Events**, check the boxes for
`task.created` and `task.completed` — the two events this tutorial's receiver will handle.

## Step 2: Save the Signing Secret

After saving the webhook, CloudPulse shows a **signing secret** — a long random string — exactly
once. Copy it now; like an API key, you won't be able to view the full value again afterward. Store
it as an environment variable you'll reference from your receiver code:

```bash
export CLOUDPULSE_WEBHOOK_SECRET=whsec_your_actual_secret_here
```

## Step 3: Scaffold the Express Receiver

Create a new project and install Express:

```bash
mkdir cloudpulse-webhook-receiver && cd cloudpulse-webhook-receiver
npm init -y
npm install express
```

## Step 4: Write the Signature Verification Logic

Create `server.js`. The key detail here is that HMAC verification must run against the **raw**
request body bytes, not a parsed JSON object — so the raw body needs to be captured before Express's
JSON parser transforms it:

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

app.post('/webhooks/cloudpulse', (req, res) => {
  const signature = req.header('X-CloudPulse-Signature');
  const secret = process.env.CLOUDPULSE_WEBHOOK_SECRET;

  if (!signature || !isValidSignature(req.rawBody, signature, secret)) {
    console.warn('Rejected webhook: invalid signature');
    return res.status(401).send('Invalid signature');
  }

  const { event, data } = req.body;

  if (event === 'task.created') {
    console.log(`Task created: ${data.title} (${data.id})`);
  } else if (event === 'task.completed') {
    console.log(`Task completed: ${data.title} (${data.id})`);
  }

  res.status(200).send('OK');
});

app.listen(3000, () => console.log('Webhook receiver listening on port 3000'));
```

Using `crypto.timingSafeEqual` instead of a plain `===` comparison avoids leaking timing
information that could help an attacker guess a valid signature byte by byte.

## Step 5: Run the Receiver and Expose It Publicly

Start the server:

```bash
node server.js
```

In a separate terminal, start a tunnel pointing at port 3000 (using ngrok, for example), and update
your webhook's URL in CloudPulse's Webhooks settings page to match the tunnel's public address if it
changed since Step 1.

## Step 6: Trigger a Real Event

Create a task on any board in your workspace — through the web UI, CLI, or API, it doesn't matter
which. Within a few seconds, your terminal running `server.js` should log something like `Task
created: Fix login redirect bug (CP-142)`, confirming the webhook fired, the signature check
passed, and your handler correctly parsed the event.

## Step 7: Understand Automatic Disabling

CloudPulse tracks delivery failures per webhook — if your receiver is unreachable, returns a
non-2xx status, or times out. After **10 consecutive delivery failures**, CloudPulse automatically
disables the webhook entirely rather than continuing to retry indefinitely, and the Webhooks
settings page shows it with a status of **Disabled**. If this happens, fix whatever caused the
failures (a crashed server, an expired tunnel URL, or a bug in your signature check), then manually
re-enable the webhook from the same settings page — CloudPulse does not re-enable a disabled webhook
on its own.

## What's Next

Now that you can receive events reliably, consider subscribing to `comment.created` as well so your
receiver can relay new comments into a system CloudPulse doesn't natively integrate with — or revisit
the **Your First CloudPulse API Call** tutorial to build the other half of a two-way sync between
CloudPulse and your own systems.
