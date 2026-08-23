# CloudPulse Changelog — March 2026

March's release, version 3.2.0, shipped on the 20th and was aimed squarely at CLI users and
integration developers. It rounds out the command-line task-creation workflow with two new flags,
introduces disposable sandbox API keys for safe testing, and closes out two CLI/API bugs that had
been open since earlier in the quarter.

## [3.2.0] - 2026-03-20

### Added

- **CLI flags for `cloudpulse task create`.** The CLI's task creation command now supports a
  `--due-date` flag (accepting an ISO 8601 date) and a `--labels` flag (accepting a comma-separated
  list of label names), so a task can be fully specified from the command line in one call instead
  of requiring a follow-up edit through the web UI or a separate API request. Both flags are
  optional and existing scripts that call `task create` without them continue to work unchanged.
- **Sandbox API keys.** CloudPulse now issues sandbox API keys, prefixed `cp_test_`, that operate
  against a dedicated sandbox workspace rather than a customer's real production data. The sandbox
  workspace resets to a clean baseline every night, so it's now possible to build and test an
  integration — including destructive operations like bulk deletes — without any risk of touching
  real tasks, boards, or team data. Sandbox keys are available on all plans and can be generated
  from the same API Keys settings page as regular keys.

### Fixed

- Fixed a CLI login timeout, surfaced to users as `ERR_AUTH_TIMEOUT`, that primarily affected users
  on restrictive corporate networks where the CLI's local callback listener for the OAuth login
  flow was being blocked by network policy before the browser-based login could complete.
- Fixed an issue where the `meta.hasMore` field in paginated API responses incorrectly returned
  `true` on the last page of results, which could cause integrations to make one extra, unnecessary
  request per paginated list before correctly detecting the end of the result set.
- Fixed a visual glitch in the sidebar on narrow screens, where the "Create board" button's icon
  would occasionally clip against the sidebar's right edge on certain zoom levels.

## Notes for Integration Developers

The sandbox key addition is the headline change for anyone building against the CloudPulse API.
Prior to this release, testing an integration meant either using a real (if low-traffic) workspace
or carefully scoping test data to avoid interfering with production boards. Sandbox keys remove
that tradeoff entirely: point your integration's test suite at a `cp_test_` key, and every night the
sandbox workspace is wiped and reseeded with a small, consistent set of boards and tasks, so tests
run against a known-good starting state every time. Sandbox keys are functionally identical to
production keys in terms of the API surface they can call — the only difference is which workspace
they're scoped to and the nightly reset.

The pagination fix is worth flagging specifically to anyone who wrote defensive pagination logic
that already accounted for `meta.hasMore` occasionally lying on the last page — that workaround is
no longer necessary and can be safely removed, though leaving it in place is harmless since it will
simply never trigger.

The CLI login timeout fix should resolve authentication problems for teams working from behind
corporate proxies or VPNs that restrict which local ports a background process can bind to for the
OAuth callback; if you were previously working around this by authenticating from a personal
network and copying a token over, that workaround should no longer be necessary after upgrading to
the latest CLI release.
