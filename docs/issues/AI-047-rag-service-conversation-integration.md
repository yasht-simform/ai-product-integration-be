---
id: AI-047
title: RagService.queryWithConversation() — conversation-integrated RAG
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 5 — Semantic Search & RAG Orchestration
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-046
  - AI-037
---

# What to Build

Implement `RagService.queryWithConversation(conversationPublicId, question, options?)` per spec §5.6. Call Phase 2's `ChatService.buildContext()` for the conversation's existing sliding-window history, splice retrieved chunks (via AI-046's search step) into that context as part of the user message content — **not** a new `chat_messages.role` value, since Phase 2's schema doesn't have one and inventing one would fragment the message-role contract every other part of the chat system relies on. Call `OpenaiService.chatCompletionWithMessages()` with the combined array, then persist the turn through `ChatService`'s existing `addUserMessage()`/`addAssistantMessage()` methods — this must produce a conversation transcript indistinguishable in storage from a normal Phase 2 chat turn (`GET /chat/conversations/:publicId` should show it like any other message).

**Context-budget interaction**: after splicing in retrieved-chunk content, the combined array must still respect Phase 2's context-window budget (`chatConfig.contextWindowPercentage`). If the combination would exceed it, reduce the number of retrieved chunks first — never trim the user's actual conversation history to make room for RAG context; the conversation is the more important thing to preserve.

# User Stories Covered

- Story 41 — RAG context injected alongside conversation history
- Story 42 — sliding-window budget respected when injecting chunks

# Acceptance Criteria

- [x] Calls `ChatService.buildContext()` for existing history, not a duplicate context-building implementation
- [x] Retrieved chunks injected as part of the user message content, not a new message role
- [x] Turn persisted via `ChatService.addUserMessage()`/`addAssistantMessage()`
- [x] Injecting chunks never causes the combined context to exceed the model's context-window budget — chunk count is reduced before conversation history is ever trimmed for this purpose
- [x] Unit tests: mocked `ChatService.buildContext()`/`addUserMessage()`/`addAssistantMessage()`, mocked search results, assert persistence calls happen with the expected content shape and that a near-full context window triggers chunk reduction rather than a context-length failure

# Dependencies

- AI-046 (`RagService.query()`'s generation logic), AI-037 (`AiChatModule` imported into `RagModule`)

# Testing Notes

Mock `ChatService` entirely (it's Phase 2's service, already covered by its own extensive test suite — this issue only proves the integration seam, not `ChatService`'s internals).

## Implementation Notes

Implemented `RagService.queryWithConversation(conversationPublicId, question, options?)`
(`src/modules/rag/services/rag.service.ts`), reusing AI-046's `buildContextBlock()` and
`DEFAULT_RAG_TEMPERATURE` rather than duplicating the citation-formatting logic.

**Cross-module seam gap discovered and closed**: `ChatService.buildContext()`/`addUserMessage()`/
`addAssistantMessage()` all take the conversation's internal `bigint` row id, but
`ConversationEntity` (the type every existing public `ChatService` method returns) deliberately
never exposes it — only `publicId`. Since `RagService` only ever has `conversationPublicId: string`
(per this issue's own method signature), there was no existing way to drive those three methods
from outside `ChatService`. Added one small additive public method to `ChatService`:
`getConversationHandle(publicId): Promise<{ id: bigint; model: string }>` — a thin wrapper around
the already-existing private `findConversationOrThrow()`, returning both the row id (needed by all
three downstream calls) and the conversation's configured `model` in a single lookup (needed so the
RAG-augmented turn respects the same per-conversation model a normal turn would, mirroring
`ChatService.sendMessage()`'s own `dto.model ?? conversation.model` fallback exactly). This is
pure addition — no existing `ChatService` method's signature or behavior changed — and a unit test
for it was added to `chat.service.spec.ts` alongside the rest of Phase 2's `ChatService` suite.

**Flow**: `getConversationHandle()` resolves `{ id, model }` → guard against a whitespace-only
`question` (`BadRequestException`, mirroring `sendMessage()`'s own validation) →
`addUserMessage(id, question)` persists the **plain** question **before** retrieval/generation
(same crash-resilience ordering `sendMessage()` uses) → `SearchService.search()` retrieves chunks →
a new private `spliceRetrievedChunks()` fetches `ChatService.buildContext(id)` (the conversation's
existing sliding-window history, which already ends with the just-persisted plain-text user
message as its last entry) and replaces **only that last entry's `content`** with the
chunk-augmented `` `${contextBlock}\n\nQuestion: ${question}` `` string — this is purely an
in-memory substitution on the array handed to the model; the **persisted** `chat_messages` row from
`addUserMessage()` above is untouched, so `GET /chat/conversations/:publicId` shows the plain
question like any other turn, exactly as the issue's "indistinguishable in storage" requirement
demands. → `chatCompletionWithMessages()` → `addAssistantMessage()` persists the answer the same
way any turn's assistant message would be persisted (no RAG-specific metadata).

**Budget enforcement**: `spliceRetrievedChunks()` computes `budget = contextWindow *
contextWindowPercentage` (model's context window via `ModelRegistryService.findModelByModelId()`,
falling back to `chatConfig.defaultContextWindow`; percentage via `chatConfig.contextWindowPercentage`
— both read directly through `ConfigService`, with literal fallbacks matching `chatConfig`'s own
factory defaults, since importing `ai-chat`'s `CONTEXT_CONFIG` constant across the module boundary
wasn't necessary). It sums the token cost of every history message **except** the last (which stays
fixed regardless of chunk count) once, then — in a loop — measures the spliced last message's token
cost and drops the lowest-ranked chunk (`SearchService` already returns results ranked by score
descending, so `.slice(0, -1)` drops the weakest match first) until the combined total fits the
budget or no chunks remain. Conversation history itself (everything but the last message) is never
touched by this loop — `ChatService.buildContext()` is called exactly once per turn, so its own
trimming decision about the conversation's actual history is never revisited or second-guessed by
`RagService`.

`RagResult.sources`/`chunksRetrieved` reflect `chunksUsed` (the post-reduction set actually sent to
the model), not the full `results` `SearchService` returned — a citation list should never claim a
chunk was used when it was dropped for budget reasons.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 58 warnings (unchanged from the prior baseline)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- rag.service chat.service chat.controller` — 90/90 pass (includes the
  Phase 2 regression check, since `ChatService` itself was touched)
- `npm run test` (full suite) — 387/387 pass (up from 378, +9 new tests, zero regressions)

## Assumptions Made

- **`getConversationHandle()` is a deliberately minimal addition to `ChatService`, not a
  RAG-specific method** — named and shaped generically (`{ id, model }`) rather than after RAG
  concerns, preserving the codebase's documented one-way dependency rule (`AiChatModule` has zero
  knowledge of `RagModule`; only `RagModule` imports `AiChatModule`, never the reverse).
- **Whitespace-only `question` is rejected with `BadRequestException`** before any persistence —
  not explicitly required by this issue's acceptance criteria, but mirrors `ChatService.sendMessage()`'s
  own established validation for the same class of input, applied here for consistency rather than
  leaving an unguarded gap.
- **Chunk reduction drops from the lowest-ranked end** (`SearchResult[]`'s natural score-descending
  order from `SearchService.search()`), preserving the most relevant matches when a reduction is
  forced — an unstated but natural reading of "reduce the number of retrieved chunks," since
  dropping the _most_ relevant chunk first would be a strictly worse outcome with no compensating
  benefit.
- **Two DB round-trips resolve the same conversation row** (`getConversationHandle()` then
  `buildContext()`'s own separate `findUnique()`) rather than threading a single fetched row through
  both — matches this codebase's existing precedent (`ChatService.sendMessage()` already does
  `findConversationOrThrow()` then lets `buildContext()` run its own independent query), and keeps
  `getConversationHandle()`'s surface minimal rather than returning a larger shape only one caller
  needs.

## Follow Ups

- AI-052 (`RagController` — search + ask endpoints) is the next consumer, wiring
  `POST /rag/conversations/:publicId/ask` (or equivalent) to `queryWithConversation()`.
- AI-055's live smoke test should verify the storage-transparency claim directly — create a
  RAG-augmented turn, then `GET /chat/conversations/:publicId` and confirm the persisted user
  message shows only the plain question, with no chunk content leaked into the stored transcript.
- This issue closes out Epic 5 — Semantic Search & RAG Orchestration (AI-045 through AI-047 are all
  now `completed`).
