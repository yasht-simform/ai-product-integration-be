---
id: AI-058
title: OpenaiService — moderateText() + moderateBatch() SDK seam
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 2 — OpenaiService Moderation Extension
parent_prd: 2026-07-10-safety-compliance.md
blocked_by: []
---

# What to Build

Add moderation to Phase 1's `OpenaiService` following the exact additive extension pattern
AI-018 (`chatCompletionWithMessages()`) and AI-038 (`generateEmbedding()`) established — only
`OpenaiService` touches the SDK; `ModerationModule` will consume this seam, never
`openaiClient.moderations` directly.

- `moderateText(input: string)` — calls `openaiClient.moderations.create({ input })`, returns the
  first result's raw shape: `{ flagged: boolean; categories: Record<string, boolean>;
category_scores: Record<string, number> }` (mapped to camelCase `categoryScores` at this seam so
  callers never see the SDK's snake_case).
- `moderateBatch(inputs: string[])` — single API call with the array as `input` (the moderation
  endpoint natively accepts arrays), returns one result per input in input order.

Both wrap the call in `RetryService.executeWithRetry()` and log through `AiAuditService.log()`
with `endpoint: OpenAIEndpoint.MODERATIONS` (defined-but-unused since Phase 1) and
`estimatedCost: 0` — the endpoint is free, and analytics must not attribute cost to it.
`userMessage` on the audit row is the input text truncated (first item for batch), mirroring
AI-038's batch convention. Reuse `mapError()` unchanged so `CircuitOpenException` passes through
identically to completions/embeddings. Follow `executeEmbedding()`'s precedent: a parallel private
`executeModeration()` helper is fine — don't force-merge with helpers whose response shapes differ.

Do not add config toggles, thresholds, or `moderation_logs` writes here — those are
`ModerationService`'s job (AI-060). This seam is a pure, always-on SDK wrapper.

# User Stories Covered

- Story 1 — moderation through the existing retry/audit pipeline
- Story 2 — audit rows with `endpoint: 'moderations'`, `estimatedCost: 0`

# Acceptance Criteria

- [x] `moderateText(input)` and `moderateBatch(inputs)` added to `OpenaiService`, camelCase result shape
- [x] Both route through `RetryService.executeWithRetry()`; failures produce a `FAILED` audit row; circuit-open surfaces `CircuitOpenException`
- [x] Every call produces an `ai_audit_logs` row with `endpoint: 'moderations'` and `estimatedCost: 0`
- [x] Batch returns results in input order from a single SDK call
- [x] Existing `chatCompletion()`/`chatCompletionWithMessages()`/embedding tests unmodified and passing
- [x] New unit tests: clean result, flagged result, batch order, retry-then-succeed, failure audit row, circuit-open passthrough
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

None — can start immediately (parallel with AI-056/AI-057).

# Testing Notes

Extend `openai.service.spec.ts` (AI-018/AI-038's approach) with `describe('moderateText')`/
`describe('moderateBatch')` blocks reusing the existing `OPENAI_CLIENT`/`RetryService`/
`AiAuditService` mocks. Mock SDK response shape:

```typescript
{
  id: 'modr-1', model: 'omni-moderation-latest',
  results: [{
    flagged: true,
    categories: { hate: false, sexual: true, violence: false },
    category_scores: { hate: 0.001, sexual: 0.85, violence: 0.02 },
  }],
}
```

Run `npx jest --testPathPatterns=openai.service` and confirm prior baseline + new tests — any
shared-helper refactor that changes completion behavior gets caught here. No live calls; the
OpenRouter-vs-direct question is AI-059's.

## Implementation Notes

Added `moderateText(input: string): Promise<ModerationResult>` and
`moderateBatch(inputs: string[]): Promise<ModerationResult[]>` to `OpenaiService`
(`src/modules/openai/services/openai.service.ts`), following `generateEmbedding()`/
`generateEmbeddingsBatch()`'s exact shape: `ensureConfigured()` guard, a `crypto.randomUUID()`
`requestId`, delegation to a new private `executeModeration()` helper (parallel to
`executeCompletion()`/`executeEmbedding()`, kept separate since `ModerationCreateResponse`'s shape
shares nothing with chat/embedding responses), and a private `toModerationResult()` mapper that
converts the SDK's snake_case `category_scores` to camelCase `categoryScores` — the only response
mapping this seam does.

`executeModeration()` wraps `openaiClient.moderations.create({ input })` in
`RetryService.executeWithRetry()`, logs one `AiAuditService.log()` call per invocation
(`endpoint: OpenAIEndpoint.MODERATIONS`, `estimatedCost: 0`, `inputTokens`/`outputTokens`/
`totalTokens: 0` — the moderation endpoint reports no usage), and reuses `mapError()` unchanged so
a `CircuitOpenException` from `RetryService` passes through identically to
`chatCompletion()`/`generateEmbedding()`. `userMessage` on the audit row is the input text (first
item for `moderateBatch()`, matching `generateEmbeddingsBatch()`'s convention) truncated to 1000
characters via a new private `truncateForAudit()` helper (`MAX_AUDIT_TEXT_LENGTH` constant) — the
audit log column has no DB-level length constraint, but an unbounded moderation-check payload
isn't useful to store in full for a free-of-charge, high-volume endpoint.

On the success path, the audit row's `model` is `response.model` (the SDK reports which moderation
model actually ran). On the failure path there is no response to read a model from — no `model`
parameter exists on `moderateText()`/`moderateBatch()`'s public signatures, since the SDK defaults
the moderation model server-side — so a `DEFAULT_MODERATION_MODEL` constant
(`'omni-moderation-latest'`, the SDK's own current default) is logged instead, purely for the
audit row's non-nullable `model` column; it does not change which model the SDK actually invokes.

Added `ModerationResult` (`{ flagged, categories: Record<string, boolean>, categoryScores:
Record<string, number> }`) to `src/modules/openai/types/openai.types.ts`, alongside the existing
`ChatCompletionResult`.

No config toggles, thresholds, or `moderation_logs` writes were added — this seam is a pure,
always-on SDK wrapper, exactly as scoped. `ModerationModule`/`ModerationService` (AI-060) will be
the only consumer of `moderateText()`/`moderateBatch()`, per the one-way dependency rule
(`ModerationModule → OpenaiModule`, `OpenaiModule` unaware of moderation policy).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 59 pre-existing warnings (all `no-unsafe-*`, downgraded to
  warnings per project convention; one new warning at the `isConfigured` test-only cast, consistent
  with the same pattern already present in the `chatCompletion()`/`generateEmbedding()` tests)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npx jest --testPathPatterns=openai.service` — 33/33 pass (24 pre-existing + 9 new: 6 in
  `describe('moderateText')`, 3 in `describe('moderateBatch')`)
- `npm run test` (full suite) — 485/485 pass across 33 suites (up from 474/474 before this issue),
  zero changes to any pre-existing spec file's assertions

## Assumptions Made

- `MAX_AUDIT_TEXT_LENGTH = 1000` for the audit-row truncation: the issue says "truncated" but
  doesn't specify a length. Chose 1000 to match the same truncation length CLAUDE.md documents for
  `ModerationLog.content` (AI-056/AI-060's own convention), so both a `moderations` audit row and
  its eventual `moderation_logs` row will use the same truncation budget.
- `DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'` is only ever used as an audit-row fallback
  string on the failure path (no response to read `response.model` from) — it is never passed to
  the SDK call itself, since `moderateText()`/`moderateBatch()` intentionally take no `model`
  parameter per the issue's own signatures.

## Follow Ups

- AI-059 (HITL) still needs to determine whether the currently configured OpenRouter base URL
  proxies `/moderations`, or whether moderation calls need to bypass `OPENAI_BASE_URL` and hit the
  real OpenAI endpoint directly — this issue only builds the SDK seam and does not make a live call.
- AI-060 will add `ModerationService`, config-driven thresholds, and `moderation_logs` persistence
  on top of this seam.
