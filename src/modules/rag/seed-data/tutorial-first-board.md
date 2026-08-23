# Tutorial: Create Your First CloudPulse Board

In this tutorial you will sign up for CloudPulse, create a workspace, install the CLI, spin up
your first board from a template, and add a task both from the command line and from the web UI.
By the end you'll have a working kanban board with one task sitting in the Backlog column. This
takes about 10 minutes.

## What you'll need

- A web browser and an email address to sign up with
- Node.js version 18 or later, if you want to follow the CLI steps (Node 20 LTS is recommended)
- 10 minutes of uninterrupted time

## Step 1: Sign Up for a Free Account

Go to `app.cloudpulse.io/signup` and create an account with your email address. CloudPulse's Free
plan costs $0 and includes up to 5 members per workspace, 3 boards, and 60 requests per minute
against the API — more than enough to complete this tutorial. You don't need a credit card to sign
up for Free.

## Step 2: Create Your Workspace

Immediately after signing up, CloudPulse asks you to create a **workspace** — the top-level
container that holds your boards, tasks, and team members. Enter a workspace name, for example
"My First Team," and CloudPulse derives a URL slug from it, such as
`app.cloudpulse.io/w/my-first-team`. Write this slug down — you'll use it in the next step to log
in from the CLI.

## Step 3: Install and Authenticate the CLI

While the web UI is enough to complete this tutorial on its own, installing the CLI now will save
you time later. Install it globally with npm:

```bash
npm install -g @cloudpulse/cli
```

Confirm the install succeeded:

```bash
cloudpulse --version
```

Now log in, substituting your own workspace slug:

```bash
cloudpulse login --workspace my-first-team
```

This command starts a temporary local server on port 8734 and opens your browser to complete an
OAuth login. Once you approve access, the CLI stores a scoped access token locally and the command
returns control to your terminal. If your browser doesn't open automatically, copy the printed URL
into it manually.

## Step 4: Create Your First Board from the CLI

With the CLI authenticated, create a board using the `kanban` template:

```bash
cloudpulse board create "My First Board" --template kanban
```

CloudPulse offers three board templates: `kanban`, `scrum`, and `blank`. Choosing `kanban` — as
this tutorial does — automatically creates four default columns for you:

1. **Backlog** — ideas and unscheduled work
2. **In Progress** — tasks someone is actively working on
3. **In Review** — work awaiting approval or code review
4. **Done** — completed work

The `scrum` template is better suited to sprint-based teams, and `blank` gives you an empty board
with no preset columns if you'd rather design your own workflow from scratch.

## Step 5: Add a Task from the CLI

Let's populate the new board with a first task:

```bash
cloudpulse task create --board "My First Board" --title "Write project kickoff notes" --assignee you@example.com
```

This creates a task titled "Write project kickoff notes," assigned to the email you supply, sitting
in the Backlog column by default. You can also pass `--due-date` and `--labels` if you want to set
a deadline or tag the task — for example: `--due-date 2026-08-01 --labels planning,onboarding`.

## Step 6: Add a Task from the Web UI

Now open `app.cloudpulse.io/w/my-first-team` in your browser and click into **My First Board**.
You should see the task you just created sitting in the Backlog column. To add a second task
directly from the web UI:

1. Click the **+ Add Task** button at the bottom of the Backlog column.
2. Type a title, such as "Review onboarding checklist," and press Enter.
3. Click the new task card to open its detail panel, where you can set an assignee, due date, and
   labels — the same fields the CLI's `task create` command accepts.

Drag the card from Backlog into In Progress to see the board's columns in action — this is exactly
what teammates will do as work moves through your pipeline.

## What's Next

You now have a working board with two tasks. From here, a natural next step is inviting teammates
so they can pick up tasks themselves — see the **Inviting Your Team and Assigning Roles** tutorial
for how to send invites and choose between the `admin`, `member`, and `viewer` roles. If you'd
rather automate task creation entirely, the **Your First CloudPulse API Call** tutorial shows how
to create tasks programmatically using the REST API instead of the CLI or web UI.
