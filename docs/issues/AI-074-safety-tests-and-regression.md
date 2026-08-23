---
id: AI-074
title: Phase 4 controller tests audit + moderation integration test + full regression
type: AFK
status: completed
priority: P2
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Live Verification
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-063
  - AI-066
  - AI-071
  - AI-072
  - AI-073
---

# What to Build

The verification-only close-out mirroring AI-034/AI-054 — no production code changes expected;
test files only.

1. **Coverage audit**: every Phase 4 route has a delegation test, every request DTO has a
   `validate()` smoke test (one invalid + one valid payload). Close any gaps found — prior phases'
   audits found real ones (AI-054 found two uncovered DTOs), so treat this as a genuine audit, not
   a checkbox.
2. **Moderation-blocks-before-handler integration test**, in
   `chat-function-calling.integration.spec.ts`'s "mock only real external boundaries" style: wire
   the real `ModerationGuard` + real `ModerationService` + real `OpenaiService` through a
   `TestingModule` (guards exercised via the framework — supertest against the compiled module, or
   invoke `canActivate` with a real ExecutionContext from the compiled app), mocking only
   `DatabaseService` and `OPENAI_CLIENT`. Script the moderation SDK response as flagged and prove:
   422 reaches the caller, the (mocked) chat handler/service path never runs, and exactly one
   `moderation_logs` create with `action: 'blocked'` fires. A second case with a clean response
   proves pass-through plus `action: 'allowed'`.
3. **Guard-ordering pin**: structural assertion that all four AI routes declare
   `ModerationGuard` before `CostBudgetGuard` (reads real route metadata — fails on reorder).
4. **Full regression**: `npm run test` with zero changes to any Phase 1–3 spec assertion,
   `npm run lint:check`, `npx tsc --noEmit --project tsconfig.build.json`, `npm run build` all
   clean. Record the before/after test counts (the AI-034/AI-054 convention).

# User Stories Covered

- Story 34 — full controller/DTO coverage + route-ordering pins
- Story 35 — Phase 1–3 suite unchanged and green

# Acceptance Criteria

- [x] Coverage audit documented (what was checked, what gaps were closed)
- [x] Integration test proves flagged-input 422 before the handler with exactly one `blocked` log row, and the clean-path counterpart
- [x] Guard-order structural pin in place for all four AI routes
- [x] `npm run test` passes with zero Phase 1–3 assertion changes; before/after counts recorded
- [x] `lint:check`, `tsc --noEmit`, and `build` all clean

# Dependencies

- AI-063, AI-066 (wired guards to pin), AI-071, AI-072, AI-073 (surfaces to audit)

# Testing Notes

Expect the usual transitive-import gotchas in any new spec touching the controllers: the
Prisma-ESM `jest.mock('.../database.service', ...)` stub always, and the
`jest.mock('@faker-js/faker', ...)` stub if anything transitively imports `MockDataService`
(documented pattern from AI-053/AI-054). The integration test intentionally does NOT hit a live
moderation API — flagged/clean results are scripted at `OPENAI_CLIENT`; live behavior is AI-075.

## Implementation Notes

