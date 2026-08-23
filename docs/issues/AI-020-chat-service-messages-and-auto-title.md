---
id: AI-020
title: ChatService — message persistence + auto-title generation
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-06
completed_at: 2026-07-06
parent_epic: Epic 3 — Chat Service, Conversations, Messages & Context Window
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-019
---

# What to Build

Implement `ChatService`'s message-append methods. These are pure persistence operations — no LLM calls, no context building (that's AI-021/AI-022).

```typescript
addUserMessage(conversationId: bigint, content: string): Promise<ChatMessageEntity>
addAssistantMessage(conversationId: bigint, params: {
  content: string | null;
  toolCalls?: unknown;
  tokenCount?: number;
  cost?: number;
  latencyMs?: number;
  model?: string;
  incomplete?: boolean;
}): Promise<ChatMessageEntity>
addToolResult(conversationId: bigint, toolCallId: string, toolName: string, result: unknown): Promise<ChatMessageEntity>
```

Each inserts one `ChatMessage` row with the appropriate `role` (`user`, `assistant`, `tool` from the `ChatMessageRole` enum). `addAssistantMessage`'s `incomplete` flag (used by the streaming disconnect path in AI-029) is stored inside a JSON `metadata`-style field — since the spec's `chat_messages` schema (§3.2) has no dedicated `incomplete` column, store it as part of the existing `toolCalls Json?` field's sibling data, or add a small `metadata Json?` column to `ChatMessage` if that's cleaner than overloading `toolCalls`. If adding a column, that's a schema change — flag it and coordinate with AI-015's migration (a follow-up migration is fine at this point since AI-015 already merged).

**Auto-title generation**: when `createConversation()` (AI-019) was called without a `title`, and `chatConfig.autoTitle` is `true` (default), the _first_ call to `addUserMessage()` for that conversation should also set the conversation's `title` to the first 50 characters of the message content + `"..."`. Slice on a safe UTF-16 boundary — don't call `content.slice(0, 50)` blindly if it could split a surrogate pair; use `Array.from(content).slice(0, 50).join('')` or equivalent grapheme-safe truncation, or accept the simpler `.slice(0, 50)` if the spec doesn't require full Unicode correctness (state which you chose and why in Implementation Notes — the spec doesn't specify, so either is a defensible read, but a plain `.slice()` is simpler and matches the spec's literal wording "first 50 characters").

