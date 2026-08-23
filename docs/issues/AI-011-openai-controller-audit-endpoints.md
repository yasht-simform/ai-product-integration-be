---
id: AI-011
title: OpenaiController — audit log query and cost summary endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 6 — REST Controller, Swagger, and Validation
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-006
  - AI-009
  - AI-010
---

# What to Build

Add two endpoints to the existing `OpenaiController` that expose `AiAuditService` query methods.

**Endpoints to add:**

`GET /openai/audit-logs` → `getAuditLogs(@Query() query: QueryAiAuditDto)`:

- Calls `AiAuditService.findAll(query)`
- Returns `PaginatedAiAuditResDto` with `code: 'AI_005'`
- `@ApiEndpoint({ summary: 'Query AI audit logs', type: PaginatedAiAuditResDto, isPublic: true })`
- Accepts all 7 query params: `model`, `status`, `userId`, `startDate`, `endDate`, `page`, `limit`

`GET /openai/audit-logs/cost-summary` → `getCostSummary(@Query() query: CostSummaryQueryDto)`:

- Calls `AiAuditService.getCostSummary(query)`
- Returns `CostSummaryResDto` with `code: 'AI_006'`
- `@ApiEndpoint({ summary: 'Get aggregated cost summary', type: CostSummaryResDto, isPublic: true })`
- Accepts 4 query params: `userId`, `model`, `startDate`, `endDate`

**Important route order**: `GET /audit-logs/cost-summary` must be declared BEFORE `GET /audit-logs/:id` (if one existed) to avoid the literal `cost-summary` being matched as an `id` param. Since there is no `/:id` route for audit logs in Phase 1, ordering is not critical — but declare `cost-summary` first as a defensive habit.

# User Stories Covered

- Story 20 — audit logs endpoint with filters and pagination (API layer)
- Story 21 — cost summary endpoint with aggregated metrics (API layer)

# Acceptance Criteria

- [ ] `GET /api/v1/openai/audit-logs` returns paginated audit log rows
- [ ] `GET /api/v1/openai/audit-logs?model=gpt-4o&status=SUCCESS` filters correctly
- [ ] `GET /api/v1/openai/audit-logs/cost-summary` returns `totalCost`, `callCount`, `averageLatencyMs`, `perModelBreakdown`
- [ ] Both endpoints are documented in Swagger with query parameter descriptions
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-006 — `AiAuditService.findAll()` and `getCostSummary()` must be implemented
- AI-009 — `QueryAiAuditDto`, `CostSummaryQueryDto`, `PaginatedAiAuditResDto`, `CostSummaryResDto` must exist
- AI-010 — `OpenaiController` must exist and be registered in `OpenaiModule`

# Testing Notes

Controller tests are in AI-013. These endpoints are tested there with mocked `AiAuditService`.

**Manual testing prompt (after sending a few chat completions):**

> "Could you run `curl 'http://localhost:3000/api/v1/openai/audit-logs/cost-summary' | jq .` after sending 3 chat completion requests and paste the result? I want to confirm `data.callCount` is 3 and `data.totalCost` is non-zero."

## Implementation Notes

**Files modified:**

- `src/modules/openai/openai.controller.ts` — added `AiAuditService` injection, `getCostSummary` handler, `getAuditLogs` handler, and 5 new imports (`Query`, `AiAuditService`, `CostSummaryQueryDto`, `CostSummaryResDto`, `PaginatedAiAuditResDto`, `QueryAiAuditDto`)

**Key design decisions:**

- `GET /audit-logs/cost-summary` is declared before `GET /audit-logs` in the controller — defensive route ordering to prevent literal path segments being matched as route params if a `/:id` route is added later.
- `getCostSummary` returns the service result directly — `CostSummaryResult` is structurally compatible with `CostSummaryResDto` (all fields are `number`, no BigInt, no null/undefined mismatch).
- `getAuditLogs` performs an explicit field mapping to: (1) strip the non-JSON-serializable `id: BigInt` field from Prisma's `AiAuditLog`, (2) convert Prisma's `field: string | null` nullable fields to `field: string | undefined` to match `AiAuditLogResDto` optional fields. The `metadata` field is also excluded since it is not in `AiAuditLogResDto`.
- `AiAuditService` is already exported from `OpenaiModule` — no module changes needed.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (21 pre-existing warnings unchanged; linter auto-sorted imports)
- `npm run build` — success (Prisma client regenerated + nest build)
- `npm run test` — 47/47 pass (no regressions)

## Assumptions Made

- No `@HttpCode()` decorator needed — GET routes return 200 by default in NestJS.
- `AiAuditService` is injected into the controller (not exported just for the controller — it's within the same module and was already exported for other consumers).
- The `metadata` field from `AiAuditLog` is omitted from the response mapping since `AiAuditLogResDto` does not expose it.

## Follow Ups

- AI-012 adds prompt template CRUD endpoints to this same controller.
- AI-013 adds controller unit tests covering both new endpoints with mocked `AiAuditService`.
