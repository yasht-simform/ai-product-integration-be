---
id: AI-019
title: ChatService — conversation CRUD + cascade delete
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
  - AI-016
---

# What to Build

Implement `ChatService`'s conversation lifecycle methods — everything except messaging and context building, which come in AI-020/AI-021.

```typescript
createConversation(dto: CreateConversationDto): Promise<ConversationResDto>
findAllConversations(query: QueryConversationsDto): Promise<PaginatedConversationsResDto>
findConversation(publicId: string): Promise<ConversationWithMessagesResDto>
updateConversation(publicId: string, dto: UpdateConversationDto): Promise<ConversationResDto>
archiveConversation(publicId: string): Promise<void>
deleteConversation(publicId: string): Promise<void>
```

Since DTOs don't exist yet (AI-030), define minimal local parameter shapes for now (`{ title?, systemPrompt?, model?, toolsEnabled? }` etc.) and let AI-030/AI-031 wire the real `class-validator` DTOs in — the service methods' logic doesn't change once the DTO classes exist, only their type annotations do.

`createConversation()` — insert with `model` defaulting to `configService.get('openai.defaultModel')` when omitted (same fallback Phase 1's `OpenaiService.chatCompletion()` uses), `toolsEnabled` defaulting to `false`. Title is left `null` if not provided — auto-title generation happens in AI-020 on the first message, not at creation time (there's no message yet to derive it from).

`findAllConversations()` — paginated, filterable by `userId` and `isArchived`, following the exact pagination pattern `ModelRegistryService.findAllModels()` uses (`Math.min(limit, 100)`, `skip = (page - 1) * take`, `orderBy: { updatedAt: 'desc' }`).

`findConversation(publicId)` — fetch with `include: { messages: { orderBy: { createdAt: 'asc' } } }`. Must return `200` with an empty `messages: []` for a just-created conversation, not throw — only throw `NotFoundException` when the conversation itself doesn't exist (Prisma's `include` naturally returns `[]` for a relation with no rows, so this should be automatic — just don't add a guard that mistakes "empty messages" for "not found").

`updateConversation(publicId, dto)` — partial update of `title`/`systemPrompt`/`model`; throw `NotFoundException` if the conversation doesn't exist (same `findUnique` guard pattern `ModelRegistryService.updateProvider()` uses).

`archiveConversation(publicId)` — sets `isArchived: true`. Not a delete.

`deleteConversation(publicId)` — hard delete via `db.chatConversation.delete({ where: { publicId } })`. Relies on the schema's `onDelete: Cascade` (AI-015) to remove all `chat_messages` rows — verify this actually happens with a test, don't just trust the schema annotation.

# User Stories Covered

- Story 1 — create conversation with defaults
- Story 3 — list with pagination/filters
- Story 4 — fetch with messages in order
- Story 5 — empty conversation returns 200, not 404
- Story 6 — update title/systemPrompt/model
- Story 7 — archive without delete
- Story 8 — delete cascades to messages

# Acceptance Criteria

