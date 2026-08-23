# Tutorial: Using the Timeline View and Bulk Editing

In this tutorial you will switch a board into Timeline view to see tasks laid out on a Gantt-style
calendar, and then use bulk editing to update up to 100 tasks at once instead of clicking into each
one individually. Both features were added in CloudPulse v3.4.0. This takes about 5 minutes.

## What These Two Features Do

Timeline view replaces a board's usual column layout with a horizontal, Gantt-style calendar, where
each task appears as a bar positioned according to its due date, making it easy to spot scheduling
gaps or clashes at a glance rather than scrolling through columns. Bulk task editing lets you select
up to 100 tasks at once — whether from Timeline view or the standard board view — and change their
assignee, status, or due date in a single action instead of opening each task individually.

## Before You Start

You'll need a board with a reasonable number of tasks that already have due dates set, since
Timeline view positions tasks based on their due date — a task with no due date still shows up in
Timeline view, but grouped in an "Unscheduled" section rather than plotted on the calendar itself.

## Step 1: Switch a Board to Timeline View

Open any board and look for the view switcher near the top of the page — by default it's set to
**Board**. Click it and select **Timeline**. The layout changes from vertical columns to a
horizontal calendar, with dates running left to right along the top and each task rendered as a
bar spanning from its start date (or creation date, if no start date is set) to its due date.

## Step 2: Read the Gantt-Style Calendar

Each task bar is color-coded to match its current column — for example, tasks still in Backlog
might appear in gray while tasks in In Progress appear in blue, letting you visually separate status
from scheduling in the same view. Hovering over a bar shows a quick preview of the task's title,
assignee, and due date without needing to open it. If two tasks assigned to the same person overlap
in time, their bars stack on top of each other in that person's row, making scheduling conflicts
easy to spot.

You can zoom the calendar's time scale in or out using the controls in the top-right corner of
Timeline view — switching between a tighter weekly view for near-term planning and a wider
quarterly view for longer-range roadmapping.

## Step 3: Select Multiple Tasks for Bulk Editing

Whether you're in Timeline view or the standard Board view, hover over any task and a checkbox
appears in its top-left corner. Click the checkbox to select that task, then click checkboxes on
additional tasks to build up a selection — CloudPulse supports selecting up to 100 tasks at once.
As soon as one task is selected, a **bulk actions toolbar** appears at the bottom of the screen
showing how many tasks are currently selected.

A fast way to select many tasks at once is clicking the first task's checkbox, then holding Shift
and clicking a task further down the list — this selects every task in between, up to the 100-task
cap.

## Step 4: Bulk-Update Status

With several tasks selected, click **Change Status** in the bulk actions toolbar and choose a
target column, such as **In Review**. Confirm the action, and every selected task moves to that
column simultaneously — equivalent to dragging each card individually, but done in one step.

## Step 5: Bulk-Update Assignee

Click **Change Assignee** in the same toolbar, and pick a teammate from the dropdown. All selected
tasks are reassigned to that person at once — useful when redistributing a batch of work after a
team member goes on leave, for example.

## Step 6: Bulk-Update Due Date

Click **Change Due Date**, and pick a new date from the calendar picker. Every selected task's due
date updates to the same value — handy for pushing an entire batch of tasks back by a sprint when a
milestone slips, without having to open and edit each one.

## Step 7: Clear Your Selection

Once you're done, click **Clear Selection** in the bulk actions toolbar (or simply click anywhere
outside a task card) to deselect everything and return the toolbar to its hidden state.

## What's Next

Timeline view pairs well with due-date-driven automation — see the **Creating Your First Automation
Rule** tutorial for how to notify someone automatically as a due date approaches. If your team
regularly needs to reschedule large batches of work, combining bulk editing with saved filters (for
example, filtering to only overdue tasks before selecting them) makes recurring cleanup much faster
than working task by task.
