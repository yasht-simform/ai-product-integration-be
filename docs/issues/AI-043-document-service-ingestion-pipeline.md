---
id: AI-043
title: DocumentService — ingestion pipeline (embed, cache, upsert, persist)
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
  - AI-038
  - AI-039
  - AI-040
  - AI-042
---

# What to Build

Implement the core ingestion pipeline: given a document's `publicId` and its already-extracted source text, (1) set `embeddingStatus: 'processing'`; (2) run AI-042's chunking step; (3) for each chunk, check `EmbeddingCacheService.get()` first — on a miss, call the embedding API (batched via `OpenaiService.generateEmbeddingsBatch()`, up to `EMBEDDING_CONFIG.batchSize`/`ragConfig.embeddingBatchSize` chunks per call, skipping any chunk already resolved from cache) and `EmbeddingCacheService.set()` the result; (4) upsert the resulting vectors to Pinecone via `PineconeService.upsert()`, with vector `id: \`chunk*${documentPublicId}*${chunkIndex}\``and metadata`{ documentId, documentTitle, chunkIndex, category, tokenCount }`(spec §7.2); (5) persist a`DocumentChunk`row per chunk with its`pineconeId`; (6) update the document row's `embeddingStatus: 'completed'`, `totalChunks`, `totalTokens`— or`embeddingStatus: 'failed'`if any step throws, never left stuck at`'processing'`.

**Where this plugs in**: wire this pipeline into the simplest entry point — creating a document from raw text (`POST /rag/documents/text` per spec §6.1). Since the caller already supplies the text directly, ingestion can run synchronously right after the document row is created, with no re-fetch needed. Add a new method for this "create-and-ingest-from-text" flow rather than folding it into AI-041's `create()`, which must stay usable standalone (e.g. `MockDataService`, AI-048, calls it before ingesting).

Batch embedding calls (rather than one call per chunk) to stay within NFR-RAG-004's 60-second budget for a 50-page PDF.

# User Stories Covered

- Story 23 — ingestion checks the cache before calling the embedding API
- Story 24 — each chunk persisted with its `pineconeId`
- Story 25 — `embeddingStatus` transitions `pending` → `processing` → `completed`
- Story 26 — `embeddingStatus` becomes `failed`, never stuck at `processing`
- Story 30 — ingestion performance budget (batched embedding calls)

# Acceptance Criteria

- [x] Pipeline checks the embedding cache per chunk before calling the embeddings API
- [x] Cache misses are batched (up to `ragConfig.embeddingBatchSize`) into `generateEmbeddingsBatch()` calls
- [x] Every embedded chunk is upserted to Pinecone with the documented id format and metadata shape (spec §7.2)
- [x] Every chunk is persisted as a `DocumentChunk` row with `content`, `tokenCount`, `startChar`/`endChar`, `pineconeId`
- [x] `embeddingStatus` transitions `pending` → `processing` → `completed` on success, or → `failed` (not stuck at `processing`) on any thrown error
- [x] `document.totalChunks`/`totalTokens` reflect the actual persisted chunk count/sum after ingestion
- [x] Unit tests: full happy path (mocked `EmbeddingCacheService`/`OpenaiService`/`PineconeService`/`DatabaseService`) asserting call order (chunk → cache-check → embed-on-miss → cache-set → Pinecone-upsert → persist → status-update); a cache-hit-skips-embedding-call test; a mid-pipeline failure sets `embeddingStatus: 'failed'` rather than throwing an unhandled rejection out of the request

## Implementation Notes

