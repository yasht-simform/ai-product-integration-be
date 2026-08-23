---
id: AI-045
title: SearchService — semantic search
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 5 — Semantic Search & RAG Orchestration
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-038
  - AI-040
  - AI-036
---

# What to Build

Implement `SearchService.search(query, options?)`/`searchWithScores(query, options?)` per spec §5.5. Embed the query text through the cache-aware path (`EmbeddingCacheService.get()` first, `OpenaiService.generateEmbedding()` on a miss — a repeated identical question shouldn't re-embed either), query `PineconeService` with `topK` (default `ragConfig.topK`) and a metadata filter built from `options.categoryFilter`/`options.documentIds`, then resolve the returned Pinecone match IDs back to `document_chunks`/`documents` in Postgres for the actual title/content, filter out anything below `options.similarityThreshold`/`ragConfig.similarityThreshold` (FR-RAG-006), and map to `SearchResult[]`.

`SearchResult` already includes `score` per spec §5.5's interface, so `search()` and `searchWithScores()` have no meaningful shape difference — implement `searchWithScores()` as a thin alias/delegate to `search()` unless a genuine distinction surfaces during implementation, rather than duplicating the retrieval logic.

# User Stories Covered

- Story 33 — ranked search results with similarity scores
- Story 34 — below-threshold results excluded
- Story 35 — category filter
- Story 36 — `documentIds` filter

# Acceptance Criteria

- [x] `search()`/`searchWithScores()` implemented, embedding the query through the cache-aware path
- [x] Results below `similarityThreshold` excluded
- [x] `categoryFilter`/`documentIds` correctly narrow the Pinecone query filter
- [x] Results resolved to full chunk text + document title via a Postgres join, not returned as bare Pinecone metadata
- [x] Unit tests: relevant result ranks first, below-threshold result excluded, category filter narrows results, `documentIds` filter narrows results, empty-index/no-match returns an empty array without throwing

# Dependencies

- AI-038 (embeddings), AI-039 (cache — via `EmbeddingCacheService` already available from AI-039), AI-040 (Pinecone), AI-036 (`document_chunks` table to join against)

# Testing Notes

Mock `PineconeService`/`OpenaiService`/`EmbeddingCacheService` and `DatabaseService` (`DeepMockProxy`). A timing assertion illustrating NFR-RAG-002's 500ms budget is informative only against mocked dependencies, not a hard gate — real latency depends on live Pinecone/embedding calls, verified in AI-055.

## Implementation Notes

Implemented `SearchService` (`src/modules/rag/services/search.service.ts`), previously an empty
shell from AI-037. `search(query, options?)`:

1. Resolves `topK`/`similarityThreshold` from `options` → `ragConfig` (`rag.topK`/
   `rag.similarityThreshold`) → `RAG_CONFIG`'s hardcoded fallback, the same three-tier chain
   `DocumentService.chunkText()` already uses.
2. Resolves the query embedding via a private `resolveQueryEmbedding()`: `EmbeddingCacheService.get(query)`
   first, falling back to `OpenaiService.generateEmbedding()` (injected directly, not through the
   still-empty `EmbeddingService` shell — same convention `DocumentService` established in AI-043)
   only on a miss, then `EmbeddingCacheService.set()`s the result — a repeated identical question
   never re-embeds.
3. Builds a Pinecone metadata filter via a private `buildFilter()`: `options.categoryFilter` maps to
   `{ category }`, `options.documentIds` maps to `{ documentId: { $in: [...] } }` (Pinecone's `$in`
   operator, per its filter syntax for narrowing by an array of values), both spread into one filter
   object when present together; returns `undefined` (not `{}`) when neither is set, matching
   `PineconeService.query()`'s existing optional-filter convention.
4. Queries `PineconeService.query(embedding, topK, filter)`, filters out any match with
   `score < similarityThreshold` (FR-RAG-006) **before** touching Postgres — so a below-threshold
   match never triggers a wasted chunk lookup.
5. Resolves surviving matches to full chunk text + document title via a single
   `documentChunk.findMany({ where: { pineconeId: { in: [...] } }, include: { document: true } })`
   join (not returned as bare Pinecone metadata, per the acceptance criteria) — chunk rows already
   carry their originating `pineconeId` from AI-043's ingestion pipeline, so this is a direct
   reverse lookup with no id-parsing needed. Results are re-ordered to match Pinecone's own ranking
   (`matches.map(...)`, not the arbitrary order `findMany` would return), and any match with no
   corresponding row (a stale/orphaned vector) is silently dropped rather than throwing.

`searchWithScores()` is a one-line delegate to `search()` — `SearchResult` already carries `score`
per spec §5.5's interface, so there's no shape difference to justify separate retrieval logic, per
this issue's own explicit guidance.

Two new interfaces landed in `types/rag.types.ts`: `SearchOptions` (`topK?`, `similarityThreshold?`,
`categoryFilter?`, `documentIds?`) and `SearchResult` (`chunkPublicId`, `documentPublicId`,
`documentTitle`, `content`, `chunkIndex`, `score`, `category`) — matching spec §5.5's interfaces
verbatim. No DTOs were added, since no controller consumes this service yet (AI-052).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 58 warnings (unchanged from the prior baseline — no new warning
  categories or instances introduced by this issue)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- search.service` — 11/11 pass
- `npm run test` (full suite) — 368/368 pass (up from 357, +11 new tests, zero regressions)

## Assumptions Made

- **`documentId` filter uses Pinecone's `$in` operator** (`{ documentId: { $in: [...] } }`) rather
  than a single equality filter — the spec's `SearchOptions.documentIds` is explicitly an array, and
  Pinecone's metadata filtering syntax supports `$in` for exactly this "narrow to any of these
  values" case; not otherwise stated in the spec text, but it's the standard Pinecone filter idiom
  for an array-valued match.
- **The similarity threshold is applied before the Postgres join, not after** — an unstated
  ordering choice, but the more efficient one (avoids querying for chunks whose results will be
  discarded anyway) and has no observable behavioral difference from applying it after, since
  filtering is a pure predicate either way.
- **A Pinecone match with no corresponding `document_chunks` row is silently dropped**, not
  treated as an error — covers the edge case of a stale vector left behind by a partial/failed
  ingestion or a race with `deleteByFilter()`; the codebase's established degrade-gracefully
  convention (`ToolExecutorService`, `DocumentService.ingestDocument()`'s catch-and-mark-failed)
  extends naturally here rather than surfacing a 500 for what is, from the caller's perspective, a
  worse-than-useless result to fail loudly on.

## Follow Ups

- AI-046 (`RagService.query()`) is the next consumer — it will call `search()` to retrieve context
  chunks before generating an answer.
- AI-052 (`RagController` — search + ask endpoints) will add the request/response DTOs
  (`SearchOptions`/`SearchResult` currently have no Swagger-annotated counterparts) once the actual
  `POST /rag/search` route lands.
