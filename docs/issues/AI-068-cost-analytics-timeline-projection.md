---
id: AI-068
title: CostAnalyticsService — timeline, daily trend & projected monthly spend
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 5 — Cost Analytics
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-067
---

# What to Build

The three time-bucketed analytics on `CostAnalyticsService`:

- **`getSpendTimeline(query)`** — daily spend buckets over a date range. Prisma `groupBy` cannot
  group by a date _truncation_, so use `$queryRaw` with `date_trunc('day', created_at)` — the
  codebase's first raw SQL. Use the `Prisma.sql` tagged template for every interpolated value
  (dates, userId filter) — never string concatenation — and keep the `status = 'SUCCESS'` filter.
  Raw results come back with `Decimal`/`bigint`-typed aggregates; normalize to plain
  `number` at the service boundary. Days with zero spend within the range are filled in as
  zero-value buckets in application code (charts need contiguous axes).
- **`getDailySpendTrend(days)`** — last N days (default 30, clamp to a sane max like 365),
  reusing the timeline query with a computed range.
- **`getProjectedMonthlySpend()`** — FR-COST-004's formula exactly: month-to-date total ÷ elapsed
  days in month (UTC, counting today as elapsed) × total days in the month. Response carries the
  inputs (monthToDate, dailyAverage, daysElapsed, daysInMonth, projected) so the arithmetic is
  auditable. Zero elapsed spend → projected 0, never NaN.

# User Stories Covered

- Story 25 — daily timeline + last-N-days trend for charts
- Story 26 — projected monthly spend per FR-COST-004

# Acceptance Criteria

- [x] Timeline via `$queryRaw` + `date_trunc`, parameterized (tagged-template bind values — see note), SUCCESS-filtered, zero-fill for gap days
- [x] Raw numeric types normalized to `number` in results
- [x] Trend delegates to the timeline logic with a computed N-day range (clamped)
- [x] Projection = MTD ÷ elapsed days × days in month, deterministic under a frozen clock, 0 (not NaN) on empty data
- [x] Unit tests: mocked `$queryRaw` fixtures (gap-day fill, type normalization), projection arithmetic across month boundaries (31-day month, first-of-month edge, 28-day month)
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-067 (service + query DTO foundations)

# Testing Notes

Extend `cost-analytics.service.spec.ts`. Mock `databaseService.$queryRaw` with fixture rows
(including a missing middle day and a `Decimal`-like value) and assert the filled, normalized
output. Freeze the system clock for projection tests — e.g. 2026-07-10 with $5 MTD → 0.5/day ×
31 days = $15.50. The raw SQL itself gets its first real execution in AI-075's live smoke test;
note that in the issue's follow-ups if the sandbox DB is available sooner.

## Implementation Notes

Extends `CostAnalyticsService` (AI-067) with the three time-bucketed analytics per spec §5.4. No
module wiring change (`CostManagementModule` already provides the service).

**`getSpendTimeline(query)`** — daily buckets via a private `queryTimeline()` using `$queryRaw` with
`date_trunc('day', "createdAt")`, `SUM("estimatedCost")`, `SUM("totalTokens")`, `COUNT(*)`, grouped
by the truncated day, `status = 'SUCCESS'` filtered, ordered ascending. Range defaults to the
trailing 30 days when `startDate`/`endDate` are omitted. Columns are camelCase-quoted
(`"createdAt"` etc.) since `ai_audit_logs` has no per-field `@map`.

**Parameterization — deliberate deviation from the literal "`Prisma.sql`" wording, same
security outcome.** The issue's AC says "`Prisma.sql`-parameterized". I used `$queryRaw`'s _own_
tagged-template form instead (a `$queryRaw` template literal with interpolated values),
where every interpolation is a bound parameter — identical parameterized binding to `Prisma.sql` (it
produces the same `Prisma.Sql` under the hood), never string concatenation. The optional `userId`
filter is handled by **branching into two full tagged-template queries** rather than composing a
`Prisma.sql` fragment, because composing one would require value-importing `Prisma` from the
generated client — which breaks Jest with the documented generated-client `.js`-extension load
failure (`cost-analytics.service.spec.ts` loads the real service). The two-branch form keeps
parameterization safe with no `Prisma` value import. This is `$queryRaw`'s first use in the
codebase beyond the health check's `` `SELECT 1` ``.

