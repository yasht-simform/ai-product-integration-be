---
title: Vector Search & RAG
status: completed
created: 2026-07-08
last_updated: 2026-07-10
phase: 3
tags:
  - rag
  - embeddings
  - pinecone
  - langchain
  - semantic-search
  - mock-data
authors:
  - Yash Trivedi
---

# Vector Search & RAG

## Problem Statement

Phases 1 and 2 gave the application everything needed to _talk_ to an LLM — single-shot completions,
multi-turn conversations, streaming, and function calling — but every answer still comes exclusively from
the model's training data. There is no way for the application to ground an answer in a specific set of
documents the developer controls. That is the single most valuable enterprise AI pattern (Retrieval-Augmented
Generation), and the codebase has no embedding generation, no vector storage, no chunking pipeline, and no
retrieval-then-generate orchestration to support it.

From the **developer's learning perspective**, this phase teaches:

- How text becomes a vector (embeddings) and why cosine similarity between vectors approximates semantic
  similarity between the underlying text
- How to split long documents into overlapping chunks so that no single embeddable unit exceeds a sane
  token budget while still preserving the surrounding context an LLM needs to answer correctly
- How a managed vector database (Pinecone) fits into a bigger system: what belongs in the vector store
  (embeddings + minimal metadata) versus what belongs in a relational database (full text, provenance,
  lifecycle state)
- How to compose a full RAG loop — embed the question, retrieve the nearest chunks, inject them into a
  prompt, generate a grounded answer with citations — using only Phase 1/2 primitives (`OpenaiService`,
  `TokenService`, `AiAuditService`) rather than an opaque framework chain
- Where a document-processing library like LangChain earns its keep (parsing, splitting) versus where its
  higher-level abstractions (chains, agents, vector-store wrappers) would hide exactly the retry/audit/cost
  behavior Phase 1 spent an entire phase building
- How to evaluate a RAG system quantitatively — generating a labeled Q&A set and measuring answer accuracy
  by question complexity instead of eyeballing a few manual queries

From the **system's technical perspective**, Phase 3 fills the following gaps:

- No embedding generation anywhere in the codebase — `OpenaiService` only exposes chat completions
- No vector storage or similarity search — nothing in Prisma/PostgreSQL is suited to nearest-neighbor
  search over high-dimensional vectors
- `EmbeddingCache` exists in `schema.prisma` from the original Phase 1 scaffold but has never been read from
  or written to by any service, and its current shape (`id String @default(cuid())`, no `publicId`, no
  `tokenCount`) predates and doesn't match the BigInt-PK + `publicId` convention every other table in this
  codebase follows
- No document ingestion, chunking, or metadata-tracking pipeline
- No semantic search or RAG orchestration layer
- No mechanism to generate realistic test data at the volume needed to evaluate a retrieval system
  meaningfully (a handful of manually-written documents can't surface retrieval quality problems the way
  50+ documents with overlapping topics can)

---

## Solution

A new `RagModule` (`src/modules/rag/`) composed of seven services and one controller, importing
`OpenaiModule` (Phase 1) for generation/embeddings and optionally `AiChatModule` (Phase 2) for
conversation-integrated RAG — following the exact one-way dependency direction Phase 2 established
(`RagModule` → `OpenaiModule`/`AiChatModule`, never the reverse).

**Module architecture:**

```
RagModule
├── EmbeddingService          ← generates embeddings via OpenAI/OpenRouter embedding models
├── EmbeddingCacheService     ← hash-based embedding dedup (reads/writes the realigned embedding_cache table)
├── DocumentService           ← document CRUD, chunking pipeline, ingestion orchestration
├── PineconeService           ← Pinecone client wrapper: upsert, query, delete vectors
├── SearchService             ← semantic search: query → embedding → Pinecone → ranked, filtered results
├── RagService                ← full RAG orchestration: search + augment + generate with citations
├── MockDataService           ← faker-based document + Q&A pair generation, for pipeline evaluation
└── RagController             ← REST endpoints: documents, search, ask, mock data, evaluation, stats
```

**Service responsibilities and boundaries:**

- **`EmbeddingService` never calls the OpenAI SDK directly.** Mirroring Phase 2's
  `chatCompletionWithMessages()` decision exactly: `OpenaiService` gains new methods —
  `generateEmbedding(text)` / `generateEmbeddingsBatch(texts[])` — that reuse the existing
  `RetryService` (backoff, circuit breaker) and `AiAuditService.log()` pipeline, tagged with
  `OpenaiEndpoint.EMBEDDINGS` (the enum value already exists, unused, from Phase 1's scaffold).
  `RagModule`'s `EmbeddingService` is a thin wrapper around this — it owns nothing SDK-related, only the
  cache-check-then-call sequencing and dimension bookkeeping.
- **`EmbeddingCacheService`** owns the hash-based dedup layer. It is the only service that reads/writes the
  `embedding_cache` table.
- **`PineconeService`** is the single boundary to the Pinecone SDK — no other service imports
  `@pinecone-database/pinecone` directly. Its contract (`upsert`/`query`/`deleteByIds`/`deleteByFilter`/
  `describeIndex`) is intentionally narrow: vector CRUD only, no business logic.
- **`DocumentService`** owns the PostgreSQL side of a document's lifecycle (metadata, chunk rows,
  `embeddingStatus` transitions) and drives the ingestion pipeline end to end, calling
  `EmbeddingService`/`EmbeddingCacheService`/`PineconeService` in sequence per spec §2.2. It uses
  LangChain's document loaders (`PDFLoader`, `TextLoader`) and `RecursiveCharacterTextSplitter` as pure
  utilities — parsing and chunking only, no LangChain chain/agent abstraction anywhere in this module.
