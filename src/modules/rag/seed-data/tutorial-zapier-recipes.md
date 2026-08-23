# Tutorial: Building Your First Zap with CloudPulse

In this tutorial you will connect CloudPulse to Zapier and build a working Zap that fires an action
in another app every time a new task is created in CloudPulse. This takes about 10 minutes and
requires a Zapier account (a free Zapier plan is enough to complete this tutorial).

## What the Zapier Integration Offers

CloudPulse's Zapier app exposes 15 triggers and 10 actions, letting you connect CloudPulse to
thousands of other apps without writing any code. A trigger is an event in CloudPulse that starts a
Zap — such as "New Task Created" — and an action is what happens as a result, either inside
CloudPulse (like creating a task from another app's event) or in a different app entirely (like
posting a Slack message or creating a Trello card). This tutorial builds one of the most common
recipes: CloudPulse's "New Task Created" trigger connected to a Slack "Send Channel Message" action.

## Before You Start

You'll need a Zapier account and, if you want your Zap to actually post somewhere, a Slack
workspace you're able to connect (any messaging or task app among Zapier's supported actions works
just as well if you'd rather substitute one in).

## Step 1: Connect the CloudPulse App to Zapier

Log into Zapier and click **Create Zap**. In the trigger app search box, type "CloudPulse" and
select it from the results. Zapier will prompt you to connect your CloudPulse account — click
**Sign in to CloudPulse**, which opens an OAuth authorization screen. Approve access, and you're
returned to Zapier with your CloudPulse account connected.

## Step 2: Choose the "New Task Created" Trigger

With the CloudPulse app selected, choose **New Task Created** from the list of available triggers.
Zapier asks you to pick which workspace (and optionally which specific board) should be watched —
select the workspace you want this Zap to monitor. If you leave the board field blank, the trigger
fires for new tasks across every board in the workspace; narrowing it to one board is useful once
you have several Zaps that should each watch something different.

## Step 3: Test the Trigger

Click **Test trigger**. Zapier fetches a recent task from your CloudPulse workspace to use as sample
data for the rest of the Zap-building process. If you don't have any tasks yet, create one quickly
from the CloudPulse web UI or CLI first, then come back and re-run the test.

## Step 4: Choose Your Action App

Click the **+** button to add an action step, and search for the app you want to trigger something
in — for this tutorial, search for "Slack" and select it. Zapier will ask you to connect your Slack
account the same way you connected CloudPulse in Step 1, via an OAuth authorization screen.

## Step 5: Choose the "Send Channel Message" Action

From Slack's available actions, choose **Send Channel Message**. Select which channel the message
should post to, and build the message text using CloudPulse's sample task data from Step 3 — for
example:

```
New CloudPulse task created: {{Title}}
Assigned to: {{Assignee Email}}
```

Zapier lets you insert any field from the triggering CloudPulse task (title, assignee, due date,
labels, and so on) directly into the message by clicking the field name from the trigger data
panel.

## Step 6: Test the Action

Click **Test step**. Zapier sends a real message to the Slack channel you selected using the sample
task data — check Slack to confirm the message arrived and looks the way you expect. If the
formatting isn't right, go back and adjust the message template, then test again.

## Step 7: Turn the Zap On

Once the test message looks correct, name your Zap something recognizable, such as "New CloudPulse
Task → Slack Notification," and click the **Publish** (or **Turn on Zap**) toggle. From this point
on, every new task created in the workspace (or board) you selected in Step 2 automatically posts a
Slack message, with no further action needed from you.

## Step 8: Verify It End to End

Create a new task in CloudPulse — either from the web UI, the CLI, or the API — and check the
connected Slack channel within a minute or two. You should see the message post automatically,
confirming the whole chain works outside of Zapier's test mode.

## What's Next

Fifteen triggers and ten actions leave plenty of other recipes to explore — try swapping the action
in this tutorial for **Create Trello Card** instead of a Slack message, or building a second Zap
using a different trigger, such as "Task Completed," to close the loop back into CloudPulse from
another app.
