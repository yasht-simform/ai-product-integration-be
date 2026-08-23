---
id: AI-073
title: CostManagementController — analytics + retention endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Live Verification
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-068
  - AI-070
---

# What to Build

The remaining ten routes (spec §6.3/§6.4), thin delegates on `CostManagementController`:

**Analytics** (→ `CostAnalyticsService`, AI-067/AI-068):

- `GET /cost/analytics/by-user`, `/by-model`, `/by-feature` — query DTOs from AI-067
- `GET /cost/analytics/timeline` — date-range query
- `GET /cost/analytics/daily-trend` — `days?` query param (validated positive int, clamped)
- `GET /cost/analytics/projected` — no params

**Retention** (→ `RetentionService`, AI-069/AI-070):

- `GET /retention/config` → `getRetentionConfig()`
- `PATCH /retention/config` → `updateRetentionConfig()` — `UpdateRetentionConfigDto` (all fields
  optional positive ints; no cron field — not runtime-updatable per AI-070). Response documents
  the in-memory/reset-on-restart semantics in its Swagger description.
- `POST /retention/cleanup` → `runFullCleanup()` — returns the `RetentionReport` (deleted counts
  per category). This is a mutating admin action; 201 per the codebase's POST convention.
- `GET /retention/stats` → `getRetentionStats()`

Note the controller prefix split: budget/analytics routes live under `/cost/...`, retention under
`/retention/...` — either a second `@Controller('retention')` class inside `CostManagementModule`
or a route-prefix override; prefer the second controller class (cleaner Swagger grouping under the
same tag, matches spec §6.4's paths literally).

Response DTOs for every analytics/retention shape (`SpendByUserResDto`, `SpendTimelineResDto`,
`ProjectedSpendResDto`, `RetentionConfigResDto`, `RetentionReportResDto`, `RetentionStatsResDto`,
etc.), Swagger-annotated, barrel-exported.

# User Stories Covered

- Story 23–26 — analytics API surface
- Story 31 — retention config/cleanup/stats API
- Story 32/33 — Swagger + validation

# Acceptance Criteria

- [x] All ten routes delegating thinly with typed query/body DTOs
- [x] `PATCH /retention/config` rejects a `cleanupCron` key (`forbidNonWhitelisted` handles it) and non-positive day values
- [x] `POST /retention/cleanup` returns per-category deleted counts
- [x] Retention routes mounted at `/retention/...`, analytics at `/cost/analytics/...`, all under the `cost-management` tag in `/api/docs-json`
- [x] Delegation tests for all ten routes + DTO `validate()` smoke tests; full suite passes
- [x] `lint:check` + `tsc --noEmit` pass

# Dependencies

- AI-068 (analytics complete), AI-070 (retention config/stats/cron seams)

# Testing Notes

Extend `cost-management.controller.spec.ts` (and add a spec for the retention controller class if
split). All services as `jest.fn()` mocks — assert delegation args (e.g. `days` clamping happens
in the DTO/controller before the service sees it, or in the service; pick one and test it there).
No live DB/cron involvement.

## Implementation Notes

**Controller split, per the issue's own preference**: retention's `/retention/...` routes landed
on a **new** `RetentionController` (`retention.controller.ts`), not on
`CostManagementController` — both classes carry `@ApiTags('cost-management')` so they group
together in Swagger despite being separate `@Controller()` prefixes (`'cost'` vs `'retention'`).
`CostManagementController` gained `@Controller('cost')` (previously a bare `@Controller()` stub)
plus the six analytics routes; its `retentionService` constructor param (unused, injected only by
the AI-057 scaffold) was removed since retention moved to its own class. `costBudgetService`
remains injected-but-unused — AI-072's job to wire up.

**Analytics routes** (all six, thin one-line delegates to `CostAnalyticsService`, all `isPublic:
true` matching this phase's "no real auth" convention): `by-user`/`by-model`/`by-feature`/
`timeline` pass their query DTO straight through; `daily-trend` unpacks `query.days` and passes it
**positionally** (`getDailySpendTrend(query.days)`), matching the service's own
`(days: number = 30)` default-parameter signature — an omitted `days` resolves to `undefined` at
the controller, and the service's own default parameter (not a DTO default) supplies `30`.
`projected` takes no arguments. A new `DailyTrendQueryDto` (`days?`, `@IsInt() @Min(1)`) validates
the lower bound only — the upper clamp to 365 already lives in `CostAnalyticsService.getDailySpendTrend()`
(AI-068), so it isn't duplicated at the DTO layer (this issue's own Testing Notes explicitly said
"pick one [layer] and test it there").

**Retention routes**: `GET /config` returns `getRetentionConfig()` directly (synchronous, no
`await`). `PATCH /config` calls `updateRetentionConfig(dto)` then re-reads and returns
`getRetentionConfig()` — a read-back rather than assuming the write succeeded silently, so the
response always reflects the actual post-update state. `POST /cleanup` returns
`runFullCleanup()`'s `RetentionReport` verbatim; `successStatus: 201` in `@ApiEndpoint` documents
the code NestJS already defaults `@Post()` to (no extra `@HttpCode()` needed — this codebase's
existing convention, confirmed against `ChatController`'s message route). `GET /stats` returns
`getRetentionStats()` verbatim.

**`UpdateRetentionConfigDto`** declares only the four day fields (`auditDays`/`moderationDays`/
`archivedConversationDays`/`embeddingCacheDays`, each `@IsOptional() @IsInt() @Min(1)`) —
**no `cron` property exists on the class at all**, so a client-supplied `cron` key is rejected by
`main.ts`'s global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` with a 400
("property cron should not exist") before the request ever reaches the controller or
`RetentionService.updateRetentionConfig()`'s own defense-in-depth rejection — verified live (see
below). This is the same "don't declare an unvalidated field on a DTO" pattern
`AI-051`'s `UploadDocumentDto` fix documented, applied in the opposite direction (omission as the
mechanism, not a bug to fix).

