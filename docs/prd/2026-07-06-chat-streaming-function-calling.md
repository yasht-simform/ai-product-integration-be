---
title: Chat Completions, Streaming & Function Calling
status: completed
created: 2026-07-06
last_updated: 2026-07-07
phase: 2
tags:
  - ai-chat
  - streaming
  - sse
  - function-calling
  - tool-execution
  - context-window
authors:
  - Yash Trivedi
---

# Chat Completions, Streaming & Function Calling

## Problem Statement

Phase 1 gave the application a single-shot, stateless way to call OpenAI: `OpenaiService.chatCompletion()`
takes one `prompt` string, calls the model once, and returns one response. There is no concept of a
conversation, no way to stream a response back token-by-token, and no way for the model to invoke external
tools. Every real AI chat product (ChatGPT, Claude, Copilot) is built on exactly these three primitives, so
Phase 2 exists to add them on top of Phase 1's foundation rather than duplicate it.

From the **developer's learning perspective**, this phase teaches:

- How to model a multi-turn conversation as an append-only message log and rebuild an LLM-ready context
  from it on every turn
- How to implement a sliding-window context-trimming algorithm that keeps a growing conversation inside a
  model's context window without losing the system prompt
- How to convert a request/response HTTP call into a Server-Sent Events (SSE) stream, including handling
  client disconnects and aborting the upstream OpenAI stream
- How OpenAI's function-calling protocol actually works end-to-end: the model requests a tool call, the
  server executes it out-of-band, and a **second** LLM call synthesizes the tool result into a natural
  language answer
- How to design a tool registry that stores tool definitions as data (JSON Schema in Postgres) rather than
  hardcoding them, while still shipping a few built-in tools that need no external configuration

From the **system's technical perspective**, Phase 2 fills the following gaps:

- No conversation or message persistence — every Phase 1 call is stateless and unaudited beyond the
  single `ai_audit_logs` row it produces
- `OpenaiService.chatCompletion()` only accepts a single `prompt` + optional `systemPrompt` — it has no way
  to accept an existing multi-message history or a `tools` parameter, both of which function calling and
  multi-turn chat require
- No streaming capability anywhere in the codebase — `main.ts`, the controller layer, and
  `OpenaiService` are all built around a single awaited response
- No tool/function-calling infrastructure — no tool registry table, no tool execution sandboxing, no
  built-in tools

The Prisma schema has no `chat_conversations`, `chat_messages`, or `chat_tools` tables. All three must be
added in this phase.

---

## Solution

A new `AiChatModule` (the `src/modules/ai-chat/` folder already exists as an empty placeholder) composed
of four services and one controller, importing `OpenaiModule` from Phase 1 and never touching the OpenAI
SDK directly.

**Module architecture:**

```
AiChatModule
├── ChatService              ← conversation + message CRUD, sliding-window context building, orchestration
├── StreamingService         ← SSE wrapper around OpenAI's streaming API
├── ToolRegistryService      ← CRUD for chat_tools, converts DB rows to OpenAI's tools parameter shape
├── ToolExecutorService      ← executes builtin/http tool calls with timeout + parallel execution
└── ChatController           ← REST endpoints (conversations, messages) + SSE endpoint (messages/stream) + tools CRUD
```

**Service responsibilities:**

- `ChatService` is the orchestrator. It never calls the OpenAI SDK — it calls `OpenaiService` (extended,
  see below) for every LLM call, and `TokenService` for context-window counting.
- `StreamingService` is the only place that calls the OpenAI SDK with `stream: true` directly, since
  streaming is not something Phase 1's `OpenaiService.chatCompletion()` supports. It still routes through
  `RetryService` conceptually (see Implementation Decisions) and always finishes by writing one
  `AiAuditService.log()` row, matching Phase 1's audit contract.
- `ToolRegistryService` owns the `chat_tools` table and is the single source of truth for "what tools exist
  and are active." It is the only service that knows how to format a DB row into
  `OpenAI.Chat.ChatCompletionTool`.
- `ToolExecutorService` owns _running_ a tool once the model has requested it. It knows nothing about the
  database beyond looking up a tool's `handlerConfig` via `ToolRegistryService`.

**Data flow — standard (non-streaming) chat turn:**

