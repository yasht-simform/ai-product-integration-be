---
id: AI-008
title: PromptTemplateService — full CRUD + unit tests
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 5 — Prompt Template Service
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-001
  - AI-003
---

# What to Build

Implement `PromptTemplateService` with full CRUD and a paginated, filterable list. All database operations use `DatabaseService`. The service uses `publicId` (UUID) as the external identifier — the internal `BigInt` PK is never exposed.

**Methods to implement:**

```typescript
create(dto: CreatePromptTemplateDto): Promise<PromptTemplateEntity>
findAll(query: QueryPromptTemplateDto): Promise<{ data: PromptTemplateEntity[]; total: number }>
findByPublicId(publicId: string): Promise<PromptTemplateEntity>
findByName(name: string): Promise<PromptTemplateEntity>
update(publicId: string, dto: UpdatePromptTemplateDto): Promise<PromptTemplateEntity>
remove(publicId: string): Promise<void>
```

Use plain TypeScript interface `PromptTemplateEntity` (not a Prisma-generated type — keep it simple, matching the table fields but with `id` omitted). The DTO classes with Swagger decorators come in AI-009.

**`create()`** — calls `db.promptTemplate.create()`. The Prisma model handles `publicId` default. Throws a `ConflictException` (409) if a template with the same `name` already exists (catch Prisma unique constraint error `P2002`).

**`findAll()`** — paginated query. Filters: `technique` (exact match), `tags` (array overlap — use Prisma `hasSome`), `isActive` (boolean, default `true`). Page: `page` and `limit` params (default: 1, 20). Order: `createdAt DESC`.

**`findByPublicId()`** — finds by `publicId`. Throws `NotFoundException` (404) if not found.

**`findByName()`** — finds by `name`. Throws `NotFoundException` (404) if not found. Used by the prompt-test endpoint to load a template by name.

**`update()`** — finds by `publicId` first, then calls `db.promptTemplate.update()`. Throws `NotFoundException` if not found. Only updates fields present in the DTO (partial update).

**`remove()`** — finds by `publicId` first, then calls `db.promptTemplate.delete()`. Throws `NotFoundException` if not found. Returns `void` (204 in the controller).

**Unit tests** (`__tests__/prompt-template.service.spec.ts`):

Use `jest-mock-extended` to mock `DatabaseService`.

Test cases:

- `create()` calls `db.promptTemplate.create()` with correct data
- `create()` throws `ConflictException` when Prisma error `P2002` is thrown
- `findAll()` calls `findMany()` with the correct `where`, `skip`, `take`, and `orderBy` arguments
- `findAll()` with `tags` filter uses `hasSome`
- `findByPublicId()` throws `NotFoundException` when `findUnique()` returns null
- `update()` throws `NotFoundException` when template doesn't exist
- `remove()` calls `db.promptTemplate.delete()` and returns void

# User Stories Covered

- Story 22 — create a prompt template with technique, model, temperature, tags
- Story 23 — paginated list with filter by technique and tags
- Story 24 — get single template by publicId
- Story 25 — update template fields
- Story 26 — delete template
- Story 27 — `findByName()` used by the prompt-test endpoint to load system prompt

# Acceptance Criteria

- [ ] `create()` persists all fields and returns the created entity (without internal `id`)
- [ ] `create()` throws `ConflictException` on duplicate `name`
- [ ] `findAll()` supports filtering by `technique`, `tags` (array overlap), and `isActive`
- [ ] `findAll()` returns `{ data, total }` with correct pagination
- [ ] `findByPublicId()` and `findByName()` throw `NotFoundException` when record is absent
- [ ] `update()` performs a partial update (only provided fields)
- [ ] `remove()` returns void
- [ ] All unit tests pass (`npm run test`)
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-001 — `prompt_templates` table and Prisma client must exist
- AI-003 — `PromptTemplateService` placeholder and `PromptTechnique` enum must exist

# Testing Notes

**Primary seam**: service-level unit test with a deep mock of `DatabaseService`.

To simulate a Prisma unique constraint violation, throw a `Prisma.PrismaClientKnownRequestError` with `code: 'P2002'` from the mock. Import `Prisma` from `../../generated/prisma/client` (Prisma v7 path) in the test.

```typescript
import { Prisma } from '../../../generated/prisma/client';

dbMock.promptTemplate.create.mockRejectedValue(
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.x',
    meta: { target: ['name'] },
  }),
);
```

**Regression risk**: `PromptTemplateService` is NOT exported from `OpenaiModule` in the initial scaffold from AI-003. Add it to the exports list in `openai.module.ts` as part of this issue — it needs to be accessible from the controller.

## Implementation Notes

**Files created:**

- `src/modules/openai/types/prompt-template.types.ts` — `PromptTemplateEntity` interface + `PaginatedPromptTemplateResult`
- `src/modules/openai/__tests__/prompt-template.service.spec.ts` — 11 unit tests

**Files modified:**

- `src/modules/openai/services/prompt-template.service.ts` — full CRUD implementation

**Key design decisions:**

- `PromptTemplateEntity` is a plain interface (not a Prisma type) matching all schema fields except the internal `BigInt id`. A private `toEntity()` mapper in the service handles the conversion.
- P2002 detection uses duck-typing (`error.code === 'P2002'`) instead of `instanceof Prisma.PrismaClientKnownRequestError`. This avoids importing the generated client at runtime in the service (which would break Jest tests due to the `import.meta.url` ESM issue in `generated/prisma/client.ts`).
- `fewShotExamples` cast: `dto.fewShotExamples as unknown as Prisma.InputJsonValue` is needed because `FewShotExampleDto[]` is structurally a valid JSON value but TypeScript can't infer that directly.
- `isActive` defaults to `true` in `findAll()` when not provided, so callers see only active templates unless they explicitly pass `isActive=false`.
- `tags` query param is a comma-separated string (per DTO spec); the service splits and trims before applying `hasSome` filter.
- `PromptTemplateService` is already registered as a provider in `openai.module.ts` (from AI-003 scaffold). Per the issue's clarification it does NOT need to be exported — `OpenaiController` is within the same module.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (25 pre-existing warnings unchanged)
- `npm run test -- prompt-template` — 11/11 pass
- `npm run test` — 47/47 pass (no regressions)

## Assumptions Made

- `tsconfig.build.json` excludes `**/*spec.ts` — spec files are not type-checked by the build compiler. The test uses `PromptTechnique.SYSTEM_PROMPT` (valid enum value) to avoid relying on this gap.
- `PromptTemplateService` does not need to be exported from `OpenaiModule` since the controller will be in the same module.

## Follow Ups

- AI-010 (controller) will inject `PromptTemplateService` directly — no export change needed in the module.
- `QueryPromptTemplateDto.isActive` default (`true`) means admins cannot list all templates in one call — a future enhancement could add a dedicated admin endpoint or a `showAll: boolean` param.

Wait — actually the controller is within `OpenaiModule` so it does NOT need to be exported. Keep `PromptTemplateService` as a provider-only (not exported) since only `OpenaiController` and `OpenaiService` (within the same module) use it.
