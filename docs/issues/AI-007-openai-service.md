---
id: AI-007
title: OpenaiService — chatCompletion(), getModelPricing(), missing API key guard + unit tests
type: AFK
status: completed
completed_at: 2026-06-29
priority: P1
assigned_to: Claude
started_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 4 — OpenAI Service and Audit Logging
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-004
  - AI-005
  - AI-006
---

# What to Build

Implement `OpenaiService` — the only service external modules interact with. It wraps the OpenAI SDK via `RetryService`, counts tokens via `TokenService`, and logs every call via `AiAuditService`.

**Inject the OpenAI SDK client** as a provider via an injection token (e.g., `OPENAI_CLIENT`). Create a factory provider in `openai.module.ts` that reads `openaiConfig` from `ConfigService` and instantiates `new OpenAI({ apiKey, organization: orgId, timeout: timeoutMs })`. This keeps the SDK client testable via mock injection.

**`onModuleInit()` hook:**

Check `ConfigService.get('openai.apiKey')`. If it is falsy or empty, call `AppLoggerService.warn()` with a clear message (`'OPENAI_API_KEY is not configured — all API calls will fail'`) and set a private `isConfigured = false` flag. Do NOT throw during init — let the app start; fail at the call site instead.

**`chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>`:**

```typescript
interface ChatCompletionParams {
  prompt: string;
  systemPrompt?: string;
  model?: OpenAIModel;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
}

interface ChatCompletionResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
}
```

Flow:

1. If `!isConfigured`, throw `new ServiceUnavailableException('OpenAI API key is not configured')`
2. Record `startTime = Date.now()`
3. Call `RetryService.executeWithRetry()` wrapping `openaiClient.chat.completions.create()`
4. On success: extract `content`, `usage.prompt_tokens`, `usage.completion_tokens` from the SDK response
5. Call `TokenService.calculateCost(model, inputTokens, outputTokens)` for `estimatedCost`
6. Call `void AiAuditService.log(...)` with `status: AiAuditStatus.SUCCESS` and `retryCount` from retry metadata
7. Return `ChatCompletionResult`

On error from `RetryService`:

- Call `void AiAuditService.log(...)` with `status: AiAuditStatus.FAILED`, `errorCode`, `errorMessage`
- Rethrow the error as an `HttpException` with appropriate status (503 for circuit open, 429 for rate limit, 500 for server errors)

**`getModelPricing()`** — delegates to `TokenService.getModelPricing()`.

**Tracking retry count:** `RetryService.executeWithRetry()` should accept an optional callback or emit via an event that increments a local counter per call. A simpler approach: pass a mutable `{ retryCount: number }` object to `executeWithRetry` that it increments on each retry attempt. Update the `RetryService` interface accordingly if needed.

**Unit tests** (`__tests__/openai.service.spec.ts`):

Mock `RetryService`, `TokenService`, `AiAuditService`, and the `OPENAI_CLIENT` injection token.

Test cases:

- Successful call: returns `ChatCompletionResult` with correct `usage` and `estimatedCost`
- `AiAuditService.log()` is called with `status: SUCCESS` on a successful call
- `AiAuditService.log()` is called with `status: FAILED` when `RetryService.executeWithRetry()` rejects
- Error from `RetryService` is rethrown as an `HttpException` (not a raw SDK error)
- When `isConfigured = false` (no API key), `chatCompletion()` throws `ServiceUnavailableException` without calling the SDK

# User Stories Covered

- Story 15 — `chatCompletion()` returns content, model, usage, estimatedCost, latencyMs
- Story 18 — startup warning + 503 when API key is missing
- Story 19 — `retryCount` recorded in audit log

# Acceptance Criteria

- [x] OpenAI SDK client is injected via a provider token (not `new OpenAI()` inside the service)
- [x] `onModuleInit()` logs a warning and sets `isConfigured = false` when API key is missing
- [x] `chatCompletion()` throws `ServiceUnavailableException` (not a raw error) when `!isConfigured`
- [x] `chatCompletion()` calls `RetryService.executeWithRetry()` for every SDK call
- [x] `AiAuditService.log()` is called with `void` (fire-and-forget) for both success and failure paths
- [x] Audit log event on success includes `status: SUCCESS`, correct token counts, estimated cost, latency
- [x] Audit log event on failure includes `status: FAILED`, `errorCode`, `errorMessage`
- [x] Errors from `RetryService` are mapped to appropriate `HttpException` status codes before rethrowing
- [x] All unit tests pass (`npm run test`)
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-004 — `TokenService` must be implemented (not just a placeholder)
- AI-005 — `RetryService` must be implemented (not just a placeholder)
- AI-006 — `AiAuditService` must be implemented (not just a placeholder)