Added the core ingestion pipeline to `DocumentService` (`src/modules/rag/services/document.service.ts`)
as a private `ingestDocument(document: Document, text: string): Promise<DocumentEntity>` method —
kept private and reused internally rather than exposed publicly, since AI-044's `ingestFromFile()`
and `reindexDocument()` will call it from within the same class (per that issue's own description:
"then run AI-043's ingestion pipeline against the extracted text"). It sets `embeddingStatus:
'processing'` immediately, then in a `try`: chunks the text via AI-042's `chunkText()`, resolves
embeddings via a new private `embedChunks()` helper, upserts vectors to Pinecone (`chunk_<publicId>_<chunkIndex>`
id format, metadata `{ documentId, documentTitle, chunkIndex, tokenCount, category? }` per spec
§7.2 — `category` is spread in only when non-null, since Pinecone's `RecordMetadata` type rejects
`null` values), bulk-persists `DocumentChunk` rows via `createMany()` (each with its `pineconeId`),
and finally updates the document to `embeddingStatus: 'completed'` with the real `totalChunks`/
`totalTokens`. A `catch` around the whole body sets `embeddingStatus: 'failed'` and **returns**
(does not rethrow) the failed entity — matching this issue's own Testing Notes phrasing ("rather
than throwing an unhandled rejection out of the request") and the codebase's established
degrade-gracefully convention (`ToolExecutorService.execute()` never rejects,
`StreamingService`'s mid-stream errors become events not throws).

**`embedChunks(chunks, model)`** (private): checks `EmbeddingCacheService.get()` per chunk
sequentially (not `Promise.all()` — sequential ordering makes the call-order assertions in the
acceptance criteria's own required test deterministic), collecting cache hits directly and
batching cache-miss indices into groups of `ragConfig.embeddingBatchSize` (falling back to
`EMBEDDING_CONFIG.batchSize`) for `OpenaiService.generateEmbeddingsBatch()` calls — each resolved
embedding is cached via `EmbeddingCacheService.set()` before moving to the next batch. Results are
returned in the chunks' original order regardless of hit/miss split, by writing into a
pre-sized array at each chunk's own index rather than concatenating hits and misses separately.

**`createFromText(dto: CreateDocumentTextDto)`**: the "create-and-ingest-from-text" entry point
this issue's spec text asked for, wiring the pipeline into the simplest ingestion path (`POST
/rag/documents/text` per spec §6.1 — the controller route itself is AI-051's job, not this
issue's). `create()` was refactored to extract a private `createDocumentRow()` helper (returns the
raw Prisma `Document` row with its `id`/`publicId`, not the mapped `DocumentEntity`) so both
`create()` (AI-041, unchanged public behavior) and `createFromText()` can create a row without
duplicating the write logic — `createFromText()` forces `sourceType: DocumentSourceType.TXT` since
there's no uploaded file to derive a format from, then immediately calls `ingestDocument()` with
`dto.content`, no re-fetch needed since the just-created row already has everything the pipeline
needs (`id`, `publicId`, `title`, `category`, `embeddingModel`).

A new `CreateDocumentTextDto` (`src/modules/rag/dto/create-document-text.dto.ts`) extends
`OmitType(CreateDocumentDto, ['sourceType'])` and adds a required `content: string` field — the
same `OmitType` pattern `UpdateDocumentDto` already uses to drop a field it doesn't want on its
surface.

`DocumentService` gained a new constructor dependency: `OpenaiService` (for
`generateEmbeddingsBatch()`) — imported directly rather than through the still-empty-shell
`EmbeddingService`, per AI-038's own documented Follow Up ("embeddings are generated via
`OpenaiService.generateEmbedding()`/`generateEmbeddingsBatch()` called directly by
`DocumentService`/`SearchService`, not through this wrapper"). No `RagModule` wiring change was
needed — it already imports `OpenaiModule`, which exports `OpenaiService`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 57 warnings (up from the 56-warning baseline by exactly one:
  `document-ingestion.service.spec.ts`'s `expect.objectContaining(...)` assertion triggers the same
  pre-existing `no-unsafe-assignment` warning `document.service.spec.ts` already had at an identical
  call site — not a new category, just one more instance of an already-accepted pattern)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- document-ingestion document.service document-dtos document-parse-chunk` — 41/41 pass
- `npm run test` (full suite) — 344/344 pass (up from 334, +10 new tests, zero regressions)

## Assumptions Made

- **Failure handling swallows, not rethrows.** The issue's Testing Notes phrase "rather than
  throwing an unhandled rejection out of the request" was read as: a mid-pipeline failure should
  resolve `createFromText()`/`ingestDocument()` normally with `embeddingStatus: 'failed'` on the
  returned entity, not reject the promise. This means a future `POST /rag/documents/text` endpoint
  (AI-051) would return `201` with a `failed`-status body rather than `500` — callers are expected
  to poll `getIngestionStatus()` (AI-044) rather than treat ingestion failure as an HTTP error. If
  a future issue wants HTTP-layer failure signaling instead, this would need revisiting.
- **`ingestDocument()` stays private.** AI-044's own issue text explicitly plans to call "AI-043's
  ingestion pipeline" from `ingestFromFile()`/`reindexDocument()`, both of which live on the same
  `DocumentService` class — no public/exported seam was needed for that, so it stays a private
  method rather than being exposed on the class's public API.
- **Pinecone/`DocumentChunk.createMany()` are skipped for a zero-chunk document** (e.g. an empty
  text input) rather than calling either with an empty array — avoids a no-op network/DB round
  trip; the document still transitions to `completed` with `totalChunks: 0`.
- **`embedChunks()`'s cache-check loop is sequential, not parallelized** — deliberate, so the
  acceptance criteria's own required call-order test (cache-check → embed-on-miss → cache-set) has
  a deterministic order to assert against; this trades a small amount of pipeline latency (each
  cache lookup awaited in turn) for testability, consistent with this codebase's general
  preference for explicit, assertable sequencing over micro-optimized concurrency in write paths.

## Follow Ups

- AI-044 will call this issue's private `ingestDocument()` from `ingestFromFile()` (after creating
  a document row from an uploaded file) and from `reindexDocument()` (after reconstructing text
  from existing chunk offsets and deleting the prior chunks/vectors).
- AI-048 (`MockDataService.generateDocuments()`) is expected to call `createFromText()` directly
  for faker-generated documents, per this issue's own "What to Build" text.
- No controller route exists yet for `POST /rag/documents/text` — that's AI-051's job; this issue
  only implements the service-layer method the route will delegate to.

# Dependencies

- AI-038 (`OpenaiService` embeddings), AI-039 (`EmbeddingCacheService`), AI-040 (`PineconeService`), AI-042 (chunking step)

# Testing Notes

Standard `DeepMockProxy<DatabaseService>` unit-test pattern; mock `EmbeddingCacheService`/`OpenaiService`/`PineconeService` as `jest.fn()`-based collaborators. No real embedding vectors needed — small fixed-dimension arrays suffice since only pipeline sequencing and status transitions are under test.
