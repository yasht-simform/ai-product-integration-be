---
id: AI-051
title: RagController — document endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Tests
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-041
  - AI-044
  - AI-037
---

# What to Build

Wire up the 8 document endpoints from spec §6.1 into `RagController` (AI-037's stub) — each a thin delegate with no business logic, following `ChatController`'s established conventions (`@ApiTags('rag')`, `@ApiEndpoint()` per route, `@ApiNoContentResponse` + `@HttpCode(HttpStatus.NO_CONTENT)` on delete):

- `POST /rag/documents` — multipart upload (`@nestjs/platform-express`'s `FileInterceptor`), delegates to `DocumentService.ingestFromFile()` (AI-044)
- `POST /rag/documents/text` — delegates to AI-043's create-and-ingest-from-text flow
- `GET /rag/documents`, `GET /rag/documents/:publicId`, `GET /rag/documents/:publicId/chunks`, `PATCH /rag/documents/:publicId`, `DELETE /rag/documents/:publicId` (204), `POST /rag/documents/:publicId/reindex` — delegate to AI-041/044's remaining `DocumentService` methods

Add the upload DTO's non-file fields as a multipart-aware DTO (`@ApiConsumes('multipart/form-data')` + `@ApiBody()` with a binary file property, per NestJS's standard file-upload Swagger pattern) covering `title?`/`description?`/`category?`/`tags?` (comma-separated string parsed to `string[]`) alongside the file.

# User Stories Covered

- Stories 1–7, 27, 29, 50, 51 (document CRUD, upload, reindex, chunk listing, Swagger, validated file upload)

# Acceptance Criteria

- [x] All 8 document routes implemented, delegating to `DocumentService` with no business logic in the controller
- [x] File upload endpoint correctly parses multipart fields alongside the binary file
- [x] Uploading a non-PDF/TXT/MD file returns 400 via the controller/DTO validation layer
- [x] `delete()` returns 204
- [x] All 8 routes appear in Swagger under the `rag` tag with correct request/response shapes
- [x] Controller-level tests: `class-validator` `validate()` on new DTOs + `jest.fn()`-mocked `DocumentService` delegation, per `openai.controller.spec.ts`'s pattern

# Dependencies

- AI-041 (`DocumentService` CRUD), AI-044 (reindex/status/chunks), AI-037 (`RagController` stub + `rag` Swagger tag)

# Testing Notes

Full multipart-transport wiring (does a real `curl -F` upload actually reach the handler correctly) is verified live in AI-055 — this issue's automated tests mock `DocumentService` and validate DTOs directly, matching this codebase's established controller-test seam.

## Implementation Notes

Wired all 8 spec §6.1 document routes into `RagController` (`src/modules/rag/rag.controller.ts`),
previously a bare `@ApiTags('rag')` stub. Each route is a thin delegate to `DocumentService`
(AI-041/AI-044) with private `to*Res()` mappers converting entity → ResDto, following
`ChatController`'s exact conventions (`@ApiEndpoint()`, `@ApiNoContentResponse` +
`@HttpCode(HttpStatus.NO_CONTENT)` on delete, `@ApiNotFoundResponse` on publicId-scoped routes).

Files created:

- `src/modules/rag/dto/upload-document.dto.ts` — `UploadDocumentDto` (multipart non-file fields:
  `title?`/`description?`/`category?`/`tags?: string` comma-separated)
- `src/modules/rag/dto/paginated-document-chunks-res.dto.ts` — `PaginatedDocumentChunksResDto`
- `src/modules/rag/__tests__/rag.controller.spec.ts` — DTO validation + controller delegation tests

Files modified:

- `src/modules/rag/rag.controller.ts` — full 8-route implementation
- `src/modules/rag/dto/index.ts` — barrel exports for the two new DTOs
- `src/modules/rag/services/document.service.ts` — `ingestFromFile()` gained an optional second
  parameter (`overrides?: Partial<Pick<CreateDocumentDto, 'title' | 'description' | 'category' |
'tags'>>`) so the multipart form's metadata fields can override the file-derived defaults, per
  spec §6.1's "Upload Document Request" table. Purely additive/backward-compatible.
