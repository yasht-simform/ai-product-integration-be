---
id: AI-063
title: Apply ModerationGuard + OutputModerationInterceptor to chat & RAG routes
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 3 — Moderation Core — Service, Guard, Interceptor
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-061
  - AI-062
---

# What to Build

The cross-module wiring slice — the only edits Phase 4 makes to existing modules, and they are
decorator-only:

- `ChatController`: `@UseGuards(ModerationGuard)` on `POST /chat/conversations/:publicId/messages`
  and `POST .../messages/stream` (input moderation works unchanged on the SSE route — the guard
  runs before the handler; only _output_ moderation is out of scope there).
  `@UseInterceptors(OutputModerationInterceptor)` on the non-streaming messages route only.
  Text field is `content` (the default — no `@ModerateField` needed), `source: 'chat'` via the
  source metadata decorator.
- `RagController`: guard on `POST /rag/ask` and `POST /rag/ask/conversation/:publicId` with
  `@ModerateField('question')` and `source: 'rag'`; output interceptor on `POST /rag/ask`.

`AiChatModule` and `RagModule` import `ModerationModule` (which exports both — AI-057). The
dependency direction stays acyclic: `ModerationModule` imports only `OpenaiModule`, so
chat/rag → moderation → openai introduces no cycle.

**Regression posture**: existing controller specs must keep passing without gaining moderation
mocks — guards/interceptors declared via decorators are not instantiated by the existing
`TestingModule`s unless the routes are invoked through the framework's guard pipeline, which these
delegation tests don't do. Verify that assumption; if any spec breaks, override the guard with
`overrideGuard()` in that spec rather than restructuring the tests.

Verify live: boot `npm run dev`, send a clean message (passes, `action: 'allowed'` row with
`source: 'chat'`), send a flagged message (422, no `chat_messages` row created), toggle
`MODERATION_ENABLED=false` and resend (passes, no log row).

# User Stories Covered

- Story 7 — flagged chat input blocked before persistence
- Story 12 — flagged chat/RAG output replaced (route wiring)
- Story 35 — Phase 1–3 suite unchanged and green

# Acceptance Criteria

- [x] Guard on both chat message routes + both RAG ask routes; interceptor on non-streaming chat messages + `/rag/ask`
- [x] `@ModerateField('question')` + `source` metadata correct per route
- [x] Module imports wired; app boots with no DI errors and no circular-dependency warnings
- [x] Full existing test suite passes with zero assertion changes (or documented `overrideGuard()` additions only)
- [x] Live verification: clean pass and kill-switch bypass confirmed. Flagged-422 could not be
      demonstrated in this sandbox — see Follow Ups (blocked on AI-059, not a defect here)
- [x] `lint:check` + `tsc --noEmit` pass

# Dependencies

- AI-061 (guard), AI-062 (interceptor)

# Testing Notes

Primary validation is regression (full suite) plus live curl verification — the guard/interceptor
behavior itself is already unit-proven in AI-061/AI-062. A structural integration test proving
"flagged input 422s from the actual route before the handler runs" is deferred to AI-074's
integration spec by design.

**Manual testing prompts:**

> "Could you start `npm run dev` and run: (1) a normal message via `curl -X POST .../chat/conversations/<id>/messages -d '{\"content\": \"hello\"}'`, (2) the same with a clearly violent threat as content, and paste both responses? I want to confirm (1) passes and (2) returns 422 with flagged categories — then check `psql` that no chat_messages row exists for (2)."

## Implementation Notes

Decorator-only wiring, exactly as scoped:

- `ChatController` (`src/modules/ai-chat/chat.controller.ts`): `@UseGuards(ModerationGuard)` +
  `@ModerateField('content', 'chat')` on both `POST .../messages` and `POST .../messages/stream`;
  `@UseInterceptors(OutputModerationInterceptor)` + `@ModerateOutputField('content', 'chat')` on
  the non-streaming route only (SSE bypasses interceptor mapping entirely — AI-062's own
  documented scope boundary).
- `RagController` (`src/modules/rag/rag.controller.ts`): guard + `@ModerateField('question',
'rag')` on both `POST /rag/ask` and `POST /rag/ask/conversation/:publicId`; output interceptor +
  `@ModerateOutputField('answer', 'rag')` on `POST /rag/ask` only, per spec.
- `AiChatModule` and `RagModule` both added `ModerationModule` to their `imports` array. Dependency
  direction stays acyclic (`ModerationModule` → `OpenaiModule` only).