Only trigger this on the _first_ user message in a conversation (check `title === null` before overwriting, or check the messages count is 0 before this insert — either works, prefer checking `title === null` since it composes better with `updateConversation()` letting a user clear the title back to null and have it regenerate, though that's not a required story — just avoid overwriting a user-set title on message #2, #3, etc.).

# User Stories Covered

- Story 2 — auto-generate title from first user message
- Story 17 — multi-turn message persistence in order
- Story 18 — assistant message records tokenCount/cost/latencyMs/model
- Story 26 — partial/incomplete assistant message on stream error (schema support, wired up fully in AI-029)
- Story 35 — tool results stored as `role: "tool"` messages linked to `toolCallId`

# Acceptance Criteria

- [x] `addUserMessage()` inserts a `role: 'user'` message and triggers auto-title on the first message of a conversation (when `title` is null and `chatConfig.autoTitle` is true)
- [x] Auto-title is exactly first-50-chars + `"..."` per spec FR-CH-015
- [x] `addAssistantMessage()` inserts a `role: 'assistant'` message with `tokenCount`/`cost`/`latencyMs`/`model` populated when provided
- [x] `addToolResult()` inserts a `role: 'tool'` message with `toolCallId`/`toolName` set and `content` holding the serialized result
- [x] A conversation with an explicitly-provided title is never overwritten by auto-title logic
- [x] Unit tests cover all three methods plus the auto-title trigger/no-trigger cases
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

## Implementation Notes

Implemented all three message-append methods in `ChatService`
(`src/modules/ai-chat/services/chat.service.ts`), plus a private `maybeSetAutoTitle()` helper.

**Schema change**: the spec (§7.3) calls the incomplete flag "a metadata flag `incomplete: true`",
but `chat_messages` (AI-015) has no `metadata` column — only `toolCalls Json?`. Per the issue's
explicit option to add a column if cleaner than overloading `toolCalls`, added `metadata Json?
@db.JsonB` to `ChatMessage` via a follow-up migration
(`20260706180939_add_chat_message_metadata`, `ALTER TABLE chat_messages ADD COLUMN metadata
JSONB`). This keeps `toolCalls` semantically pure (assistant tool-call requests only) and matches
the spec's own terminology for the incomplete flag. `ChatMessageEntity` (AI-016) gained a
`metadata: unknown` field to match.

- `addUserMessage()` — inserts the message, then calls `maybeSetAutoTitle()`, which short-circuits
  on `chatConfig.autoTitle === false` (checked first, before any DB read, to avoid an unnecessary
  query when auto-title is disabled), then fetches the conversation and only updates `title` when
  it's still `null`. Title = `` `${content.slice(0, 50)}...` `` — **chose plain `.slice(0, 50)`
  over grapheme-safe truncation**, per the issue's own note that this is a defensible simpler
  read of the spec's literal "first 50 characters" wording; grapheme/surrogate-pair-safe slicing
  is unnecessary complexity for a title field with no stated Unicode-correctness requirement.
  Also chose to always append `"..."` even when `content` is under 50 characters, since FR-CH-015
  doesn't gate the ellipsis on message length.
- `addAssistantMessage()` — inserts with `role: 'assistant'`, passes through
  `tokenCount`/`cost`/`latencyMs`/`model`/`toolCalls` as given, and sets
  `metadata: { incomplete: true }` only when `params.incomplete` is truthy (otherwise `undefined`,
  which Prisma treats as "not provided").
- `addToolResult()` — inserts with `role: 'tool'`, `content: JSON.stringify(result)` (spec says
  "content holding the serialized result"), `toolCallId`/`toolName` set directly.
- None of the three methods added a `NotFoundException` guard for an invalid `conversationId` —
  out of scope per the issue (only `addUserMessage` needs to read the conversation, for
  auto-title; the other two are pure inserts). An invalid `conversationId` would surface as a
  Prisma FK-constraint error (P2003), which is acceptable since callers (AI-021/AI-022's
  `ChatService.sendMessage()`) will already have resolved the conversation via `findConversation()`
  before calling these.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, zero errors
- `npm run lint` (auto-fixed formatting) then `npm run lint:check` — 0 errors, 34 warnings (33
  pre-existing + 1 new `no-unsafe-assignment`, same `mockDeep` pattern as every other spec file)
- `npm run build` — succeeds
- `npm run test -- chat.service` — 22/22 pass (15 from AI-019 + 7 new)
- `npm run test` — 136/136 pass (11/11 suites), no regressions
- `npx prisma validate` — passes; `npm run prisma:migrate` applied
  `20260706180939_add_chat_message_metadata` cleanly; `npm run prisma:migrate:status` confirms
  schema is up to date (5 migrations)

## Assumptions Made

- Added a `metadata Json?` column to `ChatMessage` rather than overloading `toolCalls` — the issue
  explicitly offered both options; this one matches the spec's own wording for the incomplete flag
  and keeps `toolCalls` unambiguous for tool-call data specifically.
- Chose plain `.slice(0, 50)` over grapheme-safe truncation for auto-title, and always append
  `"..."` regardless of message length — both explicitly flagged as defensible reads per the
  issue's own guidance, documented above under Implementation Notes.
- No `NotFoundException` guard added to `addAssistantMessage()`/`addToolResult()` for an unknown
  `conversationId` — not required by the acceptance criteria, and premature given no caller exists
  yet (AI-022/AI-027 will always call these after already resolving the conversation).

## Follow Ups

- AI-021 (`buildContext()`) and AI-029 (streaming disconnect, which needs the `incomplete: true`
  metadata flag this issue introduced) are now unblocked/supported.
- The `metadata` column is currently only used for `{ incomplete: true }`; if future work needs
  other assistant-message metadata, extend the shape there rather than adding more columns.

# Dependencies

- AI-019 — conversation must exist before messages can be appended to it

# Testing Notes

**Primary seam**: `chat.service.spec.ts`, same `DeepMockProxy<DatabaseService>` pattern as AI-019 — likely the same spec file, different `describe` blocks.

Key test cases: first user message on a titleless conversation sets the title; second user message does not re-trigger title generation; a conversation created _with_ a title is never touched by auto-title logic even on its first message.
