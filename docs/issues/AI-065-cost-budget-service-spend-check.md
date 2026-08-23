---
id: AI-065
title: CostBudgetService — spend aggregation + cached checkBudget() + alerts
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 4 — Cost Budgets — Service & Guard
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-064
---

# What to Build

The enforcement math on `CostBudgetService`, per spec §5.2/§8:

**`getUserSpend(userId, period)`** — `aiAuditLog.aggregate({ _sum: { estimatedCost } })` where
`userId`, `status: 'SUCCESS'`, `createdAt >= periodStart`. Daily period starts at midnight **UTC**
of the current day; monthly at the first of the current month UTC (compute with `Date.UTC()`, not
local-time methods). Null sum (no rows) → `0`.

**`checkBudget(userId)`** — returns the spec's `BudgetCheckResult`:

```typescript
interface BudgetCheckResult {
  allowed: boolean;
  dailySpend: number;
  monthlySpend: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyPercentage: number; // 0-100
  monthlyPercentage: number; // 0-100
  warning?: string; // "Approaching daily limit (85%)"
}
```

No budget row, `isActive: false`, or `costBudget.enabled=false` → `allowed: true` immediately with
zero aggregate queries (limits null, percentages 0). Otherwise: `allowed: false` when daily spend
≥ daily limit or monthly spend ≥ monthly limit (null limit = that dimension unlimited);
`warning` set when spend ≥ `alertThreshold × limit` on either dimension but still under the limit.

**In-memory spend cache** (NFR-COST-001): per-user `Map<userId, { entry, expiresAt }>` with TTL
from `costBudget.cacheTtlMs` (default 60s), the `TokenService` pricing-cache pattern. Cache the
_spend aggregates_ (both periods fetched in parallel on a miss); the budget row itself is read
fresh or cached alongside — either is fine, but **budget CRUD (AI-064's methods) must invalidate
the user's cache entry** so limit changes apply immediately.

**`getUsersApproachingLimit(threshold?)`** — reads active budgets with at least one non-null
limit, computes current spend per user (uncached is acceptable — this is an admin query, not a
hot path), returns those at/above `threshold ?? alertThreshold` of either limit as
`BudgetAlertDto[]` (userId, limits, spends, percentages, which dimension triggered).

# User Stories Covered

- Story 18 — under-limit check allows
- Story 19 — over-limit result carries spend + limit for the 429 message
- Story 20 — threshold warning surfaced
- Story 21 — 60s cache, invalidated on CRUD
- Story 22 — approaching-limit alert listing

# Acceptance Criteria

- [x] `getUserSpend()` filters `status: 'SUCCESS'` with correct UTC period starts; empty → 0
- [x] `checkBudget()` returns the exact `BudgetCheckResult` shape; over-limit on either dimension blocks; null limits never block
- [x] Warning present at ≥ threshold and absent both below threshold and when blocked
- [x] No-budget/inactive/disabled short-circuit with zero aggregate queries
- [x] Fake-timer test: N checks within TTL → one aggregate round; post-TTL → refresh; CRUD → immediate invalidation
- [x] `getUsersApproachingLimit()` returns correct users with trigger dimension
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-064 (budget CRUD + cache-invalidation hook points)

# Testing Notes

Extend `cost-budget.service.spec.ts`. Freeze the clock (`jest.useFakeTimers().setSystemTime(...)`)
so midnight-UTC/first-of-month boundaries are deterministic — assert the exact `createdAt: { gte }`
dates passed to `aiAuditLog.aggregate`. Cache behavior via fake timers + call-count assertions on
the aggregate mock. Percentage math checked against a fixture (e.g. $0.45 of $1.00 → 45).

## Implementation Notes

`CostBudgetService` (`src/modules/cost-management/services/cost-budget.service.ts`) gained the
enforcement math on top of AI-064's CRUD:

- **`getUserSpend(userId, period)`** — a single `aiAuditLog.aggregate({ _sum: { estimatedCost } })`
  call filtered by `status: AiAuditStatus.SUCCESS` and `createdAt: { gte: periodStart }`.
  `periodStart` comes from a private `getPeriodStart()` that reads the current UTC date/month via
  `new Date().getUTCFullYear()/getUTCMonth()/getUTCDate()` and reconstructs it with `Date.UTC()` —
  never a local-time method, so the boundary is correct regardless of the server's local timezone.
  `AiAuditStatus` is imported directly from `openai/constants/ai-audit-status.enum` as a plain
  value import (no NestJS DI/module coupling) — the same cross-module enum-import convention
  `ChatService` already established; `CostManagementModule` still doesn't import `OpenaiModule`
  per its own scaffold design.
- **`checkBudget(userId)`** — checks `costBudget.enabled` first (zero DB calls at all when
  disabled), then looks up the budget row directly (one `findUnique`, not through
  `findBudgetByUserId()`'s entity-mapping layer, since the raw `dailyLimitUsd`/`alertThreshold`
  fields are needed here). No row or `isActive: false` → the same `unrestrictedResult()` (`allowed:
true`, both limits `null`, both percentages `0`, no `warning` key) with zero aggregate queries —
  satisfying the "zero aggregate queries" criterion without needing to skip the budget lookup
  itself (only the `ai_audit_logs` aggregate is the expensive part being avoided). Otherwise pulls
  both spend figures from the cache (see below), computes `allowed`/percentages, and sets `warning`
  only on the still-allowed path (a blocked result never also carries a warning — spec's own
  distinction between "over limit" and "approaching limit").
- **Spend cache** — a single `Map<string, { entry: { dailySpend, monthlySpend }; expiresAt }>`
  keyed by `userId`, TTL from `costBudget.cacheTtlMs` (default `60000`). A cache miss fetches both
  periods via `Promise.all()` in one round. This is intentionally a per-key-TTL map, not
  `TokenService`'s single-shared-expiry pattern (that pattern refreshes the _whole_ cache on one
  timer; here each user's entry must expire independently based on when _that user_ was last
  checked). `createBudget()`/`updateBudget()`/`deleteBudget()` (AI-064) each now call a private
  `invalidateSpendCache(userId)` right after their write — for `updateBudget()`/`deleteBudget()`
  the `userId` comes from the row `findBudgetOrThrow()` already fetched (no extra query needed).
