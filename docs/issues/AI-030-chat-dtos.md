---
id: AI-030
title: DTOs — conversation, message, and tool request/response classes
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-07
completed_at: 2026-07-07
parent_epic: Epic 6 — API Layer
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-016
---

# What to Build

Create the full set of `class-validator`-decorated request DTOs and Swagger-annotated response DTOs for the `ai-chat` module, following Phase 1's `openai/dto/` conventions exactly (barrel `index.ts`, `PartialType()` for update DTOs, `@ApiProperty()` on every response field).

**Request DTOs**:

- `CreateConversationDto` — `title?: string`, `systemPrompt?: string`, `model?: string` (reuse Phase 1's `@IsValidModel()` decorator — it already accepts both native `OpenAIModel` values and OpenRouter-style strings, exactly what conversations need), `toolsEnabled?: boolean`
- `UpdateConversationDto` — `PartialType(CreateConversationDto)` minus `toolsEnabled` if that's meant to be immutable after creation (check spec §6.1 — `PATCH` only lists title/systemPrompt/model as updatable; decide and note the choice)
- `QueryConversationsDto` — `userId?`, `isArchived?: boolean`, `page?`, `limit?` with `@Type(() => Number)` on the numeric fields, matching `QueryAiAuditDto`'s exact pattern
- `SendMessageDto` — `content: string` (`@IsNotEmpty()`), `model?: string` (`@IsValidModel()`, optional), `temperature?: number`, `maxTokens?: number`
- `CreateToolDto` — `name: string`, `displayName: string`, `description: string`, `parameters: object` (JSON Schema — `@IsObject()`), `handlerType: ToolHandlerType` (`@IsEnum()`), `handlerConfig?: object`
- `UpdateToolDto` — `PartialType(CreateToolDto)`

**Response DTOs**:

- `ConversationResDto` — publicId, title, systemPrompt, model, toolsEnabled, isArchived, createdAt, updatedAt
- `MessageResDto` — publicId, role, content, toolCalls, toolCallId, toolName, tokenCount, cost, latencyMs, model, createdAt
- `ConversationWithMessagesResDto` — `ConversationResDto` fields + `messages: MessageResDto[]`
- `AssistantMessageResDto` — shaped exactly per spec §6.2's example: `messageId`, `role`, `content`, `model`, `toolCalls`, `usage: UsageDto` (reuse Phase 1's existing `UsageDto` if its shape matches — `{ inputTokens, outputTokens, totalTokens }`), `estimatedCost`, `latencyMs`
- `ToolResDto` — publicId, name, displayName, description, parameters, handlerType, isActive, createdAt, updatedAt
- `PaginatedConversationsResDto` — `data: ConversationResDto[]`, `total`, `page`, `limit`

Add a barrel `dto/index.ts` re-exporting all of them, matching `openai/dto/index.ts`'s pattern.

This issue is DTOs only — no controller wiring (AI-031/AI-032/AI-033) and no service-layer changes (AI-019–AI-029's methods should already have plain-object parameter shapes that these DTO classes now formalize; if a method's inline type doesn't exactly match a DTO class field-for-field, prefer adjusting the method's parameter type to use the real DTO class now that it exists, rather than keeping two parallel shapes).

# User Stories Covered

