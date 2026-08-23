---
id: AI-006
title: AiAuditService — log write, findAll, getCostSummary + unit tests
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 4 — OpenAI Service and Audit Logging
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-001
  - AI-003
---

# What to Build

Implement `AiAuditService` with three methods: a fire-and-forget log writer, a paginated query method, and a cost aggregation method. This service is exported from `OpenaiModule` so future admin/dashboard features can query logs.

**Input type for `log()`:**

```typescript
interface AiAuditLogEvent {
  requestId: string;
  userId?: string;
  model: string;
  endpoint: OpenAIEndpoint;
  systemPrompt?: string;
  userMessage: string;
  assistantResponse?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyMs: number;
  temperature?: number;
  maxTokens?: number;
  status: AiAuditStatus;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  metadata?: Record<string, unknown>;
}
```

**Methods to implement:**

`log(event: AiAuditLogEvent): Promise<void>` — writes to `ai_audit_logs` via `DatabaseService.aiAuditLog.create()`. This method must be called with `void log(...)` (fire-and-forget) from `OpenaiService`. Internally it must catch ALL errors: if the Prisma write throws, log the error via `AppLoggerService.error()` and return — never propagate. Do NOT use `.catch()` on the returned promise; use try/catch inside the method body.

`findAll(query: QueryAiAuditDto): Promise<PaginatedAiAuditResDto>` — paginated query with optional filters: `model`, `status`, `userId`, `startDate`, `endDate`. Use `DatabaseService.aiAuditLog.findMany()` with a dynamically constructed `where` clause. Return results ordered by `createdAt DESC`. Include `total` count (from `count()`) and `data` array. Page size default: 20, max: 100.

`getCostSummary(query: CostSummaryQueryDto): Promise<CostSummaryResDto>` — aggregated metrics. Use `DatabaseService.aiAuditLog.aggregate()` for `_sum` of `estimatedCost`, `inputTokens`, `outputTokens`, `totalTokens`, and `_count`, plus `_avg` of `latencyMs`. For per-model breakdown, use `groupBy` with `model`. Support the same filters as `findAll` (`userId`, `model`, `startDate`, `endDate`).

The response shapes for `findAll` and `getCostSummary` follow the Prisma raw results — define simple typed interfaces (not Prisma DTOs) for the return values. The DTO classes with Swagger decorators are created in AI-009.

**Unit tests** (`__tests__/ai-audit.service.spec.ts`):

Use `jest-mock-extended` to mock `DatabaseService`:

```typescript
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { DatabaseService } from '../../../database/database.service';
```

Test cases:

- `log()` calls `db.aiAuditLog.create()` with the mapped fields from the event
- `log()` does NOT throw when `db.aiAuditLog.create()` rejects — it catches the error and logs it
- `log()` calls `AppLoggerService.error()` when the DB write fails
- `findAll()` passes the correct `where` clause when all filters are provided
- `findAll()` returns results ordered by `createdAt DESC`
- `getCostSummary()` calls `db.aiAuditLog.aggregate()` and maps the result to the response shape

# User Stories Covered

- Story 16 — every API call (success, failure, retry) is logged to `ai_audit_logs`
- Story 17 — audit log failures never surface as HTTP errors (fire-and-forget)
- Story 20 — `findAll` with filters for model, status, userId, date range
- Story 21 — `getCostSummary` returns aggregated metrics with per-model breakdown

# Acceptance Criteria

- [x] `log()` writes all 20 fields from `AiAuditLogEvent` to `ai_audit_logs`
- [x] `log()` catches internal errors and never propagates them to the caller
- [x] `log()` calls `AppLoggerService.error()` when DB write fails
- [x] `findAll()` supports all 5 filter fields and returns paginated results ordered by `createdAt DESC`
- [x] `getCostSummary()` returns `totalCost`, `totalTokens`, `totalInputTokens`, `totalOutputTokens`, `callCount`, `averageLatencyMs`, and `perModelBreakdown`
- [x] `perModelBreakdown` is an array of `{ model, cost, callCount }` objects
- [x] All unit tests pass (`npm run test`)
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-001 — `ai_audit_logs` table and Prisma client must exist
- AI-003 — `AiAuditStatus`, `OpenAIEndpoint` enums, and `AiAuditService` placeholder must exist

