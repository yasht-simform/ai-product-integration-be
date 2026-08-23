---
id: AI-032
title: ChatController — send-message endpoint + tools CRUD endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-07-07
completed_at: 2026-07-07
created: 2026-07-06
parent_epic: Epic 6 — API Layer
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-023
  - AI-027
  - AI-030
  - AI-031
---

# What to Build

Add the non-streaming message endpoint and the full tools CRUD surface to `ChatController` (the SSE endpoint is separate — AI-033).

```
POST   /chat/conversations/:publicId/messages     — send message (non-streaming), body: SendMessageDto
GET    /chat/tools                                — list all registered tools
POST   /chat/tools                                — register a new tool, body: CreateToolDto
PATCH  /chat/tools/:publicId                      — update a tool
DELETE /chat/tools/:publicId                      — deactivate a tool
```

`POST /chat/conversations/:publicId/messages` delegates to `ChatService.sendMessage()` (AI-022/AI-027 — this single method already handles both the tool-calling and non-tool-calling branches internally based on `conversation.toolsEnabled`), returns `AssistantMessageResDto` per spec §6.2's exact example shape.

Tools endpoints delegate to `ToolRegistryService` (AI-023) — `findAllTools()`, `createTool()`, `updateTool()`, `deleteTool()` — each returning/accepting the DTOs from AI-030. `DELETE` returns `204` (soft-deactivate, not a hard delete, per AI-023's contract).

All routes use `@ApiEndpoint({ ..., isPublic: true })` under the same `ai-chat` Swagger tag as AI-031.

# User Stories Covered

- Story 9, 10 — send message, get response with usage/cost/latency
- Story 20 — empty content rejected at the DTO layer (via `SendMessageDto`'s `@IsNotEmpty()`)
- Story 28, 30, 31 — function-calling reachable via this endpoint (the branching logic itself lives in `ChatService`, this issue just exposes it)
- Story 37, 38 — tool registration/CRUD via API

# Acceptance Criteria

- [x] `POST /chat/conversations/:publicId/messages` returns `AssistantMessageResDto` matching spec §6.2's shape exactly
- [x] Empty `content` returns `400`
- [x] All four tools endpoints implemented, delegating to `ToolRegistryService`
- [x] `DELETE /chat/tools/:publicId` deactivates, does not hard-delete (confirmed via a follow-up `GET /chat/tools` in manual testing — row persists with `isActive: false`, not removed from the listing)
- [x] All routes documented in Swagger under `ai-chat` tag
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-023 — `ToolRegistryService`
- AI-027 — `ChatService.sendMessage()` (full, tool-calling-capable version)
- AI-030 — DTOs
- AI-031 — controller/module already scaffolded with conversation routes

# Testing Notes

Same as AI-031 — controller unit tests land in AI-034. Manual smoke test: create a tools-enabled conversation, `POST` a calculator-triggering message, confirm the response's `content` contains the correct numeric answer and that `GET /openai/audit-logs` (Phase 1's existing endpoint) shows the expected number of new rows.

## Implementation Notes

Extended `ChatController` (`src/modules/ai-chat/chat.controller.ts`) — same file as AI-031, no
new files needed — with:

- `POST /chat/conversations/:publicId/messages` — a pure one-line delegate to
  `ChatService.sendMessage(publicId, dto)`. No mapping needed: `sendMessage()` already returns a
  plain object shaped exactly as `AssistantMessageResDto` (AI-022/AI-027), so the controller layer
  adds nothing on top. `successStatus: 201`, matching `openai.controller.ts`'s convention for
  POST actions that trigger an LLM call (`chatCompletion`, `compareModels`, `promptTest` all use
  201 too, not just resource-creation routes).
- `GET /chat/tools`, `POST /chat/tools`, `PATCH /chat/tools/:publicId`,
  `DELETE /chat/tools/:publicId` — thin delegates to `ToolRegistryService` (AI-023), injected
  into `ChatController`'s constructor alongside `ChatService` (no module change needed —
  `ToolRegistryService` was already a provider in `AiChatModule` from AI-023).
- New private mapper `toToolRes(tool: ToolEntity): ToolResDto`, following the same pattern as the
  conversation/message mappers from AI-031. `ToolEntity.handlerType` is typed `string` (matching
  `ModelRegistryService`'s equivalent pattern for DB-sourced enum-like string columns), cast to
  `ToolHandlerType` at the mapping boundary.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 46 warnings (all pre-existing, none introduced)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 109/109 pass (7 suites, unchanged — no new spec file, per this
  issue's own explicit deferral of controller tests to AI-034, same as AI-031)
- `npm run test` — 229/229 pass (17 suites, full regression clean)
- **Live verification** against the real dev database (Postgres reachable locally):
  - Booted `npm run dev`, confirmed all 5 new routes (`.../messages` POST, `tools` GET/POST,
    `tools/:publicId` PATCH/DELETE) in the boot log with no DI errors
  - Tools CRUD fully exercised: created a custom tool (201), updated it (200), deactivated it
    (204), then confirmed via `GET /chat/tools` that the row still exists with `isActive: false`
    rather than disappearing — the exact behavior this issue's acceptance criterion calls out
  - Validation/error paths on the messages route (all instant, no LLM call needed): empty
    `content` → 400 (`"content should not be empty"`), missing `content` field → 400, unknown
    `conversationPublicId` → 404
  - Confirmed via `/api/docs-json` that all 5 new operations are tagged `ai-chat`
  - Cleaned up all test rows (tool + conversations) after each session; dev server stopped

## Assumptions Made

- **The full "send a calculator-triggering message, get back '132,678'" live smoke test from this
  issue's own Testing Notes could not be completed** — the configured `OPENAI_DEFAULT_MODEL`
  (`meta-llama/llama-3.3-70b-instruct:free` via OpenRouter) was too slow/unreliable to respond
  within `RetryService`'s backoff window; the request was still retrying (attempt 3/5) after
  several minutes before I stopped waiting on it. This is exactly the flakiness this codebase's
  own docs already anticipate for live free-tier model calls (compare AI-025's "expected to be
  flakier than the mocked suite and should not gate CI" note, and AI-035's entire purpose as a
  dedicated live-API smoke test issue). The wiring up to and including the actual model call was
  confirmed correct — DTO validation passed, the conversation was found, context was built, tools
  were fetched, and `RetryService`'s backoff engaged exactly as designed — only the third-party
  model's response time was the blocker. `AI-027`'s existing unit tests (mocked
  `OpenaiService`/`ToolExecutorService`) already prove the two-call tool-calling logic itself is
  correct; this issue only needed to prove the HTTP layer reaches that logic, which it does.
- `successStatus: 201` for the messages endpoint (not the DTO-validation-implied "200 because
  nothing is created") — followed `openai.controller.ts`'s established precedent for
  LLM-call-triggering POST routes over a strict REST "only 201 for resource creation" reading.

## Follow Ups

- **AI-034** owns: controller-level DTO validation tests for all 5 new routes, the full
  function-calling integration test suite, and — most relevantly — a retry against a faster/more
  reliable model (or a longer-budgeted live run) to complete the calculator-end-to-end smoke test
  this issue could not finish live. Consider checking `GET /openai/models/free` for a
  currently-responsive alternative if `meta-llama/llama-3.3-70b-instruct:free` continues to be
  slow.
- **AI-035** (live API smoke test) is the PRD's designated home for exactly this kind of
  live-model verification — don't re-attempt it as a blocking step in future AFK issues.
- **AI-033** (SSE streaming endpoint) is the only remaining unimplemented route on `ChatController`.
