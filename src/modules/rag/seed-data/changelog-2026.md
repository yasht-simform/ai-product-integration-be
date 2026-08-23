# CloudPulse Changelog — 2026

## [3.4.0] - 2026-06-18

### Added

- New **timeline view** for boards, showing tasks on a Gantt-style horizontal calendar
- Bulk task editing — select up to 100 tasks and update assignee, status, or due date at once
- Enterprise: SCIM 2.0 user provisioning (see Team Management guide)

### Fixed

- Fixed an issue where webhook retries could deliver duplicate `task.completed` events
- Fixed incorrect timezone handling for due dates near daylight saving transitions

## [3.3.0] - 2026-05-02

### Added

- Custom fields now support a "formula" type for computed values
- New `dueBefore` filter on the `GET /tasks` API endpoint

### Improved

- Board load time for boards with 1,000+ tasks reduced by roughly 40% through virtualized rendering

### Fixed

- Fixed a bug where removing a team member did not revoke their access to restricted boards

## [3.2.0] - 2026-03-20

### Added

- CLI: `cloudpulse task create` now supports `--due-date` and `--labels` flags
- New sandbox API keys (`cp_test_` prefix) for testing against a nightly-reset workspace

### Fixed

- Fixed CLI login timeout (`ERR_AUTH_TIMEOUT`) affecting users on restrictive corporate networks
- Fixed pagination `meta.hasMore` incorrectly returning `true` on the last page

## [3.1.0] - 2026-02-11

### Added

- Slack integration: task status changes now post threaded replies instead of new messages
- Support for SAML 2.0 SSO on Enterprise plans (previously OIDC-only)

### Improved

- Rate limit headers (`X-RateLimit-Remaining`) are now included on every API response, not just
  429s

## [3.0.0] - 2026-01-08

### Added

- Major release: redesigned workspace navigation and board sidebar
- New Enterprise audit log with CSV export and SIEM webhook streaming
- Self-hosted Sync Agent (Docker and AWS ECS deployment) for Enterprise compliance use cases

### Breaking Changes

- The legacy `GET /v0/tasks` endpoint (deprecated since 2025) has been removed. All integrations
  must use `GET /v1/tasks`.

## [2.9.0] - 2025-11-14

### Added

- Automation rules: trigger actions (assign, move column, notify) when a task matches a condition
- Pro plan automation limit raised from 10 to 20 active rules

### Fixed

- Fixed an issue where GitHub commit linking (`[CP-142]` syntax) failed for squash-merged PRs

## [2.8.0] - 2025-09-30

### Added

- Jira two-way sync (previously import-only)
- New `board.created` webhook event

### Fixed

- Fixed file upload failures for attachments larger than 25 MB on Pro workspaces

## [2.7.0] - 2025-08-05

### Added

- Two-factor authentication (TOTP and SMS)
- Nonprofit and education pricing discount program

### Improved

- Password hashing upgraded to bcrypt cost factor 12 (from 10)

## [2.6.0] - 2025-06-17

### Added

- Zapier integration launched, supporting 15 triggers and 10 actions at launch

### Fixed

- Fixed incorrect task counts on the workspace dashboard for archived boards

## [2.5.0] - 2025-04-22

### Added

- Custom fields (text, number, dropdown, date types)
- Board templates: `kanban`, `scrum`, and `blank`

## [2.4.0] - 2025-02-10

### Added

- Initial public release of the CloudPulse REST API (`v1`)
- Node.js, Python, and Go SDKs published

### Fixed

- Fixed a critical bug where deleted tasks were sometimes recoverable past the 30-day trash window
