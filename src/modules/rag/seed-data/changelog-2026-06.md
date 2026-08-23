# CloudPulse Changelog — June 2026

June's release, version 3.4.0, shipped on June 18th and is one of the larger feature releases of
the year: a new timeline view for boards, bulk task editing, and Enterprise SCIM 2.0 provisioning,
alongside fixes for two long-standing scheduling and webhook bugs.

## [3.4.0] - 2026-06-18

### Added

- **Timeline view.** Boards can now be viewed in a new timeline mode, which lays tasks out on a
  Gantt-style horizontal calendar based on their start and due dates instead of the traditional
  column-based Kanban layout. Timeline view is available as a toggle alongside the existing board
  and list views, so teams that plan work by date rather than by status now have a dedicated view
  built for that workflow, without giving up the Kanban view for day-to-day execution.
- **Bulk task editing.** Users can now select up to 100 tasks at once — via shift-click, a
  select-all-in-column shortcut, or a saved filter — and apply a single update to assignee, status,
  or due date across the entire selection. Previously, changing the assignee or due date across a
  batch of tasks required editing each task individually, which was one of the more common
  friction points reported by teams managing large backlogs or running sprint replanning sessions.
- **Enterprise SCIM 2.0 provisioning.** Enterprise customers can now provision and deprovision user
  accounts automatically through SCIM 2.0, syncing user creation, updates, and deactivation directly
  from an identity provider rather than managing CloudPulse accounts manually or through CSV import.
  SCIM provisioning works alongside both OIDC and SAML SSO, added earlier this year, and is
  configured from the same Enterprise identity settings page.

### Fixed

- Fixed an issue where webhook retries could deliver duplicate `task.completed` events — a failed
  delivery attempt that was later retried successfully could, under certain timing conditions,
  result in the original attempt also eventually succeeding, producing two deliveries for a single
  completion event.
- Fixed incorrect timezone handling for due dates falling near daylight saving transitions, where a
  task due date near a spring-forward or fall-back boundary could display or filter incorrectly by
  up to an hour depending on the viewing user's local timezone.
- Fixed a visual glitch in the sidebar on narrow screens, where the new timeline view's toggle icon
  briefly failed to highlight as active immediately after switching to it.

## Additional Notes

Timeline view reads from the same start-date and due-date fields already used elsewhere in
CloudPulse, so no data migration or field setup is required — any board with tasks that already have
due dates populated will show a populated timeline immediately after switching views. Tasks without
a due date are grouped in an "unscheduled" lane at the top of the timeline rather than being hidden.

Bulk task editing respects existing board permissions: a user can only bulk-edit tasks they would
otherwise have permission to edit individually, and restricted boards are unaffected by the new
selection tooling. The 100-task selection cap is a single hard limit per bulk operation; larger
batches require the operation to be run more than once.

SCIM 2.0 provisioning is additive to CloudPulse's existing Enterprise identity options — SAML and
OIDC SSO continue to control authentication, while SCIM now separately handles the account
lifecycle (creation, attribute updates, and deactivation) that previously required manual
administration. Full setup instructions, including the SCIM endpoint URL and supported attribute
mappings, are covered in the Team Management guide.

Both bug fixes in this release addressed timing-sensitive edge cases that were difficult to
reproduce consistently, which is part of why they took longer to resolve than a typical fix — both
have since been verified against the specific timing conditions that originally triggered them.