- Story 42 — model validation via `@IsValidModel()` consistent with Phase 1
- Foundation for Stories 1, 3, 6, 9, 10, 37, 38 (all of Epic 6's endpoint stories depend on these DTOs existing)

# Acceptance Criteria

- [x] All request DTOs listed above exist with correct `class-validator` decorators
- [x] All response DTOs listed above exist with `@ApiProperty()` on every field
- [x] `SendMessageDto.content` rejects empty strings via `@IsNotEmpty()`
- [x] `model` fields reuse Phase 1's `@IsValidModel()` decorator (not `@IsEnum(OpenAIModel)`)
- [x] `dto/index.ts` barrel exports everything
- [x] `ChatService` methods from AI-019/020 updated to accept the real DTO classes where their current inline types diverge (AI-022/027 don't exist yet — nothing to update there)
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes
- [x] A quick `class-validator` `validate()` smoke test (no full controller test yet — that's AI-034) confirms each DTO rejects at least one invalid payload and accepts a valid one

## Implementation Notes

Created `src/modules/ai-chat/dto/` mirroring `openai/dto/`'s conventions exactly:

- **Request**: `CreateConversationDto`, `UpdateConversationDto`, `QueryConversationsDto`,
  `SendMessageDto`, `CreateToolDto`, `UpdateToolDto`.
- **Response**: `ConversationResDto`, `MessageResDto`, `ConversationWithMessagesResDto`,
  `AssistantMessageResDto` (reuses Phase 1's `UsageDto`), `ToolResDto`,
  `PaginatedConversationsResDto`.
- `dto/index.ts` barrel exports all twelve, split into Request/Response sections like
  `openai/dto/index.ts`.

**`UpdateConversationDto`** = `PartialType(OmitType(CreateConversationDto, ['toolsEnabled']))` —
per spec §6.1, `PATCH /conversations/:publicId` only lists title/systemPrompt/model as updatable,
so `toolsEnabled` is fixed at creation time and dropped from the update surface entirely (not just
made optional).

**`model` fields** reuse `@IsValidModel()` from Phase 1's `openai/validators/`, typed as
`OpenAIModel` for editor autocomplete even though the decorator also accepts OpenRouter-style
`provider/model:variant` strings — same convention as `ChatCompletionDto`/`TokenCountDto`.

**`ChatService` signature updates** (only AI-019/020 methods exist so far; AI-022/027 aren't
implemented yet, so there's nothing to update there):

- `findAllConversations(query: QueryConversationsDto)` — was `QueryConversationsParams`; fields
  are identical so this was a direct type swap.
- `updateConversation(publicId, params: UpdateConversationDto)` — was `UpdateConversationParams`;
  same direct swap.
- `createConversation(params: CreateConversationParams)` — kept the named interface rather than
  swapping to `CreateConversationDto` directly, because the method also needs `userId` and
  `metadata`, which are request-context fields the (not-yet-built) controller will supply
  alongside the DTO, not part of the client payload itself. `CreateConversationParams` now
  `extends CreateConversationDto` instead of duplicating its three fields, so the DTO is still the
  single source of truth for the client-facing shape.
- `addAssistantMessage(conversationId, params: AddAssistantMessageParams)` — left unchanged; this
  represents ChatService's internal write of the OpenAI response, not a client-supplied DTO, so no
  request DTO applies here.

Added `src/modules/ai-chat/__tests__/chat-dtos.spec.ts` with `plainToInstance()` + `validate()`
smoke tests (two per DTO: one invalid payload, one valid) for all six request DTOs, following
`openai.controller.spec.ts`'s `ChatCompletionDto validation` block style. The
`UpdateConversationDto` "rejects toolsEnabled" case passes `{ whitelist: true,
forbidNonWhitelisted: true }` to `validate()` to reproduce `main.ts`'s actual `ValidationPipe`
config — plain `validate()` silently ignores properties with no decorators, so without those
options the test can't observe that `toolsEnabled` was stripped by `OmitType`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — pass, no errors
- `npm run lint:check` — pass, 0 errors (34 pre-existing warnings, all in files untouched by this
  issue — `no-unsafe-*` warnings in other spec files and `throttler-behind-proxy.guard.ts`)
- `npm run build` — pass
- `npm run test -- ai-chat` — 44/44 pass (22 pre-existing `chat.service.spec.ts` + 22 new
  `chat-dtos.spec.ts`)
- `npm run test` — 158/158 pass (full suite, no regressions)

## Assumptions Made

- **`SendMessageDto.content` whitespace**: `@IsNotEmpty()` alone does not reject
  whitespace-only strings (e.g. `"   "`) — `class-validator`'s `isEmpty()` check is a strict `===
''` comparison. Phase 1's `ChatCompletionDto.prompt` has the exact same gap
  (`@IsNotEmpty() @MinLength(1)`, neither trims). Kept the same pattern for consistency rather than
  introducing a `@Transform(trim)` or custom validator Phase 1 doesn't use anywhere; flagged here
  rather than silently diverging from the issue's literal wording.
- **`CreateToolDto.handlerConfig`** typed `Record<string, unknown>` with `@IsObject()` — the spec
  doesn't give it a concrete shape (it's handler-specific, e.g. a URL for `http` tools), so no
  narrower validation is possible without knowing AI-025/AI-026's exact `http`-handler config
  shape yet.
- **Response DTOs** are Swagger-annotated shapes only, per Phase 1's existing controller
  convention (`openai.controller.ts` returns entity objects typed as the ResDto for documentation
  purposes, with no explicit runtime mapping step) — no runtime entity→DTO transform was added
  here, consistent with there being no controller yet (AI-031/032/033).

## Follow Ups

- AI-031/032/033 (controllers) will wire these DTOs into actual endpoints and are where any
  entity→ResDto field mismatches would first surface.
- AI-034 owns the exhaustive endpoint-level DTO validation tests; this issue's tests are
  intentionally minimal smoke tests per the Testing Notes below.

# Dependencies

- AI-016 — `ToolHandlerType` enum for `CreateToolDto.handlerType`

# Testing Notes

Minimal validation-only tests here (`validate()` from `class-validator` against a couple of payloads per DTO) — the exhaustive endpoint-level validation tests belong to AI-034 once the controller exists. Follow `is-valid-model.validator.spec.ts`'s style if writing standalone DTO validation tests.
