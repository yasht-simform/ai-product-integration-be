# CloudPulse Changelog — September 2026

September's release, version 3.6.0, shipped on September 3rd and is aimed squarely at Enterprise
data governance: a new data residency option and automated database backups, plus a meaningful
performance improvement to automation rule evaluation for every plan.

## [3.6.0] - 2026-09-03

### Added

- **Data residency for Enterprise.** Enterprise customers can now choose which geographic region
  their workspace data is hosted in, selecting between a US hosting region and an EU hosting region
  at workspace setup time. This is aimed at organizations with regulatory or contractual
  requirements around where customer or employee data physically resides — for example, EU-based
  customers who need to keep workspace data within the EU for compliance purposes. Region selection
  is made once during workspace provisioning; moving an existing workspace between regions requires
  contacting support rather than being a self-service change.
- **Automated daily backups.** Enterprise workspaces now receive automated daily backups of their
  underlying PostgreSQL data, retained for 35 days on a rolling basis. Restoring from a backup is
  not yet a self-service action — it's handled by opening a support ticket specifying the workspace
  and the desired restore point, and support will restore the workspace's data to that point in
  time. This is a meaningful addition to CloudPulse's existing data protection posture alongside the
  30-day trash window for deleted tasks that's been in place since the 2.4.0 release.

### Improved

- **Faster automation rules.** Automation rule evaluation latency — the time between a task meeting
  a rule's trigger condition and the rule's configured action (assign, move column, notify, and so
  on) actually firing — has been reduced by roughly 30%. This should be most noticeable on
  workspaces with a large number of active automation rules evaluating against a high volume of
  task updates, where rule evaluation had previously been a source of a small but noticeable delay
  between a trigger condition being met and the resulting action appearing.
- Fixed a visual glitch in the sidebar on narrow screens, where the workspace region indicator (new
  in this release, shown for Enterprise workspaces with a configured data residency region) briefly
  overlapped the workspace name on the very narrowest supported widths.
- Improved loading spinner consistency across pages, unifying the backup-status indicator on the
  Enterprise settings page with the shared spinner component used everywhere else.

## Additional Notes

Data residency is available only on Enterprise plans and only at workspace creation — existing
workspaces are not automatically migrated to a selected region, and organizations that need an
existing workspace moved to a different region should reach out to support to discuss the process,
since a cross-region migration involves moving the underlying data store rather than a simple
configuration flip.

The daily backup retention window of 35 days is fixed for all Enterprise workspaces and is not
currently configurable per customer. Because restores are handled through support rather than
self-service, customers who need to restore data should include as much detail as possible in their
support ticket — the workspace affected, the approximate date/time of the desired restore point, and
the reason for the restore — to help support locate and validate the correct backup quickly.

The automation rule latency improvement applies automatically to every existing automation rule on
every plan; no changes to rule configuration are needed to benefit from it, and rule behavior itself
— which triggers fire which actions — is unchanged. Only the evaluation speed has improved.
