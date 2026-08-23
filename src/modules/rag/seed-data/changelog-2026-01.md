# CloudPulse Changelog — January 2026

CloudPulse opened 2026 with its biggest release to date. Version 3.0.0 shipped on January 8th and
represents the first major version bump since the platform's REST API went public, bringing a
redesigned navigation experience, a new Enterprise-grade audit trail, and the option to run a
self-hosted sync component for organizations with strict compliance requirements. Because this is
a major version, it also carries the first breaking API change CloudPulse has made in over a year.

## [3.0.0] - 2026-01-08

This release focused on three themes: making the product easier to navigate as workspaces grow
larger, giving Enterprise security teams the visibility they've been asking for, and closing out
the deprecation window on an old API endpoint that's been on borrowed time since 2025.

### Added

- **Major navigation redesign.** Workspace navigation and the board sidebar have been rebuilt from
  the ground up. Boards, favorites, and recently viewed items are now grouped into collapsible
  sections instead of a single flat list, which was becoming difficult to scan for teams managing
  dozens of boards across multiple workspaces. The new sidebar also remembers its collapsed/expanded
  state per workspace.
- **Enterprise audit log.** A new audit log is available on Enterprise plans, capturing
  authentication events, permission changes, board and task deletions, and integration
  configuration changes. Entries can be exported as CSV for offline review, and — for security
  teams who want events flowing into their own tooling in real time — the audit log can now stream
  events to a SIEM via an outbound webhook, in addition to the existing export option.
- **Self-hosted Sync Agent.** Enterprise customers with data residency or network isolation
  requirements can now deploy a self-hosted Sync Agent that brokers communication between an
  internal network and CloudPulse's cloud service, rather than requiring direct outbound access
  from every internal system. The Sync Agent ships as a Docker image for on-premises deployment and
  is also directly deployable to AWS ECS for customers already running infrastructure there.

### Breaking Changes

- The legacy `GET /v0/tasks` endpoint, deprecated since 2025, has been permanently removed from the
  API. Any integration still calling `/v0/tasks` will now receive a 404. All integrations must be
  updated to use `GET /v1/tasks`, which has been the recommended endpoint for over a year and
  supports the same core filtering parameters plus several that `/v0` never had (see the API
  Reference guide for the full parameter list). Customers on older SDK versions should upgrade to
  the latest Node.js, Python, or Go SDK release, all of which target `/v1` exclusively.

### Fixed

- Fixed a visual glitch in the sidebar on narrow screens, where board icons would occasionally
  overlap the collapse/expand arrow on window widths just above the mobile breakpoint.
- Improved loading spinner consistency across pages — several views were using slightly different
  spinner styles and timing, which has now been unified into a single shared loading component.

## Upgrade Notes

Because the navigation redesign changes where boards and favorites appear, we recommend giving your
team a short heads-up before this rolls out broadly — no action is required, but muscle memory for
where things live in the sidebar will need a day or two to catch up. The Sync Agent and SIEM webhook
streaming are opt-in Enterprise features and have no effect on workspaces that don't enable them.
Any team still relying on `/v0/tasks` should treat this release as the hard cutoff: there is no
grace period past 3.0.0, and calls to the removed endpoint will fail immediately rather than
returning a deprecation warning as they did previously.

As always, the full list of supported API endpoints and their parameters is kept up to date in the
API Reference guide, and questions about the Sync Agent's deployment requirements are covered in
the Deployment Guide.
