---
id: AI-015
title: Prisma schema — chat_conversations, chat_messages, chat_tools + chat config namespace
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-06
completed_at: 2026-07-06
parent_epic: Epic 1 — Database Schema Extension
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by: []
---

# What to Build

Extend `schema.prisma` with three new models and add a `chat` config namespace, following the exact patterns already established for `AiAuditLog`/`AiModel` in Phase 1 (`BigInt @id @default(autoincrement())` internal PK + `publicId String @unique @default(uuid())` external identifier).

**`ChatConversation`** (`@@map("chat_conversations")`): `title String?`, `systemPrompt String?`, `model String`, `userId String?`, `toolsEnabled Boolean @default(false)`, `metadata Json? @db.JsonB`, `isArchived Boolean @default(false)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, and a `messages ChatMessage[]` relation.

**`ChatMessage`** (`@@map("chat_messages")`): `conversationId BigInt`, a `conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)`, `role String`, `content String?`, `toolCalls Json? @db.JsonB`, `toolCallId String?`, `toolName String?`, `tokenCount Int?`, `cost Float?`, `latencyMs Int?`, `model String?`, `createdAt DateTime @default(now())`. No `updatedAt` — append-only, matching `AiAuditLog`'s pattern.

**`ChatTool`** (`@@map("chat_tools")`): `name String @unique`, `displayName String`, `description String`, `parameters Json @db.JsonB`, `handlerType String`, `handlerConfig Json? @db.JsonB`, `isActive Boolean @default(true)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.

**Indexes** (all three from spec §3.4):

- `chat_messages (conversation_id, created_at ASC)` — primary read path for a transcript
- `chat_conversations (user_id, updated_at DESC)` — list-by-user, most-recent-first
- unique index on `chat_tools.name` (already implied by `@unique`, but confirm the generated index name is sane)

**Config namespace** — add a new `chatConfig` factory to `app.config.ts` next to `openaiConfig`, following the exact `parseInt(..., default)` pattern already used there:

```typescript
export const chatConfig = registerAs('chat', () => ({
  maxContextMessages: parseInt(process.env.CHAT_MAX_CONTEXT_MESSAGES ?? '50', 10),
  contextWindowPercentage: parseFloat(process.env.CHAT_CONTEXT_WINDOW_PERCENTAGE ?? '0.8'),
  toolTimeoutMs: parseInt(process.env.CHAT_TOOL_TIMEOUT_MS ?? '10000', 10),
  httpToolTimeoutMs: parseInt(process.env.CHAT_HTTP_TOOL_TIMEOUT_MS ?? '5000', 10),
  autoTitle: process.env.CHAT_AUTO_TITLE !== 'false',
  httpToolAllowedDomains: process.env.CHAT_TOOL_HTTP_ALLOWED_DOMAINS
    ? process.env.CHAT_TOOL_HTTP_ALLOWED_DOMAINS.split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    : [],
  defaultContextWindow: 128000,
}));
export type ChatConfig = ConfigType<typeof chatConfig>;
```

Register `chatConfig` in the same `ConfigModule.forRoot({ load: [...] })` array as the other five namespaces (find where `openaiConfig` etc. are loaded — it's not in `app.config.ts` itself, check `app.module.ts`).

Add the corresponding env vars to `env.validation.ts` as `@IsOptional()` (all have defaults): `CHAT_MAX_CONTEXT_MESSAGES` (`@IsInt() @Min(1)`), `CHAT_CONTEXT_WINDOW_PERCENTAGE` (no strict class-validator decorator for float range exists in the file yet — use `@IsNumber() @Min(0.1) @Max(1)`), `CHAT_TOOL_TIMEOUT_MS`/`CHAT_HTTP_TOOL_TIMEOUT_MS` (`@IsInt() @Min(1)`), `CHAT_AUTO_TITLE` (`@IsString()`, same pattern as `OPENROUTER_SYNC_ENABLED`), `CHAT_TOOL_HTTP_ALLOWED_DOMAINS` (`@IsString()`, comma-separated).

Add all new vars to `.env.example` with the same defaults, matching the existing formatting for the `openai`/`pinecone` sections.

After schema edits: `npm run prisma:migrate` then `npm run prisma:generate`.

# User Stories Covered

- Story 8 — cascade delete on conversation deletion
- Stories covering conversation/message/tool persistence generally (foundation for all of Epic 3–6)

# Acceptance Criteria

- [x] `ChatConversation`, `ChatMessage`, `ChatTool` models exist in `schema.prisma` with all fields listed above
- [x] `ChatMessage.conversation` relation uses `onDelete: Cascade`
- [x] `ChatMessage` has no `updatedAt` field
- [x] All three indexes exist (verify generated migration SQL includes them)
- [x] `chatConfig` factory added to `app.config.ts`, registered in `AppModule`'s `ConfigModule.forRoot()`
- [x] All six new env vars declared in `env.validation.ts` as optional with correct validators
- [x] All six new env vars documented in `.env.example` with defaults
- [x] `npx prisma validate` passes
- [x] `npm run prisma:migrate` applies cleanly
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes after client regeneration

## Implementation Notes

Added `ChatConversation`, `ChatMessage`, `ChatTool` models to `prisma/schema.prisma` following the
`BigInt` PK + `publicId` UUID pattern from `AiAuditLog`/`AiModel`. `ChatMessage.conversation` uses
`onDelete: Cascade`, matching the existing `AiModel.provider` relation — Prisma v7's schema DSL
supports `onDelete: Cascade` directly with no manual SQL workaround needed (unlike AI-001's
partial-index case). Migration `20260706174306_add_chat_conversations_messages_tools` applied
cleanly; generated SQL confirms both requested indexes
(`chat_messages(conversationId, createdAt ASC)`, `chat_conversations(userId, updatedAt DESC)`) plus
the unique index on `chat_tools.name`, and `ON DELETE CASCADE ON UPDATE CASCADE` on the FK.

Added `chatConfig` (`registerAs('chat', ...)`) to `src/config/app.config.ts`, exported
`ChatConfig` type, registered it in `AppModule`'s `ConfigModule.forRoot({ load: [...] })` array.
Added all six env vars to `src/config/env.validation.ts` as `@IsOptional()` (imported `IsNumber`
for the float validator) and to `.env.example` under a new `# Chat` section, matching the format
used for other example values.

## Validation Performed

- `npx prisma validate` — passes
- `npm run prisma:migrate` — migration `20260706174306_add_chat_conversations_messages_tools` applied cleanly; `npm run prisma:migrate:status` confirms schema is up to date
- `npm run prisma:generate` — client regenerated + patched successfully
- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 29 pre-existing warnings (all in files untouched by this issue)
- `npm run build` — succeeds
- `npm run test` — 114/114 pass (10/10 suites), no regressions

## Assumptions Made

None beyond what the issue spelled out — the model/config/env shapes matched the issue text and
the PRD spec (§3) exactly, so no interpretive decisions were needed.

## Follow Ups

- AI-019 will add a test proving cascade delete against a real/mocked `DatabaseService` call, as noted in Testing Notes above.

# Dependencies

None — can start immediately.

# Testing Notes

No unit tests in this issue — validated via `npx prisma validate`, `npm run prisma:migrate`, and `npx tsc --noEmit`. A follow-up issue (AI-019) will add an actual test proving cascade delete behavior against a real/mocked `DatabaseService` call.

Double-check whether Prisma v7's schema DSL supports `onDelete: Cascade` directly (Phase 1's `AiAuditLog`/`PromptTemplate` had no FK relations to test this against) — if it requires a manual migration SQL edit similar to AI-001's partial-index workaround, document that in Implementation Notes.
