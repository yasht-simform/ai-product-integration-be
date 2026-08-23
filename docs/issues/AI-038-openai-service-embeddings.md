---
id: AI-038
title: OpenaiService — generateEmbedding() + generateEmbeddingsBatch()
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 2 — OpenaiService Embedding Extension
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-036
---

# What to Build

Add two new methods to Phase 1's `OpenaiService` — `generateEmbedding(text, model?)` and `generateEmbeddingsBatch(texts, model?)` — following the exact extension pattern Phase 2 used for `chatCompletionWithMessages()`: additive, reuses the existing `RetryService`/`AiAuditService` pipeline unchanged, never modifies `chatCompletion()`/`chatCompletionWithMessages()`'s behavior.

Both call `openaiClient.embeddings.create({ model, input })` — `generateEmbedding()` passes a single string and returns `response.data[0].embedding` as `number[]`; `generateEmbeddingsBatch()` passes the full `texts[]` array as `input` in one API call and returns `number[][]` in the same order as the input (OpenAI's embeddings endpoint preserves input order in its `data[]` response).

Wrap both in `RetryService.executeWithRetry()`, exactly like `chatCompletion()`. Log both through `AiAuditService.log()` with `endpoint: OpenAIEndpoint.EMBEDDINGS` (the enum value already exists, unused, from Phase 1's scaffold) — `userMessage` can be the input text (truncated/first-item for the batch case), `systemPrompt` is not applicable (`undefined`).

Cost: reuse `TokenService.calculateCost(model, inputTokens, 0)` — embeddings have no output tokens, so pass `0` for `outputTokens` rather than adding a second cost-calculation code path. `model` defaults to `ragConfig.embeddingModel` (AI-036) when not explicitly passed.

Extract the shared retry/audit tail into the same private helper `chatCompletionWithMessages()` already uses if that doesn't overcomplicate the diff — otherwise a parallel, equally-thin private helper for the embeddings pair is acceptable, since embeddings and chat completions have different response shapes to unpack.

# User Stories Covered

- Story 8 — `generateEmbedding()` reuses existing retry logic
- Story 9 — every embedding call logged with `endpoint: 'embeddings'`
- Story 10 — `generateEmbeddingsBatch()` embeds multiple chunks in one call
- Story 11 — circuit breaker applies identically to embedding calls
- Story 12 — embedding cost via the DB → `MODEL_PRICING` → `0` fallback chain

# Acceptance Criteria

- [x] `generateEmbedding(text, model?)` added to `OpenaiService`, returns `number[]`
- [x] `generateEmbeddingsBatch(texts, model?)` added, single API call, returns `number[][]` in input order
- [x] Both route through `RetryService.executeWithRetry()` and produce an `ai_audit_logs` row with `endpoint: 'embeddings'`
- [x] Cost estimated via `TokenService.calculateCost(model, inputTokens, 0)`
- [x] `model` defaults to `ragConfig.embeddingModel` when omitted
- [x] Existing `chatCompletion()`/`chatCompletionWithMessages()` tests unmodified and passing
- [x] New unit tests: successful single embed, successful batch embed, retry-then-succeed, a circuit-open failure surfaces the same `CircuitOpenException` chat completions already use, failure logs a `FAILED` audit row, cost calculation
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-036 (`ragConfig.embeddingModel` default)

# Testing Notes

Extend the existing `openai.service.spec.ts` rather than creating a new spec file, mirroring AI-018's approach exactly — add `describe('generateEmbedding')`/`describe('generateEmbeddingsBatch')` blocks reusing the file's existing `OPENAI_CLIENT`/`RetryService`/`TokenService`/`AiAuditService` mocks. Mock SDK response shape:

```typescript
{ data: [{ embedding: [0.01, -0.02, 0.03] }], model: 'text-embedding-3-small', usage: { prompt_tokens: 12, total_tokens: 12 } }
```

Run `npx jest --testPathPatterns=openai.service` and confirm the pass count is the prior baseline plus the new tests — a shared-helper refactor that subtly changes `chatCompletion()`'s behavior would be caught here.

## Implementation Notes

Added `generateEmbedding(text, model?)` and `generateEmbeddingsBatch(texts, model?)` to
`OpenaiService`, plus a private `executeEmbedding()` helper (parallel to `executeCompletion()`,
kept separate rather than merged since the SDK response shapes genuinely differ —
`embeddings.create()` returns `{ data: Embedding[] }` vs. chat completions' `{ choices }`) that
handles the shared retry/audit/error-mapping tail: `RetryService.executeWithRetry()` wraps
`openaiClient.embeddings.create({ model, input })`, cost is computed via
`TokenService.calculateCost(model, inputTokens, 0)`, and `AiAuditService.log()` is called with
`endpoint: OpenAIEndpoint.EMBEDDINGS` on both the success and failure paths — mirroring
`executeCompletion()`'s structure exactly, including reusing the existing `mapError()` (so a
`CircuitOpenException` from `RetryService` passes through embeddings calls unchanged, same as chat
completions).

`generateEmbedding()` extracts `response.data[0]?.embedding ?? []`; `generateEmbeddingsBatch()`
maps `response.data` to `number[][]` directly (relying on the OpenAI API's documented
input-order-preserving behavior, per this issue's own text — no explicit sort by the response's
`index` field). Added a private `resolveEmbeddingModel()` helper for the
`model ?? config.get('rag.embeddingModel') ?? 'text-embedding-3-small'` fallback chain, shared by
both public methods. Neither method takes `userId`/`requestId` parameters (matching this issue's
literal two-parameter signature) — `requestId` is generated internally via `crypto.randomUUID()`,
`userId` is left `undefined` in the audit log for both.

`__tests__/openai.service.spec.ts`: promoted the previously `beforeEach`-local `configMock` to an
outer `let` (needed so a new test can override it mid-test to prove the `rag.embeddingModel`
fallback is actually read), added `embeddings: { create: jest.fn() }` to `mockOpenAIClient`, added a
`makeEmbeddingResponse(count)` fixture builder, and added two new `describe` blocks
(`generateEmbedding()` — 8 tests across success/failure, `generateEmbeddingsBatch()` — 3 tests)
covering every item in this issue's acceptance criteria, including a dedicated
`CircuitOpenException`-passthrough test (`rejects.toBe(circuitOpenError)`, proving the exact same
instance survives `mapError()` unchanged).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 54 warnings (unchanged from the pre-existing baseline)
- `npm run build` — succeeds
- `npx jest --testPathPatterns=openai.service` — 23/23 pass (11 pre-existing `chatCompletion()`/`chatCompletionWithMessages()` tests unmodified + 12 new embedding tests)
- `npm run test` (full suite) — 283/283 pass, 21/21 suites, no regressions
- Live boot check: `node dist/src/main.js` — starts cleanly, no DI/runtime errors

## Assumptions Made

- `generateEmbeddingsBatch()` trusts the OpenAI API's documented order-preserving `data[]` response
  rather than sorting by each item's `index` field — matches this issue's own stated assumption
  verbatim, not an independent judgment call.
- Audit log `userMessage` for the batch case is the first input text only (`texts[0] ?? ''`), per
  this issue's "truncated/first-item for the batch case" instruction — the full batch isn't
  reconstructed into the audit log.

## Follow Ups

None — this fully unblocks AI-043 (document ingestion pipeline) and AI-045 (semantic search), both
of which call `OpenaiService.generateEmbedding()`/`generateEmbeddingsBatch()` directly per their own
issue text.
