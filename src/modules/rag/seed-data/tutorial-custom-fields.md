# Tutorial: Adding Custom Fields to a Board

In this tutorial you will add three custom fields to a CloudPulse board — a text field, a dropdown
field, and a formula field that calculates a value from two other fields — so your tasks can carry
structured data beyond the built-in title, assignee, and due date. This takes about 10 minutes.

## What Custom Fields Are For

Every CloudPulse board ships with the standard task properties — title, assignee, due date, and
labels — but many teams need to track something more specific, like a client name, a priority
tier, or an estimated cost. Custom fields let you add exactly that, per board. CloudPulse supports
five field types: **text**, **number**, **dropdown**, **date**, and **formula**. A formula field
can compute a value from other numeric fields on the same task using basic arithmetic operators:
`+`, `-`, `*`, and `/`. Each board can have up to 20 custom fields.

## Before You Start

You'll need an existing board and, ideally, at least one task already on it so you can see the
custom fields populate in real time as you work through this tutorial.

## Step 1: Open the Board's Custom Fields Settings

Open the board you want to add fields to, then click the **Settings** icon in the board's top-right
corner (this is the board's own settings, separate from your workspace-level Settings). Select
**Custom Fields** from the menu. You'll see a list of any fields that already exist on the board,
plus an **Add Field** button.

## Step 2: Create a Text Field

Click **Add Field** and choose **Text** as the field type. Name it "Client Name." Text fields
accept any free-form string, so this is a good choice for information that doesn't fit a fixed set
of options — client names, external ticket references, or short notes. Click **Save** to add the
field to the board.

Once saved, every task on the board — new and existing — shows a "Client Name" field in its detail
panel, initially empty until someone fills it in.

## Step 3: Create a Dropdown Field

Click **Add Field** again, this time choosing **Dropdown** as the type. Name it "Priority Tier" and
add three options: "Low," "Medium," and "High." Unlike a text field, a dropdown field constrains
every task to one of the exact values you define — useful for anything you want to filter or report
on consistently, since there's no risk of one task saying "high priority" and another saying
"High-Pri" with no way to group them together. Click **Save**.

## Step 4: Add Two Number Fields to Support a Formula

A formula field needs existing numeric fields to operate on, so before creating one, add two number
fields: click **Add Field**, choose **Number**, and name it "Hours Estimated." Repeat once more with
type **Number** and name "Hourly Rate."

## Step 5: Create a Formula Field

Click **Add Field** one more time and choose **Formula** as the type. Name it "Estimated Cost." In
the formula editor, reference the two number fields you just created and multiply them:

```
{Hours Estimated} * {Hourly Rate}
```

Formula fields recalculate automatically whenever either input field changes — if someone updates
"Hours Estimated" from 10 to 15 on a task, "Estimated Cost" updates instantly without anyone touching
it directly. You could just as easily build a formula using `+`, `-`, or `/` instead of `*`,
depending on what you're calculating; all four operators are supported and can be combined in a
single formula, such as `({Hours Estimated} * {Hourly Rate}) - {Discount}`.

## Step 6: Fill In Values on a Task

Open any task on the board and confirm all four new fields appear in its detail panel: Client Name,
Priority Tier, Hours Estimated, and Hourly Rate, plus the read-only Estimated Cost field showing the
computed result. Enter a value for Hours Estimated (say, 20) and Hourly Rate (say, 75), and confirm
Estimated Cost immediately shows 1500 — proving the formula field is live rather than something you
need to manually recalculate.

## Step 7: Keep the 20-Field Limit in Mind

The Custom Fields settings page shows a running count, such as "5 of 20 fields," at the top. If a
board is approaching the limit, consider whether an existing field can be repurposed rather than
adding a new one — for instance, reusing a general-purpose "Category" dropdown instead of adding a
separate dropdown for every new use case.

## What's Next

Custom fields become especially powerful once combined with automation — see the **Creating Your
First Automation Rule** tutorial for how to trigger actions based on a task's properties, including
values held in custom fields like Priority Tier.