**Type normalization** — raw Postgres aggregates arrive as `Decimal`/`bigint`/`number`/`string`
depending on driver/column type (`SUM(float8)` → number, `SUM(int)`/`COUNT` → bigint, `numeric` →
Decimal). A private `toNumber(value: unknown)` narrows each case explicitly (number → finite-guarded
number, bigint → `Number()`, string → parse, object → value-preserving `.toString()` then parse,
else 0) — written this way rather than `Number(String(value))` to satisfy
`@typescript-eslint/no-base-to-string` on the `unknown` input while still handling the Decimal
wrapper.

**Gap-day zero-fill** — a private `fillGapDays()` maps the raw rows into a `Map` keyed by UTC
`YYYY-MM-DD`, then walks every UTC day in `[start, end]` inclusive (via `utcMidnight()` +
`setUTCDate(+1)`), emitting the real bucket or a zero bucket, so charts get a contiguous axis
regardless of days with no spend.

**`getDailySpendTrend(days = 30)`** — clamps `days` to `[1, 365]` (`Math.trunc(days) || 30` then
`Math.max(_, 1)`, `Math.min(_, 365)` — so `0`/`NaN` → 30, over-large → 365), computes a trailing
range ending now, and delegates to the same `buildTimeline()` path.

**`getProjectedMonthlySpend()`** — FR-COST-004 exactly: `aggregate({ _sum: { estimatedCost } })`
over `status: 'SUCCESS'` since the UTC first-of-month, then `monthToDate ÷ daysElapsed × daysInMonth`
where `daysElapsed = now.getUTCDate()` (today counts as elapsed) and `daysInMonth = UTC day-0 of
next month`. Returns all five inputs (`monthToDate`, `dailyAverage`, `daysElapsed`, `daysInMonth`,
`projected`) so the arithmetic is auditable. `daysElapsed` is always ≥ 1, and `monthToDate` falls
back to `0`, so `projected` is `0` (never `NaN`) on empty data.

New types `SpendTimelinePoint`/`SpendTimelineResult`/`ProjectedSpendResult` in
`types/cost-management.types.ts`; new `SpendTimelineQueryDto` (extends `SpendAnalyticsQueryDto` +
optional `userId`) in `dto/`, barrel-exported. Response DTOs remain AI-073's concern.

Nine new tests (20 total in the spec): `$queryRaw`-fixture gap-day fill + Decimal/bigint
normalization, bound-parameter assertions (status + range with/without `userId`), trend
window/default/clamp under a frozen clock, and projection arithmetic for a 31-day mid-month, the
first-of-month edge, a 28-day February, and the empty-data `0`-not-`NaN` case.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated)
- `npm run build` — succeeds
- `npm run test -- cost-analytics` — 20/20 pass
- `npm run test` — 602/602 pass (full suite, +9 for this issue, zero regressions)

## Assumptions Made

- **`$queryRaw` tagged-template form instead of `Prisma.sql`** — same parameterized binding, chosen
  specifically to avoid the Jest-breaking `Prisma` value-import (documented above). If a future
  issue needs true `Prisma.sql` fragment composition, it must isolate the raw SQL behind a boundary
  that the spec doesn't load, or accept the ESM test constraint.
- **Timeline default range = trailing 30 days** when `startDate`/`endDate` are omitted (spec left
  the default open); the trend method always supplies its own explicit range.
- **`SpendTimelineResult` shape** = `{ data: SpendTimelinePoint[] }`; `ProjectedSpendResult` carries
  the five audit inputs. Response DTOs (AI-073) can reshape at the controller boundary.
- **Result numbers are unrounded** — raw computed values (e.g. `dailyAverage` may be a long
  decimal); any display rounding is a presentation concern for AI-073's DTO/controller.

## Follow Ups

- Epic 5 (Cost Analytics) is complete (AI-067 + AI-068). AI-073 (`CostManagementController`
  analytics + retention endpoints) is now one dependency closer — it still also needs AI-070.
- The raw `date_trunc` SQL has not yet executed against a real Postgres (unit tests mock
  `$queryRaw`). Its first live execution is AI-075's smoke test; worth an earlier manual
  `GET /cost/analytics/timeline` check during AI-073's live verification if the sandbox DB is up.
- `getProjectedMonthlySpend()` uses a whole-month linear projection (FR-COST-004's formula
  verbatim); a future refinement could weight by weekday/recent-trend, but that's beyond the spec.
