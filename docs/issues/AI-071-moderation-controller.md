---
id: AI-071
title: ModerationController — check, check-batch, logs & stats endpoints
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
  - AI-060
---

# What to Build

The standalone moderation API surface (spec §6.1) — four routes on the AI-057 stub controller,
each a thin delegate following `RagController`'s conventions (`@ApiEndpoint()` per route, private
mappers, no business logic), plus the two query methods on `ModerationService` they need:

- `POST /moderation/check` → `moderateText(dto.text, { source: dto.source ?? 'standalone',
direction: 'input', userId })` — `CheckModerationDto` (`text` required `@IsNotEmpty`,
  `source?`), response is the `ModerationResult` shape as `ModerationResultResDto`
- `POST /moderation/check-batch` → `moderateBatch(dto.texts)` — `texts: string[]`
  (`@IsArray`, non-empty, capped at a sane max like 50, each `@IsString`), response array
- `GET /moderation/logs` → new `ModerationService.getModerationLogs(query)` —
  `QueryModerationLogsDto` (`userId?`, `isFlagged?`, `direction?`, `source?`,
  `startDate?`/`endDate?`, pagination with the standard `@Type(() => Number)`/limit-cap
  conventions), `PaginatedModerationLogsResDto` (publicId, never internal id)
- `GET /moderation/stats` → new `ModerationService.getModerationStats(query)` — totals, flagged
  count, violation rate, per-direction split, top flagged categories (aggregate + a small
  in-application tally over the JSONB `categories` of flagged rows within the date range —
  bounded by the range filter), `ModerationStatsResDto`

Response envelope is the global `{ success, data, timestamp }` — the spec's `code: "MOD_001"`
examples are not adopted (PRD decision, consistent with Phases 1–3). All DTOs barrel-exported;
routes under the `moderation` Swagger tag registered in AI-057.

# User Stories Covered

- Story 4 — standalone clean-text check with scores
- Story 5 — batch check
- Story 15 — logs + stats queryable
- Story 32/33 — Swagger + DTO validation

# Acceptance Criteria

- [x] All four routes delegating thinly; check routes log with `source` defaulting to `'standalone'`
- [x] `getModerationLogs()` filters (user/flagged/direction/source/date range) + pagination asserted on Prisma call args
- [x] `getModerationStats()` returns totals, violation rate, top categories; zero-data → zeroed result, no NaN
- [x] DTO validation: missing `text` 400s; empty/oversized `texts` array 400s; date/pagination coercion works
- [x] All routes in `/api/docs-json` under `moderation`
- [x] Controller delegation tests + DTO `validate()` smoke tests green; full suite passes

# Dependencies

- AI-060 (`ModerationService` core; the two query methods land here)

# Testing Notes

Service-side query tests extend `moderation.service.spec.ts` (DeepMockProxy fixtures). Controller
tests in a new `moderation.controller.spec.ts` mirroring `rag.controller.spec.ts`'s
`TestingModule` + `jest.fn()`-mock pattern (with the standard Prisma-ESM stub). DTO tests follow
`chat-dtos.spec.ts`. No live moderation calls — the upstream is mocked at `ModerationService`.

## Implementation Notes

**Two new `ModerationService` methods** (spec §5.1) sit alongside the existing `moderateText()`/
`moderateBatch()`:

- **`getModerationLogs(query)`** — paginated read over `moderation_logs`, mirroring
  `AiAuditService.findAll()`'s shape exactly (`Math.min(limit, 100)`, parallel `findMany`/`count`).
  A private `buildLogsWhere()` layers `userId`/`isFlagged`/`direction`/`source` equality filters on
  top of a shared `buildDateRangeWhere()` helper (the same `createdAt: { gte, lte }` pattern
  `AiAuditService`/`CostAnalyticsService` already use). Rows are mapped to a `ModerationLogEntity`
  via a private `toLogEntity()` — `publicId`, never the internal `id`; `categories`/
  `categoryScores` cast from the Prisma `Json` columns to their real `Record<string, boolean>`/
  `Record<string, number>` shapes at the read boundary (same cast pattern
  `ToolRegistryService`/`DocumentService` already use for JSON column reads).