```
ChatController.sendMessage()
  → ChatService.addUserMessage(conversationId, content)          [persist immediately]
  → ChatService.buildContext(conversationId)                     [sliding window, TokenService-backed]
  → OpenaiService.chatCompletion({ messages, tools? })            [Phase 1 service, extended — see below]
  → (if tool_calls present) ToolExecutorService.execute(...)  → OpenaiService.chatCompletion() again
  → ChatService.addAssistantMessage(conversationId, response)
  → return AssistantMessageResDto
```

**Data flow — streaming chat turn:**

```
ChatController.sendMessageStream() [SSE]
  → ChatService.addUserMessage(conversationId, content)
  → ChatService.buildContext(conversationId)
  → StreamingService.streamCompletion(messages, { tools? })  → AsyncGenerator<StreamEvent>
      → for each OpenAI chunk: yield token | tool_call event
      → on client disconnect: abort upstream stream, persist partial message
  → ChatService.addAssistantMessage(conversationId, fullResponse, { incomplete? })
  → yield done event with usage + cost
```

**Critical integration decision — `OpenaiService` must be extended, not bypassed.** Phase 1's
`OpenaiService.chatCompletion(params: ChatCompletionParams)` only accepts `{ prompt, systemPrompt, model,
temperature, maxTokens, userId, requestId }` — a single string, not a message array, and no `tools`
parameter. `ChatService`'s multi-turn context and `ToolExecutorService`'s tool-calling flow both need to
pass an arbitrary `OpenAI.Chat.ChatCompletionMessageParam[]` and an optional `tools[]`. Rather than have
`AiChatModule` call the OpenAI SDK directly (which would violate Phase 1's "only `OpenaiService` touches the
SDK" rule and fork the retry/audit/cost logic), Phase 2 adds a new method to `OpenaiService` —
`chatCompletionWithMessages(params: MessagesCompletionParams): Promise<ChatCompletionResult>` — that accepts
a full message array and an optional `tools` array, and reuses the exact same retry, token-cost, and audit
pipeline as `chatCompletion()`. The original single-prompt `chatCompletion()` stays unchanged for Phase 1
callers and Swagger test endpoints.

**Integration with existing modules:**

- `AiChatModule` imports `OpenaiModule` and injects `OpenaiService`, `TokenService`, and
  `ModelRegistryService` (for context-window lookups) — all already exported from Phase 1.
- `DatabaseModule` is global — `ChatService` and `ToolRegistryService` inject `DatabaseService` directly.
- `AppLoggerService` is global — used for all logging, including SSE lifecycle events (stream start,
  abort, error).
- Every LLM call `ChatService`/`StreamingService` makes is still recorded in `ai_audit_logs` via Phase 1's
  `AiAuditService` — Phase 2 adds no new audit table.

---

## Epic Breakdown

### Epic 1: Database Schema Extension

**Goal**

Add `chat_conversations`, `chat_messages`, and `chat_tools` to `schema.prisma`, wire the cascade-delete
relation, add the three indexes, run a migration, and seed the three built-in tools.

**Stories Included**

- Stories 1–6

**Dependencies**

- None — this is the foundation epic, same pattern as Phase 1's Epic 1

**Risks**

- Prisma v7 conventions from Phase 1 apply unchanged: generator `"prisma-client"`, output
  `../generated/prisma`, adapter-based `DatabaseService`
- `chat_messages.conversationId` cascade delete must be verified with an actual delete in a test, not just
  read from the schema — Prisma's `onDelete: Cascade` is easy to get backwards

**Success Criteria**

- Migration applies cleanly via `npm run prisma:migrate`
- Deleting a `chat_conversations` row removes all its `chat_messages` rows (verified by test)
- The three built-in tools (`calculator`, `weather`, `datetime`) exist in `chat_tools` after seed/module init
- `npx prisma validate` and `npx tsc --noEmit --project tsconfig.build.json` both pass

---

### Epic 2: OpenaiService Extension for Multi-Turn & Tool Calls

**Goal**

Add `chatCompletionWithMessages()` to Phase 1's `OpenaiService` so it can accept a full message history and
an optional `tools` parameter, reusing the existing retry/audit/cost pipeline unchanged. This unblocks both
`ChatService` (multi-turn) and `ToolExecutorService`'s synthesis call.

**Stories Included**

- Stories 7–10

**Dependencies**

- Phase 1's `OpenaiService`, `RetryService`, `TokenService`, `AiAuditService` (all exist, unchanged
  contracts)