- **`SearchService`** is stateless orchestration: embed the query, ask `PineconeService` for the nearest
  vectors, join the returned chunk IDs back against PostgreSQL for the actual text, filter by
  `similarityThreshold`, and shape the result.
- **`RagService`** is the top-level orchestrator — it calls `SearchService` for retrieval and
  `OpenaiService.chatCompletionWithMessages()` (Phase 2's extension point) for generation, building the
  augmented prompt from `RAG_CONFIG.systemPrompt` + retrieved chunks + the user's question.
  `queryWithConversation()` is the one place `RagModule` reaches into Phase 2: it calls
  `ChatService.buildContext()` to get existing conversation history, splices in retrieved chunks as
  additional context, and persists the turn through `ChatService`'s existing message-append methods rather
  than duplicating persistence logic.
- **`MockDataService`** is a pure data-generation service — `@faker-js/faker` for structure, no LLM calls,
  no external API — so it is fast, free, and deterministic enough to run in a test/seed context without
  budget concerns.

**Data flow — ingestion (one-time per document):**

```
RagController.uploadDocument() / createFromText()
  → DocumentService.create()                                    [persist document row, status: 'pending']
  → DocumentService.ingestDocument(publicId)
      → parse (pdf-parse / LangChain TextLoader)
      → chunk (LangChain RecursiveCharacterTextSplitter, CHUNKING_CONFIG)
      → for each chunk:
          → EmbeddingCacheService.get(hash) → hit: reuse | miss: EmbeddingService.generateEmbedding()
          → EmbeddingCacheService.set(hash, embedding, model)   [on miss]
          → PineconeService.upsert(chunkId, embedding, metadata)
          → persist DocumentChunk row
      → update document.embeddingStatus = 'completed', totalChunks, totalTokens
```

**Data flow — RAG query:**

```
RagController.ask()
  → RagService.query(question, options)
      → SearchService.search(question, options)
          → EmbeddingService.generateEmbedding(question)
          → PineconeService.query(embedding, topK, filter)
          → join chunk IDs → PostgreSQL → filter by similarityThreshold
      → build augmented messages: [system: RAG_CONFIG.systemPrompt, user: context + question]
      → OpenaiService.chatCompletionWithMessages(messages)
      → shape RagResult: answer, sources[], usage, estimatedCost, latencyMs breakdown
```

**Integration with existing modules:**

- `RagModule` imports `OpenaiModule` for `OpenaiService` (generation + new embeddings methods),
  `TokenService` (chunk sizing, embedding cost), `AiAuditService` (already exported — no new audit table),
  and `ModelRegistryService` (embedding model pricing lookup, following the same DB → `MODEL_PRICING` →
  `0` fallback chain `TokenService.calculateCost()` already implements).
- `RagModule` imports `AiChatModule` for `ChatService`, used only by `RagService.queryWithConversation()`.
- `DatabaseModule` is global — `DocumentService` and `EmbeddingCacheService` inject `DatabaseService`
  directly, same as every other module.
- Every embedding call is audited through the same `ai_audit_logs` table Phase 1/2 already write to — no
  new audit infrastructure.

---

## Epic Breakdown

### Epic 1: Database Schema & Configuration Foundation

**Goal**

Add `documents` and `document_chunks` to `schema.prisma` with the cascade-delete relation and indexes from
spec §3, realign the existing `EmbeddingCache` model to the codebase's BigInt-PK + `publicId` convention
(adding the `tokenCount` field spec §3.3 expects), extend `pineconeConfig` (currently only `apiKey`/`index`)
with `namespace`, and add a new `rag`/`embedding` config namespace plus their env vars.

**Stories Included**

- Stories 1–7

**Dependencies**

- None — foundation epic, same pattern as Phase 1 Epic 1 and Phase 2 Epic 1

**Risks**

- `EmbeddingCache` has never been read/written by any service, so realigning its shape is a safe schema
  change with no data migration risk — but the migration must be double-checked against
  `prisma:migrate:status` to confirm no other branch has already touched this table
- `PINECONE_API_KEY`/`PINECONE_INDEX` are currently _required_ (non-optional, `!`-asserted) in
  `env.validation.ts` even though no code uses them yet — a developer without a Pinecone account cannot
  currently boot the app at all. This phase must decide whether to keep them required (forcing Pinecone
  setup for anyone running the repo) or make them optional with the RAG module degrading gracefully

**Success Criteria**

- Migration applies cleanly via `npm run prisma:migrate`
- Deleting a `documents` row cascade-deletes all its `document_chunks` rows (verified by test, not just
  read from the schema — Phase 2's Epic 1 risk note about `onDelete: Cascade` applies identically here)
- `npx prisma validate` and `npx tsc --noEmit --project tsconfig.build.json` both pass
- New env vars (`PINECONE_NAMESPACE`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BATCH_SIZE`,
  `RAG_TOP_K`, `RAG_SIMILARITY_THRESHOLD`, `RAG_MAX_CONTEXT_TOKENS`, `CHUNK_SIZE`, `CHUNK_OVERLAP`) are all
  validated in `env.validation.ts` with sane defaults, following the `chat` namespace's precedent of
  `@IsOptional()` + fallback rather than hard-requiring every value

---

### Epic 2: OpenaiService Embedding Extension

**Goal**

Add `generateEmbedding(text)` and `generateEmbeddingsBatch(texts[])` to Phase 1's `OpenaiService`, reusing
the existing retry/circuit-breaker/audit pipeline unchanged — the same extension pattern Phase 2 used for
`chatCompletionWithMessages()`. This unblocks `RagModule`'s `EmbeddingService` without giving it direct SDK
access.

**Stories Included**

- Stories 8–12

**Dependencies**

- Phase 1's `OpenaiService`, `RetryService`, `AiAuditService` (all exist, unchanged contracts)
- `OpenAIEndpoint.EMBEDDINGS` (already defined, currently unused)

**Risks**

- Must not change the signature or behavior of `chatCompletion()`/`chatCompletionWithMessages()` — Phase 1
  and Phase 2 callers and tests depend on both staying stable
- Batch embedding calls (`EMBEDDING_CONFIG.batchSize`) must map cleanly onto the OpenAI SDK's
  `embeddings.create()`, which accepts an array `input` natively — no manual batching loop needed inside
  `OpenaiService` itself, only inside the caller if the total exceeds one API call's limit

**Success Criteria**

- Existing Phase 1/2 `OpenaiService` unit tests still pass unmodified
- A new unit test proves `generateEmbedding()`/`generateEmbeddingsBatch()` route through `RetryService`
  and produce an `ai_audit_logs` row shaped identically to chat-completion audit rows except for
  `endpoint: 'embeddings'`
- Returned vectors have the dimension configured for the requested model (1536 for
  `text-embedding-3-small`)

---

### Epic 3: Embedding Cache & Pinecone Client

**Goal**

Implement `EmbeddingCacheService` (SHA-256 hash-based dedup against the realigned `embedding_cache` table)
and `PineconeService` (a narrow wrapper around `@pinecone-database/pinecone`'s upsert/query/delete
operations) — the two foundational integration services every later epic depends on.

**Stories Included**

- Stories 13–20

**Dependencies**

- Epic 1 (schema + Pinecone config), Epic 2 (`OpenaiService.generateEmbedding()` for cache-miss fallback
  inside `EmbeddingCacheService`'s own tests, though the service itself doesn't call it — `DocumentService`
  and `SearchService` orchestrate the get-or-generate sequence)

**Risks**

- Pinecone is a real external network dependency with no free local emulator — unit tests must mock the
  Pinecone client entirely; any live verification is manual only, matching how Phase 2 treated Open-Meteo
- Text normalization for the cache hash (`trim().toLowerCase()`) must be applied identically at both
  `get()` and `set()` call sites, or cache hit rate silently collapses to zero

**Success Criteria**

- Identical text (after normalization) produces a cache hit on the second call, verified by a test
  asserting `EmbeddingService.generateEmbedding()` (and therefore the OpenAI API) is called exactly once
  across two `EmbeddingCacheService`-mediated requests for the same text
- `PineconeService.query()` results are sorted by score descending (delegated to Pinecone itself, but
  asserted against a mocked response)
- `PineconeService.deleteByFilter({ documentId })` is proven to construct the filter Pinecone expects, via
  a unit test against the mocked client call arguments

---

### Epic 4: Document Ingestion Pipeline

**Goal**

Implement `DocumentService`'s full CRUD + ingestion pipeline (spec §5.3): parse (PDF via `pdf-parse`,
TXT/MD directly), chunk with LangChain's `RecursiveCharacterTextSplitter` and overlapping windows, embed
each chunk cache-aware, upsert to Pinecone, persist chunk rows, and update document status.

**Stories Included**

- Stories 21–32

**Dependencies**

- Epic 1 (schema), Epic 2 (embeddings), Epic 3 (cache + Pinecone)

**Risks**

- Chunk boundary overlap (50 tokens) must be verified against actual token counts via
  `TokenService.countTokens()`, not character counts — an off-by-a-lot error here silently degrades
  retrieval quality without throwing
- A 50-page PDF ingestion must complete under NFR-RAG-004's 60-second budget — batching embedding calls
  (`EMBEDDING_CONFIG.batchSize`) rather than embedding one chunk at a time is likely required to hit this
- Reindexing an existing document must delete its old Pinecone vectors and chunk rows before writing new
  ones, or stale vectors accumulate silently

**Success Criteria**

- Uploading a document transitions `embeddingStatus`: `pending` → `processing` → `completed` (or `failed`
  on error, never left stuck in `processing`)
- Adjacent chunks share overlapping content at their boundaries (SC-RAG-009), verified by a test asserting
  the tail of chunk N appears in the head of chunk N+1
- Deleting a document cascade-deletes chunks in PostgreSQL AND removes the corresponding vectors from
  Pinecone (SC-RAG-006) — verified as two separate assertions, since cascade delete only covers the
  PostgreSQL side
- Uploading a non-PDF/TXT/MD file returns a 400, not a 500 or a silently-empty document

---

### Epic 5: Semantic Search & RAG Orchestration

**Goal**

Implement `SearchService` (query → embedding → Pinecone → ranked, threshold-filtered, category-filterable
results) and `RagService` (search + augmented-prompt generation + citation extraction), including
`queryWithConversation()`'s integration with Phase 2's `ChatService`.

**Stories Included**

- Stories 33–42

**Dependencies**

- Epic 3 (Pinecone + embeddings), Epic 4 (chunks must exist to search over)
- Phase 2's `ChatService.buildContext()` (for `queryWithConversation()`)

**Risks**

- `queryWithConversation()` must respect the existing sliding-window token budget (Phase 2's
  `chatConfig.contextWindowPercentage`) when injecting retrieved chunks — naively appending chunks on top
  of an already-full context risks the exact context-length API error Phase 2's Epic 3 was built to avoid
- The RAG system prompt's citation instruction is a prompt-engineering control, not a code guarantee — a
  test can assert the prompt _contains_ the citation instruction, but cannot fully guarantee the model
  complies; this must be documented as a soft requirement, verified by live smoke testing (SC-RAG-003/004)
  rather than a deterministic unit test

**Success Criteria**

- A search for a term found in exactly one uploaded document ranks that document's chunk highest with a
  score above the configured threshold (SC-RAG-002)
- `RagService.query()` on a question with no relevant indexed content returns the configured "I don't have
  enough information" fallback rather than a hallucinated answer sourced from model training data
  (SC-RAG-004) — verified live, since this depends on actual model behavior
- `RagResult` always reports `searchLatencyMs` + `generationLatencyMs` separately, and their sum is close
  to (not necessarily identical to, given orchestration overhead) `latencyMs`

---

### Epic 6: Mock Data Generation & Evaluation

**Goal**

Implement `MockDataService` (faker-based structured document generation across 5 categories, three-tier
complexity Q&A pair generation) and the evaluation endpoint that runs generated Q&A pairs through the RAG
pipeline and scores accuracy by complexity tier.

**Stories Included**

- Stories 43–49

**Dependencies**

- Epic 4 (documents must be ingestible), Epic 5 (RAG query must work end-to-end for evaluation to run
  against it)

**Risks**

- "10K+ Q&A pairs" at evaluation time means 10K+ live RAG queries if evaluation is run against the full
  set — each involving an embedding call, a Pinecone query, and an LLM generation call. This is a real cost
  and time budget concern that must be surfaced to the developer (e.g. evaluation defaults to a manageable
  sample size, with the full 10K+ generation being a data-generation-only operation, not something run
  through evaluation by default)
- Faker-generated "realistic" structure is a judgment call with no automated correctness check — success
  here is closer to "a human skimming the output agrees it looks like a real doc" than a strict assertion

**Success Criteria**

- `generateDocuments(10)` produces 10 documents spanning multiple categories with headings/paragraphs, not
  flat unstructured text (SC-RAG-007)
- Evaluation against a seeded default dataset reports accuracy broken down by complexity tier, with simple
  questions scoring meaningfully higher than edge-case questions (directionally consistent with SC-RAG-008,
  not a hard-coded pass threshold since actual accuracy depends on the live model)

---

### Epic 7: API Layer, DTOs, Swagger & Tests

**Goal**

Expose every endpoint from spec §6 (documents, search, ask, mock data, evaluation, stats) with
`class-validator` DTOs and `@ApiEndpoint()` Swagger documentation, plus full test coverage across all seven
services following Phase 1/2's established mocking conventions.

**Stories Included**

- Stories 50–55

**Dependencies**

- All prior epics (this is the surface over everything else)

**Risks**

- Multipart file upload (`POST /rag/documents`) needs `@nestjs/platform-express`'s `FileInterceptor` —
  verify it's compatible with the existing global `ValidationPipe`/`ResponseInterceptor` setup, since no
  prior endpoint in this codebase has accepted file uploads
- `pdf-parse` and LangChain's loaders both do real file-system/buffer work that's awkward to unit test —
  tests should mock at the `DocumentService` boundary (mock the loader/splitter modules) rather than
  round-tripping real PDF binaries through Jest

**Success Criteria**

- All endpoints appear in Swagger at `/api/docs` under a `rag` tag
- Uploading an unsupported file type returns 400 via the global validation pipe, not a raw exception
- `npm run test` passes with new spec files for all seven services + `RagController`, following
  `jest-mock-extended`'s `DeepMockProxy<DatabaseService>` pattern and the `DatabaseService`-jest-mock-at-
  module-level requirement documented in `CLAUDE.md`
- `npx tsc --noEmit --project tsconfig.build.json` passes with zero `any` types introduced

---

## User Stories

1. As a developer, I want to upload a PDF, TXT, or MD file and have it stored as a `documents` row with
   `embeddingStatus: 'pending'`, so that ingestion can proceed asynchronously from the upload response.
2. As a developer, I want to create a document directly from raw text (no file), so that I can seed
   knowledge-base content programmatically without round-tripping through a file upload.
3. As a developer, I want to upload a file of an unsupported type (e.g. `.docx`) and receive a 400, so that
   the ingestion pipeline never receives content it can't parse.
4. As a developer, I want to list documents with pagination and filters (category, status, tags), so that I
   can browse a growing knowledge base without loading everything at once.
5. As a developer, I want to fetch a single document and see its chunk count and embedding status, so that
   I can monitor ingestion progress for a specific upload.
6. As a developer, I want to update a document's title, description, category, or tags without re-running
   ingestion, so that metadata corrections don't cost an embedding re-generation.
7. As a developer, I want to delete a document and have its chunks removed from PostgreSQL AND its vectors
   removed from Pinecone, so that no orphaned vectors keep matching search queries after deletion.
8. As a developer, I want `OpenaiService.generateEmbedding()` to reuse the existing retry/circuit-breaker
   logic, so that transient embedding API failures degrade the same way chat completion failures already
   do, rather than needing a second retry implementation.
9. As a developer, I want every embedding API call logged in `ai_audit_logs` with `endpoint: 'embeddings'`,
   so that embedding costs are visible in the same cost-tracking system as chat completions.
10. As a developer, I want `generateEmbeddingsBatch()` to embed multiple chunks in one API call (up to
    `EMBEDDING_CONFIG.batchSize`), so that ingesting a large document doesn't make one HTTP round-trip per
    chunk.
11. As a developer, I want an embedding call that trips the existing circuit breaker to fail fast with the
    same `CircuitOpenException` chat completions already use, so that a struggling embeddings endpoint
    doesn't silently retry into a cascading slowdown.
12. As a developer, I want embedding cost to be calculated through the same DB → `MODEL_PRICING` → `0`
    fallback chain `TokenService.calculateCost()` already implements for chat models, so that a
    newly-added embedding model without registry pricing still returns a `0` cost instead of throwing.
13. As a developer, I want identical text submitted for embedding twice to hit the cache on the second
    call, so that re-indexing an unchanged document costs zero additional embedding API calls.
14. As a developer, I want the cache key to be based on normalized (trimmed, lowercased) text, so that
    trivial whitespace differences don't cause unnecessary cache misses.
15. As a developer, I want to flush the embedding cache when I change `EMBEDDING_MODEL`, so that stale
    vectors from a retired model are never served as if they were computed with the new one.
16. As a developer, I want cache hit/miss counts exposed via the stats endpoint, so that I can verify the
    cache is actually reducing embedding spend during large ingestion runs.
17. As a developer, I want `PineconeService.upsert()` to accept a batch of vectors with metadata in one
    call, so that ingesting a multi-chunk document doesn't make one Pinecone API call per chunk.
18. As a developer, I want `PineconeService.query()` to return matches sorted by cosine similarity
    descending, so that the top result is always the single most relevant chunk.
19. As a developer, I want to delete all vectors for a document by metadata filter in one call, so that
    document deletion doesn't require enumerating every chunk's vector ID individually.
20. As a developer, I want `PineconeService.describeIndex()` to report vector count and dimension, so that
    the stats endpoint can surface real index health instead of only PostgreSQL-side counts.
21. As a developer, I want a document to be chunked using overlapping windows (50-token overlap on
    500-token chunks), so that a sentence spanning a chunk boundary is still fully captured in at least one
    chunk.
22. As a developer, I want each chunk's token count computed via `TokenService.countTokens()` (not a
    character estimate), so that chunk sizing decisions are accurate against the actual model tokenizer.
23. As a developer, I want the ingestion pipeline to check the embedding cache before calling the embedding
    API for every chunk, so that re-ingesting a document with mostly-unchanged content is fast and cheap.
24. As a developer, I want each successfully embedded chunk persisted with its `pineconeId`, so that a
    chunk row can always be traced back to its vector for debugging or manual deletion.
25. As a developer, I want a document's `embeddingStatus` to move through `pending` → `processing` →
    `completed`, so that a client polling `GET /rag/documents/:publicId` can show ingestion progress.
26. As a developer, I want a document's `embeddingStatus` to become `failed` (not stuck at `processing`) if
    ingestion errors partway through, so that a broken ingestion is visibly recoverable rather than silently
    stalled.
27. As a developer, I want to trigger `reindexDocument()` on an existing document, so that I can regenerate
    chunks and embeddings after changing chunking configuration, without deleting and re-uploading the
    source file.
28. As a developer, I want reindexing to clean up the previous chunks/vectors before writing new ones, so
    that a reindexed document never ends up with duplicate or stale vectors alongside the fresh ones.
29. As a developer, I want to fetch a document's chunks paginated, so that I can inspect exactly what text
    was indexed for debugging retrieval quality issues.
30. As a developer, I want ingesting a 50-page PDF to complete in under 60 seconds, so that document upload
    feels responsive rather than like a background job I have to babysit.
31. As a developer, I want to upload 50 documents in sequence without hitting embedding API rate limits, so
    that bulk ingestion (e.g. seeding a knowledge base) doesn't require manual throttling on my part.
32. As a developer, I want PDF text extraction to fail gracefully with a clear error (not a crash) on an
    image-only/scanned PDF, so that an unsupported input produces an actionable `failed` status instead of
    an unhandled exception.
33. As a developer, I want to run a semantic search for a natural-language query and get back ranked chunks
    with similarity scores, so that I can verify retrieval quality independent of the generation step.
34. As a developer, I want search results below the configured similarity threshold excluded from the
    response, so that a query with no genuinely relevant content returns few or zero results instead of
    padding out with barely-related chunks.
35. As a developer, I want to filter search results by document category, so that I can scope a query to
    (for example) only FAQ documents.
36. As a developer, I want to filter search results to a specific set of document IDs, so that I can build
    a "search within this document" feature on top of the same search service.
37. As a developer, I want `RagService.query()` to build a prompt that instructs the model to answer only
    from the provided context and to cite its sources, so that answers are grounded rather than blended
    with the model's own training data.
38. As a developer, I want a RAG answer to include structured `sources` (document title, chunk content,
    similarity score), so that a UI can render "based on these documents" alongside the generated answer.
39. As a developer, I want a question with no relevant indexed content to produce the configured
    "I don't have enough information" response rather than a fabricated answer, so that the system fails
    safely instead of hallucinating.
40. As a developer, I want `RagResult` to report `searchLatencyMs` and `generationLatencyMs` separately, so
    that I can tell whether a slow RAG response is a retrieval problem or a generation problem.
41. As a developer, I want to ask a question within an existing chat conversation and have the RAG-retrieved
    context injected alongside that conversation's history, so that follow-up questions like "tell me more
    about that" work correctly against both the documents and the prior turns.
42. As a developer, I want RAG-augmented conversation turns to still respect the sliding-window token
    budget from Phase 2, so that injecting retrieved chunks into a long conversation never triggers a
    context-length API error.
43. As a developer, I want to generate N realistic mock documents across multiple categories (guide, FAQ,
    docs, tutorial, changelog), so that I can populate a demo knowledge base without hand-writing content.
44. As a developer, I want generated documents to have real structure (headings, paragraphs, varied length),
    so that they exercise the chunking pipeline the same way genuine documents would.
45. As a developer, I want to generate Q&A pairs for existing documents split across three complexity tiers
    (simple, multi-step, edge-case), so that evaluation can measure accuracy across a realistic difficulty
    spread, not just easy lookups.
46. As a developer, I want a one-call "seed default dataset" endpoint that generates a full document + Q&A
    set and ingests it, so that I can get a working, evaluable RAG system running without a dozen manual
    steps.
47. As a developer, I want to list previously generated Q&A pairs, so that I can inspect what an evaluation
    run will actually test before spending API budget on it.
48. As a developer, I want to run an evaluation over a Q&A set and get back accuracy broken down by
    complexity tier, so that I can see where the RAG pipeline is weakest (e.g. good at simple facts, poor
    at multi-step reasoning).
49. As a developer, I want an evaluation run over a very large Q&A set to be boundable (e.g. a sample size
    or explicit count), so that "evaluate everything" doesn't silently trigger tens of thousands of paid or
    rate-limited API calls.
50. As a developer, I want every RAG endpoint documented in Swagger under a `rag` tag using the existing
    `@ApiEndpoint()` decorator, so that the API surface stays discoverable and consistent with Phase 1/2's
    modules.
51. As a developer, I want file upload validated by `class-validator`/`ValidationPipe` the same way every
    other endpoint's body is validated, so that a malformed multipart request fails predictably with a 400.
52. As a developer, I want unit tests for all seven RAG services that mock `DatabaseService`, the OpenAI
    SDK boundary, and the Pinecone client, so that the test suite runs without live network calls or a real
    vector index.
53. As a developer, I want a test proving document deletion issues both the PostgreSQL cascade delete and
    the Pinecone `deleteByFilter` call, so that the two-system deletion cascade (FR-RAG-009) is verified
    structurally, not just documented.
54. As a developer, I want a regression check that Phase 1/2's existing `OpenaiService` tests still pass
    unmodified after adding the embeddings methods, so that Phase 3 provably doesn't break Phase 1/2.
55. As a developer, I want the RAG endpoints' embedding stats (`GET /rag/stats`) to report total documents,
    chunks, Pinecone vector count, and cache hit rate in one call, so that I can sanity-check the whole
    pipeline's health without querying three different systems by hand.

---

## Implementation Decisions

- **`EmbeddingService` never calls the OpenAI SDK directly.** Exactly like Phase 2's
  `chatCompletionWithMessages()` decision: embeddings go through new `OpenaiService` methods so retry,
  circuit-breaker, and audit behavior stay identical across every LLM-adjacent call in the app, and
  `RagModule` never needs its own copy of that logic.
- **Pinecone SDK used directly, not through LangChain's vector-store wrapper.** Full control over upsert
  shape, metadata filtering, and deletion-by-filter — the same "avoid a framework abstraction that hides
  the underlying call" reasoning Phase 2 applied to skipping LangChain's chains/agents.
- **LangChain is a utility, not the backbone.** Only document loaders and `RecursiveCharacterTextSplitter`
  are used. No chain, agent, memory, or vector-store abstraction from LangChain appears anywhere in
  `RagModule` — `RagService` owns orchestration directly, matching this codebase's Phase 1/2 precedent of
  never letting a third-party framework own the retry/audit/cost-tracking seam.
- **PostgreSQL stores text, Pinecone stores vectors.** `document_chunks.content` is the source of truth for
  chunk text; Pinecone's payload carries only the vector plus minimal metadata needed for filtering
  (documentId, category, chunkIndex). Search always resolves chunk IDs from Pinecone back to PostgreSQL for
  the actual text — Pinecone is never treated as a text store.
- **`EmbeddingCache` is realigned to this codebase's BigInt-PK + `publicId` convention** (matching
  `AiAuditLog`/`AiModel`/every Phase 2 table) rather than kept in its original `cuid()`-only shape, since it
  has never been used by any service and a pre-launch schema correction has zero migration risk.
- **SHA-256 over normalized text for cache keys**, with no automatic expiration — embeddings for identical
  text under the same model are permanently valid; the only invalidation path is a manual flush, deliberately
  simple compared to a TTL-based cache.
- **Chunking uses overlapping windows (50 of 500 tokens)** to avoid losing context at a chunk boundary —
  documented in the spec as the direct fix for "a sentence spans two chunks" information loss.
- **RAG generation reuses `OpenaiService.chatCompletionWithMessages()` (Phase 2), not a new completion
  path** — the augmented prompt is just another message array, so no new LLM-calling code is needed in
  `RagModule` beyond building that array.
- **Low temperature (0.3) default for RAG generation** — factual, context-grounded answers benefit from
  reduced sampling randomness; this mirrors the spec's own stated rationale and should not be silently
  overridden by a higher application-wide default.
- **The RAG system prompt explicitly forces citations and an "I don't know" fallback** — a prompt-level
  control, not a code-level guarantee; Testing Decisions below treats compliance as something verified live,
  not asserted deterministically in a unit test.
- **`queryWithConversation()` is additive to Phase 2's `ChatService`, never a fork of it.** It calls
  `ChatService.buildContext()` for existing history and reuses `ChatService`'s message-persistence methods,
  so a RAG-augmented conversation is stored and replayable through the exact same `chat_messages` table
  Phase 2 already built — no parallel conversation-storage concept is introduced.
- **Mock data generation is faker-only, never LLM-generated.** Reproducible, free, and fast — critical
  since the target volume (10K+ Q&A pairs) would be cost-prohibitive and non-deterministic if generated by
  an LLM.
- **Evaluation runs are explicitly bounded**, not "run against every generated Q&A pair by default" — given
  each evaluated question costs one embedding call, one Pinecone query, and one generation call, an
  unbounded default against a 10K+ pair dataset is a budget and rate-limit hazard, not a reasonable default.

---

## Testing Decisions

- **Unit test seam is service-level**, matching Phase 1/2: each of the seven `RagModule` services
  (`EmbeddingService`, `EmbeddingCacheService`, `DocumentService`, `PineconeService`, `SearchService`,
  `RagService`, `MockDataService`) is tested in isolation with `jest-mock-extended`'s
  `DeepMockProxy<DatabaseService>` and a mocked `OpenaiService`/`OPENAI_CLIENT`.
- **`DatabaseService` must be jest-mocked at the module level** in every new spec file, per `CLAUDE.md`'s
  documented Jest/ESM incompatibility with the generated Prisma client — non-negotiable boilerplate, not
  optional.
- **Pinecone is mocked at the SDK boundary** (`@pinecone-database/pinecone`'s client, mirroring how
  `OpenRouterSyncService`'s tests mock `HttpService` via `rxjs`'s `of()`) — no test in this suite makes a
  real Pinecone API call, since there is no free local emulator and live calls would make CI flaky and
  cost-bearing.
- **LangChain loaders/splitters are exercised for real where cheap** (e.g.
  `RecursiveCharacterTextSplitter` against an in-memory string needs no I/O and no mocking) but **PDF
  parsing is tested against a small fixture buffer**, not mocked away entirely, so the actual `pdf-parse`
  integration is proven at least once rather than assumed correct.
- **Embedding generation is mocked at the `OPENAI_CLIENT`/`OpenaiService` boundary** — no test calls a real
  embeddings API; vectors used in tests are small fixed-dimension arrays, not real 1536-dimension output,
  since only shape and cache/dedup behavior matter for correctness, not actual semantic content.
- **RAG orchestration gets one integration-style test** (mirroring Phase 2's function-calling integration
  test) that wires real `SearchService`/`RagService` logic against a mocked Pinecone response and a mocked
  `chatCompletionWithMessages()` response, asserting the final answer includes the expected citation and
  that exactly the expected number of `ai_audit_logs` rows are produced (one embedding, one generation).
- **Controller-level tests** validate DTOs via `class-validator`'s `validate()` directly and mock every
  service, following `openai.controller.spec.ts`'s established pattern rather than spinning up a full Nest
  application — except where multipart file upload wiring needs to be proven, which is deferred to a live
  smoke test (matching Phase 2's precedent of deferring SSE transport specifics to live verification).
- **Mock-data and evaluation logic is tested deterministically** by seeding `@faker-js/faker` or asserting
  on structural properties (has headings, has the right category distribution, complexity-tier percentages
  land in the expected ranges) rather than asserting exact generated text.
- **Regression coverage**: existing Phase 1/2 `OpenaiService`, `ChatService` spec files must be re-run and
  pass unmodified after the embeddings methods and `queryWithConversation()` integration are added, proving
  both extensions are additive.
- **No live OpenAI, Pinecone, or Postgres calls in the automated test suite.** Ingesting a real PDF,
  querying a real Pinecone index, and running a full live evaluation are all manual verification steps
  (per spec §14's test scenarios), not CI gates — consistent with how Phase 2 treated Open-Meteo and live
  OpenRouter model flakiness.

---

## Out of Scope

Restated from the requirement specification (§15):

- **Image/table extraction from PDFs** — only text content is extracted
- **OCR for scanned PDFs** — PDFs must be text-based, not image-based
- **Real-time document sync** — documents are manually uploaded, not synced from external sources
- **Document versioning** — upload a new version = delete old + upload new
- **Multi-language support** — English only for embeddings and search
- **Hybrid search** (keyword + vector) — pure vector search only in this phase
- **Re-ranking models** — results ranked by cosine similarity only, no cross-encoder re-ranking
- **Streaming RAG answers** — the answer is returned complete, not streamed (can be layered on later via
  Phase 2's streaming endpoint)
- **Authentication on RAG endpoints** — unguarded like Phase 1 and 2

---

## Further Notes

- **Assumption**: a free or trial Pinecone account/index (dimension 1536, cosine metric) is available to the
  developer before this phase's live verification can run — this is an external account-setup dependency,
  not something the codebase can provision automatically.
- **Assumption**: `OpenaiService.generateEmbedding()` works through the same `OPENAI_BASE_URL` override
  Phase 1 established for OpenRouter, so embeddings can be tested against a free/cheap OpenRouter-hosted
  embedding model rather than requiring a paid OpenAI key — this should be confirmed early, since not every
  OpenRouter provider necessarily exposes an embeddings endpoint the same way it exposes chat completions.
- **Risk**: Pinecone, like Open-Meteo and OpenRouter free models before it, has no SLA on its free tier —
  live RAG test scenarios (SC-RAG-001 through SC-RAG-012) are inherently flakier than the fully-mocked unit
  suite and should not gate CI, consistent with how Phase 2 treated its own external-API test scenarios.
- **Risk**: the `EmbeddingCache` schema realignment (Epic 1) touches a table that predates this phase —
  worth double-checking no other in-flight branch depends on its current `cuid()`-based shape before the
  migration lands.
- **Risk**: generating and then evaluating against 10K+ Q&A pairs is a genuine cost and time concern if not
  explicitly bounded (see Epic 6's risk note) — this should be called out clearly in whatever
  implementation-time issue covers the evaluation endpoint, not discovered after a large accidental API
  bill.
- **Future phase consideration**: `queryWithConversation()`'s context-injection point is exactly the
  extension point Phase 2's own PRD flagged in advance ("the sliding-window algorithm should be written
  with that extension point in mind") — this phase is where that anticipated need actually lands.

---

## Tracking

Status: ready-for-agent

Issues: `docs/issues/AI-036` through `docs/issues/AI-055` (20 issues, see `docs/issues/index.md` for the
full table with dependencies). Epic mapping:

- Epic 1 (Database Schema & Configuration Foundation): AI-036, AI-037
- Epic 2 (OpenaiService Embedding Extension): AI-038
- Epic 3 (Embedding Cache & Pinecone Client): AI-039, AI-040
- Epic 4 (Document Ingestion Pipeline): AI-041, AI-042, AI-043, AI-044
- Epic 5 (Semantic Search & RAG Orchestration): AI-045, AI-046, AI-047
- Epic 6 (Mock Data Generation & Evaluation): AI-048, AI-049, AI-050
- Epic 7 (API Layer, DTOs, Swagger & Tests): AI-051, AI-052, AI-053, AI-054, AI-055

Dependencies:

- `OpenaiModule` (Phase 1) — `OpenaiService` (extended with embeddings), `TokenService`, `RetryService`,
  `AiAuditService`, `ModelRegistryService`
- `AiChatModule` (Phase 2) — `ChatService` (for `queryWithConversation()` only)
- `DatabaseModule` (global) — Prisma access for `documents`/`document_chunks`/realigned `embedding_cache`
- `AppLoggerService` (global)
- `ConfigModule` (global) — extended `pinecone` namespace, new `rag`/`embedding` config namespace
- New npm dependencies: `@pinecone-database/pinecone`, `langchain`, `@langchain/openai`,
  `@langchain/community`, `pdf-parse`, `@faker-js/faker` (none currently installed)

Open Questions:

- Should `PINECONE_API_KEY`/`PINECONE_INDEX` remain hard-required in `env.validation.ts` (blocking app boot
  without a Pinecone account) or become optional with `RagModule` degrading gracefully when unset? (Current
  recommendation: make optional, since Phase 1/2 both boot without any AI-provider-specific hard
  requirement beyond the OpenAI key itself, and RAG is an additive capability, not core to the app.)
- Should the evaluation endpoint's default sample size be explicitly capped (e.g. 100 questions) with an
  opt-in override for a full run, or should the caller always specify a count? (Current recommendation:
  default to a small bounded sample, require an explicit count for anything larger, given the cost
  implications noted above.)
- Should `RagService.queryWithConversation()` persist the retrieved-chunks context as its own message type,
  or fold it into the existing system/user message shapes `ChatService` already supports? The spec doesn't
  specify a new `chat_messages.role` value for this, so the simpler default is folding it into the existing
  user-message content rather than introducing a new role Phase 2's schema doesn't have.

Related PRDs:

- [Chat Completions, Streaming & Function Calling](./2026-07-06-chat-streaming-function-calling.md) —
  Phase 2, direct dependency (`ChatService.buildContext()` for `queryWithConversation()`)
- [OpenAI API Foundations](./2026-06-25-openai-api-foundations.md) — Phase 1, direct dependency
  (`OpenaiService`, `RetryService`, `TokenService`, `AiAuditService`, `ModelRegistryService`)
