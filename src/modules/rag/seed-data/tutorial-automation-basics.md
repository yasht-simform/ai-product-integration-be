# Tutorial: Creating Your First Automation Rule

In this tutorial you will build your first automation rule in CloudPulse — one that watches for a
condition on a task and automatically takes an action, so you and your team spend less time on
repetitive manual updates. This takes about 5 minutes.

## What Automation Rules Do

An automation rule has two parts: a **trigger condition** (what to watch for) and an **action**
(what to do when the condition is met). CloudPulse supports three action types: assigning a task to
a specific person, moving a task to a different column, and sending a notification. A common
example is "whenever a task is moved into the In Review column, notify the QA lead" — that's
exactly what you'll build below.

## Before You Start

You'll need an existing board with at least the four standard kanban columns (Backlog, In
Progress, In Review, Done). If you're on the Free or Pro plan, keep in mind that Pro allows up to
20 active automation rules per workspace; Enterprise has no limit. The Free plan does not include
automation, so you'll need at least a Pro subscription to complete this tutorial for real, though
the steps below are identical across plans once automation is available to you.

## Step 1: Open the Automation Settings Page

From your workspace, click **Settings** in the sidebar, then select **Automation**. This page lists
every automation rule currently active in the workspace, along with a toggle to enable or disable
each one without deleting it.

## Step 2: Start a New Rule

Click **New Rule** in the top-right corner of the Automation page. This opens the rule builder,
which is split into two sections: **When** (the trigger condition) and **Then** (the action).

## Step 3: Set the Trigger Condition

In the **When** section, choose the condition CloudPulse should watch for. For this tutorial,
select **Task moved to column** as the condition type, then choose **In Review** as the target
column. This means the rule will fire every time any task on the board is dragged (or moved via the
API or CLI) into the In Review column — regardless of which column it moved from.

You can combine this with additional filters if you want a narrower rule, such as restricting it to
tasks carrying a specific label, but a single column-based condition is enough for your first rule.

## Step 4: Choose the Action

In the **Then** section, select which of the three action types you want CloudPulse to perform:

- **Assign** — automatically sets (or reassigns) the task's assignee to a person you specify
- **Move column** — automatically moves the task to a different column, useful for chaining rules
- **Notify** — sends a notification to a specific person or the task's current assignee

For this tutorial, choose **Notify**, and set the recipient to your QA lead's email address. Add an
optional custom message, such as "A task just entered review — please take a look," which
CloudPulse includes in the notification.

## Step 5: Name and Save the Rule

Give the rule a descriptive name, such as "Notify QA on Review," so it's easy to recognize later on
the Automation page alongside any other rules you build. Click **Save Rule**. The rule is active
immediately — there's no separate publish step.

## Step 6: Test It

Go to your board and drag any task into the In Review column. Within a few seconds, the notification
you configured should arrive. If it doesn't show up, double-check that the rule's toggle on the
Automation page is switched on — rules can be paused without being deleted, and a paused rule looks
identical to an active one except for that toggle.

## Step 7: Keep an Eye on the 20-Rule Limit

As you build out more automation over time, the Automation page shows a running count of active
rules at the top, such as "7 of 20 rules active." On the Pro plan, once you hit 20 active rules,
you'll need to disable or delete an existing rule before creating a new one. Enterprise workspaces
don't show this limit at all, since automation rules are unlimited on that plan.

## What's Next

Once you're comfortable with a single trigger-and-action rule, try building a chain: one rule that
moves a task to In Review when all its subtasks are marked Done, and a second rule (exactly like
the one you just built) that notifies your QA lead the moment that move happens. For more ways to
reduce manual work across tools you already use, see the **Building Your First Zap with CloudPulse**
tutorial, which covers automation that spans outside CloudPulse entirely.