- Epic 1 (needs `chat_tools` shape to know what a tool definition looks like, for typing)

**Risks**

- Must not change the signature or behavior of the existing `chatCompletion()` — Phase 1's controller
  endpoints and tests depend on it staying stable
- `response.choices[0]?.message.tool_calls` must be threaded through to the caller; Phase 1's
  `ChatCompletionResult` type has no field for this and needs a compatible extension

**Success Criteria**

- Existing Phase 1 `OpenaiService` unit tests still pass unmodified
- A new unit test proves `chatCompletionWithMessages()` forwards `tools` to the SDK call and surfaces
  `tool_calls` on the result when the mocked SDK response includes them
- Both methods produce identically-shaped `ai_audit_logs` rows

---

### Epic 3: Chat Service — Conversations, Messages & Context Window

**Goal**

Implement conversation/message CRUD and the sliding-window context-building algorithm described in the
spec (§9): keep the system prompt, keep the latest N messages, trim to 80% of the model's context window
using `TokenService.countTokens()`, truncate any single oversized message.

**Stories Included**

- Stories 11–20

**Dependencies**

- Epic 1 (schema), Epic 2 (`OpenaiService.chatCompletionWithMessages()`)
- `ModelRegistryService.getModelPricing()`/model lookup for context-window size (falls back to
  `CONTEXT_CONFIG.defaultContextWindow` of 128,000 when unknown)

**Risks**

- Off-by-one errors in the trimming loop (removing the system prompt by accident) are the single easiest
  bug to introduce here — needs a dedicated unit test with a synthetic long conversation
- Auto-title generation (first 50 chars + `"..."`) must not run mid-string on a multi-byte character —
  slice on a safe boundary

**Success Criteria**

- `buildContext()` on a 50-message conversation completes in <100ms (NFR-CH-002)
- A 60+ message conversation stays within 80% of the model's context window without dropping the system
  prompt
- `sendMessage()` persists the user message before calling the model, and the assistant message only after
  a successful (or partial/error) response — matching the spec's ordering in §2.2

---

### Epic 4: Streaming Service — SSE Token Streaming

**Goal**

Wrap OpenAI's `stream: true` chat completion in an `AsyncGenerator<StreamEvent>`, exposed over SSE, with
correct handling of client disconnects (abort upstream) and mid-stream errors (partial message persisted,
audit logged as `FAILED` with partial token count).

**Stories Included**

- Stories 21–27

**Dependencies**

- Epic 3 (`ChatService.buildContext()` supplies the messages array to stream)
- NestJS `@Sse()` decorator or raw `Response` SSE writes (spec §7.1)

**Risks**

- Client-disconnect detection (`request.on('close')`) must actually abort the OpenAI SDK stream
  (`stream.controller.abort()`) — an untested disconnect path is the most likely source of leaked
  connections/silent cost
- First-chunk-to-first-SSE-event latency budget is 50ms (NFR-CH-001) — any synchronous work between
  receiving a chunk and writing it to the response will blow this

**Success Criteria**

- A full streamed response, when its `token` events are concatenated, equals what a non-streaming call
  with the same input would return
- Disconnecting after 3 tokens results in a saved partial assistant message with `incomplete: true` in
  `metadata`, an aborted upstream stream, and no server crash
- Every streamed turn produces exactly one `ai_audit_logs` row, `SUCCESS` or `FAILED` accordingly

---

### Epic 5: Tool Registry & Built-in Tools

**Goal**

Implement `ToolRegistryService` (CRUD + OpenAI-format conversion) and `ToolExecutorService` (execution with
10s builtin / 5s HTTP timeouts, parallel `Promise.all` execution for multi-tool-call responses), plus the
three built-in tools: `calculator` (`mathjs`, never `eval()`), `weather` (Open-Meteo, no API key), `datetime`
(`dayjs`, already a dependency).

**Stories Included**

- Stories 28–37

**Dependencies**

- Epic 1 (`chat_tools` table + seed rows)
- New dependency: `mathjs` must be added to `package.json` (not currently installed — verified against
  current `package.json`)
- `dayjs` is already installed from Phase 1 setup — no new dependency for the `datetime` tool

**Risks**

