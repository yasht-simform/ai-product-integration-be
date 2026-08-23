---
id: AI-066
title: CostBudgetGuard — 429 enforcement + application to AI routes
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-11
parent_epic: Epic 4 — Cost Budgets — Service & Guard
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-065
  - AI-063
---

# What to Build

Implement `CostBudgetGuard` (`CanActivate`) and apply it to the AI entrypoints.

Guard behavior:

1. `costBudget.enabled=false` → pass immediately.
2. Resolve `userId` via the shared Phase 4 identity convention (`x-user-id` header, fallback
   `body.userId` — same resolution AI-061's guard uses; extract a shared helper rather than
   duplicating). No resolvable userId → pass (nothing to key a budget on — documented boundary,
   not a bug).
3. `CostBudgetService.checkBudget(userId)`. Not allowed → throw
   `HttpException(..., HttpStatus.TOO_MANY_REQUESTS)` — **429, never 403** (FR-COST-002) — with a
   message naming the exceeded dimension, current spend, and limit, e.g.
   `"Daily budget exceeded ($1.02 of $1.00)"`.
4. Allowed with `warning` → set a response header (e.g. `X-Budget-Warning`) via
   `switchToHttp().getResponse()` and pass.

Application (decorator-only edits, extending AI-063's): `@UseGuards(ModerationGuard,
CostBudgetGuard)` on both chat message routes and both RAG ask routes — **moderation first,
budget second** (don't charge a budget check against a request moderation rejects; NestJS runs
route guards in declaration order). `AiChatModule`/`RagModule` import `CostManagementModule`
(exports the guard per AI-057). Dependency direction stays acyclic —
`CostManagementModule` imports nothing from chat/rag/openai modules.

# User Stories Covered

- Story 18 — under-budget calls proceed
- Story 19 — 429 with spend + limit in the message
- Story 20 — warning header at threshold

# Acceptance Criteria

- [x] Over-limit → 429 with dimension + spend + limit in the message; never 403
- [x] Under-limit passes; threshold crossing sets the warning header
- [x] Disabled config / missing userId pass with zero `checkBudget()` calls
- [x] Guard order moderation-then-budget on all four AI routes (asserted structurally via `Reflect.getMetadata('__guards__', handler)` order or equivalent)
- [x] App boots with the new module imports; full existing suite green with zero assertion changes
- [x] Unit tests cover all guard paths; `tsc --noEmit` + `lint:check` pass

# Dependencies

- AI-065 (`checkBudget()`), AI-063 (guard-application precedent + moderation-first ordering)

# Testing Notes

New `cost-budget.guard.spec.ts` with a fake `ExecutionContext` (request with headers/body,
response with a `setHeader` jest.fn()) and `CostBudgetService` as a plain `jest.fn()` mock —
script `BudgetCheckResult` fixtures for each path. Assert the thrown exception's `getStatus()` is
429 and the message contains the formatted amounts. The guard-order assertion reads route metadata
from the real controllers, catching accidental reordering in review.

**Manual testing prompts:**

> "Could you create a budget with `dailyLimitUsd: 0.001` for a test userId, send two chat messages with the `x-user-id` header set, and paste the second response? I want to confirm the 429 fires with the spend/limit in the message once real audit rows push spend past the limit."

## Implementation Notes

`CostBudgetGuard` (`src/modules/cost-management/guards/cost-budget.guard.ts`) replaces AI-057's
always-`true` stub with the real spec §8.1 enforcement, mirroring `ModerationGuard`'s structure
exactly: `costBudget.enabled` checked first (zero calls of any kind when disabled) → resolve
`userId` via a **new shared** `resolveUserId()` util → `CostBudgetService.checkBudget(userId)` →
not-allowed throws `HttpException(message, HttpStatus.TOO_MANY_REQUESTS)` (429, never 403) →
allowed-with-`warning` sets an `X-Budget-Warning` response header via `switchToHttp().getResponse()`
and returns `true`.

**Shared identity-resolution util, extracted per this issue's own instruction** — the exact "no
resolvable `userId`" identity convention previously duplicated as `ModerationGuard`'s private
`resolveUserId()` method now lives in `src/common/utils/resolve-user-id.util.ts` (a plain function,
`x-user-id` header first, `body.userId` fallback). `ModerationGuard` was refactored to call it
instead of its own private method (behavior unchanged, verified by its existing unit tests passing
unmodified); `CostBudgetGuard` is the second consumer.

**429 message construction** (`buildExceededMessage()`): checks the daily dimension first (`dailyLimit
!== null && dailySpend >= dailyLimit` → `` `Daily budget exceeded ($${spend} of $${limit})` ``,
`.toFixed(2)` formatting), falling back to the monthly dimension — safe because `checkBudget()`'s own
`allowed = !dailyExceeded && !monthlyExceeded` guarantees at least one is true whenever this method
is reached. The plain string thrown via `HttpException(message, status)` flows through the existing
global `HttpExceptionFilter` unmodified (already handles a string exception body — no filter changes
needed, unlike AI-061's guard which needed structured `flaggedCategories`/etc. fields).

**Same production DI fix as AI-063, applied proactively this time**: `CostManagementModule` now
exports `CostBudgetService` alongside `CostBudgetGuard` — without it, the real app would throw
`UnknownDependenciesException` on boot for the identical reason AI-063 discovered (a class
referenced via `@UseGuards()` is constructed within the _host_ module's own injector scope, so its
own first dependency must be visible there too). Verified live: the app booted with zero DI errors
on the very first attempt after wiring this in, unlike AI-063 which needed a failed boot to
discover the gap.

**Application**: `ChatController`'s two message routes and `RagController`'s two ask routes each
changed `@UseGuards(ModerationGuard)` → `@UseGuards(ModerationGuard, CostBudgetGuard)` — a single
decorator call listing both guards in declared order, avoiding any ambiguity about how Nest merges
metadata across multiple `@UseGuards()` calls on the same handler. `AiChatModule`/`RagModule` both
added `CostManagementModule` to their `imports` (no cycle — `CostManagementModule` itself imports
nothing). A new `guard order (AI-066)` describe block was added to both `chat.controller.spec.ts`
and `rag.controller.spec.ts`, asserting
`Reflect.getMetadata('__guards__', Controller.prototype.method)` equals
`[ModerationGuard, CostBudgetGuard]` on all four routes — a structural regression test against
accidental reordering, per this issue's own Testing Notes.

**Same regression-posture pattern as AI-063 recurred, exactly as expected this time**: the three
specs that construct `RagController`/`ChatController` through a bare `TestingModule`
(`chat.controller.spec.ts`, `rag.controller.spec.ts`,
`rag-controller-delete-cascade.integration.spec.ts`) needed an added
`.overrideGuard(CostBudgetGuard).useValue({ canActivate: () => true })` alongside their existing
`ModerationGuard`/`OutputModerationInterceptor` overrides — no assertions changed.

**Live-verified** (real Postgres, real OpenRouter-backed `OpenaiService`, `npm run dev`, restarted
between steps to reset the in-memory spend cache):

- Inserted a `user_cost_budgets` row (`dailyLimitUsd: 0.001`) and a synthetic `ai_audit_logs` row
  (`estimatedCost: 0.01, status: SUCCESS`) directly via `psql` — the configured OpenRouter free
  model reports `estimatedCost: 0` on every real call, so real spend can never exceed a budget on
  its own; a synthetic row was the only way to exercise the over-limit path end to end.
- A chat message with `x-user-id: ai066-test-user` → **429** —
  `"Daily budget exceeded ($0.01 of $0.00)"` (the `$0.00` is `$0.001` rounded by `.toFixed(2)`, a
  cosmetic quirk for sub-cent limits, not a functional defect — see Follow Ups) — and confirmed via
  `psql` that **no `chat_messages` row was created** for the blocked request (the guard runs before
  the handler, exactly as designed).
- Raised the limit to `$0.012` (spend `$0.01` = 83% of limit, above the 80% `alertThreshold`, below
  100%) → 201 with response header `X-Budget-Warning: Approaching daily limit (83%)`.
- Booted with `COST_BUDGET_ENABLED=false` and the tiny `$0.001` limit still in place → 201, kill
  switch bypassed the check entirely.
- `POST /rag/ask` (no `x-user-id` header) → 201, confirming `CostBudgetGuard`'s "no resolvable
  userId → pass" boundary and that the extended guard chain doesn't break the route.
- All test data (conversation, synthetic audit log row, test budget row) deleted afterward; dev
  server stopped, port 3000 confirmed free.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (pre-existing warnings elsewhere unrelated)
- `npm run build` — succeeds
- `npm run test -- ai-chat rag moderation cost-management` — 429/429 pass
- `npm run test` — 571/571 pass (full suite, no regressions)
- Live `npm run dev` verification as described above

## Assumptions Made

- The 429 exception body is a plain string (`HttpException(message, status)`), not a structured
  object like `ModerationGuard`'s — the spec's example message is just prose
  ("Daily budget exceeded ($1.02 of $1.00)"), with no additional fields analogous to
  `flaggedCategories`, so no `HttpExceptionFilter` changes were needed here.
- `resolveUserId()` was extracted to `src/common/utils/` (not kept duplicated) per the issue's
  explicit instruction — `ModerationGuard` was refactored to use it too, a small but real
  behavior-preserving cleanup beyond this issue's own file scope, justified by the issue text
  itself asking for exactly this extraction.
- Guard combination uses a single `@UseGuards(ModerationGuard, CostBudgetGuard)` decorator (not two
  stacked `@UseGuards()` calls), removing any ambiguity about Nest's array-metadata merging order —
  read directly from the issue's own example syntax.

## Follow Ups

- **Sub-cent daily limits render as `$0.00` in the 429 message** due to `.toFixed(2)` — a real,
  live-observed formatting quirk, not a functional defect (a `$0.001` limit was blocked correctly;
  only the displayed limit amount rounds to two decimals). Realistic budgets are expected to be at
  least whole cents, so this is unlikely to matter in practice; worth a `.toFixed(4)` or
  minimum-of-2-significant-figures fix only if sub-cent budgets become a real use case.
- AI-072 (`CostManagementController` budget endpoints) remains the only way to create/manage
  budgets over HTTP — this issue's live verification had to insert rows directly via `psql` since
  no `POST /cost/budgets` route exists yet.
- AI-074 (Phase 4 controller tests + full regression) is now closer to unblocked — still needs
  AI-071/AI-072/AI-073.
