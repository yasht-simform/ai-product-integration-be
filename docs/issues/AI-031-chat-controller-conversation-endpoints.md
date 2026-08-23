---
id: AI-031
title: ChatController — conversation CRUD endpoints + module registration
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
  - AI-019
  - AI-030
---

# What to Build

Implement the conversation half of `ChatController`, per spec §6.1:

```
POST   /chat/conversations
GET    /chat/conversations
GET    /chat/conversations/:publicId
PATCH  /chat/conversations/:publicId
DELETE /chat/conversations/:publicId
POST   /chat/conversations/:publicId/archive
```

Each handler is a thin pass-through to the corresponding `ChatService` method from AI-019 — no business logic in the controller. Use `@ApiEndpoint({ summary, type, successStatus?, isPublic: true })` on every route (this module follows Phase 1's `isPublic: true` convention — no auth wired up yet in this project), `@ApiTags('ai-chat')` on the controller class (register `'ai-chat'` as a recognized tag in `main.ts`'s Swagger tag list, matching how `'openai'` is registered there).

`POST /chat/conversations` → `successStatus: 201`, body validated as `CreateConversationDto`, returns `ConversationResDto`.
`GET /chat/conversations` → query validated as `QueryConversationsDto`, returns `PaginatedConversationsResDto`.
`GET /chat/conversations/:publicId` → returns `ConversationWithMessagesResDto` — must return `200` with `messages: []` for a fresh conversation, per AI-019's guarantee.
`PATCH /chat/conversations/:publicId` → body as `UpdateConversationDto`, returns `ConversationResDto`.
`DELETE /chat/conversations/:publicId` → `204` no body, cascades to messages.
`POST /chat/conversations/:publicId/archive` → `204` no body.

**Register `AiChatModule` in `AppModule.imports`** if AI-016 didn't already do this (double-check — AI-016 was scaffold-only and may have deferred actual registration until there was a controller to expose; if it's already registered, this is a no-op check).

# User Stories Covered

- Story 1, 3, 4, 5, 6, 7, 8 — the full conversation CRUD surface
- Story 41 — Swagger documentation under an `ai-chat` tag

# Acceptance Criteria

- [x] All six routes implemented, each a thin delegate to `ChatService`
- [x] `AiChatModule` registered in `AppModule`, endpoints reachable at `/api/v1/chat/conversations...`
- [x] All routes documented in Swagger under `ai-chat` tag at `/api/docs`
- [x] Invalid `CreateConversationDto`/`UpdateConversationDto` payloads (e.g. bad `model` string) return `400` via the global validation pipe
- [x] `GET /chat/conversations/:publicId` for a fresh conversation returns `200` with `messages: []`
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes
- [x] `npm run dev` boots with no DI or route-registration errors

# Dependencies

- AI-019 — `ChatService` conversation methods
- AI-030 — request/response DTOs

# Testing Notes

Controller-level DTO validation tests come in AI-034 (following `openai.controller.spec.ts`'s `class-validator` `validate()` pattern rather than a full `TestingModule`). This issue's own verification is manual/smoke-level: boot the app, hit each endpoint with `curl` against a real (or freshly-migrated empty) database, confirm the response envelope (`{ success, data, timestamp }` from the global `ResponseInterceptor`) and status codes are correct.

## Implementation Notes

New `ChatController` (`src/modules/ai-chat/chat.controller.ts`) implements the six conversation
routes as thin delegates to `ChatService` (AI-019), mirroring `openai.controller.ts`'s exact
conventions: `@ApiTags('ai-chat')` on the class, `@ApiEndpoint({...})` on every handler,
`@ApiNoContentResponse`/`@ApiNotFoundResponse`/`@HttpCode(HttpStatus.NO_CONTENT)` on the two
204-returning routes (`DELETE` and `POST .../archive`), matching `removeTemplate()`/
`removeProvider()`'s pattern exactly.

Both things the issue asked to "double-check" turned out to already be in place from earlier
issues, so this landed as pure controller-plus-mapper work with zero infrastructure changes:

- **`'ai-chat'` Swagger tag** — already registered in `main.ts`'s `DocumentBuilder` chain
  (`.addTag('ai-chat', 'AI chat completions')`), presumably added speculatively when `AiChatModule`
  was scaffolded (AI-016).
- **`AiChatModule` registration in `AppModule.imports`** — already present, also from AI-016.

The only module change was adding `ChatController` to `AiChatModule`'s `controllers: []` array
(previously absent — the module had providers but no controller until this issue).

Three private mapper helpers (`toConversationRes`, `toMessageRes`, `toConversationWithMessagesRes`)
convert `ChatService`'s entity return types (`ConversationEntity`, `ChatMessageEntity`,
`ConversationWithMessages`) to the AI-030 response DTOs, following `openai.controller.ts`'s
`toProviderRes`/`toModelRes` precedent — `?? undefined` on every nullable entity field, since the
DTOs use `@ApiPropertyOptional()` (`undefined`) rather than `@ApiProperty()` (`null`) for optional
fields.

**Live verification** (Postgres was reachable locally, so this went beyond the issue's own
"manual/smoke-level" minimum): booted the full app via `npm run dev` against the real dev
database, confirmed all six routes appear in the `RoutesResolver`/`RouterExplorer` boot log with no
DI errors, then exercised every endpoint with `curl`:

- `POST /chat/conversations` → 201, correct `{ success, data, timestamp }` envelope
- `GET /chat/conversations` → 200, paginated list containing the created conversation
- `GET /chat/conversations/:publicId` on the fresh conversation → 200 with `messages: []`
- `PATCH /chat/conversations/:publicId` → 200, `title` updated
- `POST /chat/conversations/:publicId/archive` → 204, no body
- `DELETE /chat/conversations/:publicId` → 204, no body
- Subsequent `GET` on the deleted conversation → 404
- `POST /chat/conversations` with an invalid `model` string → 400 via the global validation pipe
- Confirmed via `/api/docs-json` that all six operations appear tagged `ai-chat`

Test data was cleaned up via the `DELETE` call itself (verified `chat_conversations` count is 0
afterward); the dev server was stopped after verification.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 46 warnings (all pre-existing, none introduced by this change)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 109/109 pass (7 suites — unchanged; no new spec file, per this
  issue's own explicit deferral of controller tests to AI-034)
- `npm run test` — 229/229 pass (17 suites, full regression clean)
- Live boot + `curl` smoke test against the real dev database (see Implementation Notes) — all
  six routes verified working end to end, beyond the issue's stated minimum bar

## Assumptions Made

- No controller-level automated tests were added, per the issue's own Testing Notes explicitly
  deferring that to AI-034 (`class-validator` `validate()` pattern, not a full `TestingModule`).
  Verification here was live/manual instead, and went further than "boot + spot-check" by
  exercising every route, both success and error paths, plus a Swagger-doc content check.
- `ConversationResDto`'s `toolsEnabled`/`isArchived` fields are always present on the entity
  (non-nullable in the DB), so no `?? undefined` needed for those specific fields in
  `toConversationRes()` — only `title`/`systemPrompt` (nullable columns) get the coercion.

## Follow Ups

- AI-032 (`ChatController` send-message + tools CRUD endpoints) is now the only remaining
  prerequisite-holder blocking anything further in Epic 6 — it needs this issue plus AI-027
  (done) to be fully eligible.
- AI-034 owns: controller-level DTO validation tests for these six routes, plus the broader
  function-calling integration test suite.