- `mathjs`'s `evaluate()` still needs a sane input guard — malicious or absurdly nested expressions can hang
  or consume excessive memory even without `eval()`
- Open-Meteo geocoding can return zero results for an ambiguous city name (e.g. "Springfield") — must
  surface as a tool error, not an unhandled rejection
- HTTP-handler tools accepting an arbitrary `handlerConfig.url` is an SSRF risk if not constrained; the spec
  calls for a configurable domain whitelist (§8.4) — this must actually be enforced, not just documented

**Success Criteria**

- `getToolDefinitions()` output matches OpenAI's exact expected shape (`{ type: "function", function: {...} }`)
  byte-for-byte against the spec's example
- Calculator never uses `eval()`/`new Function()` — enforced by a lint rule or code review, verifiable by
  grep
- A tool that exceeds its timeout returns `{ success: false, error: "Tool execution timed out" }` to the
  model instead of throwing
- Two simultaneous tool calls (e.g. weather + datetime) execute concurrently, not sequentially (verified by
  timing in a test)

---

### Epic 6: API Layer — Controller, DTOs & Swagger

**Goal**

Expose all endpoints from spec §6: conversation CRUD, archive, send message (sync + SSE), tools CRUD — all
documented with `@ApiEndpoint()` per the project's existing Swagger convention, all validated with
`class-validator` DTOs.

**Stories Included**

- Stories 38–43

**Dependencies**

- Epics 3, 4, 5 (the services this controller calls)
- Existing `@ApiEndpoint()` composite decorator, `ResponseInterceptor`, `HttpExceptionFilter` (all global,
  no changes needed)

**Risks**

- The SSE endpoint's response envelope cannot go through the global `ResponseInterceptor` (which wraps
  JSON bodies in `{ success, data, timestamp }`) — SSE has its own `event:`/`data:` framing. This needs an
  explicit interceptor bypass or route-level exclusion, otherwise the interceptor will corrupt the stream.
- `GET /chat/conversations/:publicId` on a conversation with zero messages must return `200` with an empty
  `messages: []`, not `404` (SC-CH-012) — an easy accidental regression if `findConversation` throws on
  empty relations

**Success Criteria**

- All endpoints appear in Swagger at `/api/docs` under an `ai-chat` tag
- Invalid `content` (empty string) on send-message returns `400` via the global validation pipe
- SSE endpoint sends valid `text/event-stream` content that a plain `curl -N` or `EventSource` can consume

---

### Epic 7: Testing & Audit Integration Verification

**Goal**

Cover every service with unit tests following Phase 1's established patterns (`jest-mock-extended` for
`DatabaseService`, mocked `OpenaiService`/SDK responses) and add integration-style tests proving the
two-call function-calling flow and the audit trail it produces.

**Stories Included**

- Stories 44–46

**Dependencies**

- All prior epics
- Phase 1's existing spec patterns: `DatabaseService` mocked via `jest.mock()` at the top of the spec file
  (see `CLAUDE.md` — Jest/ESM incompatibility), `AiAuditService` tested with `DeepMockProxy`

**Risks**

- Streaming code (`AsyncGenerator`) is awkward to unit test — needs a helper to drain an async generator
  into an array of events for assertions
- Testing the client-disconnect abort path requires simulating `request.on('close')`, which most jest+nest
  test harnesses don't do out of the box — likely needs a small manual `EventEmitter`-based fake request

**Success Criteria**

- `npm run test` passes with new spec files for `ChatService`, `StreamingService`, `ToolRegistryService`,
  `ToolExecutorService`, `AiChatController`
- A test proves a tools-enabled conversation with one tool call produces exactly the expected number of
  `ai_audit_logs` rows (SC-CH-013: 3 normal + 1 tool-synthesis = 4)
- `npx tsc --noEmit --project tsconfig.build.json` passes with zero `any` types introduced

---

## User Stories

1. As a developer, I want to create a chat conversation with an optional title, system prompt, model, and
   tools-enabled flag, so that I can start a multi-turn interaction with sane defaults.
2. As a developer, I want an untitled conversation to auto-generate its title from the first user message
   (first 50 characters + "…"), so that conversation lists are human-readable without extra input.
3. As a developer, I want to list conversations with pagination and filters, so that I can browse chat
   history without loading everything at once.
