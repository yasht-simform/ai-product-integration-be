---
id: AI-041
title: DocumentService — CRUD + document DTOs
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 4 — Document Ingestion Pipeline
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-036
  - AI-037
  - AI-040
---

# What to Build

Implement `DocumentService`'s CRUD subset — `create`, `findAll`, `findOne`, `update`, `delete` per spec §5.3. Ingestion (`ingestDocument`/`ingestFromFile`/`reindexDocument`) is separate work (AI-043/AI-044) — this issue is metadata lifecycle only.

`create(dto: CreateDocumentDto)` persists a `documents` row with `embeddingStatus: 'pending'`, `totalChunks: 0`, `totalTokens: 0` — no chunking or embedding happens here.

`findAll(query: QueryDocumentsDto)` — paginated, filterable by `category`/`status`/`tags`/`search` (title/description substring), following `ModelRegistryService.findAllModels()`'s established filter-building pattern.

`findOne(publicId)` returns a document with its chunks — `chunks: []` for a freshly created, not-yet-ingested document, not a 404-adjacent error (matching Phase 2's `findConversation()` zero-messages precedent).

`update(publicId, dto: UpdateDocumentDto)` — metadata-only fields (`title`, `description`, `category`, `tags`); `sourceType`/`originalFilename`/`fileSize`/`embeddingStatus` are not patchable through this endpoint (they're derived/pipeline-owned, not client-editable).

`delete(publicId)` — hard delete relying on the schema's `onDelete: Cascade` for chunks (mirroring `ChatService.deleteConversation()`'s AI-019 precedent), **plus** a call to `PineconeService.deleteByFilter({ documentId: publicId })` — Postgres cascade only cleans up the relational side; the vector store needs its own explicit cleanup (FR-RAG-009).

DTOs: `CreateDocumentDto` (`title?`, `description?`, `sourceType`, `category?`, `tags?`), `UpdateDocumentDto` (`PartialType`, omitting `sourceType`/`originalFilename`/`fileSize`/`embeddingStatus`), `QueryDocumentsDto` (`category?`, `status?`, `tags?`, `search?`, `page?`, `limit?`), `DocumentResDto`, `DocumentWithChunksResDto`, `PaginatedDocumentsResDto` — following the exact `PartialType`/`@ApiProperty()`/barrel-`index.ts` conventions from `ai-chat/dto`/`openai/dto`.

# User Stories Covered

- Story 4 — list documents paginated/filtered
- Story 5 — fetch single document with chunk count and status
- Story 6 — update metadata without re-ingesting
- Story 7 — delete cascades to both PostgreSQL and Pinecone

# Acceptance Criteria

- [x] `create()`/`findAll()`/`findOne()`/`update()` implemented, entity fields match spec §3.1
- [x] `delete()` cascade-deletes chunks (Prisma `onDelete: Cascade`) **and** calls `PineconeService.deleteByFilter({ documentId: publicId })`
- [x] `findOne()` on a document with zero chunks returns `chunks: []`, not an error
- [x] All five DTOs created, exported via a barrel `index.ts`
- [x] Unit tests: `DeepMockProxy<DatabaseService>`, cover CRUD + the two-step delete (assert both `dbMock.document.delete` and the mocked `PineconeService.deleteByFilter` are called with the correct `publicId`/filter)

# Dependencies

- AI-036 (schema), AI-037 (module scaffold), AI-040 (`PineconeService`, for the delete cascade)

# Testing Notes

`DatabaseService` jest-mocked at the module level per `CLAUDE.md`'s documented gotcha. `PineconeService` mocked as a `jest.fn()`-based collaborator, not a `DeepMockProxy` (it's not a Prisma-backed service).

## Implementation Notes

Implemented the CRUD subset of `DocumentService` (`src/modules/rag/services/document.service.ts`)
per spec §5.3 — `create`/`findAll`/`findOne`/`update`/`delete`. Ingestion methods
(`ingestDocument`/`ingestFromFile`/`reindexDocument`/`getIngestionStatus`/`getChunks`) remain out of
scope, deferred to AI-042/AI-043/AI-044 as this issue specifies.

