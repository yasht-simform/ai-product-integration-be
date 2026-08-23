# CloudPulse Changelog — April 2026

April brought a small, fast-turnaround patch release rather than a full feature update. Version
3.2.1 shipped on April 14th to address two bugs that surfaced shortly after March's 3.2.0 release —
one affecting large CSV exports, and one affecting webhook delivery under load. Neither issue
required a schema change or a breaking API adjustment, so this release is a drop-in upgrade for
every plan.

## [3.2.1] - 2026-04-14

This is a patch release. There are no new features and no breaking changes — just two fixes,
described below, plus a couple of small cosmetic corrections that shipped alongside them.

### Fixed

- **CSV export truncation.** Task exports to CSV were silently truncating any task description
  longer than 5,000 characters, cutting the text off mid-sentence with no indication in the export
  file that data had been dropped. This primarily affected teams using long, detailed task
  descriptions for engineering specs or QA checklists. Descriptions of any length are now exported
  in full.
- **Duplicate `board.created` webhook deliveries.** Under high concurrency — specifically, when
  several boards were created in rapid succession, such as during a bulk import or a scripted setup
  process — the webhook dispatcher could occasionally send more than one `board.created` event for
  the same board. Integrations that treated each webhook delivery as unique (rather than
  de-duplicating by board ID) could end up creating duplicate downstream records. The dispatcher's
  concurrency handling has been corrected so each board now reliably produces exactly one
  `board.created` event.
- Fixed a visual glitch in the sidebar on narrow screens, where a scrollbar would occasionally
  appear even when the sidebar's content fit entirely within the visible height.
- Improved loading spinner consistency across pages, this time on the CSV export progress modal,
  which had been using a different animation timing than the rest of the app.

## Why a Patch Release

Both fixed bugs were reported within days of the 3.2.0 release going out in March, and both had a
clear enough root cause and fix that we judged it worth shipping a targeted patch rather than
bundling the fixes into whatever the next scheduled feature release turned out to be. The CSV
truncation bug in particular was flagged as high-priority because it could result in silent data
loss during an export — the export would complete successfully and produce a valid CSV file, it
would simply be missing the tail end of any sufficiently long description, with nothing in the file
or the UI indicating a problem had occurred.

The webhook duplication bug is lower-severity in isolation (most integrations are naturally
idempotent to some degree), but it's worth calling out for any integration built against the
`board.created` event specifically: if your integration was already de-duplicating by board ID as a
defensive measure, no changes are needed on your end, and duplicate deliveries should simply stop
occurring after this patch. If your integration was not de-duplicating and relied on CloudPulse
guaranteeing exactly-once delivery, this patch restores that guarantee going forward, though we'd
still recommend defensive de-duplication as a general best practice for any webhook consumer,
CloudPulse's or otherwise.

No action is required to receive this patch — it applies automatically to the hosted CloudPulse
service. Enterprise customers running a self-hosted Sync Agent should confirm they're running the
latest Sync Agent image, since the webhook dispatch fix is included in that image as well.