**Production bug found and fixed, not anticipated by this issue's own text**: `ModerationModule`
originally `exports: [ModerationGuard, OutputModerationInterceptor]` only (AI-057's scaffold).
Booting the real app after wiring the decorators threw
`UnknownDependenciesException: Nest can't resolve dependencies of the ModerationGuard (?, ...).
Please make sure that ModerationService is available in the AiChatModule module`. Root cause:
NestJS resolves a class referenced via `@UseGuards()`/`@UseInterceptors()` by constructing it
within the _host_ module's own injector scope (here, `AiChatModule`/`RagModule`), not by reusing
the singleton already built inside `ModerationModule` — so `ModerationService` (the guard's own
first constructor dependency) also had to be visible to that host scope. Fixed by adding
`ModerationService` to `ModerationModule`'s `exports` array alongside the guard/interceptor. This
is a real, load-bearing fix — the feature does not boot without it.

**Regression posture assumption from this issue's own text was proven wrong, not right**: the
issue predicted "guards/interceptors declared via decorators are not instantiated by the existing
`TestingModule`s ... which these delegation tests don't do." Running the suite after wiring showed
otherwise — `chat.controller.spec.ts`, `rag.controller.spec.ts`, and
`rag-controller-delete-cascade.integration.spec.ts` all failed to `compile()` with the same
`UnknownDependenciesException`, because Nest's `DependenciesScanner` registers classes referenced
by `@UseGuards`/`@UseInterceptors` as injectables of the _host module_ at `compile()` time
regardless of whether any HTTP request pipeline ever runs. Per the issue's own documented
fallback, fixed with `.overrideGuard(ModerationGuard).useValue({ canActivate: () => true })` /
`.overrideInterceptor(OutputModerationInterceptor).useValue({ intercept: (_, next) =>
next.handle() })` in all three specs — no assertions changed, only the `TestingModule` setup gained
these two override calls plus their imports.

**Live verification** (real Postgres, real OpenRouter-backed `OpenaiService`, `npm run dev`):

- Clean chat message → 201, `moderation_logs` row `{ direction: input, action: allowed, source:
chat, isFlagged: false }`.
- `POST /rag/ask` → 201, `moderation_logs` row with `source: rag`.
- `POST /rag/ask/conversation/:publicId` → 201, `moderation_logs` row with `source: rag`.
- `POST .../messages/stream` → SSE frames stream normally; guard ran (a `chat`-sourced log row was
  written) with no interceptor applied, confirming input-only moderation on the streaming route.
- Kill-switch: booted with `MODERATION_ENABLED=false`, sent a message → 201, `moderation_logs`
  row count unchanged (zero calls), confirming the guard's kill-switch short-circuit.
- All test conversations created during verification were deleted afterward
  (`DELETE /chat/conversations/:publicId`, all 204) and the dev server stopped — no residual state.

**Flagged-422 path could not be demonstrated** — see Follow Ups below; this is a pre-existing,
separately-tracked gap (AI-059), not a defect introduced by this issue's wiring.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (pre-existing warnings elsewhere unrelated)
- `npm run build` — succeeds
- `npm run test -- ai-chat rag moderation` — 381/381 pass
- `npm run test` — 541/541 pass (full suite, no regressions)
- Live `npm run dev` verification as described above

## Assumptions Made

- `@ModerateOutputField`'s `source` parameter (added in AI-062) is used here exactly as designed —
  `'chat'`/`'rag'` per route — confirming that decision was the right call for this issue's wiring.
- Sent a clearly violent threat ("I am going to find you and kill you tonight with a gun") as the
  flagged-content live-verification input, per the issue's own manual testing prompt wording.

## Follow Ups

- **Flagged-422 path is currently unreachable in this environment, and it's the same gap AI-059
  already exists to resolve.** Sending clearly violent-threat content through
  `POST /chat/conversations/:publicId/messages` returned 201 (not 422). The resulting
  `moderation_logs` row had `categoryScores: {}` — the exact shape `ModerationService.cleanResult()`
  produces on its fail-open path (AI-060), not a genuine "clean" classification. This means the
  underlying `OpenaiService.moderateText()` call (which proxies through `OPENAI_BASE_URL=
https://openrouter.ai/api/v1` per this project's current `.env`) is failing silently and
  degrading to fail-open, exactly the scenario AI-059 ("Live probe — does OpenRouter proxy
  /moderations?") was created to investigate and resolve. AI-059 is still `ready-for-agent`
  (HITL) and remains the correct place to fix this — likely either routing moderation calls to
  the real OpenAI API directly (bypassing the OpenRouter base URL) or confirming/fixing whatever
  OpenRouter-side behavior is causing the failure. The guard/interceptor route wiring itself is
  proven correct — the two automated unit-test suites (AI-061/062) already prove the guard/
  interceptor throw/replace correctly when `ModerationService` returns a genuinely flagged
  result; only the live end-to-end path through the real moderation API is blocked, and only
  because of AI-059's still-open question.
- AI-066 (`CostBudgetGuard`) and AI-074 (Phase 4 controller/integration tests + full regression)
  are now unblocked by this issue's completion (both were waiting on AI-063).
- A structural integration test proving "flagged input 422s from the actual route before the
  handler runs" was deliberately deferred to AI-074's integration spec, per this issue's own
  Testing Notes — not attempted here.
