---
id: AI-004
title: TokenService — countTokens, estimateTokens, calculateCost + unit tests
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-25
completed_at: 2026-06-25
created: 2026-06-25
parent_epic: Epic 2 — Token Service
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-003
---

# What to Build

Implement `TokenService` with three public methods. This service is pure — no database, no HTTP, no state. It uses the `tiktoken` npm package for exact tokenization and `MODEL_PRICING` for cost calculation.

Install `tiktoken` if not already present: `npm install tiktoken`.

**Methods to implement:**

```typescript
// Exact token count using tiktoken WASM tokenizer
countTokens(text: string, model?: OpenAIModel): number

// Fast heuristic for UI previews — do NOT use for audit log costs
estimateTokens(text: string): number

// USD cost from actual token counts
calculateCost(model: string, inputTokens: number, outputTokens: number): number

// Expose pricing data for the /models/pricing endpoint
getModelPricing(): Record<string, { input: number; output: number }>
```

**Implementation details:**

`countTokens` uses `encoding_for_model(model ?? 'gpt-4o')` from tiktoken. The encoding object **must** be freed after each call via `enc.free()` — this is non-negotiable; a missing `enc.free()` is a WASM memory leak (NFR-AI-002). Wrap in try/finally to guarantee the free even on encode errors.

`estimateTokens` returns `Math.ceil(text.length / 4)`. No tiktoken involved.

`calculateCost` uses `MODEL_PRICING` as the sole source of pricing. Formula: `(inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output`, rounded to 8 decimal places via `parseFloat(result.toFixed(8))`. If `model` is not in `MODEL_PRICING`, throw a descriptive error rather than returning NaN.

`getModelPricing` returns the `MODEL_PRICING` constant directly.

**Unit tests** (`__tests__/token.service.spec.ts`):

Do NOT mock `tiktoken` — test against the real library to catch WASM initialization issues early. Known test cases:

- `countTokens('Hello world', OpenAIModel.GPT_4O)` should return `2`
- `countTokens('What is a REST API?', OpenAIModel.GPT_4O)` should return `6`
- `estimateTokens('Hello world')` should return `3` (11 chars / 4 = 2.75 → ceil = 3)
- `calculateCost('gpt-4o', 1_000_000, 0)` should return `2.5` (input price per 1M tokens)
- `calculateCost('gpt-4o', 0, 1_000_000)` should return `10.0` (output price per 1M tokens)
- `calculateCost('gpt-4o-mini', 500, 250)` should compute correctly against its pricing
- Calling `countTokens` 10 times in a loop completes without error (smoke test for WASM memory management)
- `calculateCost` with an unknown model throws an error

# User Stories Covered

- Story 5 — exact token counts using tiktoken
- Story 6 — fast heuristic estimation without WASM overhead
- Story 7 — cost calculation from MODEL_PRICING as single source of truth
- Story 8 — tiktoken encoding freed after every use

# Acceptance Criteria

- [x] `tiktoken` is in `package.json` dependencies
- [x] `countTokens` returns exact token counts (not estimates) for known inputs
- [x] `enc.free()` is called in a `finally` block — guaranteed even on encode errors
- [x] `estimateTokens` uses the `chars/4` formula, no tiktoken
- [x] `calculateCost` returns a number rounded to 8 decimal places using `MODEL_PRICING`
- [x] `calculateCost` with an unknown model throws (not returns NaN)
- [x] All unit tests pass (`npm run test`)
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0
- [x] `npm run lint` exits 0

# Dependencies

- AI-003 — `OpenAIModel` enum and `MODEL_PRICING` constant must exist; `TokenService` placeholder must exist

# Testing Notes

**Primary seam**: service-level unit test. No mocks needed — `tiktoken` is used directly.

The test file goes in `src/modules/openai/__tests__/token.service.spec.ts`. Use `Test.createTestingModule()` with `TokenService` as the only provider.

`AppLoggerService` is injected but not needed for pure computation — mock it with `{ log: jest.fn(), warn: jest.fn(), error: jest.fn() }` in the test module.

Do not mock `tiktoken`. The real WASM tokenizer must load correctly in the Jest environment. If WASM fails in Jest, check that `transformIgnorePatterns` does not block the tiktoken package.

## Implementation Notes

**Files created/modified:**

- `src/modules/openai/services/token.service.ts` — full implementation replacing the placeholder
- `src/modules/openai/__tests__/token.service.spec.ts` — 12 unit tests (new file; new `__tests__/` directory)

**Design decisions:**

- `countTokens` wraps `encoding_for_model(model)` in try/finally, guaranteeing `enc.free()` even if `encode()` throws — WASM memory leak prevention
- ESLint auto-removed the `as TiktokenModel` cast during `--fix` (linter simplification); TypeScript accepts `OpenAIModel` directly since the enum string values are a subset of the `TiktokenModel` union and the project does not use `strict` mode; `tsc --noEmit` exits 0
- `calculateCost` uses `parseFloat(result.toFixed(8))` for 8-decimal rounding; throws with a descriptive message for unknown models rather than returning NaN
- `AppLoggerService` is kept in the constructor for future use (e.g., error logging on WASM initialization failures) but is not called in the current implementation
- No tiktoken mocking — the real WASM tokenizer is exercised; tiktoken's `.cjs` entry is used by Node/Jest automatically via the `node` export condition

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (11 pre-existing warnings unchanged)
- `npx jest --testPathPatterns=token.service` — 12/12 pass
- `npm run test` — 13/13 pass (full suite, no regressions)

## Assumptions Made

- `tiktoken` was already in `package.json` (v1.0.22) — no install required
- TypeScript accepts `encoding_for_model(model)` without an explicit cast because `noImplicitAny: false` and `strict` mode is not enabled; if stricter settings are added later, restore `model as unknown as TiktokenModel`

## Follow Ups

- `getModelPricing()` is implemented now to support the future `/models/pricing` endpoint (AI-010)
- Consider adding per-call logging in `countTokens` if token audit detail is needed at the service level
