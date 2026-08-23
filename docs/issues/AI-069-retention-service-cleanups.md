---
id: AI-069
title: RetentionService — batched cleanup methods + RetentionReport
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 6 — Data Retention
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-056
  - AI-057
---

# What to Build

The four cleanup methods plus the aggregating full run on `RetentionService`, per spec §5.4/§9 —
no cron yet (AI-070):

- `cleanupAuditLogs(retentionDays)` — `aiAuditLog` rows where `createdAt < now - retentionDays`
- `cleanupModerationLogs(retentionDays)` — same cutoff logic on `moderationLog`
- `cleanupArchivedConversations(retentionDays)` — `chatConversation` where `isArchived: true AND
updatedAt < cutoff`; messages go via the existing `onDelete: Cascade` — never deleted manually
- `cleanupStaleEmbeddingCache(retentionDays)` — `embeddingCache` where `createdAt < cutoff`.
  Pure time-based: cache rows carry no chunk reference, so the spec's "not referenced by an active
  chunk" condition is unenforceable — the only cost of over-deletion is one re-embedding
  (PRD decision, restate in a code comment).

Each returns `{ deleted: number }` and deletes in **fixed-size batches** (NFR-RET-001): loop
`deleteMany({ where: { id: { in: batchIds } } })` over id pages selected by the cutoff (or an
equivalent bounded-delete pattern) with a batch size constant (e.g. 1000), summing counts — never
one unbounded `deleteMany` over a potentially 100K-row backlog. Cutoffs computed in UTC; a row
aged exactly `retentionDays` is **kept** (strict `<`).

`runFullCleanup()` runs all four sequentially using the currently effective config
(env-namespaced values falling back to `RETENTION_CONFIG` — AI-057) and returns a
`RetentionReport` (per-category deleted counts + `ranAt` + duration), logging the spec §9.2
one-line summary via `AppLoggerService`. One category failing logs the error and continues to the
next — a partial cleanup beats an aborted one; the report marks the failed category.

Safety by omission (FR-RET-002): no method touching active conversations, documents, or chunks
exists at all — enforced by a test asserting the service's public surface.

# User Stories Covered

- Story 27 — the four cleanups with correct default periods
- Story 28 — active data structurally untouchable
- Story 29 — batched deletes bounded in time

# Acceptance Criteria

- [x] All four methods with strict-`<` UTC cutoffs; boundary row kept
- [x] Archived-conversation filter is `isArchived: true` + `updatedAt` cutoff; no manual message deletion
- [x] Batch loop: mocked 2.5-batch backlog → 3 delete calls, counts summed correctly
- [x] `runFullCleanup()` aggregates the report, logs the summary line, continues past a single-category failure
- [x] No public method can touch documents/chunks/active conversations (surface test)
- [x] Unit tests cover cutoff math, batching, report aggregation, partial-failure continuation
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-056 (`moderation_logs` exists to clean), AI-057 (retention config namespace + constant)

# Testing Notes

New `retention.service.spec.ts`: `DeepMockProxy<DatabaseService>` (+ ESM stub), frozen clock for
deterministic cutoffs — assert the exact `lt` dates. Batching tested by scripting `findMany` id
pages of sizes [1000, 1000, 500] and counting `deleteMany` calls. Never test via real timers or
cron — direct method calls only (cron is AI-070).

## Implementation Notes

`RetentionService` (`src/modules/cost-management/services/retention.service.ts`) replaces AI-057's
constructor-only shell with the four cleanups + `runFullCleanup()` per spec §5.4/§9. No cron and no
`getRetentionConfig()`/`updateRetentionConfig()` — those are AI-070's runtime-config/cron concern.
No module wiring change: `CostManagementModule` already provides `RetentionService` from AI-057.

**Batched deletes (NFR-RET-001)** — a single private `runBatchedDelete(fetchIds, deleteByIds)`
helper drives all four cleanups via closures, so each cleanup body only differs by its Prisma
delegate and where-clause. It pages ids ascending (`findMany({ where, select: { id: true },
orderBy: { id: 'asc' }, take: RETENTION_BATCH_SIZE })`), deletes each page by
`deleteMany({ where: { id: { in: ids } } })`, sums `count`, and stops when a page is empty **or**
shorter than the batch size (`hasMore = rows.length === RETENTION_BATCH_SIZE`). `RETENTION_BATCH_SIZE
= 1000` — never an unbounded `deleteMany` over a 100K-row backlog. The short-page early-break means
a 2.5-batch backlog ([1000, 1000, 500]) issues exactly 3 `findMany` + 3 `deleteMany` calls with no
wasted 4th probe query, while an exact multiple falls through to a final empty page and breaks
there.

**Cutoffs** — a private `computeCutoff(retentionDays)` returns
`new Date(Date.now() - retentionDays * MS_PER_DAY)`; millisecond arithmetic is timezone-agnostic
(UTC-correct), and every where-clause
uses a strict `lt`, so a row aged _exactly_ `retentionDays` is kept, not deleted.

