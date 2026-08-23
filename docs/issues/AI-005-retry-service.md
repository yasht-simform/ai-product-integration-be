---
id: AI-005
title: RetryService — exponential backoff, error classification, circuit breaker + unit tests
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-25
completed_at: 2026-06-25
created: 2026-06-25
parent_epic: Epic 3 — Retry Engine and Circuit Breaker
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-003
---

# What to Build

Implement `RetryService` with exponential backoff with jitter, error classification (retryable vs. permanent), and a three-state in-memory circuit breaker. This service is internal to `OpenaiModule` — it is NOT exported and is never injected by external modules.

**Public interface:**

```typescript
executeWithRetry<T>(operation: () => Promise<T>): Promise<T>
getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN'
resetCircuit(): void  // for test teardown only
```

**Retry logic:**

Use the config values from `RETRY_CONFIG` as defaults, but also read the env-configurable overrides from `ConfigService` (`openai.maxRetries`, `openai.retryBaseDelayMs`, `openai.circuitFailureThreshold`, `openai.circuitCooldownMs`). Config values take precedence over the constant.

Delay formula: `min(baseDelayMs * 2^attempt, maxDelayMs) + Math.random() * baseDelayMs * jitterFactor`

Where `attempt` starts at 0 for the first retry (after the first failure). Use `setTimeout` wrapped in a `Promise` for the delay.

**Error classification:**

Inspect the thrown error for an HTTP status code. The OpenAI SDK throws errors with a `.status` property. Classify based on that:

- 429, 500, 503, 529 → `RETRYABLE` — retry with backoff
- 400, 401, 403, 404 → `PERMANENT` — throw immediately, no retry
- No status / network error → treat as `RETRYABLE`

If the error has a `Retry-After` header value (accessible via `.headers['retry-after']` on the SDK error), use it as the delay for that attempt instead of the computed backoff.

**Circuit breaker state machine:**

Maintain private state: `consecutiveFailures: number`, `circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'`, `openedAt: number | null`.

Transitions:

- `CLOSED` → `OPEN`: when `consecutiveFailures >= failureThreshold`
- `OPEN` → `HALF_OPEN`: when `Date.now() - openedAt >= cooldownMs`
- `HALF_OPEN` → `CLOSED`: when the next request succeeds
- `HALF_OPEN` → `OPEN`: when the next request fails

When circuit is `OPEN` and cooldown has NOT elapsed: throw `CircuitOpenException` (a custom `HttpException` with 503 status) immediately without calling the operation.

When circuit is `OPEN` and cooldown HAS elapsed: transition to `HALF_OPEN` and attempt the operation.

On success (any state): reset `consecutiveFailures` to 0.

**Custom exception:**

Create `CircuitOpenException extends HttpException` in the constants or a dedicated exceptions file. Message: `'OpenAI circuit breaker is open — service temporarily unavailable'`, status: `HttpStatus.SERVICE_UNAVAILABLE`.

**Unit tests** (`__tests__/retry.service.spec.ts`):

Use `jest.useFakeTimers()` to advance past delays without real waits. Mock the `operation` callback as `jest.fn()`.

Test cases:

- A retryable error (status 429) followed by success: final result is returned, operation called twice
- A permanent error (status 401): operation called once, error thrown immediately
- Five consecutive 500 errors: sixth call throws `CircuitOpenException` without calling operation
- After circuit opens and `jest.advanceTimersByTime(cooldownMs)`, a successful call closes the circuit
- After circuit opens, a failed half-open attempt re-opens the circuit
- `resetCircuit()` restores `CLOSED` state and zero consecutive failures

# User Stories Covered

- Story 9 — exponential backoff with jitter on 429/500/503/529
- Story 10 — permanent errors fail fast (no retry)
- Story 11 — circuit opens after 5 consecutive failures, stays open for 60s
- Story 12 — half-open state allows one test request; closes on success
- Story 13 — `getCircuitState()` exposes current state to health endpoint
- Story 14 — `resetCircuit()` exists for test isolation

# Acceptance Criteria

