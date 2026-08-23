# CloudPulse Changelog — July 2026

July's release, version 3.5.0, shipped on July 9th and is the release CloudPulse's mobile users
have been waiting for: the first stable release of CloudPulse Mobile. This release also introduces
full-text search across the API and a meaningful dashboard performance improvement.

## [3.5.0] - 2026-07-09

### Added

- **CloudPulse Mobile v1.0.** CloudPulse now has a dedicated native mobile app, available for iOS
  14 and later and Android 10 and later. The initial release includes push notifications for task
  assignments, mentions, and due-date reminders; offline board viewing, so a previously loaded board
  remains browsable without a network connection (changes made offline sync automatically once
  connectivity returns); and biometric login via Face ID, Touch ID, or Android's equivalent
  fingerprint/face unlock, so users aren't required to re-enter credentials on every app open once
  they've signed in once.
- **Full-text search API.** A new `GET /v1/search` endpoint searches across task titles,
  descriptions, and comments in a single query, returning matches ranked by relevance. The endpoint
  supports scoping a search with `label:` and `assignee:` filter prefixes directly in the query
  string (for example, `label:urgent assignee:me`), so integrations and power users can combine
  free-text search with structured filtering in one request instead of needing to filter results
  client-side after the fact.

### Improved

- **Faster dashboards.** Dashboard load time has been reduced by roughly 25% through response
  caching — dashboard widgets that don't change on every request (recent activity summaries,
  workspace-level task counts, and similar aggregates) are now cached briefly server-side, so
  repeated dashboard loads within a short window no longer require recomputing the same aggregates
  from scratch each time.
- Fixed a visual glitch in the sidebar on narrow screens, where the new mobile app promotional
  banner (shown to users who haven't yet installed the app) overlapped the bottom of the board list
  on shorter viewport heights.
- Improved loading spinner consistency across pages, extending the shared spinner component to the
  new search results page.

## Additional Notes

CloudPulse Mobile is available now from the Apple App Store and Google Play. It's a companion to
the existing web app rather than a full replacement — the initial v1.0 release covers browsing
boards, viewing and commenting on tasks, receiving notifications, and basic status updates, but more
advanced workflows like bulk task editing and timeline view (added in June's 3.4.0 release) remain
web-only for now. Biometric login is optional and can be disabled in the mobile app's settings for
users who prefer to re-enter credentials manually.

The full-text search endpoint indexes task titles, descriptions, and comments, but does not
currently search custom field values or attachment contents — a search for a formula field's
computed value, for instance, won't currently surface a match. Search results are scoped to boards
the requesting user has access to, consistent with every other CloudPulse API endpoint.

The dashboard caching change is transparent and requires no configuration — cached aggregates are
automatically invalidated whenever the underlying data changes, so dashboards remain accurate while
loading faster on repeated views within the same short window.
