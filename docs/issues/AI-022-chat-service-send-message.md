---
id: AI-022
title: ChatService.sendMessage() — non-tool orchestration
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-07-07
completed_at: 2026-07-07
created: 2026-07-06
parent_epic: Epic 3 — Chat Service, Conversations, Messages & Context Window
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-018
  - AI-021
---

# What to Build

Implement `ChatService.sendMessage(conversationPublicId, dto): Promise<AssistantMessageResDto>` for the non-tool-calling path (tool-calling is added on top of this in AI-027, once `ToolExecutorService` exists). This is the orchestrator described in spec §2.2:

1. Look up the conversation by `publicId` (reuse the `findConversation`-style lookup, throw `NotFoundException` if missing)
2. Reject empty/whitespace-only `content` with a validation error — this may already be covered once real DTOs land in AI-030 via `class-validator`, but guard here too since the service can be called from tests/other callers directly
3. `addUserMessage(conversation.id, dto.content)` — persist immediately, before calling the model (per spec's explicit ordering — a crash between this and the model call leaves an acceptable, recoverable state: user message present, no assistant reply yet)
4. `buildContext(conversation.id)` — get the trimmed message array
5. Call `openaiService.chatCompletionWithMessages({ messages, model: dto.model ?? conversation.model, temperature: dto.temperature, maxTokens: dto.maxTokens, userId: conversation.userId })` — per-message overrides (`dto.model`/`temperature`/`maxTokens`) apply to this call only, they do not persist back onto the conversation's stored defaults
6. `addAssistantMessage(conversation.id, { content, tokenCount: usage.totalTokens, cost: estimatedCost, latencyMs, model })`
7. Return the response shaped as `AssistantMessageResDto` (or an equivalent plain object for now if AI-030's DTO class doesn't exist yet — mirror the exact fields from spec §6.2's example response)

Do not implement the tool-calling branch yet — if `conversation.toolsEnabled` is true and the model returns `tool_calls`, that's out of scope for this issue (AI-027 replaces/extends this method's tail to handle it). For now, if `chatCompletionWithMessages()` returns `toolCalls` on the result, it's acceptable for this issue's implementation to just surface the raw content (likely empty/null) as-is — AI-027 will add the actual branching logic.

# User Stories Covered

- Story 9 — send message, get full response synchronously
- Story 10 — response includes usage/cost/latency
- Story 11 — user message persisted before model call, assistant message persisted only after
- Story 19 — per-message overrides don't mutate conversation defaults
- Story 20 — empty content rejected

# Acceptance Criteria

- [x] `sendMessage()` persists the user message, builds context, calls the model, persists the assistant message, in that exact order
- [x] Empty/whitespace-only `content` is rejected before any DB write or model call
- [x] `dto.model`/`temperature`/`maxTokens` override the conversation's stored defaults for this call only — `conversation.model` in the DB is unchanged afterward
- [x] Response includes `content`, `model`, `usage` (input/output/total tokens), `estimatedCost`, `latencyMs`
- [x] `NotFoundException` thrown for an unknown `conversationPublicId`
- [x] Unit tests mock `OpenaiService.chatCompletionWithMessages()` and assert the full call sequence (user message persisted → context built → model called with correct params → assistant message persisted)
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-018 — `OpenaiService.chatCompletionWithMessages()`
- AI-021 — `buildContext()`

# Testing Notes

**Primary seam**: `chat.service.spec.ts`, mocking `OpenaiService` (the whole service, not the SDK — `ChatService` never touches `OPENAI_CLIENT` directly) and `DatabaseService`.

Assert call order explicitly (e.g. using a shared array that each mock implementation pushes an event into, then asserting the array's sequence) rather than only asserting each mock was called — the ordering guarantee (user message before model call, assistant message after) is the actual behavior this issue must prove, not just "all four things happened."

## Implementation Notes

Added `ChatService.sendMessage(conversationPublicId, dto): Promise<AssistantMessageResDto>`
(`src/modules/ai-chat/services/chat.service.ts`), inserted between `addToolResult()` and
`buildContext()` since it's the orchestrator that calls both:

1. `findConversationOrThrow(conversationPublicId)` — existing private helper, throws
   `NotFoundException`.
2. `if (!dto.content.trim()) throw new BadRequestException(...)` — guards against
   whitespace-only content that `SendMessageDto`'s `@IsNotEmpty()` alone doesn't catch (it only
   rejects `''`/`null`/`undefined`, not `"   "`).
3. `addUserMessage(conversation.id, dto.content)` — persisted before any model call.
4. `buildContext(conversation.id)` — reuses AI-021's sliding-window builder as-is.
5. `openaiService.chatCompletionWithMessages({ messages, model: dto.model ?? conversation.model,
temperature: dto.temperature, maxTokens: dto.maxTokens, userId: conversation.userId ??
undefined })` — per-call overrides only, `conversation.model` in the DB is never touched (no
   `chatConversation.update` call in this method).
6. `addAssistantMessage(conversation.id, { content, toolCalls, tokenCount: usage.totalTokens,
cost: estimatedCost, latencyMs, model })`.
7. Returns an `AssistantMessageResDto`-shaped plain object (`messageId`, `role: 'assistant'`,
   `content`, `model`, `toolCalls`, `usage`, `estimatedCost`, `latencyMs`) — matching the existing
   codebase convention of services returning plain objects typed as the ResDto shape, with no
   runtime class instantiation.

Per the issue's explicit scope cut, `result.toolCalls` is surfaced as-is with no branching logic —
AI-027 replaces/extends this method's tail to add the tool-calling flow.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors (a pre-existing,
  unrelated type error surfaces only under a full unscoped `npx tsc --noEmit` in
  `chat.service.spec.ts`'s `createConversation()` describe block — line predates this issue,
  passing a plain string literal where `CreateConversationParams.model` expects `OpenAIModel`;
  out of scope for AI-022 and not touched)
- `npm run lint` — 0 errors, 37 warnings (same count as before this change; the 5 in
  `chat.service.spec.ts` are pre-existing `no-unsafe-assignment` warnings from
  `expect.objectContaining()`/`toHaveBeenCalledWith()` patterns already used throughout this file,
  not new)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 88/88 pass (6 suites, including 6 new `sendMessage()` tests)
- `npm run test` — 208/208 pass (16 suites, full regression clean)

## Assumptions Made

- **Order assertion via `mock.invocationCallOrder`**, not the issue's suggested shared-events-array
  pattern — Jest's mocks already expose call order natively (`dbMock.chatMessage.create.mock
.invocationCallOrder` has two entries for the user/assistant creates;
  `mockOpenaiService.chatCompletionWithMessages.mock.invocationCallOrder` has one), which proves
  the same ordering guarantee without hand-rolling an events array or fighting Prisma's generic
  mock-argument typing.
- **`autoTitle: false` by default in `sendMessage()` tests** — `addUserMessage()`'s auto-title
  side effect is already covered by its own describe block above; gating it off here keeps
  `sendMessage()`'s tests focused on the orchestration behavior actually under test.
- **Response `toolCalls` field**: left as `result.toolCalls` verbatim (typically `undefined` for a
  non-tool-calling response), per the issue's explicit note that branching on it is AI-027's job.

## Follow Ups

- AI-027 will extend `sendMessage()`'s tail to branch on `conversation.toolsEnabled` and
  `result.toolCalls`, adding the two-call tool-execution protocol on top of this non-tool path.
- AI-032 (`ChatController` send-message endpoint) will be the first real caller of this method
  from outside the service layer/tests.