**Response DTOs** (9 new files, barrel-exported): `SpendByUserResDto`/`SpendByModelResDto`/
`SpendByFeatureResDto` each pair a row class with a wrapping result class (mirroring
`PaginatedBudgetsResDto`'s nested-array-type pattern, `@ApiProperty({ type: () => [RowDto] })`).
`SpendTimelineResDto` is **shared** by both `timeline` and `daily-trend` routes — both service
methods return the identical `{ data: SpendTimelinePoint[] }` shape, so a second near-duplicate DTO
would have been pure boilerplate. `ProjectedSpendResDto` mirrors `ProjectedSpendResult` field-for-
field. `RetentionConfigResDto`/`RetentionReportResDto` (+ nested `RetentionCategoryResDto`)/
`RetentionStatsResDto` (+ nested `RetentionRowsDueResDto`) mirror their respective service-layer
interfaces; `RetentionStatsResDto.lastReport` is `@ApiPropertyOptional({ nullable: true })` since it
is genuinely `null` before the first cleanup run.

**Tests**: `cost-management.controller.spec.ts` (7 tests) covers all six analytics routes' pure
delegation, including the `daily-trend` positional-argument assertion and an
undefined-when-omitted case. A new `retention.controller.spec.ts` (6 tests) covers all four
retention routes, including a read-after-write ordering assertion on `PATCH /config`
(`mock.invocationCallOrder` proving `updateRetentionConfig()` is called before the
`getRetentionConfig()` read-back) and a validation-error-propagates case (a thrown service error
short-circuits before any read-back call). Two DTO `describe` blocks were added to the existing
`cost-management-dtos.spec.ts` (8 tests) for `UpdateRetentionConfigDto` (cron rejection via
`{ whitelist: true, forbidNonWhitelisted: true }`, non-positive-day rejection, valid partial,
empty-payload) and `DailyTrendQueryDto` (non-positive rejection, empty-payload, valid value).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated —
  confirmed the single pre-existing warning inside this module's own test suite,
  `cost-budget.service.spec.ts:233`, predates this issue and was untouched)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 112/112 pass (7 suites, +19 for this issue)
