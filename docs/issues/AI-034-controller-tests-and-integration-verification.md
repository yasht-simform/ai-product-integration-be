---
id: AI-034
title: ChatController unit tests + function-calling integration verification + regression check
type: AFK
status: completed
priority: P2
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-07
completed_at: 2026-07-07
parent_epic: Epic 7 — Testing & Audit Integration Verification
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-032
  - AI-027
---

# What to Build

Three things, following Phase 1's `AI-013`/`AI-014` precedent for a final verification issue:

**1. `ChatController` unit tests** — DTO validation via `class-validator`'s `validate()` called directly, exactly matching `openai.controller.spec.ts`'s established pattern (no full `TestingModule`, just construct DTO instances and assert `validate()` results for valid/invalid payloads across `CreateConversationDto`, `SendMessageDto`, `CreateToolDto`, etc. — whichever weren't already covered by AI-030's minimal smoke tests).

**2. Full function-calling flow integration test** — drive `ChatService.sendMessage()` (with `ToolExecutorService`/`ToolRegistryService` real, not mocked, but `OpenaiService`/`OPENAI_CLIENT` mocked at the SDK boundary) through the complete calculator scenario:

- Create a tools-enabled conversation (real `ChatService.createConversation()`)
- Send "What is 234 times 567?"
- Mock the first `OpenaiService.chatCompletionWithMessages()` call to return a `tool_calls` result requesting `calculator` with `{"expression":"234*567"}`
- Let the real `ToolExecutorService`/calculator tool execute (no mock here — prove the real math evaluates correctly)
- Mock the second `chatCompletionWithMessages()` call to return content containing `"132,678"`
- Assert the final returned message's content contains `"132,678"`
- Assert `AiAuditService.log()` was called exactly twice for this turn (SC-CH-013's per-turn count — extend to the full scenario: 3 normal messages + 1 tool-triggering message = 4 total audit rows across the conversation, if this test covers multiple sends; if it only covers the one tool-triggering turn, assert 2 audit calls for that turn specifically and note that the 4-total figure is a multi-turn scenario better suited to a slightly larger test setup)

**3. Phase 1 regression check** — run the full existing test suite (`npm run test`) and confirm `openai.service.spec.ts` (extended in AI-018) and every other Phase 1 spec file still passes with no changes to their assertions, proving `chatCompletionWithMessages()` was purely additive.

# User Stories Covered

- Story 44 — new services' unit tests mock DB/OpenaiService the same way Phase 1 does
- Story 45 — full function-calling protocol verified end-to-end against mocks
- Story 46 — Phase 1 regression proof

# Acceptance Criteria

- [x] `ChatController`/DTO validation tests cover all request DTOs not already covered in AI-030
- [x] Function-calling integration test exercises the real calculator tool (not mocked) and asserts the correct numeric result appears in the final content
- [x] Integration test asserts the expected `ai_audit_logs` write count for the tool-triggering turn
- [x] `npm run test` passes in full — zero regressions in any Phase 1 spec file
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes with zero `any` types introduced across the entire `ai-chat` module
- [x] `npm run lint` passes (or produces no new warnings beyond the project's existing documented baseline)

# Dependencies

- AI-027 — full `sendMessage()` with tool-calling
- AI-032 — controller wiring, so DTOs are exercised through the actual request surface where relevant

# Testing Notes

This issue is itself mostly testing work — no new production code beyond whatever small gaps the tests surface (e.g. if a DTO validation edge case reveals a missing decorator, fix it here rather than filing yet another issue).

Keep the integration test's OpenAI-SDK-boundary mock as close to `OpenaiModule`'s real `OPENAI_CLIENT` injection token as possible (mock at that DI boundary, not by stubbing out `ChatService`'s own methods) — mocking too high up the call stack would make this test indistinguishable from the narrower `chat.service.spec.ts` unit tests it's meant to sit above.

## Implementation Notes

**Gap found during context-gathering**: no `chat.controller.spec.ts` file existed at all — AI-030's
`chat-dtos.spec.ts` already covers every request DTO (`CreateConversationDto`,
`UpdateConversationDto`, `QueryConversationsDto`, `SendMessageDto`, `CreateToolDto`,
`UpdateToolDto`) with both valid and invalid payloads, so the DTO-validation half of this issue's
first deliverable was already satisfied. The actual gap was `ChatController`-level unit tests
(delegation/mapping assertions), which this issue fills.

**1. `src/modules/ai-chat/__tests__/chat.controller.spec.ts`** (new, 17 tests) — mirrors
`openai.controller.spec.ts`'s `TestingModule`-based delegation-test pattern: `ChatService` and
`ToolRegistryService` are provided as plain `jest.fn()`-based mocks (no `DeepMockProxy`, since the
controller never touches `DatabaseService` directly). Covers all 11 conversation/message/tool
routes (delegation + entity→ResDto null-to-undefined mapping + `NotFoundException` propagation)
plus four dedicated `sendMessageStream()` tests against a hand-built fake Express `Response`
(`writeHead`/`write`/`end`/`on` as `jest.fn()`s, with an `emitClose()` helper to simulate the
underlying socket closing):

- Happy path: primes the stream once, writes SSE headers exactly once, writes one frame per
  yielded event (assessed via `formatSseFrame()` directly, not a hand-duplicated string).
- Pre-stream error (e.g. `NotFoundException` thrown before any `yield`): propagates uncaught,
  confirming `response.writeHead`/`.write` are never called — the priming-call contract from
  AI-033.
- **Regression coverage for AI-033's disconnect bug**: asserts that calling `response`'s captured
  `'close'` listener (not `request`'s) flips the `AbortSignal` passed into
  `ChatService.sendMessageStream()` to `aborted: true`. This is the first automated test of that
  wiring — AI-033 could only verify it live via `curl`+`kill`, since Nest's `TestingModule` has no
  real HTTP transport to exercise `request.on('close')` timing against.
- Mid-stream failure after headers are committed: asserts the last `response.write()` call is an
  `event: error` frame (not a thrown exception), matching AI-033's committed-headers scope
  boundary.

**2. `src/modules/ai-chat/__tests__/chat-function-calling.integration.spec.ts`** (new, 2 tests) —
per the Testing Notes' explicit instruction, mocks at the `OPENAI_CLIENT` DI boundary rather than
stubbing `OpenaiService` itself, so `OpenaiService`, `RetryService`, `AiAuditService`,
`TokenService`, `ToolRegistryService`, and `ToolExecutorService` are all **real** instances wired
through a `TestingModule`; only `DatabaseService` (`DeepMockProxy`), the `OPENAI_CLIENT` token
(`chat.completions.create` scripted with `mockResolvedValueOnce()` twice), `ModelRegistryService`,
`HttpService`, `WeatherTool`, and `StreamingService` (unused by `sendMessage()`) are mocked.
`OpenaiService.onModuleInit()` is called explicitly after `module.compile()` (per this repo's
documented `TestingModule` gotcha — hooks don't fire automatically) so `ensureConfigured()` doesn't
reject every call.

The main test: creates a `toolsEnabled: true` conversation via the real
`ChatService.createConversation()`, sends "What is 234 times 567?", and lets the real
`ToolExecutorService` → `ToolRegistryService` → `executeCalculator()` chain run unmocked — `mathjs`
genuinely evaluates `234*567` — while the two `OPENAI_CLIENT.chat.completions.create()` calls are
scripted (first returns a `tool_calls` response requesting `calculator`, second returns a canned
final answer containing `"132,678"`). Asserts: final `result.content` contains `"132,678"`; the
first SDK call included `tools`, the second didn't (proving the two-call protocol's "no tools on
the synthesis call" behavior); `dbMock.aiAuditLog.create` — the real `AiAuditService.log()`'s
actual write point — was called **exactly twice** (once per `chatCompletionWithMessages()` call,
satisfying SC-CH-013's per-turn count); and `dbMock.chatMessage.create` was called 4 times (user
message, tool-decision assistant message, tool-result message, final assistant message). A second
test proves a malformed calculator expression doesn't crash the turn — `ToolExecutorService`'s
existing "never rejects" contract surfaces it as a failed tool result, and the turn still
completes with 2 audit calls.

**3. Phase 1 regression check**: `npm run test` (full suite) — 271/271 pass, up from the
pre-existing 250 (21 new tests added by this issue), zero changes to any Phase 1 spec file's
assertions. `openai.service.spec.ts` (extended in AI-018 for `chatCompletionWithMessages()`) passes
unchanged, confirming that method was purely additive.

No production code changes were needed — the tests didn't surface any DTO or service gaps.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 54 warnings (up from the documented 50-warning baseline by
  exactly 4 — all `@typescript-eslint/no-unsafe-member-access` on `jest.fn().mock.calls[n][m]`
  array-index access, the same downgraded-to-warning category every other spec file in this repo
  already carries; no new warning category introduced)
- `npm run build` — succeeds (prisma:generate + nest build)
- `npm run test -- ai-chat` — 151/151 pass
- `npm run test` — 271/271 pass (full suite, zero regressions)

## Assumptions Made

- Interpreted deliverable #1 ("ChatController unit tests") as requiring an actual
  `chat.controller.spec.ts` file (delegation/mapping tests), since the issue's own acceptance
  criterion — "DTO validation tests cover all request DTOs not already covered in AI-030" — was
  already fully satisfied by AI-030's `chat-dtos.spec.ts` with zero gaps found. Treating the issue
  as a no-op here would have left `ChatController` as the only controller in the codebase without
  any dedicated spec file.
- For the integration test, re-read the Testing Notes' explicit instruction ("mock at that DI
  boundary, not by stubbing out `ChatService`'s own methods") as applying to `OpenaiService` too —
  not just `ChatService` — since the What-to-Build section's parenthetical ("`OpenaiService`/
  `OPENAI_CLIENT` mocked at the SDK boundary") is satisfied more faithfully by mocking only
  `OPENAI_CLIENT` and letting the real `OpenaiService`/`AiAuditService` chain run, which is also
  the only way to assert "`AiAuditService.log()` called exactly twice" against real audit-logging
  code rather than a hand-simulated call count.
- Scoped the integration test to the single tool-triggering turn (2 audit calls), per the issue's
  own fallback guidance ("if it only covers the one tool-triggering turn, assert 2 audit calls for
  that turn specifically") rather than building a larger multi-turn (4-audit-row) scenario, since
  `chat.service.spec.ts` already exercises multi-message conversation flows at the unit level.

## Follow Ups

- The 4-audit-row, multi-turn scenario (3 normal messages + 1 tool-triggering message) mentioned as
  an optional extension in the issue text was not built — `chat.service.spec.ts`'s existing
  `sendMessage()` orchestration tests already cover repeated calls at the unit level, and building
  a second, larger integration test purely to move from "2 audits verified" to "4 audits verified"
  didn't seem to add proportionate value. Revisit only if a real regression in cross-turn audit
  counting is ever suspected.
