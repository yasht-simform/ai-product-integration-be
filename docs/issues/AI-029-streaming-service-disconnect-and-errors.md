---
id: AI-029
title: StreamingService — client disconnect, mid-stream errors, partial persistence
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-07
completed_at: 2026-07-07
parent_epic: Epic 4 — Streaming Service
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-028
  - AI-020
---

# What to Build

Wrap AI-028's `streamCompletion()` generator with the resilience behavior spec §7.3/§7.4 requires, and wire it into `ChatService` so a streamed turn ends up persisted the same way a non-streamed turn does.

**Client disconnect** (FR-CH-005, NFR-CH-008): the caller (the SSE controller endpoint, built in AI-033) is responsible for detecting `request.on('close')`, but this service must expose a way to be told "stop" — accept an `AbortSignal` parameter on `streamCompletion()` (extend AI-028's signature) and pass it through to the SDK call (`openaiClient.chat.completions.create({ ...， stream: true }, { signal })` — the `openai` SDK supports a `signal` in its per-request options). When the signal aborts mid-iteration, the `for await` loop should exit cleanly rather than throwing an unhandled error — catch the abort-specific error type and stop yielding further events, then let the caller know how much was captured so far (the accumulated partial content from AI-028's accumulator).

**Add a `sendMessageStream()` orchestration method to `ChatService`**, mirroring `sendMessage()` (AI-022/AI-027) but streaming:

```typescript
sendMessageStream(conversationPublicId: string, dto: SendMessageDto, abortSignal: AbortSignal): AsyncGenerator<StreamEvent>
```