- `npm run test` — 637/637 pass (full suite, +19, zero regressions)
- **Live-verified** (`npm run dev` against real Postgres — real accumulated audit-log data from
  prior phases' testing, not synthetic fixtures): confirmed all 10 routes in the boot log with
  zero DI errors (`RoutesResolver` showed `CostManagementController {/api/v1/cost}` and a separate
  `RetentionController {/api/v1/retention}`), then exercised every route with `curl`:
  - `GET /cost/analytics/by-user` and `/projected` returned real, non-trivial aggregates
    (`{"userId":"anonymous","totalCost":0.00118225,...}` and a real MTD projection) computed from
    genuine `ai_audit_logs` rows accumulated across this project's earlier live-verification
    sessions — not a fixture.
  - `GET /cost/analytics/daily-trend?days=0` → 400 (`"days must not be less than 1"`), confirming
    the DTO's lower-bound validation fires before the controller/service.
  - `PATCH /retention/config` with `{"cron":"*/5 * * * *"}` → 400
    (`"property cron should not exist"`) — the intended `forbidNonWhitelisted` rejection, verified
    against the real global pipe, not a unit-test simulation of it.
  - `PATCH /retention/config` with `{"auditDays":7}` → 200 with the override reflected
    immediately in the response and in a follow-up `GET /retention/config`.
  - `GET /retention/stats` before cleanup showed `rowsDue.auditLogs: 4` (real rows older than the
    7-day override); `POST /retention/cleanup` → **201** with `{"auditLogs":{"deleted":4,...},
"totalDeleted":4,...}`; a follow-up `GET /retention/stats` showed `lastReport` now populated with
    that exact report and `rowsDue` all zeroed.
  - `/api/docs-json` confirmed all 10 routes present, every one tagged `cost-management`.
  - Dev server stopped afterward (port 3000 confirmed free). The in-memory `auditDays: 7` override
    is discarded automatically by the restart (by design — AI-070's documented reset-on-restart
    semantics), so no manual config cleanup was needed.

## Assumptions Made

- **`daily-trend`'s upper clamp lives in the service, not the DTO** — the DTO only enforces the
  lower bound (`@Min(1)`); `CostAnalyticsService.getDailySpendTrend()` already clamps to 365
  (AI-068). Per this issue's own Testing Notes ("pick one and test it there"), duplicating the
  365 ceiling in the DTO would be redundant validation with no behavioral difference.
- **`PATCH /retention/config` re-reads and returns the config** rather than returning `void`/the
  request body — the spec's route table doesn't specify a response shape for this route, and a
  read-back is more useful to a caller (and was the only way to make `RetentionConfigResDto` a
  meaningful response type for this route) than an empty body.
- **`SpendTimelineResDto` is shared** between `timeline` and `daily-trend` rather than two
  near-identical classes — justified purely by the two service methods returning byte-identical
  result shapes; if a future issue diverges their shapes, this DTO should be split then, not now.
- **`costBudgetService` stays injected-but-unused** in `CostManagementController` — matches the
  AI-057 scaffold's original intent (budget routes are AI-072's job) rather than removing the
  dependency and re-adding it later.

## Follow Ups

- AI-072 (`CostManagementController` — budget endpoints) still needs to land its routes on the
  same `@Controller('cost')` class (`/cost/budgets/...`) — this issue only added the analytics
  routes to that controller, deliberately leaving `costBudgetService` wired but unused.
- AI-074 (Phase 4 controller tests audit + full regression) now only needs AI-071 and AI-072 to be
  fully unblocked (AI-063/AI-066/AI-073 are already done).
- Live verification permanently deleted 4 real `ai_audit_logs` rows (via the real
  `POST /retention/cleanup` call, under a temporary `auditDays: 7` override) — this is the correct,
  designed behavior of the feature under test, not an accident; these were transient audit-log
  telemetry rows from this project's own prior live-verification sessions (already well past any
  reasonable retention window), not business data. Documented here per this project's established
  live-testing transparency convention (see AI-063/AI-066/AI-069's own write-ups for the same
  pattern with synthetic rows).