4. As a developer, I want to fetch a single conversation with all of its messages in chronological order, so
   that I can render a full chat transcript.
5. As a developer, I want to fetch a just-created conversation with zero messages and get an empty
   `messages: []` array (not a 404), so that a new conversation renders correctly before the first message
   is sent.
6. As a developer, I want to update a conversation's title, system prompt, or model, so that I can correct
   metadata without recreating the conversation.
7. As a developer, I want to archive a conversation, so that it disappears from my active list without
   being deleted.
8. As a developer, I want to delete a conversation and have all of its messages cascade-deleted, so that no
   orphaned message rows are left behind.
9. As a developer, I want to send a message to a conversation and receive the assistant's full response
   synchronously, so that I can build a simple non-streaming chat client.
10. As a developer, I want the assistant's response to include usage stats (input/output/total tokens),
    estimated cost, and latency, so that I can track spend per message.
11. As a developer, I want every send-message call to append the user message, build context, call the
    model, and append the assistant message in that exact order, so that a crash mid-call never leaves the
    conversation in an inconsistent state (user message present, assistant missing, is acceptable and
    recoverable — the reverse is not).
12. As a developer, I want `buildContext()` to always retain the system prompt regardless of how many
    messages are trimmed, so that the model never loses its instructions in a long conversation.
13. As a developer, I want the context window to be trimmed to 80% of the model's max context (not 100%),
    so that the model's own response has headroom and doesn't trigger a context-length API error.
14. As a developer, I want a single message that alone exceeds the context window to be truncated rather
    than causing the whole request to fail, so that one pasted wall of text doesn't break the conversation.
15. As a developer, sending a 61st message in a 60-message conversation should trim the oldest non-system
    messages and succeed without an API error, so that long-running conversations remain usable
    indefinitely.
16. As a developer, I want context building for a 50-message conversation to complete in under 100ms, so
    that it doesn't become the bottleneck in the request path.
17. As a developer, I want to send 5 messages in a row and then fetch the conversation and see all 10
    messages (5 user + 5 assistant) in order, so that multi-turn history is reliably persisted.
18. As a developer, I want each stored assistant message to record its token count, cost, latency, and
    model, so that per-message cost auditing is possible without re-deriving it from `ai_audit_logs`.
19. As a developer, I want to override `model`, `temperature`, or `maxTokens` on a single message without
    changing the conversation's stored defaults, so that I can experiment mid-conversation.
20. As a developer, I want an empty `content` string on send-message to be rejected with a `400`, so that
    blank messages never reach the model.
21. As a developer, I want to send a message to a streaming endpoint and receive `token` events as the
    model generates its response, so that the UI can render text as it arrives instead of waiting for the
    full response.
22. As a developer, I want the concatenation of all `token` event contents to exactly equal the full
    response I would have gotten from the non-streaming endpoint, so that streaming is a strict UX
    improvement, not a different answer.
23. As a developer, I want a final `done` event with usage stats, estimated cost, and latency after the
    stream completes, so that the client can finalize its UI state (e.g. show the final cost) without a
    separate API call.
24. As a developer, I want the time from the first OpenAI chunk arriving to the first SSE event reaching the
    client to be under 50ms, so that streaming actually feels real-time and not internally buffered.
25. As a developer, if I disconnect mid-stream after receiving 3 tokens, I want the server to detect the
    disconnect, abort the upstream OpenAI call, and save whatever content arrived as a partial assistant
    message, so that no cost is wasted generating tokens nobody will see and no resource leaks.
26. As a developer, if an error occurs mid-stream, I want an `error` SSE event, the connection closed, the
    partial response saved with an `incomplete: true` flag, and the audit log recorded as `FAILED` with the
    partial token count, so that failures are observable and recoverable.
27. As a developer, I want every streamed turn — successful, partial, or failed — to produce exactly one
    `ai_audit_logs` row, so that cost tracking has no blind spots for streaming traffic.
28. As a developer, I want to enable `toolsEnabled` on a conversation and ask "What is 234 times 567?", so
    that the model can call the calculator tool and give me the exact numeric answer instead of guessing.
29. As a developer, I want the calculator tool to use `mathjs` and never `eval()`/`new Function()`, so that
    arbitrary code cannot be executed through a math expression string.
30. As a developer, I want to ask about the weather in a named city and get a real answer via the
    Open-Meteo API, so that function calling is demonstrated against a real, free, keyless external service.