# Testing Notes

**Primary seam**: service-level unit test with a deep mock of `DatabaseService`.

```typescript
const dbMock = mockDeep<DatabaseService>();
const module = await Test.createTestingModule({
  providers: [
    AiAuditService,
    { provide: DatabaseService, useValue: dbMock },
    { provide: AppLoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
  ],
}).compile();
```

The key test for fire-and-forget behavior:

```typescript
dbMock.aiAuditLog.create.mockRejectedValue(new Error('DB down'));
await expect(service.log(mockEvent)).resolves.toBeUndefined(); // must not throw
expect(loggerMock.error).toHaveBeenCalled();
```

**Regression risk**: ensure `log()` is always called with `void` from `OpenaiService` (not `await`) so a DB failure can't block the response. The service itself resolves but its caller should not await it.

## Implementation Notes

**Files created/modified:**

- `src/modules/openai/types/ai-audit.types.ts` — new; `AiAuditLogEvent`, `QueryAiAuditDto`, `PaginatedAiAuditResult`, `CostSummaryQueryDto`, `CostSummaryResult`, `ModelCostBreakdown` interfaces
- `src/modules/openai/services/ai-audit.service.ts` — full implementation replacing the placeholder
- `src/modules/openai/__tests__/ai-audit.service.spec.ts` — 8 unit tests with `jest-mock-extended` (new file)
- `eslint.config.mjs` — added test-file override: `@typescript-eslint/unbound-method: off` for `*.spec.ts` files (jest mock methods are `jest.fn()` instances, `this` binding is irrelevant)

**Design decisions:**

- Types placed in `types/ai-audit.types.ts` (not the service file) so AI-009 can import and extend them when creating class DTOs with Swagger decorators. When AI-009 ships, the service imports can be updated to point to `dto/` instead.
- `log()` uses try/catch (not `.catch()`) as specified — the method is `async` and internally awaits the DB write.
- `findAll()` calls `buildWhereClause()` (a private helper that takes `CostSummaryQueryDto`) and then adds `status` after (since `CostSummaryQueryDto` doesn't include status). This shares the date/user/model filter logic between `findAll` and `getCostSummary`.
- Aggregate uses `_count: true` → returns `number` directly. GroupBy uses `_count: { _all: true }` → returns `{ _all: number }` object (Prisma v7 type difference between aggregate and groupBy).
- `_sum` and `_avg` are nullable in Prisma aggregate results (null when no records match) — all accessors use `?.` and `?? 0` defensive access.
- `jest-mock-extended` v4 installed as devDependency.
- `DatabaseService` mock pattern: `jest.mock('../../../database/database.service', () => ({ DatabaseService: class {} }))` at the top of the spec file prevents Jest from loading the Prisma generated client (which uses ESM `import.meta.url`, incompatible with CommonJS Jest). `import type` imports from the generated client are safe — they're stripped before execution.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (16 pre-existing warnings unchanged)
- `npx jest --testPathPatterns=ai-audit.service` — 8/8 pass
- `npm run test` — 31/31 pass (was 23; 8 new tests, no regressions)

## Assumptions Made

- Internal interfaces (`AiAuditLogEvent`, `QueryAiAuditDto`, etc.) are defined in `types/ai-audit.types.ts` rather than the service file. AI-009 will create proper class DTOs in `dto/`, at which point the service imports can migrate. The type shapes are deliberately identical to avoid refactoring the service.
- `CostSummaryQueryDto` does not include `status` filter (aggregate by model makes status filtering less relevant). `QueryAiAuditDto` includes `status`.
- Limit is capped at 100 (not 50 or 200) per the spec ("page size default: 20, max: 100").
- `perModelBreakdown` entries access `b._count._all` (not `b._count` directly) because Prisma groupBy with `_count: { _all: true }` returns an object, not a scalar.

## Follow Ups

- When AI-009 creates DTO classes, update service method signatures from the internal interface types to the DTO class types
- `AiAuditService.log()` is designed to be called with `void` — AI-007 must not `await` it
- Add `getCostSummary` date range validation in the controller (AI-011) — the service trusts string dates to be valid ISO strings
