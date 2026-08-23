# Backup and Restore (Enterprise)

CloudPulse Enterprise workspaces are automatically and continuously backed up as part of the
platform's underlying PostgreSQL infrastructure. This guide explains how those automated backups
work, how to request a restore, and how to take a manual, on-demand export of your own data at any
time using the CLI.

## Automated Daily Backups

Every Enterprise workspace's data is backed up automatically once per day:

- **Schedule:** daily at 02:00 UTC
- **Retention:** 35 days — any given day's backup is available for restore up to 35 days after it
  was taken, after which it is permanently rotated out
- **Scope:** the full PostgreSQL system of record backing your workspace, including boards, tasks,
  comments, attachments metadata, custom field definitions and values, and team membership

Automated backups are not user-configurable — there's no setting to change the 02:00 UTC schedule
or extend the 35-day window per workspace. They exist as a platform-wide safety net against data
loss (accidental bulk deletion, a bad automation rule, or an internal CloudPulse incident) rather
than as a tool for routine point-in-time recovery of individual tasks — for recovering an
individual deleted task, check workspace trash first, since deleted tasks remain there for 30 days
before permanent deletion, which is almost always faster than a full backup restore.

## Requesting a Restore

Restoring from an automated backup is not self-service — it's handled through CloudPulse support,
consistent with Enterprise's dedicated support model:

1. Open a support ticket specifying the workspace, the approximate date/time you want restored to,
   and a brief description of what happened (e.g. "accidental board deletion around 14:00 UTC on
   2026-07-09")
2. CloudPulse's support team identifies the nearest available daily backup at or before that time
3. The restore is performed by CloudPulse engineering directly against your workspace's database

**Target RTO (Recovery Time Objective): 4 hours** from the time a restore request is confirmed and
scoped. Because backups are taken once daily, a restore recovers your workspace to the state it was
in at the most recent 02:00 UTC snapshot at or before your requested point in time — any changes
made between that snapshot and the incident are not recoverable through this process, since
CloudPulse does not currently offer sub-daily, continuous point-in-time recovery.

Given the once-daily granularity, it's worth pairing backup-based recovery with CloudPulse's own
30-day trash retention and your own periodic manual exports (below) for anything you need finer
recovery granularity on.

## Manual Export

Independent of the automated backup schedule, any workspace member with sufficient access can
trigger an on-demand export of workspace data using the CLI:

```bash
cloudpulse export --format json --board "Q3 Engineering Roadmap"
```

```bash
cloudpulse export --format csv --board "Q3 Engineering Roadmap" > q3-roadmap.csv
```

- **`--format json`** produces a structured export preserving the full task object shape (`id`,
  `title`, `description`, `status`, `assignee`, `dueDate`, `labels[]`, `customFields{}`) — the same
  fields the API returns for a task — making it suitable for re-importing elsewhere or archiving in
  a format that preserves custom field values.
- **`--format csv`** produces a flattened, spreadsheet-friendly export, useful for sharing with
  stakeholders who don't need the full object structure or for feeding into external reporting
  tools.

A manual export captures the exact current state of the board at the moment it's run — unlike a
backup restore, it isn't retained by CloudPulse afterward, so store the output file yourself if you
need to keep it. Manual exports are a good complement to the daily automated backup: run one before
a risky bulk operation (e.g. a large bulk edit across 100 tasks, or deleting a board) so you have an
immediate, self-serviced fallback that doesn't require opening a support ticket and waiting on the
4-hour restore RTO.

## Choosing Between Restore and Export

| Scenario                                                          | Use                           |
| ----------------------------------------------------------------- | ----------------------------- |
| You need to recover from an incident that already happened        | Support-ticket backup restore |
| You want a safety net before a risky change you're about to make  | Manual `cloudpulse export`    |
| You need workspace data outside CloudPulse (reporting, archiving) | Manual `cloudpulse export`    |
| You need continuous, sub-daily point-in-time recovery             | Not currently supported       |

Both mechanisms are Enterprise-only. Pro and Free workspaces have neither automated backups nor the
`cloudpulse export` command available.