31. As a developer, I want to ask "what's the weather in London and what time is it there" and have both the
    weather and datetime tools called and their results synthesized into one answer, so that multi-tool-call
    responses are supported, not just single-tool.
32. As a developer, I want multiple tool calls in one model response to execute in parallel via
    `Promise.all`, not sequentially, so that a multi-tool turn isn't slower than the slowest tool times the
    number of tools called.
33. As a developer, I want a tool execution that exceeds its 10-second timeout to return a structured
    `{ success: false, error: "Tool execution timed out" }` to the model rather than hang the request or
    throw an unhandled exception, so that a slow or broken tool can't take down a conversation.
34. As a developer, I want a model-requested tool call for a tool that doesn't exist (or is inactive) to
    return an error back to the model as context, so that the model can tell the user it couldn't use that
    tool instead of the server crashing.
35. As a developer, I want tool results stored as `role: "tool"` messages linked to their `toolCallId`, so
    that the full conversation — including tool invocations and results — is replayable and debuggable from
    the message log alone.
36. As a developer, I want function calling to always cost exactly two LLM calls (decide-tool, then
    synthesize-result) and have both calls individually audited in `ai_audit_logs`, so that cost tracking
    for tool-augmented conversations is transparent and not hidden inside one opaque call.
37. As a developer, I want to register a new tool via `POST /chat/tools` with a name, description, and JSON
    Schema parameters, so that I can extend the model's capabilities without redeploying code (for `http`
    handler tools).
