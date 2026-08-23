---
id: AI-012
title: OpenaiController — prompt template CRUD endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 6 — REST Controller, Swagger, and Validation
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-008
  - AI-009
  - AI-010
---

# What to Build

Add 5 CRUD endpoints to the existing `OpenaiController` that expose `PromptTemplateService`.

**Endpoints to add:**

`POST /openai/templates` → `createTemplate(@Body() dto: CreatePromptTemplateDto)`:

- Calls `PromptTemplateService.create(dto)`
- Returns 201 with `PromptTemplateResDto` and `code: 'AI_007'`
- `@ApiEndpoint({ summary: 'Create a prompt template', type: PromptTemplateResDto, successStatus: 201, isPublic: true })`

`GET /openai/templates` → `listTemplates(@Query() query: QueryPromptTemplateDto)`:

- Calls `PromptTemplateService.findAll(query)`
- Returns `PaginatedPromptTemplateResDto` with `code: 'AI_008'`

`GET /openai/templates/:publicId` → `getTemplate(@Param('publicId') publicId: string)`:

- Calls `PromptTemplateService.findByPublicId(publicId)`
- Returns `PromptTemplateResDto` with `code: 'AI_009'`
- The `NotFoundException` from the service propagates to a 404 via `HttpExceptionFilter`

`PATCH /openai/templates/:publicId` → `updateTemplate(@Param('publicId') publicId: string, @Body() dto: UpdatePromptTemplateDto)`:

- Calls `PromptTemplateService.update(publicId, dto)`
- Returns `PromptTemplateResDto` with `code: 'AI_010'`
- Use `@ApiBody({ type: UpdatePromptTemplateDto })` explicitly since `PartialType` can confuse Swagger inference

`DELETE /openai/templates/:publicId` → `removeTemplate(@Param('publicId') publicId: string)`:

- Calls `PromptTemplateService.remove(publicId)`
- Returns 204 No Content — `@HttpCode(HttpStatus.NO_CONTENT)` and no body
- `@ApiEndpoint({ summary: 'Delete a prompt template', successStatus: 204, isPublic: true })`

**`PromptTemplateResDto`** must omit the internal `id` (BigInt) and include `publicId` as the identifier. If `@ApiEndpoint()` does not support 204, use `@ApiNoContentResponse()` directly for the delete endpoint.

# User Stories Covered

- Story 22 — create template via API
- Story 23 — list templates with filters and pagination
- Story 24 — get single template by publicId
- Story 25 — update template fields
- Story 26 — delete template

# Acceptance Criteria

- [ ] `POST /api/v1/openai/templates` returns 201 with the created template (including `publicId`)
- [ ] `GET /api/v1/openai/templates` returns paginated list with `total`
- [ ] `GET /api/v1/openai/templates/:publicId` returns 404 for an unknown publicId
- [ ] `PATCH /api/v1/openai/templates/:publicId` updates only the provided fields
- [ ] `DELETE /api/v1/openai/templates/:publicId` returns 204 with no body
- [ ] `PromptTemplateResDto` does not include the internal BigInt `id`
- [ ] All 5 endpoints appear in Swagger
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-008 — `PromptTemplateService` must be implemented
- AI-009 — `CreatePromptTemplateDto`, `UpdatePromptTemplateDto`, `QueryPromptTemplateDto`, `PromptTemplateResDto`, `PaginatedPromptTemplateResDto` must exist
- AI-010 — `OpenaiController` must exist

# Testing Notes

Controller tests are in AI-013.

**Manual testing prompt (full CRUD cycle):**

> "Could you run this sequence and paste the output for each step?
>
> 1. `curl -X POST http://localhost:3000/api/v1/openai/templates -H 'Content-Type: application/json' -d '{\"name\": \"test-template\", \"systemPrompt\": \"You are helpful.\", \"technique\": \"system-prompt\"}' | jq .data.publicId`
> 2. Use the returned `publicId` to run: `curl http://localhost:3000/api/v1/openai/templates/<publicId> | jq .data.name`
> 3. `curl -X DELETE http://localhost:3000/api/v1/openai/templates/<publicId>` (should return 204 with no body)
>    I want to confirm the full CRUD cycle works end-to-end."

## Implementation Notes

**Files modified:**

- `src/modules/openai/openai.controller.ts` — added `Delete, HttpCode, HttpStatus, Param, Patch` to `@nestjs/common` imports; added `ApiBody, ApiNoContentResponse, ApiNotFoundResponse` to `@nestjs/swagger` imports; added 5 new DTO imports (`CreatePromptTemplateDto`, `PaginatedPromptTemplateResDto`, `PromptTemplateResDto`, `QueryPromptTemplateDto`, `UpdatePromptTemplateDto`); added `import type { PromptTemplateEntity }`; added 5 new endpoint handlers + private `toTemplateRes()` mapping helper

**Key design decisions:**

- `@ApiEndpoint()` only supports `successStatus: 200 | 201` — DELETE uses `@ApiEndpoint({ summary, isPublic: true })` (no type, no successStatus) plus an explicit `@ApiNoContentResponse()` to document the 204.
- `toTemplateRes()` private helper converts `PromptTemplateEntity` → `PromptTemplateResDto`: maps `description: string | null → string | undefined` (via `?? undefined`) and `fewShotExamples: unknown → PromptTemplateResDto['fewShotExamples']` (cast via `?? undefined` then `as`). This avoids importing the non-exported `FewShotExampleResDto` class.
- `@ApiBody({ type: UpdatePromptTemplateDto })` added explicitly to PATCH — `PartialType` confuses Swagger's schema inference.
- `@ApiNotFoundResponse()` added to GET/:publicId, PATCH/:publicId, DELETE/:publicId — documents the 404 that propagates from `PromptTemplateService.findByPublicId()`.
- `GET /templates` is declared before `GET /templates/:publicId` — NestJS resolves literal paths before parameterized ones, but explicit ordering is defensive.
- `PromptTemplateService` was already in the constructor (injected in AI-010) — no module changes needed.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (21 pre-existing warnings unchanged)
- `npm run build` — success (Prisma client regenerated + nest build)
- `npm run test` — 47/47 pass (no regressions)

## Assumptions Made

- `recommendedModel` and `recommendedTemperature` are always present on `PromptTemplateEntity` (non-nullable) — the Prisma schema has defaults for these fields, so `toTemplateRes()` does not need null-handling for them.
- No `@HttpCode(200)` needed on GET/PATCH — NestJS defaults non-POST routes to 200.

## Follow Ups

- AI-013 adds controller unit tests covering all 13 endpoint handlers (8 existing + 5 new template endpoints) with mocked services.
