# Tutorial: Connecting Slack to CloudPulse

In this tutorial you will connect your workspace's Slack team to CloudPulse, create tasks directly
from a Slack channel using a slash command, and see how task status changes automatically show up
as threaded replies. This takes about 5 minutes.

## What the Slack Integration Does

Once connected, CloudPulse posts a message into a Slack channel of your choosing whenever a task
changes status, and every subsequent status change on that same task is added as a **threaded
reply** underneath the original message — so a channel doesn't get flooded with a new top-level
message every time a task moves from In Progress to In Review to Done. The integration also adds a
slash command, `/cloudpulse create <title>`, that lets anyone in the channel create a new CloudPulse
task without leaving Slack.

## Before You Start

You'll need admin permissions in both your CloudPulse workspace and the Slack workspace you're
connecting, since installing a Slack app requires Slack workspace admin approval.

## Step 1: Open the Integrations Settings Page

From your CloudPulse workspace, click **Settings** in the sidebar, then select **Integrations**.
You'll see cards for each supported integration — Slack, GitHub, Jira, and Zapier.

## Step 2: Authorize the Slack App

Click **Connect** on the Slack card. This redirects you to Slack's own authorization screen, where
you confirm you want to install the CloudPulse app into your Slack workspace. Review the requested
permissions — CloudPulse asks to post messages and register the `/cloudpulse` slash command — and
click **Allow**. You're redirected back to CloudPulse once authorization completes.

## Step 3: Choose a Channel

After authorization, CloudPulse asks which Slack channel should receive task status updates. Pick an
existing channel, such as `#eng-updates`, or create a new one specifically for CloudPulse
notifications if you'd rather keep them separate from general team chatter. You can change this
channel later from the same Integrations page without disconnecting and reconnecting the whole
integration.

## Step 4: Create a Task with the Slash Command

Switch over to Slack and, in the channel you just connected (or any channel where the CloudPulse
app has been added), type:

```
/cloudpulse create Fix login redirect bug
```

Press Enter. CloudPulse creates a new task titled "Fix login redirect bug" on your workspace's
default board, in the Backlog column, and posts a confirmation message back into the Slack channel
with a link to the task. You didn't need to open the CloudPulse web UI or CLI at all — the whole
round trip happened inside Slack.

## Step 5: Watch a Status Change Post as a Threaded Reply

Open the task you just created (either by clicking the link Slack posted, or from the CloudPulse
web UI) and drag it from Backlog into In Progress. Switch back to Slack: instead of a brand-new
message appearing at the bottom of the channel, you'll see a **threaded reply** attached to the
original "task created" message, noting that the task moved to In Progress. Move the task again,
into In Review, and a second threaded reply appears under the same original message. This keeps a
task's entire history readable as one thread instead of scattering it across the channel.

## Step 6: Try It from an Existing Task

The slash command isn't the only way tasks and Slack interact — any task created through the CLI,
API, or web UI that lives on a board with Slack notifications enabled will also post its status
changes into the connected channel automatically, with no extra configuration needed per task.

## Troubleshooting

If `/cloudpulse create` returns "command not recognized," the Slack app may not have been added to
that specific channel — in Slack, type `/invite @CloudPulse` in the channel and try the slash
command again. If status updates stop appearing in the thread, check the Integrations page in
CloudPulse to confirm the Slack connection still shows as **Connected** rather than
**Disconnected** — Slack authorization tokens can be revoked from the Slack side (for example, if a
Slack admin removes the app), which silently breaks the integration until reconnected.

## What's Next

Now that Slack is wired up for task notifications, consider the **Linking GitHub Commits to Tasks**
tutorial to connect your code repository the same way, or the **Building Your First Zap with
CloudPulse** tutorial if you want to route CloudPulse events into tools beyond Slack and GitHub.
