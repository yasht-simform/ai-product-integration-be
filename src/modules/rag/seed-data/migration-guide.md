# Migrating to CloudPulse from Trello, Asana, or Jira

Switching project-management tools is usually the biggest blocker to adopting a new one, so
CloudPulse provides two supported migration paths: a self-service CSV import available on every
plan, and a guided migration wizard offered as part of Enterprise onboarding. This guide covers
both paths, plus practical advice for mapping the column/list/status concepts from Trello, Asana,
and Jira onto a CloudPulse board.

## Path 1: CSV Import (All Plans)

The fastest way to bring existing tasks into CloudPulse is the CLI's `import` command:

```bash
cloudpulse import --file tasks.csv --board "Q3 Engineering Roadmap"
```

This creates the target board if it doesn't already exist and inserts one task per CSV row. The
import is available to Free, Pro, and Enterprise workspaces alike — it doesn't require an
Enterprise contract, since it's a stateless, one-time conversion rather than a live sync.

### Required CSV Columns

`cloudpulse import` expects exactly four columns, in any order, with these exact header names:

| Column     | Description                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `title`    | The task's title (required, non-empty)                                                                                  |
| `status`   | Maps to a board column — see the mapping tables below                                                                   |
| `assignee` | An email address; if the user isn't already a workspace member, the task is created unassigned and a warning is printed |
| `dueDate`  | ISO 8601 date (`YYYY-MM-DD`); left blank if omitted                                                                     |

A minimal valid file looks like this:

```csv
title,status,assignee,dueDate
"Fix pagination bug on task list","In Progress","priya@acme.com","2026-08-15"
"Write onboarding docs","Backlog","",""
"Ship v2 API client","Done","dev@acme.com","2026-07-01"
```

Rows with a `status` value that doesn't match any existing board column are placed in the board's
first column (typically `Backlog`) rather than failing the import — check the CLI's summary output
after every run, since it reports how many rows fell back to the default column.

## Path 2: Migration Wizard (Enterprise Onboarding)

Enterprise customers get access to a guided migration wizard as part of their onboarding — the
same onboarding that can include the optional $500 priority onboarding add-on's 2-hour kickoff
call. Unlike the CLI's one-shot CSV import, the wizard connects directly to your source tool's API
(where the source tool exposes one) and walks a workspace admin through:

1. Authorizing CloudPulse to read from the source tool (Trello, Asana, or Jira)
2. Selecting which boards/projects to bring over
3. Reviewing an auto-generated column mapping (editable before anything is imported)
4. Reviewing user-matching (source-tool email → CloudPulse workspace member)
5. Running the import, with attachments and comments carried over where the source API supports it

The wizard is intended for larger, one-time cutovers where hand-editing a CSV for thousands of
tasks isn't practical. It is not a continuous two-way sync — once the cutover import completes,
further changes need to be made directly in CloudPulse, the same as with the CSV path.

## Mapping Source Tools to CloudPulse Columns

CloudPulse boards use columns (e.g. `Backlog`, `In Progress`, `In Review`, `Done` on a default
kanban template) rather than lists, sections, or issue statuses. Each source tool's own
organizing concept maps onto a CloudPulse column, but the mapping isn't always 1:1.

### From Trello

Trello organizes cards into **lists**. Each Trello list should map to one CloudPulse column:

- A list named `To Do` or `Backlog` → `Backlog`
- A list named `Doing` or `In Progress` → `In Progress`
- A list named `Review` or `QA` → `In Review`
- A list named `Done` or `Complete` → `Done`

Trello boards with more than four lists (e.g. a separate `Blocked` list) either need an additional
CloudPulse column created before import, or the extra list's cards should be merged into the
closest matching column and re-triaged afterward with labels.

### From Asana

Asana organizes tasks into **sections** within a project, and often also tracks completion via a
separate boolean "marked complete" flag independent of section. When mapping:

- Map each section name directly to a CloudPulse column, same as Trello lists
- For any task marked complete in Asana regardless of its section, set `status` to `Done` in the
  CSV rather than trusting the section name, since teams frequently leave completed tasks in their
  original section

### From Jira

Jira issues carry a **workflow status** (e.g. `To Do`, `In Progress`, `In Review`, `Done`, plus
any custom statuses a team has configured). Map each Jira status to the CloudPulse column with the
closest meaning:

- Custom intermediate statuses (e.g. `Blocked`, `Awaiting Deploy`) should be mapped to the nearest
  upstream column (usually `In Progress`) and tracked instead via a CloudPulse label such as
  `blocked`, since CloudPulse's default templates don't include a blocked column out of the box
- Jira subtasks can be imported as regular CloudPulse tasks; there's no native subtask hierarchy in
  a CloudPulse board, so a common pattern is prefixing subtask titles with their parent issue key
  (e.g. `[CP-142] Add rate-limit header`) for traceability, which also happens to match the
  `[CP-142]`-style syntax CloudPulse's GitHub integration looks for in commit messages

## After the Import

Once tasks are in CloudPulse, re-check assignees (any email that didn't match a workspace member
during import will show the task unassigned), confirm labels landed as expected, and spot-check a
sample of due dates for timezone drift if your source tool stored dates in a different timezone
than your CloudPulse workspace.