- `CLAUDE.md` — new "RagController — document endpoints (AI-051)" section

**Live-verified and fixed a real bug**: booted `npm run dev` against a real Postgres instance and
exercised all 8 routes with `curl`, including multipart `curl -F` uploads. The first draft declared
a `file: unknown` field directly on `UploadDocumentDto` (the textbook NestJS Swagger file-upload
pattern) — this 500'd/400'd on every upload request. Root cause: this project's `tsconfig.json`
targets `ES2023`, so an undecorated class field becomes a real own-property (`undefined`) on every
instantiated DTO under TC39 class-fields semantics, which `main.ts`'s global
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` then rejects as an unrecognized
property. Fixed by removing `file` from the DTO class and declaring the binary field directly in an
inline `@ApiBody({ schema: {...} })` in the controller instead of `type: UploadDocumentDto`. Full
details in CLAUDE.md's new section.

Live-verified end to end (after the fix): text-based document creation, list/get/chunks/update,
multipart upload with metadata overrides (`title`/`category`/`tags` all correctly override
filename-derived defaults), 400 on unsupported file extension, 400 on missing file, 404 on unknown
`publicId`, 204 on delete. `embeddingStatus: 'failed'` was observed on ingestion (both text and file
paths) — root-caused via server logs to this sandbox's placeholder/invalid `PINECONE_API_KEY`
rejecting the SDK's `describeIndex()` call, not a defect in this issue's code (`DocumentService`'s
AI-043 try/catch degrades gracefully exactly as designed). `reindexDocument()`/`delete()`'s
`PineconeService.deleteByFilter()` calls surfaced the same credential error as an uncaught 500 —
this is pre-existing `PineconeService`/`DocumentService` behavior from AI-040/AI-041, unrelated to
the controller wiring added in this issue, and out of scope to fix here.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 59 pre-existing warnings in unrelated files (none in files
  touched by this issue)
- `npm run build` — succeeds
- `npm run test -- rag.controller` — 14/14 pass
- `npm run test -- src/modules/rag` — 148/148 pass (includes `document-upload-reindex.service
.spec.ts`'s pre-existing `ingestFromFile()` tests, confirming the new optional parameter is
  backward-compatible)
- `npm run test` (full suite) — 433/433 pass, zero regressions
- Live `npm run dev` + `curl`/`curl -F` smoke test against real Postgres — see Implementation Notes

## Assumptions Made

- No dedicated ingestion-status route was added — spec §6.1 lists exactly 8 document routes and
  `GET /rag/documents/:publicId` (`findOne()`) already surfaces `totalChunks`/`embeddingStatus`.
  AI-044's `getIngestionStatus()` method remains unreachable by any route, same as before this
  issue — not a regression, just not exposed (no route asked for it in either issue).
- `POST /rag/documents/text` and `POST /rag/documents` use `successStatus: 201` (resource created);
  `POST /rag/documents/:publicId/reindex` uses the default `200` (modifies an existing resource,
  doesn't create one) — no explicit guidance in the issue text, inferred from `ChatController`'s
  own POST-status conventions.
- `UploadDocumentDto.tags` reuses `QueryDocumentsDto.tags`'s comma-separated-string convention
  (parsed via a new private `RagController.parseTags()`) rather than requiring `tags[]=` array
  multipart syntax, matching the issue's own explicit instruction.

## Follow Ups

- This sandbox's `PINECONE_API_KEY` is a placeholder/invalid value — every ingestion in this
  environment degrades to `embeddingStatus: 'failed'`, and `reindexDocument()`/`delete()` surface
  an uncaught 500 from `PineconeService.deleteByFilter()`'s `describeIndex()` call. Real
  credentials should be configured before AI-055's live smoke test, or that issue will hit the same
  wall.
- AI-055 should also verify the file-upload path against a real PDF and a real MD file (this
  session only exercised `.txt` and a rejected `.docx`).
