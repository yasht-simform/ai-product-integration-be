---
id: AI-067
title: CostAnalyticsService — spend by user, model & feature
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
  - AI-057
---

# What to Build

The three dimension-grouped analytics queries on `CostAnalyticsService`, per spec §5.3 — all
read-only over `ai_audit_logs` via Prisma `groupBy`, all filtering `status: 'SUCCESS'` (the same
spend definition budgets use) and all accepting optional `startDate`/`endDate` range filters,
following `AiAuditService.getCostSummary()`'s existing date-handling conventions:

- **`getSpendByUser(query)`** — `groupBy: ['userId']`, `_sum: { estimatedCost, totalTokens }`,
  `_count`, paginated and sortable by total spend (descending default). Rows with null `userId`
  aggregate under a literal `'anonymous'` bucket in the response rather than being dropped —
  unattributed spend is still spend.
- **`getSpendByModel(query)`** — `groupBy: ['model']` with the same aggregates.
- **`getSpendByFeature(query)`** — `groupBy: ['endpoint']`, mapped to feature labels
  (`chat.completions` → `'chat'`, `'embeddings'`, `'moderations'`). Chat-vs-RAG completions are
  not distinguishable from existing audit columns — document this limitation in the service (and
  later in Swagger), per the PRD's no-new-audit-column decision.

Result interfaces (`SpendByUserResult` etc.) go in the cost-management types file; response DTOs
are AI-073's concern unless trivially co-created. Query DTOs (`SpendByUserQueryDto` etc. —
startDate/endDate/pagination/sort) land here since the service signatures need them.

# User Stories Covered

- Story 23 — spend per user (paginated, sortable) and per model
- Story 24 — spend per feature

# Acceptance Criteria

