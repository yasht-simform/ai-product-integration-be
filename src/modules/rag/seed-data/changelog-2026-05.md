# CloudPulse Changelog — May 2026

May's release, version 3.3.0, landed on May 2nd and focused on making custom fields more powerful
and large boards more usable. It also closes a permissions gap around team member removal that had
been quietly reported by a handful of Enterprise customers over the previous quarter.

## [3.3.0] - 2026-05-02

### Added

- **Formula custom fields.** Custom fields now support a new "formula" type, which computes its
  value automatically from other fields on the same task rather than requiring manual entry. A
  formula field can reference number fields, dates, and other formula fields to produce a computed
  result — for example, a "days remaining" formula field that calculates the difference between a
  due date field and today's date, or a "total estimate" field that sums several numeric fields
  together. Formula fields are read-only wherever they appear in the UI, since their value is always
  derived rather than set directly.
- **`dueBefore` filter on the tasks API.** The `GET /tasks` endpoint now accepts a `dueBefore` query
  parameter, accepting an ISO 8601 date, which returns only tasks due before the given date. This
  complements the existing due-date filtering already available in the UI and makes it possible to
  build reporting or automation around upcoming deadlines directly through the API, without having
  to fetch every task and filter client-side.

### Improved

- **Faster large boards.** Board load time for boards containing 1,000 or more tasks has been
  reduced by roughly 40%, achieved by switching the board view to virtualized rendering — only the
  tasks currently visible in the viewport (plus a small buffer) are rendered to the DOM at any given
  time, with the rest tracked in memory and rendered on demand as the user scrolls. This should be
  most noticeable on large Kanban boards with many columns and long backlogs.

### Fixed

- Fixed a bug where removing a team member from a workspace did not revoke their access to boards
  that had been explicitly restricted to a specific list of members. The removed member retained
  access to those restricted boards (though not to newly created ones) until the bug was
  identified and fixed; access is now correctly revoked immediately upon removal.
- Fixed a visual glitch in the sidebar on narrow screens, where long board names in the favorites
  section would wrap onto a second line instead of truncating with an ellipsis.

## Additional Notes

The formula field type is the first computed field type CloudPulse has offered — previous custom
field types (text, number, dropdown, date) always store a value the user enters directly. Formula
fields are available on the same plans that already support custom fields generally; no separate
enablement is required. Existing custom fields of other types are unaffected and can be freely
combined with new formula fields on the same board.

The team member removal fix is a meaningful security correction for any Enterprise customer relying
on restricted boards to control access to sensitive projects — organizations that removed team
members from a workspace between the introduction of restricted boards and this fix should
double-check that former members no longer have access, since the underlying access grant may have
persisted until this release was deployed. Going forward, removal from a workspace immediately and
correctly revokes access to every board, restricted or not.

The virtualized rendering change for large boards is transparent to end users beyond the speed
improvement itself — board layout, drag-and-drop, and column behavior are all unchanged, and no
board configuration is required to benefit from the faster load times.