- **`getUsersApproachingLimit(threshold?)`** — one `findMany({ where: { isActive: true, OR: [...] }
})` for active budgets with at least one non-null limit, then a private
  `buildAlertIfApproaching()` per budget (parallelized via `Promise.all(budgets.map(...))`,
  filtering out `null`s) — deliberately bypasses the spend cache (`getUserSpend()` directly, not
  `getCachedSpend()`), per the issue's own "uncached is acceptable — admin query, not a hot path"
  guidance. `triggeredBy: 'daily' | 'monthly' | 'both'` records which dimension(s) crossed
  `threshold ?? budget.alertThreshold`.

Two new interfaces landed in `types/cost-management.types.ts` — `BudgetCheckResult` and
`BudgetAlertDto` — as plain TS interfaces (not Swagger-decorated classes), matching this
codebase's established convention of using `types/*.types.ts` interfaces for internal
service-to-service contracts before a real controller-facing response DTO exists (e.g. RAG's
`RagOptions`/`RagResult` predated `AskResDto`). No controller consumes either type yet — that's
AI-066 (`CostBudgetGuard`) and AI-073 (`CostManagementController` analytics/alerts routes).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (pre-existing warnings elsewhere unrelated)
- `npm run build` — succeeds
- `npm run test -- cost-budget` — 30/30 pass
- `npm run test` — 560/560 pass (full suite, no regressions)

No live `npm run dev` verification was performed — this issue is pure service-layer logic with no
new HTTP route (`CostBudgetGuard`/`CostManagementController` land in AI-066/AI-072/AI-073), so
there is nothing to exercise over the wire yet; the issue's own Testing Notes only asked for unit
test coverage.

## Assumptions Made

- `BudgetCheckResult`/`BudgetAlertDto` are plain interfaces in `types/`, not Swagger `ResDto`
  classes, since no controller exists yet to document against — consistent with how RAG's
  service-layer types predated their controller DTOs.
- `getUsersApproachingLimit()`'s per-budget alert computation is parallelized across budgets via
  `Promise.all()` — the issue text doesn't specify sequential vs. parallel for this admin-only
  query, and nothing in this codebase's established conventions (e.g. `MockDataService.evaluate()`
  going sequential to respect real external rate limits) applies here, since this only touches the
  local Postgres instance.
- A blocked (`allowed: false`) result never also carries a `warning` — read from the spec's
  `BudgetCheckResult` example JSON only ever showing one or the other, and from the plain English
  distinction between "exceeded" (429) and "approaching" (header warning) in spec §8.1.

## Follow Ups

- AI-066 (`CostBudgetGuard`) is now unblocked on its `checkBudget()` dependency (still needs
  AI-063, already completed, for its "apply to routes" half).
- AI-072 (`CostManagementController` budget endpoints) is now unblocked — it was the only issue
  blocked solely on this one.
- `getUsersApproachingLimit()` has no consumer yet; AI-073's analytics/alerts endpoint is the
  expected first caller.
