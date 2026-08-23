# CloudPulse Data Export FAQ

Answers to common questions about exporting your CloudPulse data, in what formats, and how GDPR
data portability requests are handled.

## What formats can I export CloudPulse data in?

CloudPulse supports exporting data in both CSV and JSON formats. You can choose the format either
when using the `cloudpulse export` CLI command (part of the `@cloudpulse/cli` npm package) or when
exporting from **Settings → Data Export** in the web app.

## How do I export data using the CLI?

Run `cloudpulse export` after authenticating with `cloudpulse login --workspace <slug>`. The CLI
command supports both CSV and JSON output, giving you the same export options available in
**Settings → Data Export** but scriptable from the command line — useful for scheduled or
automated backups.

## Who is allowed to export a full workspace?

A full workspace export is available to `admin` users only. Members and viewers do not have access
to the full-workspace export option in **Settings → Data Export**, regardless of how much content
they've personally created within the workspace.

## Can a `member` export their own tasks?

The full-workspace export feature itself is restricted to `admin` role users. `member` and
`viewer` accounts should use the CloudPulse API directly to retrieve data for boards and tasks they
have read access to, since the bulk export screen under **Settings → Data Export** is not exposed
to those roles.

## How long does a GDPR data portability request take?

GDPR data portability (export) requests are fulfilled within 30 days of submission, in line with
CloudPulse's broader GDPR compliance commitments. Requests can be submitted by emailing
`legal@cloudpulse.io` or through **Settings → Billing → Legal Documents**.

## Is a GDPR data export different from a regular Settings → Data Export?

A GDPR data portability request is handled through CloudPulse's legal/compliance process (via
`legal@cloudpulse.io`) with a guaranteed 30-day turnaround, while the CSV/JSON export in
**Settings → Data Export** (or via the `cloudpulse export` CLI command) is a self-service feature
available immediately to `admin` users with no waiting period. Both ultimately produce your
workspace's data, but the GDPR path exists specifically to satisfy data portability obligations
under GDPR.

## What data is included in a full workspace export?

A full workspace export includes boards, tasks, comments, and associated metadata for the
workspace. Attachments are referenced but handled according to CloudPulse's storage and retention
policies rather than being embedded directly inside the CSV or JSON export file itself.

## Does exporting data delete it from CloudPulse?

No. Exporting data via the CLI, **Settings → Data Export**, or a GDPR portability request is
strictly a read/copy operation — it has no effect on the source data still stored in your
CloudPulse workspace, and can be repeated as many times as needed.

## Can I automate recurring exports?

Yes, since `cloudpulse export` is a CLI command, it can be scheduled with any standard job
scheduler (such as a cron job) on a machine where `@cloudpulse/cli` is installed and authenticated
via `cloudpulse login --workspace <slug>`, allowing recurring CSV or JSON exports without manual
intervention through the web app.

## What happens to exported data if I cancel my subscription?

An export you've already downloaded is unaffected by subscription cancellation, since it's a
standalone file outside CloudPulse. Data still stored in your workspace remains subject to the
90-day post-cancellation retention window described in the CloudPulse Subscription Return & Refund
Policy, so exporting before that window closes is recommended if you want a copy of any data not
already downloaded.
