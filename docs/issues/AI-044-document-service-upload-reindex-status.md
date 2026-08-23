---
id: AI-044
title: DocumentService — file upload ingestion, reindex, status & chunk queries
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
  - AI-042
  - AI-043
  - AI-040
---

# What to Build

**`ingestFromFile(file: Express.Multer.File)`**: validate the file's mimetype/extension against `DocumentSourceType` (`pdf`/`txt`/`md`; anything else rejected before any parsing is attempted), extract text via AI-042's parse step, create the document row (AI-041's `create()`, with `sourceType`/`originalFilename`/`fileSize` populated from the file), then run AI-043's ingestion pipeline against the extracted text. Given this codebase has no job queue, run ingestion awaited (not fire-and-forget) rather than introducing new async infrastructure for this phase — document this as a scalability tradeoff, not a bug, in the same spirit as `AiAuditService.log()` being explicitly fire-and-forget where that pattern _is_ appropriate.

**`reindexDocument(publicId)`**: reconstructs the document's original source text from its existing `DocumentChunk` rows' `startChar`/`endChar` offsets — sort chunks by `chunkIndex`, take each chunk's non-overlapping unique span (`[chunk[i].startChar, chunk[i+1].startChar)` for all but the last chunk; the full range for the last chunk), and concatenate. Because these offsets index into the original text and chunks are contiguous by construction, this reconstruction is exact — no separate raw-text storage column is needed. Then delete the existing chunks (Postgres rows + `PineconeService.deleteByFilter({ documentId })`) and re-run AI-043's pipeline against the reconstructed text.

**`getIngestionStatus(publicId)`**: thin read returning `{ embeddingStatus, totalChunks, totalTokens }` for polling.

**`getChunks(documentPublicId, query: QueryChunksDto)`**: paginated read of a document's chunks, ordered by `chunkIndex`.

# User Stories Covered

- Story 1 — upload PDF/TXT/MD, document created with `embeddingStatus: 'processing'`
- Story 3 — unsupported file type rejected before parsing
- Story 27 — `reindexDocument()`
- Story 28 — reindex cleans up prior chunks/vectors before writing new ones
- Story 29 — paginated chunk listing
- Story 31 — bulk ingestion doesn't hit embedding rate limits (covered by AI-043's batching; this issue's job is not to regress it across many sequential uploads)

# Acceptance Criteria

- [x] `ingestFromFile()` rejects unsupported file types with a clear error before any parsing is attempted
- [x] `ingestFromFile()` populates `sourceType`/`originalFilename`/`fileSize` correctly from the Multer file object
- [x] `reindexDocument()` reconstructs the original text exactly from existing chunk offsets — verified by a test: ingest known text, reindex with a different chunk config, assert the newly-chunked content still covers the exact original text when stitched back together
- [x] `reindexDocument()` deletes prior chunks/vectors before writing new ones — no duplicate/stale vectors remain
- [x] `getIngestionStatus()`/`getChunks()` implemented and paginated per spec §5.3
- [x] Unit tests cover all four methods, including the unsupported-file-type rejection and the offset-reconstruction correctness check

# Dependencies

- AI-042 (parse step), AI-043 (ingestion pipeline), AI-040 (`PineconeService.deleteByFilter`)

# Testing Notes

`Express.Multer.File` is a plain interface — construct a fixture object literal (`buffer`, `originalname`, `mimetype`, `size`) rather than a real HTTP multipart request; full multipart transport wiring is verified at the controller/live-smoke level (AI-051/AI-055), not here.

## Implementation Notes

Added four methods to `DocumentService` (`src/modules/rag/services/document.service.ts`), all
composing directly with AI-042's `parseSource()`/`chunkText()` and AI-043's private
`ingestDocument()` pipeline:

**`ingestFromFile(file: Express.Multer.File)`**: a new private `resolveSourceTypeFromFilename()`
derives the source type from the file's extension (not its `mimetype` — browsers/curl send
inconsistent MIME types for `.md` in particular, so the filename extension is the more reliable
signal) against a `SUPPORTED_FILE_SOURCE_TYPES` allowlist (`pdf`/`txt`/`md` — `generated` is
excluded, since that source type only exists for `MockDataService`-authored rows). An unsupported
or missing extension throws `BadRequestException` **before** `parseSource()` is ever called —
verified by a test asserting `parseSource` was never invoked. On success: `parseSource(file.buffer,
sourceType)` extracts text, then `createDocumentRow()` (AI-043's helper) creates the row with
`sourceType`/`originalFilename`/`fileSize` populated from the Multer file and `title` defaulting to
`file.originalname` (per spec §6.1's documented default: "Override title (default: filename)"),
then `ingestDocument()` runs synchronously (awaited, not fire-and-forget — this codebase has no job
queue, so ingestion blocks the calling request; a documented scalability tradeoff for this phase,
not a bug, matching how `AiAuditService.log()`'s fire-and-forget pattern is deliberately the
exception rather than the rule elsewhere in this codebase).

`createDocumentRow()` (AI-043) gained two new optional fields on its parameter type
(`originalFilename?: string`, `fileSize?: number`) rather than introducing a second row-creation
path — both are Prisma-nullable columns, so omitting them (as `create()`/`createFromText()` already
do) writes `undefined`, which Jest's `toEqual`/`toHaveBeenCalledWith` treats as absent, so no
existing AI-041/AI-043 test assertions needed updating.

**`reindexDocument(publicId)`**: fetches the document with its chunks (ordered by `chunkIndex`),
reconstructs the original source text via a new private `reconstructText()` — for each chunk except
the last, takes `chunk.content.slice(0, nextChunk.startChar - chunk.startChar)` (the chunk's
non-overlapping unique span, sliced from its own already-persisted `content` rather than needing
access to any separately-stored raw text — since `content` **is** `sourceText.slice(startChar,
endChar)` by construction, per AI-042), and the last chunk's full `content` for the tail. Verified
by a test asserting the reconstructed text passed into `chunkText()` exactly matches a hand-built
original string across three overlapping chunk rows. Deletes the prior `DocumentChunk` rows
(`deleteMany` by `documentId`) and the matching Pinecone vectors (`deleteByFilter({ documentId })`)
**before** calling `ingestDocument()` again — both happen unconditionally ahead of re-ingestion, so
there's no window where old and new vectors coexist under the same `documentId` filter.

**`getIngestionStatus(publicId)`** and **`getChunks(documentPublicId, query: QueryChunksDto)`**:
thin reads, following `findOne()`/`findAll()`'s existing conventions exactly —
`findDocumentOrThrow()` (already existed) guards both against a missing document, and `getChunks()`
mirrors `findAll()`'s pagination shape (`Math.min(limit, 100)`, `skip`/`take`, parallel
`findMany`/`count` calls). Two new interfaces were added to `types/rag.types.ts`:
`IngestionStatusResult` and `PaginatedChunksResult`. A new `QueryChunksDto`
(`dto/query-chunks.dto.ts`) is
`PickType(QueryDocumentsDto, ['page', 'limit'])` — chunk listing has no filter dimensions beyond
pagination, unlike document listing's category/status/tags/search.

**Dependency footgun** (third occurrence of the pattern first documented in AI-037/AI-042):
`Express.Multer.File` doesn't resolve without `@types/multer` — `multer` itself is present in
`node_modules` only as an undeclared transitive/peer dependency of `@nestjs/platform-express`
(consistent with the `axios`/`@langchain/core` precedents), and it ships no bundled `.d.ts`.
Installed `@types/multer` as an explicit dev dependency via `--legacy-peer-deps`. This will also be
needed by AI-051's controller (`@UploadedFile() file: Express.Multer.File`), so installing it now
rather than deferring avoids re-discovering the same gap in that issue.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` (this project's documented type-check command,
  which excludes `**/*spec.ts`) — clean, no errors
- `npm run lint:check` — 0 errors, 58 warnings (up from the 57-warning baseline by exactly one:
  `document-upload-reindex.service.spec.ts`'s `expect.objectContaining(...)` assertion triggers the
  same pre-existing `no-unsafe-assignment` warning already present at identical call sites in
  `document.service.spec.ts`/`document-ingestion.service.spec.ts` — not a new category)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- document-upload-reindex document-ingestion document.service` — 34/34 pass
- `npm run test` (full suite) — 357/357 pass (up from 344, +13 new tests, zero regressions)
- **Noted, not a regression**: a bare `npx tsc --noEmit` (using the unfiltered `tsconfig.json`,
  which — unlike `tsconfig.build.json` — includes `*.spec.ts` files) reports pre-existing
  `jest-mock-extended`/Prisma deep-mock typing errors across several spec files, including this
  issue's own `document-upload-reindex.service.spec.ts` and AI-043's `document-ingestion.service.spec.ts`.
  This class of error already existed before this issue (e.g. in `chat.service.spec.ts`,
  `ai-audit.service.spec.ts`, `app.e2e-spec.ts`) and does not block Jest (ts-jest transpiles these
  files without hard-failing on them, proven by the passing test run above) — it's exactly why this
  project's own documented validation command scopes to `tsconfig.build.json` rather than bare `tsc`.

## Assumptions Made

- **`ingestFromFile()`'s title defaults to the original filename**, not `"Untitled Document"` —
  read from spec §6.1's Upload Document Request table ("title: No — Override title (default:
  filename)"), since this issue's own "What to Build" text didn't restate the default explicitly.
- **Source type is derived from the file extension, not the `mimetype` field** — deliberate, since
  MIME type detection for `.md` files is inconsistent across upload clients (some send
  `text/markdown`, others `text/plain` or `application/octet-stream`), while the extension is
  unambiguous and is what the acceptance criteria's "before any parsing is attempted" rejection
  needs to be reliable against.
- **`ingestFromFile()` takes only the file** (no separate metadata parameter for
  description/category/tags), matching this issue's own stated method signature exactly
  (`ingestFromFile(file: Express.Multer.File)`). Spec §6.1's multipart form also accepts
  `description`/`category`/`tags` fields — wiring those through is left to AI-051's controller,
  which will need to combine the parsed multipart fields with this method's file-only signature
  (likely by extending `createDocumentRow()`'s already-generalized parameter shape further, or by
  having the controller call `create()`-style metadata separately — a decision deferred to that
  issue since it depends on the controller's actual multipart DTO shape).
- **No response DTOs were added** for `getIngestionStatus()`/`getChunks()` — only the request-side
  `QueryChunksDto` and two plain result interfaces in `rag.types.ts`. This issue's own "What to
  Build" text didn't mention Swagger response DTOs (unlike AI-041, which explicitly listed six DTOs
  including response shapes), and no controller exists yet to document against — AI-051 is expected
  to add `IngestionStatusResDto`/reuse `PaginatedDocumentsResDto`'s sibling pattern for chunks when
  it wires the actual routes.

## Follow Ups

- AI-051 (`RagController` — document endpoints) will call all four of these methods:
  `POST /rag/documents` (multipart) → `ingestFromFile()`, `POST /rag/documents/:publicId/reindex`
  → `reindexDocument()`, and a status/chunks read path for
  `GET /rag/documents/:publicId`/`GET /rag/documents/:publicId/chunks`. That issue will need to
  resolve how multipart metadata fields (title/description/category/tags) reach
  `ingestFromFile()`, per the Assumption above.
- This issue closes out Epic 4 — Document Ingestion Pipeline (AI-041 through AI-044 are all now
  `completed`).