`create()` writes `embeddingStatus: 'pending'`, `totalChunks: 0`, `totalTokens: 0` — no chunking or
embedding happens here. `embeddingModel` is resolved from `ConfigService.get('rag.embeddingModel')`
(falling back to the same `'text-embedding-3-small'` literal `ragConfig`'s own factory uses),
mirroring `ChatService.createConversation()`'s config-fallback pattern — the schema's
`embeddingModel: String` column is NOT nullable, so a concrete value must be written even though
this issue's own `CreateDocumentDto` has no `embeddingModel` field.

`findAll()` follows `ModelRegistryService.findAllModels()`'s exact filter-building shape: optional
`category`/`status` (mapped to `embeddingStatus`) equality filters, a comma-separated `tags` string
split/trimmed/filtered into a `hasSome` array filter (same pattern as
`PromptTemplateService.findAll()`'s `tags` handling), and a `search` param spread across
`title`/`description` via a case-insensitive `OR` (matching `ModelRegistryService`'s `search` →
`name`/`modelId` `OR` precedent).

`findOne()` includes `chunks: { orderBy: { chunkIndex: 'asc' } }` — a document with no chunks yet
(the state every document is in immediately after `create()`) returns `chunks: []`, not an error,
matching this issue's own explicit requirement and Phase 2's `findConversation()` zero-messages
precedent.

`update()` only ever writes `title`/`description`/`category`/`tags` — `UpdateDocumentDto` is
`PartialType(OmitType(CreateDocumentDto, ['sourceType']))`, so `sourceType` is structurally absent
from the update surface entirely (not just optional), the same pattern
`UpdateConversationDto` uses to drop `toolsEnabled`. `originalFilename`/`fileSize`/`embeddingStatus`
were never part of `CreateDocumentDto` in the first place (per this issue's own DTO field list), so
there was nothing further to omit for those three.

`delete()` is a two-step operation: `databaseService.document.delete()` (Postgres `onDelete: Cascade`
on `DocumentChunk.document` handles the relational side, mirroring `ChatService.deleteConversation()`'s
AI-019 precedent) followed unconditionally by
`pineconeService.deleteByFilter({ documentId: publicId })` — the vector store has no foreign-key
relationship to Postgres, so this explicit second call is the only way to keep Pinecone from
accumulating orphaned vectors for a deleted document (FR-RAG-009). Both `update()` and `delete()`
call a shared private `findDocumentOrThrow()` guard first, throwing `NotFoundException` before any
mutation — same precondition-check shape as `ModelRegistryService.updateModel()`/`deleteModel()`.

Added `src/modules/rag/types/rag.types.ts` (this module's first `types/` file, following
`ai-chat.types.ts`'s naming convention) with `DocumentEntity`, `DocumentChunkEntity`,
`DocumentWithChunks`, `PaginatedDocumentsResult`. Six DTOs were created under `src/modules/rag/dto/`
(`CreateDocumentDto`, `UpdateDocumentDto`, `QueryDocumentsDto`, `DocumentResDto`,
`DocumentChunkResDto`, `DocumentWithChunksResDto`, `PaginatedDocumentsResDto` — this issue's own
"What to Build" section lists all of these explicitly even though its Acceptance Criteria checkbox
says "five"; the fuller list was implemented since `DocumentWithChunksResDto` structurally requires
a chunk response shape and none existed yet), all exported via a barrel `dto/index.ts` matching
`ai-chat/dto`'s exact conventions. `sourceType`/`category`/`status` fields use
`@IsIn(Object.values(...))` against the existing `as-const` constants (`DocumentSourceType`,
`DocumentCategory`, `EmbeddingStatus`) rather than `@IsEnum()`, since these are `as const` objects
with derived union types, not native TypeScript `enum`s (`@IsEnum()` requires an actual enum object
at runtime).

`__tests__/document.service.spec.ts` follows `model-registry.service.spec.ts`'s
`DeepMockProxy<DatabaseService>` pattern, with `PineconeService` mocked as a plain
`{ deleteByFilter: jest.fn() }` object (not a `DeepMockProxy`, since it isn't Prisma-backed) per
this issue's own Testing Notes — covers all five CRUD methods including the two-step delete
(asserting both `dbMock.document.delete` and the mocked `deleteByFilter` receive the correct
`publicId`) and the not-found guard on `update()`/`delete()`/`findOne()`.
`__tests__/document-dtos.spec.ts` adds `class-validator` `validate()` smoke tests for all three
request DTOs, mirroring `chat-dtos.spec.ts`'s pattern exactly (including the
`whitelist`/`forbidNonWhitelisted` reproduction of `main.ts`'s global `ValidationPipe` for
`UpdateDocumentDto`'s `sourceType` rejection test).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 56 warnings (55 pre-existing baseline + 1 new instance of the
  same already-accepted `expect.objectContaining()` → `no-unsafe-assignment` category seen in
  `openai.service.spec.ts`/`pinecone.service.spec.ts`; not a new pattern, not a regression)
- `npm run build` — succeeds
- `npx jest --testPathPatterns=document` — 21/21 pass (2 suites)
- `npm run test` (full suite) — 324/324 pass, 25/25 suites, no regressions (up from 303)
- Live boot check: `node dist/src/main.js` — clean boot, `RagModule dependencies initialized` and
  `Application running on port 3000` both present, no DI/runtime errors

## Assumptions Made

- `CreateDocumentDto.title` is optional per this issue's own DTO field list, but the `documents.title`
  schema column is non-nullable — defaults to the literal `'Untitled Document'` when omitted. Not
  derived from `originalFilename` (also absent from this DTO), since file-upload title defaulting is
  explicitly AI-044's concern (`ingestFromFile`), not this metadata-only `create()`.
- `embeddingModel` on a freshly created (not-yet-ingested) document is set to the app's currently
  configured `rag.embeddingModel` value rather than left as a placeholder — the schema requires a
  non-null value, and this is the model that will actually be used once ingestion runs, so it's the
  most accurate value available at creation time, not a magic/empty string.
- Implemented six response/request DTOs (not five) since `DocumentWithChunksResDto` needs a chunk
  shape (`DocumentChunkResDto`) to be well-typed, and this issue's own "What to Build" text lists it
  explicitly — read as the authoritative source over the Acceptance Criteria's checkbox count.

## Follow Ups

- AI-042 (parse + chunk pipeline) and AI-043 (embed/cache/upsert/persist) both extend
  `DocumentService` with `ingestDocument()`/`reindexDocument()` — they will write real
  `DocumentChunk` rows and update `totalChunks`/`totalTokens`/`embeddingStatus` on the `Document`
  row this issue's `create()` seeds as `pending`.
- AI-044 adds `ingestFromFile()`/`getIngestionStatus()`/`getChunks()` — `getChunks()` will reuse
  this issue's `DocumentChunkResDto`/pagination conventions directly.
- AI-051 (RagController document endpoints) consumes all five CRUD methods and all six DTOs added
  here as-is.