- [x] `executeWithRetry` retries on 429/500/503/529 up to `maxRetries` times with increasing delays
- [x] `executeWithRetry` does NOT retry on 400/401/403/404 — throws on first attempt
- [x] Delay between retries follows the exponential backoff formula (verifiable with fake timers)
- [x] Circuit opens after `failureThreshold` consecutive failures
- [x] While circuit is `OPEN`, calls throw `CircuitOpenException` without invoking the operation callback
- [x] After cooldown, circuit enters `HALF_OPEN` and allows one attempt through
- [x] Successful half-open attempt closes the circuit and resets `consecutiveFailures`
- [x] Failed half-open attempt reopens the circuit
- [x] `resetCircuit()` resets all state
- [x] `CircuitOpenException` has HTTP status 503
- [x] All unit tests pass (`npm run test`)
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-003 — `RetryService` placeholder, `RETRY_CONFIG` constant, `ApiErrorType` enum, and `ConfigService` access via the openai config namespace must exist

# Testing Notes

**Primary seam**: service-level unit test with a mocked operation callback and fake timers.

```typescript
// Setup pattern
jest.useFakeTimers();
const module = await Test.createTestingModule({
  providers: [
    RetryService,
    { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(defaultValue) } },
    { provide: AppLoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  ],
}).compile();
```

Use `jest.advanceTimersByTimeAsync(ms)` (not `advanceTimersByTime`) to advance timers in async contexts. Call `service.resetCircuit()` in `afterEach` to prevent state leaking between tests.

**Regression risk**: `RetryService` is not exported from `OpenaiModule`. If another test accidentally imports it, that test will fail at module resolution. Keep it internal.

## Implementation Notes

**Files created/modified:**

- `src/modules/openai/exceptions/circuit-open.exception.ts` — `CircuitOpenException extends HttpException` (503)
- `src/modules/openai/services/retry.service.ts` — full implementation replacing the placeholder
- `src/modules/openai/__tests__/retry.service.spec.ts` — 10 unit tests with fake timers (new file)

**Design decisions:**

- Circuit breaker tracks consecutive failures at the **call level** (per `executeWithRetry` invocation), not the attempt level. If a call ultimately fails after all retries, consecutiveFailures increments by 1. If any attempt succeeds, consecutiveFailures resets to 0. This is the standard Resilience4j-style circuit breaker pattern.
- `HALF_OPEN` re-opens immediately on failure (does not go through the threshold) — the spec requires exactly one probe attempt.
- Permanent errors (400/401/403/404) do NOT count toward the circuit breaker's consecutiveFailures — they are client-side bugs, not service-side outages.
- Config values from `ConfigService` take precedence over `RETRY_CONFIG` constants; `??` fallback ensures RETRY_CONFIG is used if env vars are absent.
- `Math.random()` is NOT mocked in tests — fake timers advance past the maximum possible jitter, making tests deterministic regardless of random jitter.
- Test pattern for rejecting promises with timers: attach `expect(...).rejects.toThrow()` BEFORE calling `jest.advanceTimersByTimeAsync()` to prevent unhandled rejection errors.
- `exceptions/` directory created (no barrel `index.ts`) — only one exception class; a barrel would be premature.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (11 pre-existing warnings unchanged)
- `npx jest --testPathPatterns=retry.service` — 10/10 pass
- `npm run test` — 23/23 pass (full suite, no regressions)

## Assumptions Made

- Consecutive failures are counted at the call level (not per retry attempt) — makes the "five calls → circuit opens" test case clean and matches standard circuit breaker semantics.
- Permanent errors do not trip the circuit breaker — omitted from spec but semantically correct.
- `exceptions/` directory has no barrel (`index.ts`) — only one exception class so far; add one when a second exception is needed.

## Follow Ups

- `getCircuitState()` is ready to power a `GET /openai/health` endpoint (AI-010)
- `Retry-After` header support is implemented but untested — add a targeted test if the OpenAI SDK is confirmed to surface this header on 429 responses
- Consider extracting the circuit breaker state machine into its own class if it grows beyond its current size
