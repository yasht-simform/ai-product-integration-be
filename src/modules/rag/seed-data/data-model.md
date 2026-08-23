# CloudPulse Data Model

This document describes how CloudPulse organizes data internally, from the top-level workspace
down to individual comments and attachments, and lists the fields that make up a Task.

## Entity Hierarchy

CloudPulse's data model is a strict four-level hierarchy:

```
Workspace (1)
  └── Board (many)
        └── Task (many)
              └── Comment / Attachment (many)
```

- A **Workspace** is the top-level container for a team or organization. Team members, boards,
  billing, and (on Enterprise) SSO configuration are all scoped to a single workspace.
- A **Board** belongs to exactly one Workspace. Boards are created from one of three templates —
  `kanban`, `scrum`, or `blank` — and organize tasks into columns such as Backlog, In Progress,
  In Review, and Done.
- A **Task** belongs to exactly one Board and, within that board, exactly one column. Tasks are
  the primary unit of work tracked in CloudPulse.
- **Comments** and **Attachments** belong to exactly one Task each. A task can have any number of
  comments and any number of attachments; neither has a plan-level cap distinct from the
  workspace's overall storage quota.

This hierarchy is strictly one-directional: a Board cannot exist without a parent Workspace, and a
Task cannot exist without a parent Board. Moving a task between boards changes its parent Board
reference but never its Workspace, since both boards involved in such a move must belong to the
same workspace.

## Task Fields

A Task is CloudPulse's richest entity. Every task carries the following fields:

| Field          | Type     | Description                                                                             |
| -------------- | -------- | --------------------------------------------------------------------------------------- |
| `id`           | string   | Unique task identifier, formatted `tsk_<random>`.                                       |
| `title`        | string   | Short, human-readable summary of the task.                                              |
| `description`  | string   | Longer free-text body, supports Markdown.                                               |
| `status`       | string   | The task's current column, e.g. `Backlog`, `In Progress`, `In Review`, `Done`.          |
| `assignee`     | string   | Email address of the team member responsible for the task.                              |
| `dueDate`      | string   | ISO-8601 date the task is due, if set.                                                  |
| `labels`       | string[] | An array of free-text tags used for categorization and filtering.                       |
| `customFields` | object   | A free-form key-value map for workspace-defined fields (Pro and Enterprise plans only). |

`labels` and `customFields` serve different purposes even though both let a workspace attach extra
metadata to a task. `labels` is a flat array of short tags — well suited to filtering (for example
via the `label:` search filter) and to quick visual scanning on a board. `customFields` is a
structured key-value object intended for workspace-specific structured data, such as a numeric
"story points" field or a dropdown "priority tier" field, and is only available once a workspace
upgrades past the Free plan, since it depends on the automation and custom-field capability that
Free does not include.

## Example Task Object

```json
{
  "id": "tsk_7f2a9c1d",
  "title": "Migrate billing webhook handler to v3 signature format",
  "description": "Update the internal billing service to verify the new HMAC-SHA256 signature header before the v2 signature scheme is retired.",
  "status": "In Progress",
  "assignee": "priya.nandakumar@example.com",
  "dueDate": "2026-08-15",
  "labels": ["billing", "webhooks", "backend"],
  "customFields": {
    "storyPoints": 5,
    "priorityTier": "P1"
  }
}
```

## Comments and Attachments

Comments and attachments are both child entities of a Task, but they are tracked separately:

- A **Comment** is a piece of text (optionally Markdown-formatted) authored by a workspace member
  against a specific task. Creating a comment emits a `comment.created` event, which can trigger a
  webhook delivery.
- An **Attachment** is a file uploaded to a task. Attachment storage counts against the
  workspace's overall storage quota (1GB on Free, 50GB on Pro, unlimited on Enterprise) alongside
  every other file stored in the workspace.

Both are strictly scoped to their parent task: deleting a task's parent board removes every task
on that board along with each task's comments and attachments, since nothing beneath a Board can
outlive its parent in CloudPulse's hierarchy.

## Relationship to the REST API

The hierarchy described above maps directly onto the REST API's resource paths: boards are listed
and created relative to the authenticated workspace, tasks are listed and created relative to a
`boardId`, and comments/attachments are addressed relative to a `taskId`. There is no way to
create a Task without specifying its parent Board, and no way to create a Board without an
authenticated workspace context — the hierarchy is enforced by the Task Service at write time, not
just documented convention.