- [x] All three methods with `status: 'SUCCESS'` + optional date-range filters, asserted on exact Prisma call args
- [x] By-user pagination + spend-descending sort; null userId → `'anonymous'` bucket
- [x] Feature mapping from `endpoint` values with the chat-vs-RAG limitation documented
- [x] Empty table → empty arrays / zeroed totals, never NaN
- [x] Unit tests with fixture `groupBy` returns covering all three + date filtering
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-057 (module scaffold; no Phase 4 schema needed — reads Phase 1's table)

# Testing Notes

New `cost-analytics.service.spec.ts`: `DeepMockProxy<DatabaseService>` (+ ESM stub), scripted
`aiAuditLog.groupBy` returns. The valuable assertions are the _arguments_ (where-clause, groupBy
fields, `_sum` selections, orderBy, skip/take) and the post-processing (anonymous bucket, feature
label mapping, sort) — Prisma itself isn't under test.

## Implementation Notes

`CostAnalyticsService` (`src/modules/cost-management/services/cost-analytics.service.ts`) replaces
the AI-057 constructor-only shell with the three dimension-grouped read-only aggregates per spec
§5.3, all over `ai_audit_logs` via Prisma `groupBy`. All three share a private `buildWhere(query)`
that unconditionally sets `status: AiAuditStatus.SUCCESS` (the exact spend definition
`CostBudgetService.getUserSpend()` uses — same cross-module plain-value enum import from
`../../openai/constants/ai-audit-status.enum`, no `OpenaiModule` DI coupling added) and applies the
optional `startDate`/`endDate` range via `createdAt: { gte, lte }`, mirroring
`AiAuditService.getCostSummary()`/`buildWhereClause()`'s existing conventions verbatim.

- **`getSpendByUser(query)`** — `groupBy: ['userId']`, `_sum: { estimatedCost, totalTokens }`,
  `_count: { _all: true }`, `orderBy: { _sum: { estimatedCost: sortOrder } }` (default `'desc'`),
  paginated with `skip`/`take`. A null `userId` maps to the literal `'anonymous'` bucket in the
  mapped row (via a `?? ANONYMOUS_BUCKET` module constant) rather than being dropped. Pagination
  `total` (distinct-user count) comes from a **second** `groupBy(['userId'])` with no
  `skip`/`take`/aggregates run in the same `Promise.all()` — Prisma `groupBy` has no built-in
  total-groups count, so `allGroups.length` is the cheapest correct source.
- **`getSpendByModel(query)`** — `groupBy: ['model']`, same aggregates, spend-descending, no
  pagination (bounded distinct-model set).
- **`getSpendByFeature(query)`** — `groupBy: ['endpoint']`, mapped through a `FEATURE_LABELS`
  `Record<string, string>` (`chat.completions` → `'chat'`, `embeddings` → `'embeddings'`,
  `moderations` → `'moderations'`, unknown endpoint → passthrough). The **chat-vs-RAG
  indistinguishability** is documented in an inline block comment on `FEATURE_LABELS`: chat
  completions serve both plain chat and RAG answer generation, and `ai_audit_logs` has no
  feature/source column (the PRD's deliberate no-new-audit-column decision), so RAG-driven spend
  folds into the `'chat'` bucket. Each returned row carries both the mapped `feature` and the raw
  `endpoint` so a consumer can still see the underlying dimension.

Every mapped numeric field uses `?? 0`, so an all-null aggregate (or an empty table) yields zeroed
numbers / empty arrays, never `NaN`/`null`.

**DTOs** (`src/modules/cost-management/dto/`, barrel-exported): a shared
`SpendAnalyticsQueryDto` base (`startDate`/`endDate`, `@IsDateString()` — matching
`CostSummaryQueryDto`) with `SpendByUserQueryDto extends` it adding `page`/`limit`
(`@Type(() => Number)` + `@Min`/`@Max(100)`, matching `QueryBudgetsDto`) and `sortOrder`
(`@IsIn(['asc', 'desc'])`); `SpendByModelQueryDto`/`SpendByFeatureQueryDto` are empty subclasses of
the base (date-range only), kept as named classes so AI-073's controller/Swagger get correct type
names. Result interfaces (`SpendByUserResult`/`SpendByModelResult`/`SpendByFeatureResult` + their
`*Row` shapes) live in `types/cost-management.types.ts`; **response DTOs are deferred to AI-073**
per this issue's scope note.

Follows the established test convention exactly (`cost-budget.service.spec.ts`'s
`jest.mock('.../database.service', ...)` ESM guard + `mockDeep<DatabaseService>()`); the injected
`AppLoggerService` is retained on the constructor (unused by these read paths, but kept for parity
with the shell and future logging). No module wiring change was needed —
`CostManagementModule` already registers `CostAnalyticsService` as a provider from AI-057.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 57/57 pass (4 suites; +14 including budget/guard/retention)
- `npm run test` — 582/582 pass (full suite, +11 for this issue's spec, zero regressions)

## Assumptions Made

- **Response shape**: the spec (§5.3) only lists method signatures, not result field names. Each
  row exposes `totalCost`/`totalTokens`/`callCount` alongside its group key; `getSpendByUser`
  additionally returns `total`/`page`/`limit` (matching `PaginatedBudgetsResult`'s shape). AI-073's
  response DTOs can rename/reshape at the controller boundary if the FE dashboard needs different
  labels.
- **`total` = distinct-group count**, obtained via a second unpaginated `groupBy` — chosen over a
  raw `count()` (which counts rows, not groups) or an in-memory slice of a full groupBy (which
  would defeat DB-side pagination). Two lightweight groupBys is the correct-and-simple tradeoff at
  this project's scale.
- **`sortOrder` applies to total spend only** (spec says "sortable by total spend") — no secondary
  sort key or multi-column sort was added.
- **Feature labels are lowercase single words** (`'chat'`/`'embeddings'`/`'moderations'`) matching
  the spec §6 route comment (`by-feature — Spend per feature (chat, rag, embeddings)`); `'rag'` is
  intentionally absent as a distinct label for the documented indistinguishability reason.

## Follow Ups

- AI-068 (`getSpendTimeline`/`getDailySpendTrend`/`getProjectedMonthlySpend`) is now unblocked —
  it extends this same service with the time-series analytics.
- AI-073 (`CostManagementController` analytics endpoints) will add the `GET /cost/analytics/*`
  routes and Swagger response DTOs on top of these methods, and should carry the chat-vs-RAG
  limitation note into the Swagger description per this issue's spec text.
- If distinguishing RAG spend from plain-chat spend ever becomes a real requirement, it needs a new
  `ai_audit_logs` column (feature/source) written at call time — explicitly out of scope for
  Phase 4 per the PRD.
