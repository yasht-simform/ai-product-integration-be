---
id: AI-023
title: ToolRegistryService — CRUD + OpenAI tool-format conversion
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-07-07
completed_at: 2026-07-07
created: 2026-07-06
parent_epic: Epic 5 — Tool Registry & Built-in Tools
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-016
---

# What to Build

Implement `ToolRegistryService` — the single source of truth for what tools exist and are active, and the only service that knows how to convert a `chat_tools` row into the exact shape OpenAI's API expects.

```typescript
findAllTools(): Promise<ToolEntity[]>
findActiveTool(name: string): Promise<ToolEntity>  // throws NotFoundException if missing or inactive
createTool(dto: CreateToolDto): Promise<ToolEntity>
updateTool(publicId: string, dto: UpdateToolDto): Promise<ToolEntity>
deleteTool(publicId: string): Promise<void>  // soft delete — isActive: false, matching ModelRegistryService's provider/model pattern
getToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionTool[]>
```

`createTool()` should throw `ConflictException` on a duplicate `name` (P2002), following `ModelRegistryService.createModel()`'s exact `isP2002()` helper pattern.

`getToolDefinitions()` fetches all active tools and maps each to:

```json
{ "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} } }
```

This output must match spec §5.3's example byte-for-byte in shape (same three levels of nesting, same key names) — this is the payload directly forwarded to OpenAI's `tools` parameter, so any shape mismatch causes a silent API-level 400 that's hard to debug downstream.

This issue owns the `onModuleInit()` upsert of the three built-in tool rows described in AI-017 — if AI-017 was implemented as a placeholder before this service had real CRUD methods, migrate that upsert logic into this service now using the same `db.chatTool.upsert()` shape, so seeding and CRUD share one code path.

# User Stories Covered

- Story 37 — register a new tool via API
- Story 38 — list/update/deactivate tools
- Story 39 — `getToolDefinitions()` matches OpenAI's exact expected shape
- Story 34 — a tool that doesn't exist or is inactive returns an error (via `findActiveTool()`'s `NotFoundException`, caught upstream by `ToolExecutorService` in AI-026)

# Acceptance Criteria

- [x] All six methods implemented as described
- [x] `createTool()` throws `ConflictException` on duplicate `name`
- [x] `findActiveTool()` throws `NotFoundException` for a missing OR inactive tool (an inactive tool must not be callable even if it still exists in the DB)
- [x] `getToolDefinitions()` output shape matches spec §5.3 exactly, verified by a snapshot-style assertion in a test
- [x] `deleteTool()` sets `isActive: false`, does not hard-delete
- [x] Built-in tool seeding (calculator/weather/datetime) happens via this service's upsert logic
- [x] Unit tests cover all six methods plus the duplicate-name and inactive-tool-lookup edge cases
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-016 — `AiChatModule` scaffold, `ToolHandlerType` enum

# Testing Notes

**Primary seam**: `tool-registry.service.spec.ts`, `DeepMockProxy<DatabaseService>`, directly modeled on `model-registry.service.spec.ts` (closest existing precedent for a soft-deletable registry with format-conversion output).

The `getToolDefinitions()` test should assert the exact JSON structure with `toEqual()` against a literal expected object (not just "has a `name` field") — this is the one place in the whole ai-chat module where an exact-shape contract with an external API (OpenAI) matters most.

## Implementation Notes

Implemented `ToolRegistryService` (`src/modules/ai-chat/services/tool-registry.service.ts`) with all
six methods, following `ModelRegistryService`'s exact conventions (constructor-injected
`DatabaseService`/`AppLoggerService`/`ConfigService`, private `isP2002()` helper, private
`toToolEntity()` mapper, soft-delete via `isActive: false`).

New file `src/modules/ai-chat/constants/builtin-tools.constant.ts` exports `BUILTIN_TOOLS` — the
three built-in tool definitions (`calculator`, `weather`, `datetime`) with their exact JSON Schema
`parameters` from spec §8.2, re-exported from `constants/index.ts`.

**`onModuleInit()`** upserts all three `BUILTIN_TOOLS` rows by `name` on every boot, mirroring
`OpenRouterSyncService`'s pattern (idempotent upsert, errors logged and swallowed rather than
crashing app boot). This directly implements AI-017's requirement — per AI-023's own spec text
("This issue owns the `onModuleInit()` upsert... migrate that upsert logic into this service"),
AI-017 had not yet been implemented, so there was no placeholder to migrate; the seeding logic was
written directly into `ToolRegistryService` from the start. **AI-017's acceptance criteria are now
fully satisfied as a side effect of this issue** — see Follow Ups.

`parameters`/`handlerConfig` are Prisma `Json` columns — writes are cast through
`Prisma.InputJsonValue` (same pattern as `ChatService`'s `metadata`/`toolCalls` fields) since a
plain `Record<string, unknown>` doesn't structurally satisfy Prisma's generated JSON input type.

`getToolDefinitions()` queries only `isActive: true` rows and maps to the exact three-level
`{ type: 'function', function: { name, description, parameters } }` shape from spec §5.3, asserted
with a literal `toEqual()` in tests.

Not exported from `AiChatModule` — like `ChatService`'s existing collaborators, `ToolExecutorService`
(AI-026) will consume it via same-module DI, no cross-module export needed.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 35 pre-existing warnings (none introduced by this change)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 58/58 pass (3 suites, including new `tool-registry.service.spec.ts`)
- `npm run test` — 178/178 pass (13 suites, full regression clean)

## Assumptions Made

- Followed the issue's method signatures (`Promise<ToolEntity>`/`Promise<ToolEntity[]>`) rather than
  spec §5.3's `Promise<ToolResDto>` wording — matches the codebase's established convention
  (`ModelRegistryService` returns entity types; `ResDto` classes are Swagger-documentation-only
  shapes with no runtime mapping step, per `CLAUDE.md`).
- `onModuleInit()` failures are logged and swallowed (not rethrown) so a transient DB issue during
  seeding doesn't crash app boot — mirrors `OpenRouterSyncService.onModuleInit()`'s exact behavior.

## Follow Ups

- **AI-017 ("Seed built-in tools")** is now redundant — its only acceptance criteria (three tool
  rows seeded via idempotent upsert, exact §8.2 JSON Schema, no duplicate-row errors on re-run) are
  fully met by this change. Recommend closing AI-017 as completed-by-AI-023 rather than
  re-implementing it, or verifying it live (`npm run dev` + `npm run prisma:studio`) and marking it
  completed directly.
- `CLAUDE.md` module documentation for `ToolRegistryService`/`AiChatModule` should be updated once
  AI-017 is formally closed, to avoid documenting it twice.
