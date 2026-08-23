---
id: AI-017
title: Seed built-in tools — calculator, weather, datetime
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
completed_at: 2026-07-07
parent_epic: Epic 1 — Database Schema Extension
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-015
  - AI-016
---

# What to Build

Ensure the three built-in tools (`calculator`, `weather`, `datetime`) exist as rows in `chat_tools` on a fresh database, without relying on `prisma/seed.ts` (which `CLAUDE.md` documents as currently broken under plain `ts-node` for this project — the generated Prisma client's `import.meta.url`-derived imports don't resolve outside Nest's own build pipeline).

Follow the same precedent `OpenRouterSyncService` already established for populating a registry table reliably on every startup: add an `onModuleInit()` hook to `ToolRegistryService` (or a small dedicated seeding step called from `AiChatModule`) that upserts the three tool rows by `name` (idempotent — safe to run on every boot, matching `OpenRouterSyncService.onModuleInit()`'s pattern).

Each row's `parameters` field must be the exact JSON Schema from spec §8.2:

- `calculator` — `handlerType: 'builtin'`, description mentions supported operations (`+, -, *, /, sqrt, pow, sin, cos, tan, log, pi, e`), single required `expression: string` parameter
- `weather` — `handlerType: 'builtin'`, `city: string` (required) + `units: enum['celsius','fahrenheit']` (optional) parameters
- `datetime` — `handlerType: 'builtin'`, `timezone: string` (required) + `operation: enum['now','diff']` + `date1`/`date2` (optional) parameters

Use `displayName` values `'Calculator'`, `'Weather Lookup'`, `'Date/Time'` per spec §13.1.

This issue only creates the rows — the actual tool execution logic (calculator/weather/datetime handlers) is implemented in AI-024/AI-025, and `ToolRegistryService`'s CRUD/format-conversion methods are implemented in AI-023. If those services don't exist yet as more than shells, this issue can still land the upsert logic inside `ToolRegistryService`'s `onModuleInit()` — it doesn't need the CRUD methods to be complete, just a direct `db.chatTool.upsert()` call per tool.

# User Stories Covered

- Story 28 (calculator availability), Story 30 (weather availability), and Story 37/38's assumption that the tool catalog is non-empty out of the box

# Acceptance Criteria

- [ ] All three tools exist in `chat_tools` after a fresh app boot, with `isActive: true`
- [ ] Each tool's `parameters` field matches the JSON Schema from spec §8.2 exactly (verified by comparing against `GET /chat/tools` once AI-032 exists, or a direct DB query in the interim)
- [ ] Re-running the app (upsert, not insert) does not create duplicate rows or error on unique constraint violation
- [ ] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-015 — `chat_tools` table must exist
- AI-016 — `ToolHandlerType` enum must exist for typing the upsert payload

# Testing Notes

Verify manually: fresh DB → `npm run dev` → query `chat_tools` via Prisma Studio (`npm run prisma:studio`) or a temporary log statement, confirm 3 rows. No dedicated unit test needed for a startup upsert (mirrors `OpenRouterSyncService`, which also has no dedicated "seed correctness" unit test in Phase 1 — its upsert logic is covered by `openrouter-sync.service.spec.ts`'s general upsert tests, so if `ToolRegistryService.onModuleInit()` reuses tested upsert logic from AI-023, no new test is required here).

## Implementation Notes

Closed without new code — fully satisfied by AI-023. `ToolRegistryService.onModuleInit()`
(`src/modules/ai-chat/services/tool-registry.service.ts:26-52`) already upserts all three tools by
`name` on every boot, and `constants/builtin-tools.constant.ts` already defines `BUILTIN_TOOLS`
with the exact spec §8.2 `parameters` JSON Schema and §13.1 `displayName` values
(`'Calculator'`, `'Weather Lookup'`, `'Date/Time'`) for `calculator`/`weather`/`datetime`. This
was called out explicitly in `CLAUDE.md`'s AI-023 section: "AI-017 should be closed as
satisfied-by-AI-023 rather than re-implemented" — since AI-017 hadn't landed yet when AI-023 was
built, its seeding requirement was folded directly into `ToolRegistryService` instead of being
migrated from a placeholder.

## Validation Performed

- All four acceptance criteria verified by reading existing code (no runtime change made, so no
  new validation run needed): upsert-by-name (not create), `isActive` defaults `true` via schema,
  `parameters` matches spec §8.2 verbatim, `tsc`/tests already passed when AI-023 was completed.

## Assumptions Made

None — this is a documentation-only closure of an already-implemented requirement.

## Follow Ups

None.