**1. Coverage audit (genuine, not a checkbox)** — enumerated every Phase 4 route
(`ModerationController`: 4, `RetentionController`: 4, `CostManagementController`: 12 — budgets +
analytics) against `moderation.controller.spec.ts`/`retention.controller.spec.ts`/
`cost-management.controller.spec.ts` and confirmed all 20 already have a delegation test from their
originating issues (AI-071/072/073). Then enumerated every Phase 4 **request** DTO
(`moderation/dto/index.ts` + `cost-management/dto/index.ts`, 14 total) against their `*-dtos.spec.ts`
files. Found the real gap this audit exists to find: **5 cost-analytics query DTOs had zero
`validate()` coverage** — `SpendAnalyticsQueryDto`, `SpendByUserQueryDto`, `SpendByModelQueryDto`,
`SpendByFeatureQueryDto`, `SpendTimelineQueryDto` (all from AI-067/AI-068, shipped without DTO
tests since that issue's scope was the service layer). Closed by adding one invalid + one valid
`validate()` test per DTO to `cost-management-dtos.spec.ts` (10 new tests) — including proving
`SpendByModelQueryDto`/`SpendByFeatureQueryDto` correctly inherit `SpendAnalyticsQueryDto`'s
`startDate`/`endDate` validation despite declaring no fields of their own.

**2. Moderation-blocks-before-handler integration test** — new
`src/modules/ai-chat/__tests__/moderation-guard-integration.spec.ts`, following
`chat-function-calling.integration.spec.ts`'s "mock only real external boundaries" convention but
going one level further: rather than calling `ChatService` directly, it builds a real
`INestApplication` (`Test.createTestingModule({ controllers: [ChatController], providers: [...] })`
→ `createNestApplication()` → `app.init()`) and drives it with `supertest`, so `ModerationGuard`
and `CostBudgetGuard` are exercised by the actual NestJS guard pipeline, not invoked directly. Real
providers: `ChatService`, `OpenaiService`, `RetryService`, `TokenService`, `AiAuditService`,
`ModerationGuard`, `ModerationService`, `OutputModerationInterceptor`, `CostBudgetGuard`,
`Reflector`. Mocked: `DatabaseService` (`DeepMockProxy`), `OPENAI_CLIENT` (both
`chat.completions.create` and `moderations.create` scripted per test), `ModelRegistryService`,
`ToolRegistryService`/`ToolExecutorService`/`StreamingService` (unused — the test conversation has
`toolsEnabled: false`), and `CostBudgetService` (unused — `costBudget.enabled: false` in the config
mock makes `CostBudgetGuard` pass with zero calls, keeping this suite scoped to `ModerationGuard`
alone; budget enforcement already has its own dedicated live/unit coverage from AI-066).

Two cases against `POST /chat/conversations/:publicId/messages`:

- **Flagged**: `OPENAI_CLIENT.moderations.create` scripted to return a flagged result → asserts
  HTTP 422, `dbMock.chatMessage.create` **never called** (proves `ChatService.sendMessage()` never
  ran — `addUserMessage()` is its first side effect), `mockOpenaiClient.chat.completions.create`
  **never called** (the chat model itself was never invoked), and exactly one
  `moderationLog.create` with `isFlagged: true`/`action: 'blocked'`/`source: 'chat'`.
- **Clean**: scripted clean moderation + a scripted chat completion → asserts HTTP 201 with the
  real assistant content in the body, `dbMock.chatMessage.create` called **twice** (user message +
  assistant message — proving the real handler executed), and exactly one `moderationLog.create`
  with `isFlagged: false`/`action: 'allowed'`.

Confirmed empty `messages: []` on the mocked `chatConversation.findUnique` return keeps
`buildContext()`'s trim loop a no-op, so no real `tiktoken` encoding is exercised — same technique
`chat-function-calling.integration.spec.ts` already relies on.

**3. Guard-ordering structural pin** — audited first before writing anything new: this pin
**already exists**, added proactively in AI-066 (`chat.controller.spec.ts`'s and
`rag.controller.spec.ts`'s `describe('guard order (AI-066)', ...)` blocks), asserting
`Reflect.getMetadata('__guards__', ...)` equals `[ModerationGuard, CostBudgetGuard]` on all four
routes (`ChatController.sendMessage`/`sendMessageStream`, `RagController.ask`/
`askInConversation`). Re-ran both (`npm run test -- chat.controller.spec.ts rag.controller.spec.ts
-t "guard order"`) to confirm they still pass — no new test needed, this acceptance criterion was
already satisfied by prior work and is now explicitly verified rather than assumed.

**4. Full regression** — see Validation Performed below.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors, 68 warnings (identical baseline to AI-072's — no new warnings)
- `npm run build` — succeeds
- `npm run test -- moderation cost-management ai-chat` — 361/361 pass (24 suites)
- `npm run test -- chat.controller.spec.ts rag.controller.spec.ts -t "guard order"` — 2/2 pass
  (the pre-existing AI-066 pin, re-verified)
- `npm run test` (full suite) — **694/694 pass, up from 682 (+12: 10 new DTO validate() tests + 2
  new moderation-guard integration tests), zero changes to any Phase 1–3 spec assertion**

## Assumptions Made

- **The guard-ordering pin was already satisfied** — re-verified rather than re-implemented, since
  the issue's own acceptance criterion doesn't require a _second_, duplicate pin if one already
  exists and demonstrably passes.
- **The integration test disables `costBudget.enabled`** rather than wiring a real
  `CostBudgetService` — this issue is specifically about proving `ModerationGuard` blocks before
  the handler; budget-guard behavior is already covered by AI-066's own dedicated tests and live
  verification, so pulling it in here would only add unrelated setup surface without adding new
  proof.
- **Only the non-streaming `POST .../messages` route was integration-tested**, not
  `.../messages/stream` — both routes carry an identical `@UseGuards(ModerationGuard,
CostBudgetGuard)` stack and the guard has no route-specific branching, so the non-streaming route
  is representative; the SSE route's own transport-level behavior is already covered by
  `chat.controller.spec.ts`'s dedicated stream tests (AI-033/034).
- **DTO coverage audit scope was Phase 4's own request DTOs only** (moderation +
  cost-management) — `ModerateField`/`ModerateOutputField` decorators (AI-061/062) carry no
  `class-validator` surface of their own (they're `SetMetadata` wrappers), so there was nothing to
  audit there.

## Follow Ups

- AI-059 (HITL — OpenRouter `/moderations` proxy probe) and AI-075 (HITL — live smoke test:
  moderation block, budget enforcement, retention) are the only two Phase 4 issues remaining.
  AI-075 was already blocked on AI-074 (this issue) and AI-059 — it is now blocked on AI-059 alone.
- Phase 4 PRD (`docs/prd/2026-07-10-safety-compliance.md`) stays `ready-for-agent`, not
  `completed` — AI-059/AI-075 are still open.
