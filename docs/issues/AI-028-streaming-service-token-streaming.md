---
id: AI-028
title: StreamingService.streamCompletion() — SSE token streaming
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
  - AI-016
---

# What to Build

Implement `StreamingService.streamCompletion(messages, options): AsyncGenerator<StreamEvent>` — the one place in the entire codebase that calls the OpenAI SDK with `stream: true` directly. `OpenaiService` (Phase 1 + AI-018) has no streaming support, so this service injects `OPENAI_CLIENT` itself (the same injection token `OpenaiModule` already exports it under) rather than going through `OpenaiService`.

```typescript
streamCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: { model?: string; temperature?: number; tools?: OpenAI.Chat.ChatCompletionTool[] }
): AsyncGenerator<StreamEvent>
```

```typescript
interface StreamEvent {
  type: StreamEventType;
  data: string | ToolCallData | { error: string };
}
interface ToolCallData {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
```

**Core loop** (spec §7.2):

```typescript
const stream = await openaiClient.chat.completions.create({ model, messages, tools, stream: true });
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.content) yield { type: StreamEventType.TOKEN, data: delta.content };
  if (delta?.tool_calls) yield { type: StreamEventType.TOOL_CALL, data: /* mapped ToolCallData */ };
}
```

Accumulate the full response content and any tool-call deltas as you iterate (OpenAI streams tool-call arguments in fragments across multiple chunks — they need to be concatenated by `index`/`id` before the tool call is complete) so the caller (AI-029/`ChatService`) can persist the complete message once the generator finishes, not just the individual token fragments.

This issue covers the happy-path generator only — client disconnect handling, error events, and audit logging are AI-029. Keep `streamCompletion()` itself simple and focused: it's a pure transform from "OpenAI stream" to "sequence of `StreamEvent`s," with no DB writes and no `AiAuditService` calls inside it (those belong to the caller in AI-029, matching how `ChatService`/`OpenaiService` split responsibilities elsewhere in this codebase — services that touch the SDK don't also own persistence).

# User Stories Covered

- Story 21 — receive `token` events as the model generates
- Story 22 — concatenated token events equal the non-streaming response exactly

# Acceptance Criteria

- [x] `streamCompletion()` yields a `token` event for every chunk with `delta.content`
- [x] `streamCompletion()` yields a `tool_call` event once a tool call's arguments are fully accumulated across chunks (not one malformed partial-JSON event per chunk)
- [x] Concatenating all yielded `token` event `data` strings reproduces the exact full response content a non-streaming call with identical input would produce (proven with an identical mocked response split across multiple chunks vs. one non-chunked mock)
- [x] The generator can be drained into a plain array in a test via a small `for await` helper
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-016 — module scaffold, `StreamEventType` enum, `StreamEvent`/`ToolCallData` types

# Testing Notes

**Primary seam**: `streaming.service.spec.ts`. Mock `OPENAI_CLIENT.chat.completions.create()` to return an async-iterable object (not a real stream — a plain object with `[Symbol.asyncIterator]` yielding a hardcoded array of chunk objects is sufficient and avoids any real transport).

Write a small test helper `async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]>` that pushes every yielded value into an array — reuse it across all streaming tests in this module (AI-029 will need the same helper).

Test the multi-chunk tool-call accumulation case explicitly: feed chunks where `tool_calls[0].function.arguments` arrives split across 3 chunks (e.g. `'{"exp'`, `'ression":"2+2'`, `'"}'`) and assert the emitted `tool_call` event has the fully-formed, valid-JSON-parsed arguments — this is the single easiest thing to get subtly wrong in a streaming tool-call implementation.

## Implementation Notes

`StreamingService.streamCompletion()` (`src/modules/ai-chat/services/streaming.service.ts`) injects
`OPENAI_CLIENT` directly (not `OpenaiService` — Phase 1's service has no `stream: true` support)
and is a plain async generator: `for await (const chunk of stream)`, yielding a `TOKEN` event per
`delta.content` and accumulating `delta.tool_calls` fragments in a `Map<index, accumulator>` keyed
by the chunk's `tool_calls[].index` (OpenAI streams a tool call's `id`/`function.name` once on the
first fragment and `function.arguments` incrementally across subsequent fragments, all sharing the
same `index`). A `TOOL_CALL` event is emitted per accumulated tool call only when
`choice.finish_reason === 'tool_calls'` — the signal that every tool-call fragment for this turn
has arrived — never per-chunk, so downstream consumers never see partial/invalid JSON.

**New type**: `StreamCompletionOptions` (`types/ai-chat.types.ts`) — `{ model?, temperature?,
tools? }`, matching the spec §5.2 signature exactly. Default model resolution mirrors
`ChatService.createConversation()`'s existing fallback chain:
`options.model ?? config.get('openai.defaultModel') ?? OpenAIModel.GPT_4O`.

**Module wiring change**: `OpenaiModule`'s `exports` array (`src/modules/openai/openai.module.ts`)
now includes `OPENAI_CLIENT` alongside the existing service exports — it wasn't exported before
this issue (only `OpenaiService`/`AiAuditService`/`TokenService`/`ModelRegistryService` were), so
`AiChatModule` (which already imports `OpenaiModule`) can inject the token into `StreamingService`.
This is a superset-only change to Phase 1's public surface — no existing consumer is affected.

**Malformed-JSON guard**: if a fully-accumulated tool call's `arguments` string isn't valid JSON
(a real possibility per the OpenAI SDK's own type docs — "the model does not always generate valid
JSON"), the service logs the error via `AppLoggerService` and yields `{}` rather than throwing,
since a single bad tool call must not crash the whole stream — `ToolExecutorService` (AI-026)
already handles missing/invalid args gracefully on the receiving end.

**Scope boundary respected**: no `DONE`/`ERROR` `StreamEventType` is ever yielded by this service —
per spec §2.3, `[DONE]` is emitted by the orchestration layer (AI-029/AI-033) only after the
assistant message is persisted, and error/disconnect handling is explicitly AI-029's scope. This
service is a pure "OpenAI stream → `StreamEvent` sequence" transform with no DB writes, matching
the issue's stated boundary.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (pre-existing `no-unsafe-*` warnings only, per `CLAUDE.md`'s documented
  downgrade; one new warning in `streaming.service.ts`'s `JSON.parse` catch path, same category)
- `npm run build` — succeeds
- `npm run test -- streaming` — 7/7 pass
- `npm run test` — 236/236 pass (full suite, no regressions)
- Verified live: `npm run dev` boots cleanly, `AiChatModule dependencies initialized` with no DI
  errors — confirms `StreamingService`'s new `OPENAI_CLIENT` injection resolves correctly through
  the newly-exported token.

## Assumptions Made

- `StreamCompletionOptions` was added as a new named interface in `types/ai-chat.types.ts` rather
  than inlining the options object type, matching this file's existing convention of one named
  interface per service-boundary shape.
- Multiple concurrent tool calls in a single turn (different `index` values) are each accumulated
  and emitted independently — the spec's pseudocode only shows a single tool call, but AI-027's
  existing `ChatService.handleToolCalls()` already runs multiple tool calls concurrently via
  `Promise.all()`, so the streaming path needed to support the same multi-tool-call case.

## Follow Ups

- AI-029 will wrap this generator to add disconnect handling, `ERROR`/`DONE` events, and persist
  the accumulated content/tool-calls via `ChatService` — it can reuse this issue's `drain()` test
  helper and `toAsyncIterable()` mock shape from `streaming.service.spec.ts`.
