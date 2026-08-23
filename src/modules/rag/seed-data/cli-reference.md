# CloudPulse CLI Reference

The CloudPulse command-line interface lets you manage workspaces, boards, and tasks without
leaving your terminal — useful for scripting, CI pipelines, and quick lookups during development.

## Installation

```bash
npm install -g @cloudpulse/cli
```

This installs the `cloudpulse` command globally. The CLI is distributed as the `@cloudpulse/cli`
npm package, separate from the `@cloudpulse/sdk` library package.

## Authentication

### `cloudpulse login --workspace <slug>`

Logs in via OAuth. Running this command opens your default browser to CloudPulse's login page and
starts a temporary local HTTP server on **port 8734** to receive the OAuth callback once you
authorize the CLI. The `--workspace` flag selects which workspace slug to authenticate against;
credentials are then stored locally for use by every subsequent command.

### `cloudpulse logout`

Clears the locally stored credentials, requiring `cloudpulse login` again before any
authenticated command will succeed.

## Board Commands

### `cloudpulse board create "<name>" --template kanban|scrum|blank`

Creates a new board in the current workspace using one of the three supported templates.

```bash
cloudpulse board create "Q4 Planning" --template scrum
```

### `cloudpulse board list`

Lists all boards in the current workspace, printing each board's name and ID.

## Task Commands

### `cloudpulse task create --board <name> --title <title> --assignee <email> [--due-date <date>] [--labels <a,b>]`

Creates a new task on the named board. The `--due-date` and `--labels` flags are optional and were
both added in v3.2.0.

```bash
cloudpulse task create --board "Q4 Planning" --title "Draft launch checklist" \
  --assignee jane@acme.com --due-date 2026-10-01 --labels launch,docs
```

### `cloudpulse task list --board <name>`

Lists every task on the named board, along with each task's status column and assignee.

### `cloudpulse task update <id> --status <status>`

Updates the status (column) of an existing task, identified by its task ID.

```bash
cloudpulse task update tsk_7f2a9c1d --status "In Review"
```

## Workspace Commands

### `cloudpulse workspace switch <slug>`

Switches the CLI's active workspace context to a different workspace the authenticated user
belongs to, without requiring a fresh login.

## Configuration Commands

### `cloudpulse config set <key> <value>`

Writes a key-value pair to the CLI's local configuration file, `.cloudpulse.yml`, in the current
directory (or the nearest parent directory containing one).

### `cloudpulse config get <key>`

Reads back the current value of a configuration key, resolving it from `.cloudpulse.yml`.

The supported configuration keys are:

| Key            | Purpose                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| `workspace`    | The default workspace slug used when no `--workspace` flag is given.                 |
| `defaultBoard` | The board name assumed by commands like `task list` when no `--board` flag is given. |
| `apiVersion`   | Which REST API version the CLI targets when making requests.                         |

## Export

### `cloudpulse export --format json|csv`

Exports the current workspace's boards and tasks to either a JSON or CSV file in the current
directory. This is a read-only operation — it does not modify any data in CloudPulse and is
commonly used for offline reporting or backups.

## Configuration File Example

A typical `.cloudpulse.yml`, either hand-edited or produced by `cloudpulse config set`, looks
like:

```yaml
workspace: acme-engineering
defaultBoard: Q4 Planning
apiVersion: v1
```

When present, this file lets most CLI commands omit `--workspace` and `--board` flags entirely,
since the CLI falls back to these configured defaults before failing with a "no workspace/board
specified" error.
