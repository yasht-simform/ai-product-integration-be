---
id: AI-072
title: CostManagementController — budget endpoints
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
  - AI-065
---

# What to Build

The budget API surface (spec §6.2) — six routes on the AI-057 stub controller, thin delegates to
`CostBudgetService` (AI-064/AI-065):

- `POST /cost/budgets` → `createBudget()` (201; duplicate userId propagates 409)
- `GET /cost/budgets` → `findAllBudgets()`
- `GET /cost/budgets/alerts` → `getUsersApproachingLimit()` — **must be declared before the
  `:userId` route** or NestJS matches `alerts` as a userId; pin this ordering with a test
- `GET /cost/budgets/:userId` → budget + current spend combined: `findBudgetByUserId()` +
  `checkBudget()` composed into the spec §6.2 status response (`dailySpend`, `monthlySpend`,
  limits, percentages, and a derived `status` string — `'within_budget'` / `'approaching_limit'` /
  `'exceeded'`). Unknown userId with no budget → 404 here (unlike the guard's pass-through
  semantics, a direct lookup of a nonexistent resource is a NotFound)
- `PATCH /cost/budgets/:publicId` → `updateBudget()`
- `DELETE /cost/budgets/:publicId` → `deleteBudget()` — 204 `@HttpCode(HttpStatus.NO_CONTENT)` +
  `@ApiNoContentResponse`, per the codebase's delete convention

New response DTOs: `BudgetStatusResDto` (the composed spend view) and `BudgetAlertResDto`;
`BudgetResDto`/`PaginatedBudgetsResDto` exist from AI-064. All under the `cost-management`
Swagger tag.

# User Stories Covered

- Story 16/17 — create + conflict
- Story 20/22 — status with percentages; alerts listing
- Story 32/33 — Swagger + validation

# Acceptance Criteria

- [x] All six routes delegating thinly; 409/404/204 semantics correct
- [x] `/cost/budgets/alerts` declared before `/:userId`; a delegation test calls the alerts route and asserts the alerts service method (not the lookup) ran
- [x] `GET /cost/budgets/:userId` composes budget + spend into the status shape with the derived `status` string; 404 when no budget exists
- [x] All routes in `/api/docs-json` under `cost-management`
- [x] Controller delegation tests + any new DTO `validate()` tests green; full suite passes
- [x] `lint:check` + `tsc --noEmit` pass

# Dependencies

