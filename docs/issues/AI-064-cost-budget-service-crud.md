---
id: AI-064
title: CostBudgetService — budget CRUD + budget DTOs
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
  - AI-056
  - AI-057
---

# What to Build

The budget-row lifecycle on `CostBudgetService`, per spec §5.2's CRUD subset —
`createBudget(dto)`, `findAllBudgets(query)` (paginated, `isActive` filter), `findBudgetByUserId
(userId)` (returns `null`, not 404 — the guard treats "no budget" as unlimited),
`updateBudget(publicId, dto)`, `deleteBudget(publicId)` (hard delete — removing a budget removes
enforcement, per spec §6.2; this is deliberately _not_ the soft-delete convention, since an
inactive-but-present budget is what `isActive: false` already expresses).

Follow `PromptTemplateService`/`ModelRegistryService`'s established shapes: P2002 on duplicate
`userId` → `ConflictException`; `NotFoundException` from a shared find-or-throw guard on
update/delete; pagination as `Math.min(limit, 100)` + parallel `findMany`/`count`.

Request/response DTOs following `openai/dto` conventions with barrel export:
`CreateBudgetDto` (`userId` required; `dailyLimitUsd?`/`monthlyLimitUsd?` positive numbers —
null/omitted = unlimited; `alertThreshold?` `@Min(0)`/`@Max(1)`, default 0.8; `isActive?`),
`UpdateBudgetDto` = `PartialType(OmitType(CreateBudgetDto, ['userId']))` — a budget never moves
between users, same immutability pattern as `toolsEnabled`/`sourceType` — `QueryBudgetsDto`
(pagination + `isActive?`), `BudgetResDto` (publicId, not id), `PaginatedBudgetsResDto`.

Entity/type interfaces land in a new `cost-management` types file following
`rag.types.ts`/`ai-chat.types.ts` naming.

# User Stories Covered

- Story 16 — create budget with daily/monthly limits + alert threshold
- Story 17 — duplicate userId → 409

# Acceptance Criteria

- [x] All five CRUD methods implemented with the established error/pagination conventions
- [x] Duplicate `userId` create → `ConflictException`; unknown publicId update/delete → `NotFoundException`
- [x] `findBudgetByUserId()` returns `null` for absent budgets (no throw)
- [x] DTO validation: negative limits rejected, `alertThreshold` outside 0–1 rejected, `userId` required on create and absent from update surface
- [x] Unit tests (`DeepMockProxy<DatabaseService>`) cover CRUD happy paths + both error paths
- [x] DTO `validate()` smoke tests (one invalid + one valid payload each)
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-056 (`user_cost_budgets` table), AI-057 (module scaffold)

# Testing Notes

New `cost-budget.service.spec.ts` mirroring `prompt-template.service.spec.ts`'s pattern
(`DeepMockProxy<DatabaseService>` + Prisma-ESM stub, P2002 simulated by rejecting with
`{ code: 'P2002' }`-shaped errors the way existing specs do). DTO tests in a
`cost-management-dtos.spec.ts` following `chat-dtos.spec.ts`. No spend math here — that's AI-065.

## Implementation Notes

`CostBudgetService` (`src/modules/cost-management/services/cost-budget.service.ts`) replaces the
AI-057 constructor-only shell with the five CRUD methods per spec §5.2, following
`PromptTemplateService`/`ModelRegistryService`'s exact conventions: `createBudget()` catches P2002
via the same `isP2002()` helper → `ConflictException`; `updateBudget()`/`deleteBudget()` share a
private `findBudgetOrThrow()` guard; `findAllBudgets()` uses `Math.min(limit, 100)` + parallel
`findMany`/`count`, with `isActive` only added to the Prisma `where` clause when explicitly
provided (`ModelRegistryService.findAllModels()`'s `isActive !== undefined` convention, not
`PromptTemplateService`'s default-`true` one — a budget-admin listing should show both active and
inactive budgets by default). `findBudgetByUserId()` returns `null` on a miss rather than throwing,
per spec — the guard (AI-066) needs to distinguish "no budget row" (unlimited) from an actual
lookup failure. `deleteBudget()` is a genuine hard delete (`db.userCostBudget.delete()`), not the
soft-delete (`isActive: false`) convention `ModelRegistryService` uses for models/providers — per
this issue's own text, an inactive-but-present budget already has a first-class representation
(`isActive: false`), so a hard delete is the correct way to fully remove enforcement.

Five new files under `src/modules/cost-management/dto/` (`create-budget.dto.ts`,
`update-budget.dto.ts`, `query-budgets.dto.ts`, `budget-res.dto.ts`,
`paginated-budgets-res.dto.ts`) plus a barrel `index.ts`, following `openai/dto`'s exact shape.
`UpdateBudgetDto extends PartialType(OmitType(CreateBudgetDto, ['userId']))` — same
immutable-identity-field pattern as `UpdateConversationDto`'s `toolsEnabled` omission. A new
`src/modules/cost-management/types/cost-management.types.ts` holds `BudgetEntity`,
`PaginatedBudgetsResult`, and `QueryBudgetsParams` (the service-facing param shape, mirroring
`QueryModelsParams` in `model-registry.types.ts` — the DTO and the internal params interface are
kept separate since the DTO carries `class-validator` decorators the service doesn't need).

No changes to `CostManagementModule`, `CostManagementController`, or any other module were
needed — `CostBudgetService` was already registered as a provider by AI-057's scaffold.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors (67 pre-existing warnings elsewhere, unrelated to this issue)
- `npm run build` — passes
- `npm run test -- cost-management` — 18/18 pass (2 new spec files)
- `npm run test` (full suite) — 529/529 pass, zero regressions to any existing spec file

## Assumptions Made

- `findAllBudgets()`'s `isActive` filter has no default (shows both active and inactive budgets
  when omitted) — the issue text didn't specify a default, and `ModelRegistryService`'s
  filter-only-when-provided convention fits an admin-facing budget list better than
  `PromptTemplateService`'s default-active-only one.
- `metadata: Json?` (present on the `UserCostBudget` schema but not mentioned anywhere in this
  issue's spec text) is left untouched by every CRUD method — no DTO field or entity field for it,
  since nothing in spec §5.2 or the acceptance criteria references it.

## Follow Ups

- AI-065 (`CostBudgetService` spend aggregation + cached `checkBudget()` + alerts) builds directly
  on this CRUD surface.
- No `CostManagementController` routes exist yet for these methods — that's AI-072.