**The four cleanups:**

- `cleanupAuditLogs` / `cleanupModerationLogs` — `createdAt < cutoff` on `aiAuditLog` /
  `moderationLog`.
- `cleanupArchivedConversations` — `{ isArchived: true, updatedAt: { lt: cutoff } }` on
  `chatConversation`. Messages are removed by the schema's `onDelete: Cascade` — never deleted
  manually. Active (non-archived) rows are excluded by the `isArchived: true` filter and, more
  fundamentally, by there being **no method that deletes active conversations at all** (FR-RET-002
  safety-by-omission).
- `cleanupStaleEmbeddingCache` — `createdAt < cutoff` on `embeddingCache`. Documented in a code
  comment as intentionally pure-time-based: cache rows carry no chunk reference, so the spec's "not
  referenced by an active chunk" condition is unenforceable; the only cost of over-deleting a
  still-referenced entry is one re-embedding on the next miss (PRD decision).

**`runFullCleanup()`** — runs the four sequentially against `getEffectiveConfig()` (reads the
`retention` config namespace via `ConfigService`, falling back field-by-field to `RETENTION_CONFIG`
— AI-057's constant), returning a `RetentionReport` (per-category `{ deleted, failed, error? }` +
`totalDeleted` + `ranAt` + `durationMs`). Each category runs inside a private `runCategory()`
try/catch: a thrown error is logged via `AppLoggerService.error()` and the category is marked
`failed: true` (deleted 0), and the run **continues** to the next category — a partial cleanup beats
an aborted one. The spec §9.2 one-line summary (`Retention cleanup: deleted X audit logs, Y
moderation logs, Z conversations, W cache entries (<ms>)`) is always logged via
`AppLoggerService.log()`, even after a partial failure.

New types `RetentionCategoryResult` / `RetentionReport` in `types/cost-management.types.ts`.

**Tests** (`retention.service.spec.ts`, 11) follow `cost-budget.service.spec.ts`'s
`jest.mock('.../database.service', ...)` ESM guard + `mockDeep<DatabaseService>()`, with a frozen
clock (`jest.useFakeTimers()` + `setSystemTime(FROZEN_NOW)`, real timers restored in `afterEach`)
so cutoff `lt` dates are asserted exactly. Coverage: per-table cutoff/where shape, archived-only +
`updatedAt` filter, embedding-cache createdAt cutoff, no-op empty backlog (no `deleteMany`), the
[1000, 1000, 500] → 3-delete batch summation, exact-batch-then-empty stop, full-run aggregation +
config-derived cutoffs + summary line, `RETENTION_CONFIG` fallback when the namespace is unset,
single-category-failure continuation, a runtime FR-RET-002 assertion that
`document`/`documentChunk`/`chatMessage` `deleteMany` are never called during a full run, and a
public-surface test that no method name references documents/chunks/active data.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 68/68 pass (5 suites)
- `npm run test` — 593/593 pass (full suite, +11 for this issue's spec, zero regressions)

## Assumptions Made

- **`RetentionReport` shape** — the spec names the type but not its fields. Chosen shape:
  per-category `{ deleted, failed, error? }` (so a partial failure is machine-readable, not just
  logged) + `totalDeleted` + `ranAt` (`Date`) + `durationMs`. AI-070's manual-trigger endpoint /
  stats route can reshape at the controller boundary.
- **Batch size 1000**, a module constant in the service file (the issue's "e.g. 1000"). Kept local
  rather than in `retention-config.constant.ts`, since it's an implementation-detail bound, not an
  operator-tunable retention period.
- **`getRetentionConfig()`/`updateRetentionConfig()` deliberately not implemented here** — they are
  AI-070's runtime-config surface; this issue's "What to Build" lists only the four cleanups +
  `runFullCleanup()`. `runFullCleanup()` reads config directly via `ConfigService` for now.
- **Fallback is field-by-field** (`config?.auditDays ?? RETENTION_CONFIG.auditLogRetentionDays`,
  etc.) so a partially-populated namespace still resolves every period.

## Follow Ups

- AI-070 (RetentionService — dynamic cron registration + runtime config) is now unblocked: it adds
  the `@Cron` schedule driven by `retention.cron`, `getRetentionConfig()`/`updateRetentionConfig()`
  with `SchedulerRegistry`-based re-registration, and wires `runFullCleanup()` to the schedule.
- AI-073 will expose `POST /retention/cleanup` (manual trigger → `runFullCleanup()`) and
  `GET /retention/stats`; the `RetentionReport` shape here is what those routes will serialize.
- A future optimization could replace the two-query page-then-delete with a single
  `deleteMany({ where: { <field>: { lt: cutoff } }, limit })` once Prisma's `deleteMany` gains a
  bounded-`limit` option — not available in the pinned Prisma v7 today, so the id-page loop stands.