- AI-065 (spend/check/alerts methods; AI-064's CRUD transitively)

# Testing Notes

New `cost-management.controller.spec.ts` (`TestingModule` + `jest.fn()` mocks for
`CostBudgetService` — analytics/retention services stubbed as `{}` until AI-073 fills them in;
standard Prisma-ESM stub). The route-ordering pin is the highest-value test in this slice: invoke
the controller's route-matched method for a literal `alerts` path segment via supertest against
the compiled TestingModule _or_ assert declaration order structurally — either is acceptable, but
it must fail if someone reorders the methods.

## Implementation Notes

**Six routes on `CostManagementController`** (extending AI-073's `@Controller('cost')` class),
declared as a "Budgets" block above the analytics block, each a thin delegate to
`CostBudgetService` (AI-064/AI-065):

- `POST /cost/budgets` → `createBudget()` — `successStatus: 201` + `@ApiConflictResponse`; the
  service's own P2002→`ConflictException` propagates the 409 with no controller-side handling.
- `GET /cost/budgets` → `findAllBudgets()` — rows mapped through a private `toBudgetRes()`
  (`?? undefined` on nullable limits, the codebase's standard entity→ResDto convention).
- `GET /cost/budgets/alerts` → `getUsersApproachingLimit()` — **declared before `/:userId`**, with
  an inline comment stating the ordering constraint and pointing at the structural test that pins
  it (see below). Rows mapped via a private `toAlertRes()`.
- `GET /cost/budgets/:userId` — the one composed route: `findBudgetByUserId()` (null → 404
  `NotFoundException`, thrown **before** `checkBudget()` is ever called) + `checkBudget()`
  combined into the spec §6.2 status response. A private `deriveStatus()` maps the check to the
  new `BudgetStatus` constant (`constants/budget-status.constant.ts`, `as const` + derived union,
  barrel-exported): `!allowed` → `'exceeded'`, `warning` present → `'approaching_limit'`, else
  `'within_budget'`. `dailyLimit`/`monthlyLimit` come from the **budget row**, not the check —
  `checkBudget()` reports null limits when enforcement is disabled or the budget is inactive, but
  a direct status lookup should still show what is configured (inline-commented). The check's
  optional `warning` string is passed through on the response as a bonus detail field.
- `PATCH /cost/budgets/:publicId` → `updateBudget()`; `DELETE /cost/budgets/:publicId` →
  `deleteBudget()` — 204 via `@HttpCode(HttpStatus.NO_CONTENT)` + `@ApiNoContentResponse`,
  matching `ChatController.deleteConversation()`'s exact decorator stack.

**Two new response DTOs** (`BudgetStatusResDto`, `BudgetAlertResDto`), barrel-exported —
`BudgetResDto`/`PaginatedBudgetsResDto` already existed from AI-064.

**`QueryBudgetsDto.isActive` boolean-coercion bug fixed** — AI-071's flagged Follow Up, pulled
into this issue because its consuming route (`GET /cost/budgets`) ships here and live verification
would have hit it. The `toBoolean` `@Transform` helper AI-071 wrote inline in
`query-moderation-logs.dto.ts` was extracted to a shared
`src/common/utils/transform-query-boolean.util.ts` (`transformQueryBoolean`) at its second
consumer — the same extract-at-second-consumer precedent `resolveUserId()` set in AI-066 — with
the full explanatory comment moved to the util and both DTOs refactored to use it (`@Transform
(transformQueryBoolean)` replacing `@Type(() => Boolean)` on `isActive`). Moderation's tests pass
unchanged after the refactor.

**Route-ordering pin** (`cost-management.controller.spec.ts`, the issue's highest-value test):
asserts `Object.getOwnPropertyNames(CostManagementController.prototype)` (declaration order for
string-keyed class members — what NestJS's route registration follows) places `getBudgetAlerts`
before `getBudgetStatus`, **and** pins each method's `Reflect.getMetadata('path', ...)` to
`'budgets/alerts'`/`'budgets/:userId'` so a rename can't silently vacate the ordering assertion.
A companion delegation test proves the alerts route calls `getUsersApproachingLimit()` and never
`findBudgetByUserId()`/`checkBudget()`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint` — 0 errors (68 pre-existing warnings, unchanged from AI-071's baseline)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 128/128 pass (7 suites, +14 controller tests + 2 DTO tests)
- `npm run test -- moderation` — 67/67 pass (unchanged after the shared-util refactor)
- `npm run test` — 682/682 pass (full suite, +16, zero regressions)
- **Live-verified** (`npm run dev` against real Postgres): all six routes in the boot log with
  `budgets/alerts` mapped before `budgets/:userId` and zero DI errors. Create → 201 with the full
  envelope; duplicate userId → 409. `GET /cost/budgets?isActive=false` → 0 rows against 1 active
  budget (the boolean fix working live — pre-fix this returned the active row);
  `?isActive=true` → 1. `GET /cost/budgets/alerts` → 200 `[]` (not a `:userId`-lookup 404 —
  live proof of the route ordering). Status route exercised through **all three derived states**
  using a synthetic `ai_audit_logs` row (`estimatedCost: 0.45`, AI-066's psql precedent):
  `within_budget` (0 spend), `exceeded` (spend 0.45 of a 0.4 limit, 112%), and
  `approaching_limit` with `warning: "Approaching daily limit (90%)"` (0.45 of 0.5, threshold
  0.8). The PATCH-invalidates-spend-cache behavior (AI-065) was observed directly: the status
  route served a cached 0-spend snapshot until a PATCH invalidated it. PATCH unknown publicId →
  404; negative `dailyLimitUsd` → 400; DELETE → 204; status + repeat DELETE after → 404 both.
  `/api/docs-json` confirmed all 6 routes tagged `cost-management`. Synthetic audit row deleted,
  budget deleted via the API itself, dev server stopped, port 3000 confirmed free.

## Assumptions Made

- **Status-route limits come from the budget row, not `checkBudget()`** — the two only diverge
  when enforcement is disabled (`COST_BUDGET_ENABLED=false`) or the budget is inactive, where the
  check returns `unrestrictedResult()` (null limits, zero spend). A resource-status view should
  show the configured limits; the zeroed spend/percentages in that edge case are accepted and a
  test documents the behavior.
- **`warning` is included on `BudgetStatusResDto`** even though spec §6.2's example doesn't show
  it — the derived `'approaching_limit'` status already encodes the fact, but the warning string
  carries the dimension + percentage detail for free. Optional field, absent when clean.
- **The alerts route takes no query parameters** — `getUsersApproachingLimit(threshold?)`'s
  optional threshold override is not exposed; spec §6.2 lists the route with no request fields,
  and each budget's own `alertThreshold` is the sensible default.

## Follow Ups

- AI-074 (Phase 4 controller tests audit + full regression) is now fully unblocked — AI-063/066/
  071/072/073 are all completed.
- AI-059 (HITL OpenRouter `/moderations` probe) remains the only other open Phase 4 item ahead of
  AI-075's live smoke test.