- **`getModerationStats(query)`** — five parallel queries over the same date-range where clause:
  `totalChecks`/`flaggedCount` (`count()`), `input`/`output` counts (`count()` with a `direction`
  filter added), and a `findMany({ select: { categories: true } })` over only the **flagged** rows
  within the range. A private `tallyTopCategories()` does a small in-application pass over just
  those flagged rows' JSONB `categories`, counting each `true` category and returning the top 5 by
  count — bounded by the same date-range filter as everything else (never a full-table scan, per
  the issue's own framing). `violationRate = flaggedCount / totalChecks` guarded by a
  `totalChecks > 0` ternary, so an empty table returns `0`, never `NaN`.

**Controller** (`moderation.controller.ts`, replacing the AI-057 stub): four thin routes, all
`isPublic: true`. `POST /check` resolves `userId` via the shared
`resolveUserId()` util (`src/common/utils/`, the same convention `ModerationGuard`/
`CostBudgetGuard` already use — `x-user-id` header, falling back to `body.userId`) from a `@Req()`
Express `Request`, and calls `moderateText(dto.text, { source: dto.source ?? 'standalone',
direction: ModerationDirection.INPUT, userId })` — `direction: INPUT` is passed explicitly even
though it's already `moderateText()`'s own default, self-documenting the route's intent (matching
`ModerationGuard`'s established "explicit even when redundant" convention for `action: BLOCKED`).
`POST /check-batch` is a pure one-line delegate (`moderateBatch()` takes no options — spec §5.1's
signature). `GET /logs` maps the paginated result's nullable `requestId`/`userId` fields to
`undefined` via a private `toLogRes()` mapper (the same `?? undefined` convention every other
paginated-list route in this codebase uses for Swagger's `@ApiPropertyOptional()` semantics).
`GET /stats` is a pure delegate.

**DTOs** (10 new files under `src/modules/moderation/dto/`, barrel-exported): `CheckModerationDto`
(`text` required `@IsNotEmpty`, `source?`), `CheckBatchModerationDto` (`texts: string[]`,
`@ArrayNotEmpty` + `@ArrayMaxSize(50)` + `@IsString({ each: true })`), `QueryModerationLogsDto`
(`userId?`, `isFlagged?`, `direction?` — `@IsIn(Object.values(ModerationDirection))` since
`ModerationDirection` is an `as const` object with a derived union type, not a native TS `enum`,
matching this codebase's established `DocumentSourceType`/`category` validation convention —
`source?`, `startDate?`/`endDate?`, `page?`/`limit?`), `ModerationStatsQueryDto` (date range only).
Response DTOs: `ModerationResultResDto` (+ nested `HighestScoreResDto`), `ModerationLogResDto`,
`PaginatedModerationLogsResDto`, `ModerationStatsResDto` (+ nested
`ModerationDirectionSplitResDto`/`TopFlaggedCategoryResDto`). `Record<string, boolean>`/
`Record<string, number>` fields (`categories`/`categoryScores`) use the
`@ApiProperty({ type: 'object', additionalProperties: {...} })` pattern already established by
`ModelPricingResDto`.

**Real bug found and fixed during live verification, not present in the original plan**: a query
GET request with `?isFlagged=false` returned zero rows against a table where all 14 existing rows
had `isFlagged: false` (confirmed independently via `GET /moderation/stats`'s
`flaggedCount: 0`/`totalChecks: 14`) — the filter was silently inverted. Root cause, confirmed with
a standalone reproduction script: `main.ts`'s global `ValidationPipe` sets
`transformOptions: { enableImplicitConversion: true }`, and class-transformer's `PLAIN_TO_CLASS`
transform order runs its own naive `Boolean(value)` coercion **before** any `@Transform` decorator
runs — `Boolean('false')` is `true` in JavaScript (any non-empty string is truthy), so the string
`'false'` becomes the boolean `true` before a first-draft `@Transform(({ value }) => ...)` fix ever
saw it (verified this first draft still failed with a standalone script). The actual fix reads the
**original, untransformed** value via the `@Transform` callback's `obj`/`key` parameters
(`obj[key]`) instead of its already-coerced `value` parameter, bypassing the pre-coercion entirely
— verified both via the standalone repro script and live against the real running app afterward
(`?isFlagged=false` → 14/14 matched; `?isFlagged=true` → 0). **`QueryBudgetsDto.isActive`
(AI-064, already shipped) has the identical latent bug** (`@Type(() => Boolean)` on a query-string
boolean) — not fixed here since it's a different, already-completed DTO outside this issue's file
scope; flagged below as a Follow Up.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated —
  confirmed the 8 warnings inside `moderation.service.spec.ts` are all in pre-existing
  `moderateText()`/`moderateBatch()` test blocks, not this issue's new code)
- `npm run build` — succeeds
- `npm run test -- moderation` — 67/67 pass (5 suites, +44 for this issue)
- `npm run test` — 666/666 pass (full suite, +29, zero regressions)
- **Live-verified** (`npm run dev` against real Postgres): all four routes confirmed in the boot
  log (`ModerationController {/api/v1/moderation}`) with zero DI errors. `POST /check` and
  `/check-batch` both returned 200/201 with a `ModerationResult` shape (though the underlying
  OpenAI moderation call itself fails open — the already-tracked, pre-existing AI-059 finding that
  OpenRouter doesn't proxy `/moderations`; confirmed via `psql` that each check still wrote a
  `moderation_logs` row with `metadata: {"failedOpen": true}`, proving this route's own
  request→controller→service→DB pipeline works correctly end to end regardless of that separate,
  already-tracked upstream issue). `text: ''`/missing → 400; `texts: []` → 400. `GET /logs`
  paginated correctly and, after the boolean-coercion fix above, filtered `isFlagged` correctly in
  both directions. `GET /logs?direction=sideways` → 400. `GET /stats` returned real aggregate
  numbers matching the `psql`-confirmed row count. `/api/docs-json` confirmed all 4 routes tagged
  `moderation`. Dev server stopped afterward, port 3000 confirmed free.

## Assumptions Made

- **`getModerationStats()`'s date range is the only filter** (no `userId`/`source`/`direction`
  narrowing) — matching the spec's `ModerationStatsQueryDto` signature, which the issue's own "What
  to Build" text lists with only a date range implied by "within the date range."
- **Top-categories tally is capped at 5** (`DEFAULT_TOP_CATEGORIES_LIMIT`) — the spec says "top
  flagged categories" without a number; 5 matches this codebase's existing convention for a "top N"
  list elsewhere (none directly precedent, but a small fixed cap keeps the response bounded).
- **`POST /check-batch`'s 50-item cap** is a plain module constant (`MAX_BATCH_SIZE`), matching the
  issue's own "capped at a sane max like 50" wording literally.
- **`ModerationController` and its DTOs never import `ModerationGuard`/
  `OutputModerationInterceptor`** — this is the standalone moderation API, not a route being
  guarded; those two are applied to chat/RAG routes (AI-063), not to this module's own routes.

## Follow Ups

- **`QueryBudgetsDto.isActive` (AI-064) has the same query-string boolean-coercion bug** discovered
  and fixed here for `QueryModerationLogsDto.isFlagged` — `?isActive=false` on `GET /cost/budgets`
  almost certainly also silently resolves to `true`. Out of this issue's scope (a different,
  already-shipped module's DTO) but worth a follow-up fix using the same `obj[key]`-based
  `@Transform` pattern documented in `query-moderation-logs.dto.ts`.
- AI-059 (live probe — does OpenRouter proxy `/moderations`?) remains the open item blocking a real
  (non-fail-open) moderation check demonstration; this issue's own live verification reconfirmed
  the same fail-open behavior AI-063 already found, with no new information.
- AI-074 (Phase 4 controller tests + full regression) now only needs AI-072 to be fully unblocked.