38. As a developer, I want `GET /chat/tools` to list all registered tools and `PATCH`/`DELETE` to
    update/deactivate them, so that the tool catalog has full CRUD like every other registry in this
    codebase (mirroring Phase 1's provider/model registry pattern).
39. As a developer, I want `ToolRegistryService.getToolDefinitions()` to output the exact JSON shape OpenAI's
    API expects (`{ type: "function", function: { name, description, parameters } }`), so that a
    malformed tools payload never causes a silent 400 from the OpenAI API.
40. As a developer, I want an HTTP-handler tool's outbound call constrained to a configurable domain
    whitelist and a 5-second timeout, so that a misconfigured or malicious tool registration can't be used
    as an SSRF vector or hang the server.
41. As a developer, I want all new endpoints documented in Swagger under an `ai-chat` tag using the existing
    `@ApiEndpoint()` decorator, so that the API surface stays discoverable and consistent with Phase 1's
    modules.
42. As a developer, I want conversation creation with an invalid `model` string to fail validation the same
    way Phase 1's `@IsValidModel()` decorator already enforces on other endpoints, so that model validation
    is consistent across the whole app.
43. As a developer, I want the SSE endpoint's raw event stream to bypass the global `ResponseInterceptor`
    JSON-wrapping, so that `event:`/`data:` framing reaches the client uncorrupted.
44. As a developer, I want unit tests for `ChatService`, `StreamingService`, `ToolRegistryService`, and
    `ToolExecutorService` that mock `DatabaseService` and `OpenaiService` the same way Phase 1's specs do,
    so that the test suite runs without live OpenAI calls or a real database.
45. As a developer, I want a test that drives the full function-calling flow (calculator) end-to-end against
    mocks and asserts the final synthesized text contains the correct numeric result, so that the two-call
    protocol is verified as a whole, not just its individual pieces.
46. As a developer, I want a regression check that Phase 1's existing `OpenaiService` tests still pass
    unmodified after adding `chatCompletionWithMessages()`, so that Phase 2 provably doesn't break Phase 1.

---

## Implementation Decisions

- **`ChatService` never calls the OpenAI SDK.** All model calls go through `OpenaiService`
  (`chatCompletion()` for the rare single-prompt case, `chatCompletionWithMessages()` — new in this phase —
  for multi-turn and tool-augmented calls). This preserves Phase 1's rule that `OpenaiService` is the only
  SDK boundary and means retry, circuit-breaker, and audit behavior is identical across every calling
  pattern in the app.
- **Messages are append-only.** No `updatedAt`, no edit endpoint, no soft delete on `chat_messages` — a
  conversation is a log, matching the existing `AiAuditLog` append-only pattern from Phase 1.
- **Tool results are persisted as `role: "tool"` messages**, not as a side-channel or a field on the
  assistant message. This mirrors OpenAI's own conversation format exactly, which keeps the stored
  conversation directly replayable back through the API without transformation.
- **Function calling is always exactly two LLM calls.** The first call may return `tool_calls` instead of
  content; the second call (with the tool result appended as a `tool` message) always produces the final
  natural-language answer. Both calls are audited as separate `ai_audit_logs` rows — cost is never hidden
  inside a single combined "turn."
- **SSE over WebSocket**, per the spec's decision record — simpler, HTTP-native, works through standard
  proxies, and this phase has no bidirectional real-time requirement that would justify WebSocket's added
  complexity (the optional `ChatGateway` in the spec's module diagram is not implemented in this phase; see
  Out of Scope).
- **Context window management is a sliding window, not summarization.** Oldest non-system messages are
  dropped outright when the running token count exceeds 80% of the model's context window. Summarizing
  dropped history is a plausible future enhancement but adds an extra LLM call and is not implemented here.
- **Tool execution is isolated from the chat request lifecycle.** A tool throwing, timing out, or returning
  malformed data is always converted into a structured `{ success: false, error }` result fed back to the
  model — it never propagates as an unhandled exception that would 500 the whole chat request.
- **`mathjs` for calculation, never `eval()`/`new Function()`.** This is a hard security rule, not a style
  preference — arbitrary string evaluation from model-controlled input is a direct code-execution
  vulnerability.
- **HTTP-handler tools are domain-whitelisted.** `handlerConfig.url` for `handlerType: 'http'` tools is
  checked against a configured allowlist before the executor issues the request, closing the SSRF surface
  a fully-open outbound proxy would create.
- **Environment variables follow Phase 1's convention** — read only via `ConfigService`, registered under a
  new `chat` namespace (`CHAT_MAX_CONTEXT_MESSAGES`, `CHAT_CONTEXT_WINDOW_PERCENTAGE`, `CHAT_TOOL_TIMEOUT_MS`,
  `CHAT_HTTP_TOOL_TIMEOUT_MS`, `CHAT_AUTO_TITLE`), validated in `env.validation.ts` alongside the existing
  `openai`/`pinecone`/etc. namespaces.
- **Audit logging stays fire-and-forget**, consistent with Phase 1's `AiAuditService.log()` — chat and
  streaming turns never block their response waiting for the audit write to complete.

---

## Testing Decisions

- **Unit test seam is service-level**, matching Phase 1: `ChatService`, `StreamingService`,
  `ToolRegistryService`, and `ToolExecutorService` are each tested in isolation with `jest-mock-extended`'s
  `DeepMockProxy<DatabaseService>` and a mocked `OpenaiService`/`OPENAI_CLIENT`.
- **`DatabaseService` must be jest-mocked at the module level** in every new spec file, per `CLAUDE.md`'s
  documented Jest/ESM incompatibility with the generated Prisma client (`import.meta.url`) — this is not
  optional boilerplate, tests will fail to even load without it.
- **Streaming tests drain the `AsyncGenerator`** produced by `StreamingService.streamCompletion()` into a
  plain array before asserting on event sequence and content — no real SSE transport is involved in unit
  tests.
- **Mocked OpenAI streaming responses** are constructed as async iterables yielding the same chunk shape the
  real SDK produces (`{ choices: [{ delta: { content? , tool_calls? } }] }`), so `StreamingService`'s
  chunk-parsing logic is exercised without a network call.
- **Client-disconnect abort path** is tested with a fake request object exposing an `EventEmitter`-based
  `.on('close', ...)` so the test can trigger the disconnect deterministically and assert the abort was
  called and a partial message was persisted.
- **Function-calling flow gets one integration-style test** per built-in tool (calculator at minimum) that
  drives `ChatService.sendMessage()` through both LLM calls against mocked `OpenaiService` responses and
  asserts on the final message content and the resulting `ai_audit_logs` row count (SC-CH-013).
- **Controller-level tests** validate DTOs via `class-validator`'s `validate()` directly, same pattern as
  `openai.controller.spec.ts`, rather than spinning up a full Nest test application.
- **Regression coverage**: existing Phase 1 `openai.service.spec.ts` must be re-run and pass unmodified
  after `chatCompletionWithMessages()` is added, proving the extension is additive.
- **No live OpenAI, Open-Meteo, or Postgres calls in the test suite** — the weather tool's HTTP client is
  mocked in unit tests; a real Open-Meteo call is only exercised manually per the spec's test scenarios
  (SC-CH-006), not in CI.

---

## Out of Scope

- **WebSocket real-time** — SSE is sufficient for this phase's server-to-client streaming needs; the
  `ChatGateway` shown in the spec's module diagram is not built
- **Message editing or regeneration** — messages are strictly append-only
- **Branching conversations** — no forking or alternate-timeline support
- **File attachments** — deferred to Phase 3 (RAG document context)
- **Image generation** (DALL·E / image tools) and **voice input/output** (Whisper / TTS)
- **Per-conversation rate limiting** — Phase 1's global throttler applies uniformly
- **End-to-end encryption** — messages are stored as plain text, matching every other table in this schema
- **Conversation sharing** — no public links, no multi-user conversations
- **A tool-building UI** — tools are registered via API only; no drag-and-drop builder

---

## Further Notes

- **Assumption**: `ModelRegistryService` (Phase 1) can supply a model's context-window size for the
  sliding-window calculation; where a model is unknown to the registry (e.g. a brand-new OpenRouter model
  not yet synced), `CONTEXT_CONFIG.defaultContextWindow` (128,000) is used as a fallback, per spec §9.3.
- **Assumption**: the free OpenRouter default model configured in Phase 1 (`openai.defaultModel`) supports
  streaming and tool calling; not all OpenRouter-hosted free models do. If the currently configured default
  model 404s or rejects `tools`/`stream` parameters, the fix is the same as Phase 1's documented gotcha —
  check `GET /openai/models/free` for a currently-live replacement.
- **Risk**: Open-Meteo, like any external free API, has no SLA. Weather-tool test scenarios (SC-CH-006) are
  inherently flakier than the fully-mocked test suite and should not gate CI.
- **Risk**: SSE behavior under corporate proxies or certain load balancers (buffering, connection timeouts)
  is a known class of production issue; this is a learning project so it's accepted as-is, but worth noting
  if this pattern is ever reused outside this repo.
- **Future phase consideration**: Phase 3 (RAG) will likely want to inject retrieved document chunks into
  `ChatService.buildContext()` as additional system/context messages — the sliding-window algorithm should
  be written with that extension point in mind (e.g. don't hardcode "system prompt is always message index
  0" in a way that can't accommodate an injected context block).

---

## Tracking

Status: ready-for-agent

Issues: `docs/issues/AI-015` through `docs/issues/AI-035` (21 issues, see `docs/issues/index.md` for the full
table with dependencies). Epic mapping:

- Epic 1 (Database Schema Extension): AI-015, AI-016, AI-017
- Epic 2 (OpenaiService Extension): AI-018
- Epic 3 (Chat Service, Conversations, Messages & Context Window): AI-019, AI-020, AI-021, AI-022, AI-027
- Epic 4 (Streaming Service): AI-028, AI-029
- Epic 5 (Tool Registry & Built-in Tools): AI-023, AI-024, AI-025, AI-026
- Epic 6 (API Layer): AI-030, AI-031, AI-032, AI-033
- Epic 7 (Testing & Audit Integration Verification): AI-034, AI-035

Dependencies:

- `OpenaiModule` (Phase 1) — `OpenaiService`, `TokenService`, `RetryService`, `AiAuditService`,
  `ModelRegistryService`
- `DatabaseModule` (global) — Prisma access for the three new tables
- `AppLoggerService` (global)
- `ConfigModule` (global) — new `chat` config namespace
- New npm dependency: `mathjs` (not currently installed)

Open Questions:

- Should `ChatGateway` (WebSocket) be scaffolded as an empty stub now for Phase 3+ or omitted entirely until
  actually needed? (Current recommendation: omit — spec marks it optional and out of scope.)
- Should the HTTP-tool domain whitelist be a global config value (`CHAT_TOOL_HTTP_ALLOWED_DOMAINS`) or
  per-tool (a field on `chat_tools`)? The spec says "configurable" without specifying which; a global env
  var is the simpler default and matches the project's existing config-namespace pattern.

Related PRDs:

- [OpenAI API Foundations](./2026-06-25-openai-api-foundations.md) — Phase 1, direct dependency