1. `addUserMessage()` → `buildContext()` — same as the non-streaming path
2. Delegate to `StreamingService.streamCompletion(messages, { tools?, signal: abortSignal })`, re-yielding each event to the caller as it arrives (so the controller can forward them straight to SSE)
3. On generator completion (normal or aborted), persist the result:
   - Normal completion: `addAssistantMessage()` with the full accumulated content, computed `tokenCount`/`cost`/`latencyMs`, `incomplete: false`
   - Aborted mid-stream: `addAssistantMessage()` with whatever partial content was accumulated, `incomplete: true` (per AI-020's `incomplete` flag support)
4. Every path — success or abort — must call `AiAuditService.log()` exactly once for this turn, `status: SUCCESS` for a full completion, `status: FAILED` with the partial token count for an abort/error (per FR-CH-010/spec §7.3 step 4) — this streaming call bypasses `OpenaiService.chatCompletionWithMessages()` entirely (it uses `OPENAI_CLIENT` directly per AI-028), so audit logging here is `StreamingService`'s/`ChatService`'s own responsibility, not inherited for free the way the non-streaming path gets it from `OpenaiService`.

**Mid-stream errors** (distinct from client disconnect — an OpenAI API error during iteration): yield a `StreamEventType.ERROR` event with the error message, then stop the generator. The caller-side `sendMessageStream()` treats this the same as an abort for persistence purposes (partial message saved, `incomplete: true`, audit `FAILED`).

**Final `done` event**: after a normal (non-aborted, non-errored) completion, `sendMessageStream()` yields one last `StreamEventType.DONE` event carrying `{ messageId, usage, estimatedCost, latencyMs }` per spec §6.3's example — this is the point where the client learns the turn is fully settled.

# User Stories Covered

- Story 23 — final `done` event with usage/cost/latency
- Story 25 — disconnect aborts upstream, saves partial message, no crash
- Story 26 — mid-stream error → error event, partial save, audit `FAILED`
- Story 27 — every streamed turn produces exactly one audit row regardless of outcome

# Acceptance Criteria

- [x] `streamCompletion()` accepts an `AbortSignal` and stops yielding cleanly when it fires, without throwing an unhandled rejection
- [x] `ChatService.sendMessageStream()` persists a full assistant message with `incomplete: false` on normal completion
- [x] Aborting after N token events results in a persisted partial message (containing exactly the accumulated content up to the abort) with `incomplete: true`
- [x] A simulated mid-stream SDK error yields an `error` SSE event and results in the same partial-save + `incomplete: true` behavior as an abort
- [x] Exactly one `AiAuditService.log()` call happens per streamed turn, with `status: FAILED` and the partial token count on abort/error, `SUCCESS` on completion
- [x] A normal completion's final event is `done` with `{ messageId, usage, estimatedCost, latencyMs }`
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-028 — base `streamCompletion()` generator
- AI-020 — `addAssistantMessage()`'s `incomplete` flag support

# Testing Notes

**Primary seam**: extend `streaming.service.spec.ts` for the abort-signal behavior, and add streaming-specific tests to `chat.service.spec.ts` for the persistence/audit wiring.

Simulate a client disconnect in tests via `AbortController` — create one, call `streamCompletion()` with its `signal`, then call `controller.abort()` partway through iterating the returned generator (e.g. after manually pulling 3 values via `.next()`), and assert the generator terminates without throwing and that the accumulator captured exactly those 3 tokens' worth of content.

Reuse the `drain()` helper from AI-028's tests where a full drain (not partial pull) is what the test needs.

## Implementation Notes

**`StreamingService.streamCompletion()`** (`src/modules/ai-chat/services/streaming.service.ts`)
gained a `signal?: AbortSignal` field on `StreamCompletionOptions` (`types/ai-chat.types.ts`),
passed as the second (`RequestOptions`) argument to `openaiClient.chat.completions.create()`. The
whole body (creation + `for await` iteration) is now wrapped in one `try/catch`, because the two
places an abort can surface differ: the OpenAI SDK links the passed `signal` to its own internal
`AbortController` and already swallows an abort that fires _during_ iteration (the SDK's `Stream`
class catches it and the `for await` loop just ends with no exception) — but an abort that fires
_before_ `create()`'s promise resolves rejects with `APIUserAbortError`, which does need catching.
The single `catch` block checks `error instanceof APIUserAbortError || signal?.aborted` and simply
`return`s (ends the generator, no event) for an abort; any other error yields a
`StreamEventType.ERROR` event with the message, then ends the generator — this is what
distinguishes "client disconnect" (spec §7.4, no error surfaced) from "mid-stream SDK error" (spec
§7.3, `error` event yielded).

**`ChatService.sendMessageStream()`** (`src/modules/ai-chat/services/chat.service.ts`) mirrors
`sendMessage()`'s shape: look up the conversation, reject whitespace-only content, `addUserMessage()`,
`buildContext()`, then `for await` over `streamingService.streamCompletion()`, re-yielding every
event to the caller while accumulating `TOKEN` data into `accumulatedContent`, `TOOL_CALL` data
into a `toolCalls` array, and capturing the last `ERROR` event's message. Once the loop ends
(normally, on abort, or after an error), it computes `incomplete = abortSignal.aborted ||
streamErrorMessage !== undefined`, persists one `addAssistantMessage()` call with the accumulated
content and `incomplete` flag, calls `AiAuditService.log()` exactly once (`SUCCESS` vs `FAILED`
keyed off the same `incomplete` flag), and — only on a clean completion — yields one final
`StreamEventType.DONE` event with `{ messageId, usage, estimatedCost, latencyMs }`.

**New constructor deps on `ChatService`**: `StreamingService` (same-module DI, no export needed)
and `AiAuditService` (already exported from `OpenaiModule`, which `AiChatModule` already imports —
no module wiring change required, unlike AI-028's `OPENAI_CLIENT` export).

**Token/cost accounting for the streaming path**: OpenAI's streaming API doesn't return a `usage`
object per chunk unless the request opts into `stream_options: { include_usage: true }` (not
requested here — out of scope, since AI-028's `streamCompletion()` doesn't ask for it). So
`sendMessageStream()` estimates `inputTokens` via a new private `countMessagesTokens()` helper
(sums `TokenService.countTokens()` over each built-context message's string `content`) and
`outputTokens` via `TokenService.countTokens(accumulatedContent, model)` — the same token-counting
primitive the non-streaming path already trusts, just applied to the accumulated stream output
instead of an SDK-reported number. `estimatedCost` still goes through
`TokenService.calculateCost()`, so the DB→`MODEL_PRICING`→`0` fallback chain (documented in
`CLAUDE.md`'s "Dynamic model registry" section) applies identically to both paths.

**New type**: `StreamDoneData` (`types/ai-chat.types.ts`) — `{ messageId, usage: {inputTokens,
outputTokens, totalTokens}, estimatedCost, latencyMs }` — added to `StreamEvent.data`'s union
alongside the existing `string | ToolCallData | { error: string }` members.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (pre-existing `no-unsafe-*` warnings only, per `CLAUDE.md`'s documented
  downgrade; no new warnings introduced by this issue's source changes)
- `npm run build` — succeeds
- `npm run test -- chat.service` — 52/52 pass (45 pre-existing + 7 new `sendMessageStream()` tests)
- `npm run test -- streaming` — 10/10 pass (7 pre-existing AI-028 tests, 2 updated for the new
  `{ signal }` request-options argument, 3 new: abort-signal passthrough, clean exit on
  pre-resolve abort, `error` event on a genuine mid-stream failure)
- `npm run test` — 246/246 pass (full suite, no regressions)
- Verified live: `npm run dev` boots cleanly against a real Postgres instance —
  `AiChatModule dependencies initialized` and `ChatController {/api/v1/chat}` routes mapped with no
  DI errors, confirming `ChatService`'s two new constructor dependencies
  (`StreamingService`/`AiAuditService`) resolve correctly.

## Assumptions Made

- **No tool execution in the streaming path.** The issue's own numbered steps (1–4) only describe
  re-yielding `StreamingService` events and persisting the result — they never mention running
  `ToolExecutorService` or making the two-call tool-calling protocol's second request when a
  `TOOL_CALL` event arrives mid-stream. Implementing that would be a materially larger, undescribed
  scope addition (spec §6.3's own example shows `tool_result` events and a second round of `token`
  events after a `tool_call`, which this issue doesn't ask for). `sendMessageStream()` therefore
  only forwards `TOOL_CALL` events to the client and persists them on the assistant message
  (`toolCalls` field) without executing them — the streamed turn ends after the model's first
  tool-call-requesting response. This mirrors the codebase's existing pattern of documenting a
  "Known gap" for live/streaming+tool-calling combinations (see AI-032's note) rather than silently
  guessing at an unscoped design.
- **Streamed tool-call persistence shape differs from the non-streaming path's.** The non-streaming
  path persists `toolCalls` as raw `OpenAI.Chat.ChatCompletionMessageFunctionToolCall[]` objects
  (`{id, type, function: {name, arguments}}`); the streaming path persists the already-parsed
  `ToolCallData[]` shape (`{toolCallId, toolName, arguments}`) that `StreamingService` naturally
  produces. Both are stored as opaque JSON (`Prisma.InputJsonValue`) and neither is currently
  re-read/re-parsed by any other code path, so this divergence has no functional impact today —
  flagged here so AI-033/AI-034 don't assume a single shape when building the SSE controller or
  its tests.
- **Token/cost figures are estimates, not SDK-reported.** As explained above, since streaming
  without `stream_options.include_usage` gives no real `usage` object — this is a reasonable
  reading of the issue's "computed `tokenCount`/`cost`/`latencyMs`" wording (as opposed to
  "SDK-reported"), and is one estimate-tolerant step better than always recording `0`.

## Follow Ups

- AI-033 (SSE controller) needs to create the `AbortController`, wire `request.on('close')` to
  `controller.abort()`, and forward each yielded `StreamEvent` as an SSE frame — this issue only
  built the generator-and-persistence half of that contract.
- A future issue could extend the streaming path to execute tool calls and make the model's
  second synthesis call while still streaming (mirroring AI-027's non-streaming two-call
  protocol) — deferred per the "Assumptions Made" note above; AI-035's live smoke test should
  surface whether this gap actually matters for the intended use cases before it's built.
- Adopting `stream_options: { include_usage: true }` on the OpenAI request would let
  `sendMessageStream()` use SDK-reported token counts instead of the `TokenService`-estimated
  ones, matching the non-streaming path's precision exactly.