- [x] All six methods implemented with the behavior described above
- [x] `createConversation()` defaults `model` to `openai.defaultModel` config when omitted
- [x] `findConversation()` on a conversation with zero messages returns `messages: []`, does not throw
- [x] `findConversation()`/`updateConversation()`/`archiveConversation()`/`deleteConversation()` throw `NotFoundException` for an unknown `publicId`
- [x] `deleteConversation()` removes all associated `chat_messages` rows — proven at the schema/migration level (see Implementation Notes for why a mock-based test can't observe this directly)
- [x] `findAllConversations()` respects `page`/`limit` (capped at 100) and filters by `userId`/`isArchived`
- [x] Unit tests cover all six methods with `DeepMockProxy<DatabaseService>`
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

## Implementation Notes

Implemented all six `ChatService` conversation-lifecycle methods in
`src/modules/ai-chat/services/chat.service.ts`, following `ModelRegistryService`'s pagination
(`Math.min(limit, 100)`, `skip = (page - 1) * take`, `orderBy: { updatedAt: 'desc' }`) and
`NotFoundException`-guard (`findUnique` → throw if null) patterns exactly.

- `createConversation()` — defaults `model` via the same three-step fallback chain
  `OpenaiService.chatCompletion()` uses: `params.model ?? config.get('openai.defaultModel') ??
OpenAIModel.GPT_4O`. `toolsEnabled` defaults to `false`; `title` stays `null` (no auto-title yet —
  that's AI-020, which needs a first message to derive it from). `metadata` is cast
  `as Prisma.InputJsonValue`, matching `AiAuditService.log()`'s existing pattern for the same
  situation (JsonB column, optional input).
- `findAllConversations()` — filters by `userId`/`isArchived` only when provided (avoids
  over-constraining the `where` clause), otherwise identical shape to
  `ModelRegistryService.findAllModels()`.
- `findConversation()` — `include: { messages: { orderBy: { createdAt: 'asc' } } }`; Prisma
  naturally returns `messages: []` for a relation with no rows, so no extra guard was needed to
  avoid conflating "empty" with "not found" — only a `null` conversation throws.
- `updateConversation()`/`archiveConversation()`/`deleteConversation()` — all guard through a
  shared private `findConversationOrThrow()` before mutating, then perform the state change.
  `deleteConversation()` is a hard `delete()`, relying on the schema's `onDelete: Cascade`
  (AI-015) for cascade cleanup — no manual message-deletion step needed.
- Added `CreateConversationParams`, `UpdateConversationParams`, `QueryConversationsParams`,
  `PaginatedConversationsResult`, `ConversationWithMessages` to
  `src/modules/ai-chat/types/ai-chat.types.ts` as the "minimal local parameter shapes" the issue
  calls for — these stand in for the real DTOs until AI-030/AI-031.
- Two private mapping helpers (`toConversationEntity`, `toMessageEntity`) convert Prisma rows to
  the `ConversationEntity`/`ChatMessageEntity` types already defined in AI-016.

**Cascade-delete verification**: empirically confirmed a real `DatabaseService` cannot be
instantiated inside this codebase's Jest unit-test run — `import { DatabaseService } from
'.../database.service'` still fails with `Cannot find module './internal/class.js'` even after
AI-015's `import.meta.url` patch, because the generated Prisma client's internal `.js`-extension
relative imports only resolve through NestJS's own build/watch pipeline, not ts-jest (this is the
same known gap CLAUDE.md documents for `npm run prisma:seed`). A `DeepMockProxy<DatabaseService>`
therefore cannot observe real Postgres `ON DELETE CASCADE` behavior — mocking `db.chatConversation.delete`
only proves the service calls it with the right `publicId`, which is what `chat.service.spec.ts`'s
`deleteConversation()` tests do, with a comment explaining the limitation inline. The cascade
behavior itself was verified directly against the generated migration SQL in AI-015
(`ON DELETE CASCADE ON UPDATE CASCADE` on `chat_messages.conversationId`) and against Postgres's
own `ON DELETE CASCADE` semantics, which are unconditional at the database level. A true
end-to-end proof (insert → delete → query) would require either an integration-test harness with
proper `.js`→`.ts` module-resolution config for Jest, or driving it through the running dev server
once AI-031 exposes a `DELETE /conversations/:id` endpoint — noted as a follow-up.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, zero errors
- `npm run lint` (fixed prettier formatting) then `npm run lint:check` — 0 errors, 33 warnings (29
  pre-existing + 4 new `no-unsafe-assignment` warnings in `chat.service.spec.ts`, same
  `jest-mock-extended`/`mockDeep` pattern already produces in every other `*.service.spec.ts` file)
- `npm run build` — succeeds
- `npm run test -- chat.service` — 15/15 pass
- `npm run test` — 129/129 pass (11/11 suites), no regressions (114 pre-existing + 15 new)

## Assumptions Made

- DTOs don't exist yet (AI-030), so `CreateConversationParams`/`UpdateConversationParams`/
  `QueryConversationsParams` were added to `types/ai-chat.types.ts` as plain interfaces, per the
  issue's explicit instruction. Field names/optionality mirror the spec's `chat_conversations`
  columns exactly, so no interpretation was needed once AI-030 replaces them with real
  `class-validator` DTOs — only the type annotations on the six methods change.
- Confirmed (rather than assumed) that Jest cannot load a real `DatabaseService` in this repo,
  even after AI-015's Prisma-client patch — tested directly by attempting to instantiate one in a
  throwaway spec file, which failed identically to the documented `prisma:seed` gap. This
  justified keeping the cascade-delete test mock-based with a documented limitation, exactly as
  the issue's Testing Notes anticipated as an acceptable outcome.

## Follow Ups

- A true end-to-end cascade-delete proof (real Postgres insert → delete → query) is still open —
  either via a Jest module-resolution fix for the generated Prisma client's `.js`-extension
  imports, or via an e2e/manual check once AI-031's `DELETE /conversations/:id` endpoint exists.
- AI-020 (message persistence + auto-title) and AI-023/AI-028/AI-030 (already unblocked by AI-016)
  can now also build on these conversation CRUD methods where relevant.

# Dependencies

- AI-016 — `AiChatModule` scaffold, `ChatService` shell, entity types

# Testing Notes

**Primary seam**: service-level unit test, `jest-mock-extended`'s `DeepMockProxy<DatabaseService>`, following `model-registry.service.spec.ts`'s pattern exactly (it's the closest existing precedent for CRUD-with-pagination-and-soft-state testing in this codebase).

Remember `DatabaseService` must be `jest.mock()`'d at the module level per `CLAUDE.md`'s documented Jest/ESM incompatibility — copy the mock boilerplate from any existing `*.service.spec.ts` file in `openai/__tests__/`.

The cascade-delete test is the highest-value test here — mock `db.chatConversation.delete` to actually simulate cascade by also asserting `db.chatMessage.deleteMany`/count behavior if you're testing against a real test database, or at minimum assert the delete call targets the right `publicId` if testing against a full mock (a true cascade-delete proof may need an integration-style test against a real Postgres test instance rather than a mock — note this limitation in the test file if mocking makes it untestable).
