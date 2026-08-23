---
id: AI-013
title: OpenaiController unit tests + TypeScript and lint verification
type: AFK
status: completed
priority: P2
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 6 — REST Controller, Swagger, and Validation
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-010
  - AI-011
  - AI-012
---

# What to Build

Write the controller unit test suite and run the final TypeScript/lint verification pass for all Phase 1 code.

**Controller test file** (`__tests__/openai.controller.spec.ts`):

Use `Test.createTestingModule()` with mocked services. Inject mocked `OpenaiService`, `AiAuditService`, `TokenService`, `PromptTemplateService`, and `RetryService`. The test module uses `APP_PIPE` with `ValidationPipe` to test DTO validation.

```typescript
const module = await Test.createTestingModule({
  controllers: [OpenaiController],
  providers: [
    { provide: OpenaiService, useValue: openaiMock },
    { provide: AiAuditService, useValue: auditMock },
    { provide: TokenService, useValue: tokenMock },
    { provide: PromptTemplateService, useValue: templateMock },
    { provide: RetryService, useValue: { getCircuitState: jest.fn().mockReturnValue('CLOSED') } },
    { provide: APP_PIPE, useClass: ValidationPipe },
  ],
}).compile();
```

**Test cases to cover** (organized by endpoint):

Chat:

- Valid request delegates to `OpenaiService.chatCompletion()` and returns the result
- Empty `prompt` returns 400 (ValidationPipe catches it)
- `temperature: 5` returns 400

Compare:

- Delegates to `OpenaiService.chatCompletion()` for each model in `dto.models`
- Returns comparison summary with `cheapest` and `fastest` fields

Prompt test:

- Without `templateName`: calls `chatCompletion()` directly with `dto.systemPrompt`
- With `templateName`: calls `PromptTemplateService.findByName()` then `chatCompletion()` with the template's system prompt
- When template not found: returns 404

Token count:

- Calls `TokenService.countTokens()` and `TokenService.calculateCost()` twice (input and output estimate)
- Does NOT call `AiAuditService.log()`

Model pricing:

- Calls `OpenaiService.getModelPricing()` and returns the result

Health:

- Calls `RetryService.getCircuitState()` and returns `{ circuitState: 'CLOSED', status: 'ok' }`
- When circuit is `OPEN`, status is `'degraded'`

Audit logs:

- Delegates to `AiAuditService.findAll()` with the query params
- Delegates to `AiAuditService.getCostSummary()` with the query params

Templates CRUD:

- `POST` delegates to `PromptTemplateService.create()` and returns 201
- `GET /:publicId` returns 404 when service throws `NotFoundException`
- `DELETE /:publicId` returns 204

**Final verification:**

After all tests pass, run:

1. `npm run test` — all tests across the project
2. `npm run test:cov` — ensure Phase 1 code has coverage
3. `npx tsc --noEmit --project tsconfig.build.json` — zero TypeScript errors
4. `npm run lint` — zero ESLint violations

# User Stories Covered

- Story 33 — `npx tsc --noEmit` exits 0
- Story 34 — `npm run lint` exits 0, no `console.*`, no `process.env`

# Acceptance Criteria

- [ ] Controller spec file exists with test cases for all 13 endpoint handlers
- [ ] Validation pipe test: empty `prompt` returns 400 with field-level error message
- [ ] Validation pipe test: `temperature: 5` returns 400
- [ ] `GET /health` returns `status: 'ok'` when circuit is `CLOSED`, `status: 'degraded'` otherwise
- [ ] `POST /token-count` does NOT call `AiAuditService.log()`
- [ ] All tests pass (`npm run test`)
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0
- [ ] `npm run lint` exits 0

# Dependencies

- AI-010, AI-011, AI-012 — all controller endpoints must exist before the test suite can cover them

# Testing Notes

**Primary seam**: controller-level unit test with mocked service layer.

To test ValidationPipe in a unit test (without a real HTTP server), use `@nestjs/testing`'s `createTestingModule` with `APP_PIPE`. Alternatively, use the DTO's `validate()` function from `class-validator` directly in a separate spec file for DTOs.

If `APP_PIPE` in unit tests is complex to set up, test DTO validation separately:

```typescript
import { validate } from 'class-validator';

const dto = new ChatCompletionDto();
dto.prompt = '';
const errors = await validate(dto);
expect(errors[0].property).toBe('prompt');
```

**Regression risk**: all existing module tests (`health`, `database`) must still pass after adding `OpenaiModule` to `AppModule`. Run `npm run test` against the full suite, not just the new spec files.

## Implementation Notes

**Files created:**

- `src/modules/openai/__tests__/openai.controller.spec.ts` — 22 tests across 2 describe blocks (controller + DTO validation)

**Key design decisions:**

- `jest.mock('../../../database/database.service')` at the top of the file — the controller imports `AiAuditService` and `PromptTemplateService`, both of which import `DatabaseService` → Prisma ESM client. The mock breaks this chain before Jest tries to load `import.meta.url`.
- Fresh `jest.fn()` mocks recreated in every `beforeEach()` — avoids cross-test state bleed without needing `jest.clearAllMocks()`.
- `APP_PIPE` not used — calling controller methods directly in unit tests bypasses the NestJS HTTP pipeline, so `ValidationPipe` would not run. DTO validation tested separately using `class-validator`'s `validate()` function directly on DTO instances, as suggested by the issue spec.
- `makeTemplateEntity()` and `makeAuditLogRaw()` factory helpers provide consistent test fixtures with the right nullable/non-nullable shapes.
- `null → undefined` mapping verified explicitly: the `getAuditLogs()` test asserts `result.data[0].userId` is `undefined` (not `null`), confirming the `?? undefined` conversion in the controller works correctly.
- `removeTemplate()` tests that the result resolves to `undefined` (not `null`) — consistent with `Promise<void>` return type.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (23 warnings: 21 pre-existing + 2 new from `jest.Mock` typed variables in spec file — expected in test code)
- `npm run test` — 69/69 pass (47 pre-existing + 22 new)
- `npm run test:cov` — `openai.controller.ts`: 100% statements, 100% functions, 100% lines, 78.35% branches (uncovered branches are null-coalescing defaults that would require null fixture data)

## Assumptions Made

- DTO validation tests use `class-validator`'s `validate()` directly rather than `APP_PIPE` — this is the correct approach for unit tests that call controller methods directly (not via HTTP server).
- 2 new lint warnings from `jest.Mock` typed variables are acceptable in test files; `no-unsafe-*` rules are already downgraded to warnings project-wide per CLAUDE.md.

## Follow Ups

- AI-014 (Live API smoke test, HITL) is now unblocked — requires a real API key and running the dev server.
