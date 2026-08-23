# Tutorial: Your First CloudPulse API Call

In this tutorial you will generate an API key, use it to create a task with a raw `curl` request
against the CloudPulse REST API, and then make the identical call using the Node.js SDK instead.
This takes about 10 minutes and assumes basic familiarity with the command line.

## What You'll Be Calling

Every CloudPulse API request goes to the base URL `https://api.cloudpulse.io/v1`, and every
authenticated request needs a Bearer token in the `Authorization` header. In this tutorial you'll
call `POST /tasks` — the same endpoint the CLI and web UI use internally when you create a task
through them.

## Step 1: Generate an API Key

From your CloudPulse workspace, click **Settings** in the sidebar, then select **API Keys**. Click
**Generate New Key**, give it a descriptive name such as "Quickstart Tutorial," and click **Create**.
CloudPulse shows the full key exactly once — copy it immediately and store it somewhere safe, such
as a password manager or a local `.env` file, since you won't be able to view the full value again
afterward (only a masked version stays visible on the API Keys page).

If you'd rather not risk touching production data while learning the API, generate a **sandbox**
key instead by toggling **Sandbox Mode** before clicking Create — sandbox keys are prefixed
`cp_test_` (as opposed to live keys, which carry no special prefix) and only operate against a
sandbox copy of your workspace that resets periodically.

## Step 2: Store the Key as an Environment Variable

To avoid pasting your key directly into commands (and accidentally leaking it into your shell
history or a screenshot), export it as an environment variable:

```bash
export CLOUDPULSE_API_KEY=cp_test_your_actual_key_here
```

## Step 3: Make Your First Call with curl

With the key exported, create a task using `curl`:

```bash
curl -X POST https://api.cloudpulse.io/v1/tasks \
  -H "Authorization: Bearer $CLOUDPULSE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"boardId": "brd_123", "title": "Set up staging environment"}'
```

Replace `brd_123` with a real board ID from your own workspace — you can find a board's ID in its
URL or by listing boards with `GET /boards`. A successful call returns a `201 Created` response
with a JSON body describing the new task, including its generated task ID (something like
`CP-201`) and its default column, Backlog.

## Step 4: Check Your Rate Limit

Every response includes rate-limit headers so you can see how much request budget you have left.
Keep in mind your plan's ceiling: 60 requests per minute on Free, 300 on Pro, and 2,000 on
Enterprise. If you're scripting a bulk import, watch these headers rather than guessing at delays
between requests.

## Step 5: Repeat the Call with the Node.js SDK

Now let's make the exact same request using CloudPulse's Node.js SDK instead of raw `curl`. First,
install it:

```bash
npm install @cloudpulse/sdk
```

Then, in a small script:

```javascript
const { CloudPulseClient } = require('@cloudpulse/sdk');

const client = new CloudPulseClient({
  apiKey: process.env.CLOUDPULSE_API_KEY,
});

async function main() {
  const task = await client.tasks.create({
    boardId: 'brd_123',
    title: 'Set up staging environment',
  });

  console.log(`Created task ${task.id} in column ${task.column}`);
}

main();
```

Run it:

```bash
node create-task.js
# Created task CP-202 in column Backlog
```

The SDK handles the `Authorization` header, JSON serialization, and base URL for you — everything
you did manually with `curl` in Step 3 happens under the hood here, which is why most teams switch
to the SDK once they move past initial experimentation.

## Step 6: Confirm the Task Exists

Open your workspace in the browser and navigate to the board matching `brd_123`. Both tasks you
just created — one via `curl`, one via the SDK — should appear in the Backlog column, proving both
approaches hit the same underlying API.

## What's Next

Now that you can create tasks programmatically, the **Setting Up a Webhook Receiver** tutorial
shows the reverse direction — having CloudPulse notify your own server the moment a task changes,
instead of your code polling the API for updates.