# Testing Notes

**Primary seam**: service-level unit test with mocked collaborators.

```typescript
const module = await Test.createTestingModule({
  providers: [
    OpenaiService,
    { provide: TokenService, useValue: { calculateCost: jest.fn(), countTokens: jest.fn() } },
    { provide: RetryService, useValue: { executeWithRetry: jest.fn() } },
    { provide: AiAuditService, useValue: { log: jest.fn() } },
    { provide: OPENAI_CLIENT, useValue: { chat: { completions: { create: jest.fn() } } } },
    { provide: ConfigService, useValue: { get: jest.fn() } },
    { provide: AppLoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  ],
}).compile();
```

**Important**: `AiAuditService.log` is called with `void` — in tests, assert it was called with the correct arguments using `expect(auditMock.log).toHaveBeenCalledWith(...)` even though the return value is ignored.

**Regression risk**: The `OPENAI_CLIENT` injection token must match between the provider factory in `openai.module.ts` and the `@Inject()` decorator in `openai.service.ts`. A mismatch causes a runtime DI error that does not surface at compile time.

## Implementation Notes

**Files created/modified:**

- `src/modules/openai/constants/injection-tokens.ts` — new; exports `OPENAI_CLIENT = 'OPENAI_CLIENT'`
- `src/modules/openai/constants/index.ts` — added `OPENAI_CLIENT` to barrel exports
- `src/modules/openai/types/openai.types.ts` — new; `ChatCompletionParams` and `ChatCompletionResult` interfaces
- `src/modules/openai/services/retry.service.ts` — added optional `retryTracker?: { retryCount: number }` parameter to `executeWithRetry()`; incremented on each retry attempt (backward-compatible, existing tests unaffected)
- `src/modules/openai/openai.module.ts` — added `OPENAI_CLIENT` factory provider (reads `openai.apiKey`, `openai.orgId`, `openai.timeoutMs` from ConfigService)
- `src/modules/openai/services/openai.service.ts` — full implementation replacing placeholder
- `src/modules/openai/__tests__/openai.service.spec.ts` — 5 unit tests

**Design decisions:**

- `OPENAI_CLIENT` token is defined in `constants/injection-tokens.ts` (not in `openai.module.ts`) to avoid a circular import: `openai.module.ts` imports `OpenaiService`, and `openai.service.ts` needs the token.
- `onModuleInit()` does NOT throw on missing API key — it sets a flag and warns. The guard is at the call site. This allows the app to start and serve non-OpenAI routes even with a missing key.
- `retryTracker.retryCount` is only incremented when a retry ACTUALLY occurs (inside the `attempt < maxAttempts - 1` branch), not on the final failure. This gives an accurate count of retry attempts.
- `mapError()` preserves `CircuitOpenException` and other `HttpException` subclasses as-is; maps 429 to `TOO_MANY_REQUESTS`; maps everything else to `INTERNAL_SERVER_ERROR`.
- `void this.auditService.log(...)` is used for both success and failure paths — the fire-and-forget contract from AI-006.
- Test setup: `service.onModuleInit()` must be called explicitly after `module.compile()`. `TestingModule.compile()` does not trigger `onModuleInit()` for individually provided services (only when a full `NestApplication` is created via `app.init()`).
- `jest.clearAllMocks()` + manual re-setup after: `mockOpenAIClient` is module-scoped (not recreated per test), so its mock implementations must be re-applied after `clearAllMocks()` which resets call history.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (16 pre-existing warnings unchanged)
- `npx jest --testPathPatterns=openai.service` — 5/5 pass
- `npm run test` — 36/36 pass (was 31; 5 new tests, no regressions)

## Assumptions Made

- `OPENAI_CLIENT` token is a string constant (not a Symbol) — simpler to mock in tests and consistent with the spec example.
- Error mapping for non-HTTP errors uses `INTERNAL_SERVER_ERROR` (500) as the fallback. Callers (controllers) are responsible for documenting which codes are possible.
- `requestId` defaults to `crypto.randomUUID()` when not provided in `ChatCompletionParams`. `crypto` is available globally in Node.js 18+ without imports.
- `messages` array includes `systemPrompt` only when provided (not an empty string entry).

## Follow Ups

- AI-010 (OpenaiController) must import `OpenaiModule` (or register it in `AppModule`) to make `OpenaiService` available via DI
- AI-007 does not implement `generateEmbeddings()` or `moderateContent()` — those are separate API calls and belong in follow-up issues if needed
- `chatCompletion()` always uses `stream: false` (default) — streaming support would need a separate method signature
