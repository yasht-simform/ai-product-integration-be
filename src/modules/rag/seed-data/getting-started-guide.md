# Getting Started with CloudPulse

CloudPulse is a cloud-based project management platform for engineering and product teams. This
guide walks you through creating a workspace, installing the CLI, and shipping your first project
board in under 15 minutes.

## Prerequisites

Before you begin, make sure you have:

- Node.js version 18 or later (Node 20 LTS is recommended)
- A CloudPulse account — sign up free at `app.cloudpulse.io/signup`
- npm or yarn installed
- (Optional) Docker, if you plan to self-host the CloudPulse sync agent

## Step 1: Create Your Workspace

After signing up, CloudPulse prompts you to create a **workspace** — the top-level container for
your projects, boards, and team members. Choose a workspace name (e.g. "Acme Engineering") and a
unique workspace slug, which becomes part of your workspace URL:
`app.cloudpulse.io/w/acme-engineering`.

Each account can belong to up to 10 workspaces on the Free plan and unlimited workspaces on Pro
and Enterprise.

## Step 2: Install the CLI

CloudPulse ships a command-line tool for scripting board and task operations. Install it globally:

```bash
npm install -g @cloudpulse/cli
```

Verify the install:

```bash
cloudpulse --version
# cloudpulse-cli/3.2.0
```

Authenticate the CLI against your workspace:

```bash
cloudpulse login --workspace acme-engineering
```

This opens a browser window to complete OAuth login and stores a scoped access token in
`~/.cloudpulse/credentials.json`.

## Step 3: Create Your First Board

Boards are the core organizational unit in CloudPulse. Create one from the CLI:

```bash
cloudpulse board create "Q1 Roadmap" --template kanban
```

Available templates are `kanban`, `scrum`, and `blank`. The `kanban` template creates four default
columns: Backlog, In Progress, In Review, and Done.

You can also create a board from the web UI by clicking **New Board** in the workspace sidebar.

## Step 4: Add Tasks

Add a task to a board via the CLI:

```bash
cloudpulse task create --board "Q1 Roadmap" --title "Set up CI pipeline" --assignee jane@acme.com
```

Or via the REST API:

```bash
curl -X POST https://api.cloudpulse.io/v1/tasks \
  -H "Authorization: Bearer $CLOUDPULSE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"boardId": "brd_123", "title": "Set up CI pipeline"}'
```

## Step 5: Invite Your Team

From **Settings → Team → Invite Members**, enter teammate emails and select a role
(`admin`, `member`, or `viewer`). Invited members receive an email with a join link that expires
after 7 days. The Free plan supports up to 5 team members per workspace; Pro supports 50; Enterprise
is unlimited.

## Step 6: Connect an Integration

CloudPulse supports one-click integrations with Slack, GitHub, Jira, and Zapier from
**Settings → Integrations**. Connecting GitHub lets you link commits and pull requests to tasks by
including a task ID like `[CP-142]` in your commit message.

## Configuration File

For CLI-driven workflows, create a `.cloudpulse.yml` file in your project root:

```yaml
workspace: acme-engineering
defaultBoard: Q1 Roadmap
apiVersion: v1
```

The CLI reads this file automatically so you don't need to pass `--workspace` on every command.

## Next Steps

Once your board is set up, see the **API Reference** guide for automating task creation, the
**Team Management** guide for configuring roles and SSO, and the **Integrations Guide** for
connecting Slack notifications to board activity.

## Troubleshooting Setup

If `cloudpulse login` fails with `ERR_AUTH_TIMEOUT`, check that port 8734 is not blocked by a
local firewall — the CLI runs a temporary local server on that port to receive the OAuth callback.
If the browser window doesn't open automatically, copy the printed URL manually into your browser.
