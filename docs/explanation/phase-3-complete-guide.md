# Phase 3: Vector Search & RAG — Complete Guide

> Reference document for `src/modules/rag/`, plus the two methods Phase 3 added to
> `src/modules/openai/services/openai.service.ts`. Written against the code as it exists on
> `feat/openai-api-setup`. If the code and this doc ever disagree, trust the code and update this
> file. Companion to [`phase-1-complete-guide.md`](./phase-1-complete-guide.md) and
> [`phase-2-complete-guide.md`](./phase-2-complete-guide.md) — read those first if you haven't;
> this phase is built entirely on top of both.

---

## What I Built (Non-Technical Summary)

Phase 1 built the switchboard — a reliable way to place one call to an AI model. Phase 2 turned
that into a notebook — a conversation the model remembers, that can stream and use tools. Phase 3
gives the model something neither of those could: **its own library**.

Until now, every answer the model gave came exclusively from what it memorized during training.
Ask it about your company's return policy, and it either says "I don't know" or — worse —
confidently makes something up that sounds plausible but is wrong. Phase 3 fixes this with
**Retrieval-Augmented Generation (RAG)**: before the model answers, the app searches a library of
_your own documents_, pulls out the most relevant passages, hands them to the model, and says
"answer using only this." The model stops guessing and starts reading.

### What is RAG, and why it's the most valuable AI pattern for enterprises

Think of the difference between asking a brilliant new hire a question cold, versus handing them
the exact three pages of the employee handbook that answer it, then asking. The first produces a
confident-sounding guess. The second produces a grounded, citable answer — and if the handbook
doesn't cover it, the hire can honestly say so instead of inventing an answer to seem helpful.
That's RAG: **R**etrieve the relevant material, **A**ugment the prompt with it, then **G**enerate
the answer. It's the single most valuable AI integration pattern for a real business, because
almost every enterprise AI use case ("answer questions about our docs," "search our internal
wiki," "summarize this contract against our policy") is really just RAG wearing a different
outfit.

### What are embeddings — turning text into numbers you can compare

A computer can't tell that "car" and "automobile" mean roughly the same thing by looking at the
letters — they share zero characters in common. An **embedding** solves this by converting a
chunk of text into a long list of numbers (1,536 of them, for the model this project uses) that
represents its _meaning_ as a point in space. Text with similar meaning ends up as points that are
close together in that space, regardless of which words were actually used. "How do I return an
item?" and "What is your refund policy?" become two nearby points, even though they don't share a
single word.

### Semantic search vs. keyword search

A keyword search for "car" only finds documents containing the literal string "car" — it would
miss a document that only says "automobile." A **semantic search** compares the _embedding_ of
your query against the embeddings of every stored chunk and returns whichever chunks are
mathematically closest in meaning — "car" finds "automobile" because their embeddings land near
each other in that 1,536-dimensional space, even with zero shared vocabulary. This is the search
Phase 3 builds.

### Why Pinecone — a database built for "how similar," not "what matches exactly"

PostgreSQL is superb at "give me the row where `id = 5`" or "give me every row where `category =
'faq'`" — exact matches on structured fields. It has no efficient way to answer "give me the 5
rows whose 1,536-number vector is closest to _this_ 1,536-number vector" across millions of rows —
that's a fundamentally different kind of search (nearest-neighbor search in high-dimensional
space), and it needs a database purpose-built for it. **Pinecone** is that database: you hand it a
vector, it hands back the closest vectors it has stored, ranked by similarity, in milliseconds.
This project splits responsibilities cleanly — PostgreSQL stores and indexes the actual text and
metadata (everything relational), Pinecone stores and searches the vectors (everything
similarity-based). Neither system tries to do the other's job.

### The document pipeline, end to end

```
Upload a document (PDF/TXT/MD)
  → chunk it into overlapping ~500-token pieces (so no piece is too big for one embedding call)
  → convert each chunk into a vector (an embedding)
  → store the vector in Pinecone, store the text in PostgreSQL
  → (later) a user asks a question
  → convert the question into a vector the same way
  → ask Pinecone: "which stored chunks are closest to this?"
  → pull the actual text of those chunks back out of PostgreSQL
  → hand the model those chunks plus the question: "answer using only this, and cite your source"
  → return a grounded, cited answer
```

Everything in this phase exists to make that loop real, fast, cheap (via caching), and observable
(via the same audit logging Phase 1 already built).

---

## Architecture Overview

### Module dependency diagram

```
AppModule
├── OpenaiModule                                   (Phase 1 — 2 new methods, no other changes)
│   └── exports: OPENAI_CLIENT, OpenaiService, TokenService,
│                AiAuditService, ModelRegistryService
│
├── AiChatModule                                   (Phase 2 — completely unchanged)
│   └── exports: ChatService
│
└── RagModule                                      (src/modules/rag/rag.module.ts)
    ├── imports: OpenaiModule, AiChatModule
    ├── providers
    │   ├── EmbeddingService        empty shell — see "A note on EmbeddingService" below
    │   ├── EmbeddingCacheService   the only service that reads/writes embedding_cache
    │   ├── DocumentService         document CRUD + the full ingestion pipeline
    │   ├── PineconeService         the only service that imports the Pinecone SDK
    │   ├── SearchService           query → embedding → Pinecone → ranked, filtered chunks
    │   ├── RagService              search + augmented prompt + generation + citations
    │   └── MockDataService         faker-based document/Q&A generation + evaluation scoring
    └── controllers
        └── RagController           17 REST endpoints; injects 6 of the 7 services directly
```

`RagModule` exports **nothing** — unlike `OpenaiModule` (`exports: [OpenaiService, ...]`) and
`AiChatModule` (`exports: [ChatService]`), no later module currently needs to inject anything from
`RagModule`, so its `exports` array is simply absent. The dependency direction is strictly one-way,
matching Phase 2's own precedent: `RagModule` → `OpenaiModule`/`AiChatModule`, never the reverse —
neither Phase 1 nor Phase 2 has any idea Phase 3 exists.

### A note on `EmbeddingService`

The spec's module diagram lists `EmbeddingService` as the thing that "generates embeddings via
OpenAI/OpenRouter embedding models." In the actual implementation, it's an empty
`@Injectable()` shell — a constructor and nothing else:

```typescript
// src/modules/rag/services/embedding.service.ts
@Injectable()
export class EmbeddingService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}
}
```

Every service that actually needs an embedding (`DocumentService`, `SearchService`) injects
`OpenaiService` directly and calls `generateEmbedding()`/`generateEmbeddingsBatch()` on it — the
same "only `OpenaiService` touches the SDK" rule Phase 1 established, just applied one layer
higher than the spec originally sketched. This mirrors Phase 2's own `StreamingService` precedent
of "extend the shared seam, don't fork it" — `RagModule` never needed a second embedding-calling
code path once `OpenaiService` itself grew the capability. `EmbeddingService` still exists as a
registered provider (in case a future issue gives it real cache-checking/dimension-bookkeeping
responsibility the spec originally sketched for it), but as of this writing it does no work.

### How the 7 services connect to each other

```
RagController
 ├─▶ DocumentService     (documents CRUD, upload, reindex, chunks)
 ├─▶ SearchService       (POST /rag/search)
 ├─▶ RagService          (POST /rag/ask, POST /rag/ask/conversation/:publicId)
 ├─▶ MockDataService     (mock generation, seeding, evaluation)
 ├─▶ PineconeService     (GET /rag/stats — describeIndex() only)
 └─▶ EmbeddingCacheService (GET /rag/stats — getCacheStats() only)

DocumentService (owns the PostgreSQL side of a document's whole lifecycle)
 ├─▶ TokenService         countTokens() — token-accurate chunk sizing, not character estimates
 ├─▶ OpenaiService        generateEmbeddingsBatch() — the actual embedding calls
 ├─▶ EmbeddingCacheService  cache-check every chunk before paying for an embedding
 └─▶ PineconeService      upsert() new vectors, deleteByFilter() on delete/reindex

SearchService (stateless retrieval orchestration)
 ├─▶ OpenaiService        generateEmbedding() — embeds the query itself
 ├─▶ EmbeddingCacheService  cache-check the query text too (repeated questions cost nothing extra)
 └─▶ PineconeService      query() — the actual nearest-neighbor search

RagService (the top-level orchestrator — search + generate)
 ├─▶ SearchService        search() — retrieval
 ├─▶ OpenaiService        chatCompletionWithMessages() (Phase 2's extension point) — generation
 ├─▶ ModelRegistryService  contextWindow lookup for queryWithConversation()'s budget math
 ├─▶ TokenService         token counting for the same budget math
 └─▶ ChatService          (Phase 2) buildContext()/addUserMessage()/addAssistantMessage()/
                          getConversationHandle() — queryWithConversation() only

MockDataService (data generation + evaluation, no SDK calls of its own)
 ├─▶ DocumentService      createFromText()/ingestFromFile() — every generated doc is really ingested
 └─▶ RagService           query() — evaluate() runs real RAG queries, not a simulation
```

Notice the same single-responsibility shape Phase 1 and 2 already established: `PineconeService`
is the _only_ service that imports `@pinecone-database/pinecone`, `DocumentService`/`SearchService`
are the _only_ services that call `OpenaiService`'s embedding methods, and `RagService` is the
_only_ service that ever composes retrieval with generation. No two services duplicate the same
responsibility.

### The two main flows

**Ingestion (one-time per document)** — everything that happens once, when a document is uploaded:

```
DocumentService.createFromText() / ingestFromFile()
  → createDocumentRow()                         persist row, embeddingStatus: 'pending'
  → ingestDocument(document, text)               private — the actual pipeline
      → set embeddingStatus: 'processing'
      → chunkText()                              LangChain RecursiveCharacterTextSplitter
      → embedChunks()                            cache-check every chunk, batch the misses
      → pineconeService.upsert(vectors)          one Pinecone call for the whole batch
      → documentChunk.createMany(...)             bulk-persist chunk rows
      → set embeddingStatus: 'completed', totalChunks, totalTokens
      → (any step throws) → embeddingStatus: 'failed', return — never rethrows
```

**Query (every user question)** — everything that happens on every `POST /rag/ask`:

```
RagService.query(question, options)
  → SearchService.search(question, options)
      → resolveQueryEmbedding()                  cache-check, embed on miss
      → PineconeService.query(embedding, topK, filter)
      → filter out anything below similarityThreshold
      → resolveChunks()                          join matched Pinecone IDs back to PostgreSQL text
  → buildAugmentedMessages()                      [system: RAG_CONFIG.systemPrompt, user: context+question]
  → OpenaiService.chatCompletionWithMessages()    the actual generation call
  → shape RagResult: answer, sources[], usage, cost, latency breakdown
```

### How Phase 1 and Phase 2 services are reused, not reinvented

Every embedding call and every generation call in this entire module still passes through Phase
1's audited, retried, cost-tracked pipeline — `RagModule` adds zero new SDK-calling code:

| What Phase 3 needs                       | Which existing service supplies it                                                                          | New code required                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Turn text into a vector                  | `OpenaiService.generateEmbedding()` (new method, Phase 3)                                                   | 2 new methods on an existing service — see below |
| Turn a question + context into an answer | `OpenaiService.chatCompletionWithMessages()` (Phase 2)                                                      | None — used exactly as-is                        |
| Count tokens for chunk sizing            | `TokenService.countTokens()` (Phase 1)                                                                      | None — used exactly as-is                        |
| Know a model's context window            | `ModelRegistryService.findModelByModelId()` (Phase 1)                                                       | None — used exactly as-is                        |
| Splice RAG context into an ongoing chat  | `ChatService.buildContext()`/`addUserMessage()`/`addAssistantMessage()`/`getConversationHandle()` (Phase 2) | One new method on `ChatService` — see below      |
| Retry on a flaky API call                | `RetryService` (Phase 1, via `OpenaiService`)                                                               | None — inherited automatically                   |
| Log every call for cost tracking         | `AiAuditService.log()` (Phase 1, via `OpenaiService`)                                                       | None — inherited automatically                   |

---

## The 7 Services Explained

### 1. EmbeddingService — the empty shell

Covered above in [A note on `EmbeddingService`](#a-note-on-embeddingservice). Registered as a
provider, does no work today — `DocumentService` and `SearchService` both call
`OpenaiService.generateEmbedding()`/`generateEmbeddingsBatch()` directly instead.

### 2. EmbeddingCacheService — don't pay to embed the same text twice

**What it does (non-technical):** Embedding a chunk of text costs a little money and a little
time. If you re-upload the same document, or two different documents happen to share a paragraph,
there's no reason to pay for that embedding twice — this service remembers "we've already computed
the vector for this exact text" and hands back the stored answer instantly instead.

**What it does (technical):**

```typescript
// src/modules/rag/services/embedding-cache.service.ts
@Injectable()
export class EmbeddingCacheService {
  private hits = 0;
  private misses = 0;

  async get(text: string): Promise<number[] | null> {
    const textHash = this.hash(text);
    const cached = await this.databaseService.embeddingCache.findUnique({ where: { textHash } });

    if (!cached) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return cached.embedding as number[];
  }

  async set(text: string, embedding: number[], model: string): Promise<void> {
    const textHash = this.hash(text);
    await this.databaseService.embeddingCache.upsert({
      where: { textHash },
      create: { textHash, embedding: embedding as Prisma.InputJsonValue, model },
      update: { embedding: embedding as Prisma.InputJsonValue, model },
    });
  }

  async invalidate(textHash: string): Promise<void> {
    await this.databaseService.embeddingCache.deleteMany({ where: { textHash } });
  }

  async getCacheStats(): Promise<{ hits: number; misses: number; totalCached: number }> {
    const totalCached = await this.databaseService.embeddingCache.count();
    return { hits: this.hits, misses: this.misses, totalCached };
  }

  private hash(text: string): string {
    const normalized = text.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }
}
```

**Key design decisions and why:**

- **The hash key is `SHA-256(text.trim().toLowerCase())`, not the raw text.** Two chunks that
  differ only by leading whitespace or letter casing are, for embedding purposes, the same input
  — normalizing before hashing means those trivial differences don't cause a needless cache miss.
- **`set()` is an `upsert()` keyed on `textHash`, not a plain insert.** Idempotent by construction
  — calling `set()` twice for the same text just overwrites the same row, no `P2002`
  conflict-handling needed anywhere in the codebase.
- **`invalidate()` uses `deleteMany()`, not `delete()`.** Invalidating an already-absent hash
  resolves silently instead of throwing Prisma's `P2025` — a cache invalidation for a key that was
  never cached (or already cleared) shouldn't be an error.
- **Hit/miss counts live in two private in-memory numbers, not a database column.** They reset on
  every app restart — an accepted trade-off, not a gap: the counters exist to answer "is the cache
  actually helping _this run_," not to be a permanent historical metric. `totalCached` (from
  `getCacheStats()`) _is_ durable, since it's a live `COUNT(*)` against the real table.
- **The `embedding` column is written with a single `as Prisma.InputJsonValue` cast**, not the
  double `as unknown as X` cast some other services in this codebase need — a plain `number[]` is
  directly structurally assignable to Prisma's JSON input type, so no intermediate `unknown` step
  is required.

### 3. DocumentService — the whole PostgreSQL-side lifecycle of a document

**What it does (non-technical):** This owns everything about a document from the moment it's
uploaded to the moment it's deleted: reading the file, splitting it into pieces small enough to
embed, turning each piece into a vector, storing everything, and keeping a `pending` →
`processing` → `completed`/`failed` status so you always know where ingestion stands.

**What it does (technical):**

```typescript
// src/modules/rag/services/document.service.ts
async create(dto: CreateDocumentDto): Promise<DocumentEntity>                    // metadata-only, no ingestion
async createFromText(dto: CreateDocumentTextDto): Promise<DocumentEntity>        // create + ingest immediately
async ingestFromFile(file: Express.Multer.File, overrides?: {...}): Promise<DocumentEntity>
async reindexDocument(publicId: string): Promise<DocumentEntity>
async getIngestionStatus(publicId: string): Promise<IngestionStatusResult>
async getChunks(documentPublicId: string, query: QueryChunksDto): Promise<PaginatedChunksResult>

async findAll(query: QueryDocumentsDto): Promise<PaginatedDocumentsResult>
async findOne(publicId: string): Promise<DocumentWithChunks>
async update(publicId: string, dto: UpdateDocumentDto): Promise<DocumentEntity>
async delete(publicId: string): Promise<void>
async getStats(): Promise<DocumentStatsResult>

async parseSource(buffer: Buffer, sourceType: string): Promise<string>           // public — unit-tested directly
async chunkText(text: string, model?: string): Promise<ChunkDescriptor[]>        // public — unit-tested directly
```

The ingestion pipeline itself, the part everything above ultimately calls:

```typescript
private async ingestDocument(document: Document, text: string): Promise<DocumentEntity> {
  await this.databaseService.document.update({
    where: { id: document.id },
    data: { embeddingStatus: EmbeddingStatus.PROCESSING },
  });

  try {
    const chunks = await this.chunkText(text, document.embeddingModel);
    const embeddings = await this.embedChunks(chunks, document.embeddingModel);

    const vectors: PineconeVector[] = chunks.map((chunk, i) => ({
      id: `chunk_${document.publicId}_${chunk.chunkIndex}`,
      values: embeddings[i] ?? [],
      metadata: {
        documentId: document.publicId,
        documentTitle: document.title,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        ...(document.category ? { category: document.category } : {}),
      },
    }));

    if (vectors.length > 0) await this.pineconeService.upsert(vectors);
    if (chunks.length > 0) {
      await this.databaseService.documentChunk.createMany({ data: chunks.map((chunk, i) => ({
        documentId: document.id, chunkIndex: chunk.chunkIndex, content: chunk.content,
        tokenCount: chunk.tokenCount, startChar: chunk.startChar, endChar: chunk.endChar,
        pineconeId: vectors[i]?.id, embeddingStatus: EmbeddingStatus.COMPLETED,
      })) });
    }

    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    const completed = await this.databaseService.document.update({
      where: { id: document.id },
      data: { embeddingStatus: EmbeddingStatus.COMPLETED, totalChunks: chunks.length, totalTokens },
    });
    return this.toDocumentEntity(completed);
  } catch (error) {
    this.logger.error(`Ingestion failed for document ${document.publicId}: ${error}`);
    const failed = await this.databaseService.document.update({
      where: { id: document.id },
      data: { embeddingStatus: EmbeddingStatus.FAILED },
    });
    return this.toDocumentEntity(failed);   // returns the failed entity — never rethrows
  }
}
```

The cache-aware, batched embedding step:

```typescript
private async embedChunks(chunks: ChunkDescriptor[], model: string): Promise<number[][]> {
  const embeddings: (number[] | undefined)[] = new Array(chunks.length).fill(undefined);
  const missIndices: number[] = [];

  // Sequential, deliberately — gives a deterministic call order to assert against in tests.
  for (let i = 0; i < chunks.length; i++) {
    const cached = await this.embeddingCacheService.get(chunks[i].content);
    if (cached) embeddings[i] = cached;
    else missIndices.push(i);
  }

  const batchSize = this.configService.get<number>('rag.embeddingBatchSize') ?? EMBEDDING_CONFIG.batchSize;

  for (let start = 0; start < missIndices.length; start += batchSize) {
    const batchIndices = missIndices.slice(start, start + batchSize);
    const batchTexts = batchIndices.map((idx) => chunks[idx].content);
    const batchEmbeddings = await this.openaiService.generateEmbeddingsBatch(batchTexts, model);

    for (let i = 0; i < batchIndices.length; i++) {
      const idx = batchIndices[i];
      const embedding = batchEmbeddings[i] ?? [];
      embeddings[idx] = embedding;
      await this.embeddingCacheService.set(chunks[idx].content, embedding, model);
    }
  }

  return embeddings.map((embedding) => embedding ?? []);
}
```

**Key design decisions and why:**

- **A failed ingestion returns the failed entity — it never rethrows.** The `try/catch` around the
  whole pipeline body means a parse error, an embedding API failure, or a Pinecone outage all
  degrade to `embeddingStatus: 'failed'` on the document row instead of an unhandled 500 back to
  the caller. This is the same "never crash the caller, degrade to a structured failure" pattern
  Phase 2's `ToolExecutorService.execute()` and `StreamingService`'s mid-stream error handling
  already established.
- **`embedChunks()`'s cache-check loop is sequential (not `Promise.all()`'d), on purpose.** A
  deterministic call order (chunk 0's cache check, then chunk 1's, ...) is exactly what the test
  suite's own acceptance criterion needed to assert against ("chunk → cache-check →
  embed-on-miss → cache-set → upsert → persist → status-update," in that order for every chunk).
- **Embeddings are written into a pre-sized array at each chunk's own original index**, not
  concatenated hits-then-misses. This guarantees the final vector list always lines up with the
  chunks' original order regardless of which specific chunks were cache hits vs. misses — a subtle
  correctness requirement that's easy to get backwards if you build the result by simply appending.
- **Batching only applies to cache misses.** If every chunk in a re-ingested document is already
  cached, `generateEmbeddingsBatch()` is never called at all — a full re-ingestion of an unchanged
  document costs zero embedding API calls.
- **`reindexDocument()` reconstructs the original source text from existing chunk rows** instead of
  requiring the original file again:

  ```typescript
  private reconstructText(chunks: DocumentChunk[]): string {
    const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    return sorted.map((chunk, i) => {
      const next = sorted[i + 1];
      if (!next) return chunk.content;
      return chunk.content.slice(0, next.startChar - chunk.startChar);
    }).join('');
  }
  ```

  Since every `DocumentChunk.content` is, by construction, `sourceText.slice(startChar, endChar)`,
  the non-overlapping unique span of every chunk except the last is
  `content.slice(0, nextChunk.startChar - chunk.startChar)` — concatenating these spans in
  `chunkIndex` order reconstructs the exact original text with no separate raw-text storage column
  needed anywhere in the schema.

- **`delete()` is two unconditional, sequential steps** — Postgres delete (cascades to chunks via
  `onDelete: Cascade`) followed by `pineconeService.deleteByFilter({ documentId: publicId })`.
  Pinecone has no foreign-key relationship to Postgres, so this explicit second call is the _only_
  mechanism that prevents orphaned vectors from silently accumulating after a document is deleted
  (FR-RAG-009) — proven from `RagController`'s own route entrypoint (not just at the service unit
  level) by `rag-controller-delete-cascade.integration.spec.ts`.
- **File-type detection uses the filename extension, not the MIME type.** Upload clients report
  `.md` inconsistently (`text/markdown` vs. `text/plain` vs. nothing at all), so
  `resolveSourceTypeFromFilename()` splits on `.` and checks against an explicit allowlist
  (`pdf`/`txt`/`md`) — an unsupported or missing extension throws `BadRequestException` _before_
  `parseSource()` is ever called, so a `.docx` upload never reaches the parsing step at all.

### 4. PineconeService — the only door to the vector database

**What it does (non-technical):** This is the single place in the whole codebase that talks to
Pinecone. Every other service that needs a vector stored, searched, or deleted goes through this
one narrow interface instead of touching the Pinecone SDK itself.

**What it does (technical):**

```typescript
// src/modules/rag/services/pinecone.service.ts
async upsert(vectors: PineconeVector[]): Promise<void>
async query(vector: number[], topK: number, filter?: Record<string, unknown>): Promise<PineconeMatch[]>
async deleteByIds(ids: string[]): Promise<void>
async deleteByFilter(filter: Record<string, unknown>): Promise<void>
async describeIndex(): Promise<PineconeIndexStats>
```

```typescript
constructor(private readonly configService: ConfigService, private readonly logger: AppLoggerService) {
  const apiKey = this.configService.get<string>('pinecone.apiKey');
  this.indexName = this.configService.get<string>('pinecone.index');
  this.namespace = this.configService.get<string>('pinecone.namespace') ?? PINECONE_CONFIG.namespace;

  this.client = apiKey && this.indexName ? new Pinecone({ apiKey }) : null;
  if (!this.client) {
    this.logger.warn('Pinecone is not configured (PINECONE_API_KEY/PINECONE_INDEX unset) — vector operations will fail until configured');
  }
}

private getIndex(): Index {
  const { client, indexName } = this;
  if (!client || !indexName) {
    throw new ServiceUnavailableException('Pinecone is not configured');
  }
  return client.index({ name: indexName }).namespace(this.namespace);
}
```

**Key design decisions and why:**

- **No DI token, unlike `OPENAI_CLIENT`.** `OpenaiModule` uses a factory-provider token
  (`OPENAI_CLIENT`) because _two_ things needed to inject the raw SDK client (`OpenaiService` and
  Phase 2's `StreamingService`). `PineconeService` is the Pinecone SDK's _only_ consumer in this
  entire app, so a token would just be indirection with no second caller to justify it — the client
  is constructed directly in `PineconeService`'s own constructor.
- **The client is `Pinecone | null`, not a hard boot-time requirement.** Unlike Phase 1's
  `OPENAI_API_KEY` (which the app genuinely cannot function without), `PINECONE_API_KEY`/
  `PINECONE_INDEX` are optional — the app boots cleanly with neither set, logging one warning at
  construction. Every public method routes through `getIndex()`, which throws a clear
  `ServiceUnavailableException` (503) _before_ any SDK call if the client is unconfigured — a RAG
  feature is additive to this learning project, not core to it, so it shouldn't block the app from
  starting at all.
- **Every operation is automatically namespace-scoped.** `getIndex()` returns
  `client.index({ name }).namespace(this.namespace)`, so no individual method (`upsert`, `query`,
  `deleteByIds`, `deleteByFilter`, `describeIndex`) has to repeat that call — the whole app writes
  to and reads from exactly one Pinecone namespace (`'documents'` by default), configured once.
- **`describeIndex()` uses the _data-plane_ `index.describeIndexStats()`, not the _control-plane_
  `Pinecone.describeIndex(name)`.** Only the data-plane call reports live, per-namespace vector
  counts — the control-plane call would return static index configuration (dimension, metric) but
  not "how many vectors are actually in there right now," which is what `GET /rag/stats` needs.
- **`query()`'s `filter` uses the same optional-conditional-spread pattern** Phase 1's
  `chatCompletion()` uses for `temperature`/`maxTokens` — `...(filter !== undefined ? { filter } :
{})` — so an omitted filter is genuinely absent from the request payload, not sent as an explicit
  `undefined`.
- **Metadata going _into_ Pinecone needs an `as unknown as RecordMetadata` cast**; metadata coming
  _out_ needs no cast at all. The Pinecone SDK's `RecordMetadata` value union (string, number,
  boolean, or string array — no nested objects) is narrower than the plain `Record<string,
unknown>` this codebase's own types use, so writing requires the cast; reading doesn't, since the
  narrower type is structurally assignable to `unknown`.

### 5. SearchService — the retrieval half of RAG

**What it does (non-technical):** Takes a plain-English question, turns it into the same kind of
vector everything else in the index is stored as, asks Pinecone for the closest matches, and
resolves those matches back into actual readable text plus which document they came from.

**What it does (technical):**

```typescript
// src/modules/rag/services/search.service.ts
async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const topK = options.topK ?? this.configService.get<number>('rag.topK') ?? RAG_CONFIG.topK;
  const similarityThreshold =
    options.similarityThreshold ??
    this.configService.get<number>('rag.similarityThreshold') ??
    RAG_CONFIG.similarityThreshold;

  const queryEmbedding = await this.resolveQueryEmbedding(query);
  const filter = this.buildFilter(options);
  const matches = await this.pineconeService.query(queryEmbedding, topK, filter);

  const aboveThreshold = matches.filter((match) => match.score >= similarityThreshold);
  if (aboveThreshold.length === 0) return [];

  return this.resolveChunks(aboveThreshold);
}

async searchWithScores(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  return this.search(query, options);      // SearchResult already carries `score` — no separate logic
}
```

The full retrieval pipeline broken into its private helpers:

```typescript
private async resolveQueryEmbedding(query: string): Promise<number[]> {
  const cached = await this.embeddingCacheService.get(query);
  if (cached) return cached;

  const model = this.configService.get<string>('rag.embeddingModel') ?? EMBEDDING_CONFIG.model;
  const embedding = await this.openaiService.generateEmbedding(query, model);
  await this.embeddingCacheService.set(query, embedding, model);
  return embedding;
}

private buildFilter(options: SearchOptions): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  if (options.categoryFilter) filter.category = options.categoryFilter;
  if (options.documentIds?.length) filter.documentId = { $in: options.documentIds };
  return Object.keys(filter).length > 0 ? filter : undefined;
}

private async resolveChunks(matches: PineconeMatch[]): Promise<SearchResult[]> {
  const pineconeIds = matches.map((match) => match.id);
  const chunks = await this.databaseService.documentChunk.findMany({
    where: { pineconeId: { in: pineconeIds } },
    include: { document: true },
  });
  const chunkByPineconeId = new Map(chunks.map((chunk) => [chunk.pineconeId, chunk]));

  return matches
    .map((match) => {
      const chunk = chunkByPineconeId.get(match.id);
      if (!chunk) return null;                 // a stale/orphaned vector — silently dropped
      return { chunkPublicId: chunk.publicId, documentPublicId: chunk.document.publicId,
        documentTitle: chunk.document.title, content: chunk.content, chunkIndex: chunk.chunkIndex,
        score: match.score, category: chunk.document.category };
    })
    .filter((result): result is SearchResult => result !== null);
}
```

**Key design decisions and why:**

- **The query's own embedding is cache-checked too, using the exact same `EmbeddingCacheService`
  every chunk uses.** A repeated or common question ("What is the pricing?") costs an embedding
  call exactly once, ever — every subsequent identical question is a pure cache hit.
- **The similarity-threshold filter runs _before_ touching Postgres, not after.** Filtering by
  `score >= similarityThreshold` on the raw Pinecone matches means a zero-result search never even
  issues the `documentChunk.findMany()` join — no wasted database round-trip for a query with
  nothing relevant indexed.
- **`resolveChunks()`'s single `findMany({ pineconeId: { in: [...] } })` join, not N individual
  lookups.** One Pinecone query typically returns `topK` (default 5) matches — resolving all of
  them to their PostgreSQL text is one query, not five.
- **Results preserve Pinecone's own ranking order.** `resolveChunks()`'s outer `.map()` iterates
  over `matches` (already returned by Pinecone in similarity-descending order) and looks each one
  up in a `Map` — since `findMany()`'s own return order isn't guaranteed to match the input filter
  order, iterating over the _matches_ array (not the _chunks_ array) is what keeps the final result
  list correctly ranked.
- **A match with no corresponding chunk row is silently dropped, never thrown.** This covers a
  stale or orphaned Pinecone vector (e.g. from a bug, or a chunk deleted out-of-band) — a single
  bad vector shouldn't turn an otherwise-successful search into a 500.

### 6. RagService — retrieval + generation, with citations

**What it does (non-technical):** This is what actually answers the question. It calls
`SearchService` to find the relevant material, builds a prompt that tells the model "here's your
source material, answer only from this, and say which document you used," sends that to the
model, and packages the answer together with exactly which chunks were used as evidence.

**What it does (technical):**

```typescript
// src/modules/rag/services/rag.service.ts
async query(question: string, options: RagOptions = {}): Promise<RagResult>
async queryWithConversation(conversationPublicId: string, question: string, options?: RagOptions): Promise<RagResult>
```

```typescript
async query(question: string, options: RagOptions = {}): Promise<RagResult> {
  const overallStart = Date.now();

  const searchStart = Date.now();
  const results = await this.searchService.search(question, {
    topK: options.topK,
    categoryFilter: options.categoryFilter,
  });
  const searchLatencyMs = Date.now() - searchStart;

  const messages = this.buildAugmentedMessages(question, results);

  const generationStart = Date.now();
  const completion = await this.openaiService.chatCompletionWithMessages({
    messages,
    model: options.model,
    temperature: options.temperature ?? DEFAULT_RAG_TEMPERATURE,   // 0.3
  });
  const generationLatencyMs = Date.now() - generationStart;

  const sources: RagSource[] = results.map((result) => ({
    documentTitle: result.documentTitle, documentPublicId: result.documentPublicId,
    chunkContent: result.content, chunkIndex: result.chunkIndex, similarityScore: result.score,
  }));

  return {
    answer: completion.content, model: completion.model, sources, usage: completion.usage,
    estimatedCost: completion.estimatedCost, latencyMs: Date.now() - overallStart,
    chunksRetrieved: results.length, searchLatencyMs, generationLatencyMs,
  };
}
```

**Key design decisions and why:**

- **`sources` is mapped directly from `SearchService`'s real results — never parsed from the
  model's own answer text.** The retrieved data is already structured and authoritative; asking the
  model to _also_ self-report which sources it used (and then parsing that out of free text) would
  be strictly less reliable than the data the app already has in hand.
- **`searchLatencyMs` and `generationLatencyMs` are measured independently**, and `latencyMs` is a
  _separate_ wall-clock measurement across the whole method — not a literal sum of the two. This
  naturally captures the small orchestration overhead of building messages and mapping sources,
  and it lets a caller tell whether a slow response is a retrieval problem or a generation problem
  (exactly FR-RAG's own stated reason for reporting them separately).
- **A zero-result search still calls the model** — `buildContextBlock([])` renders `"Context: No
relevant documents were found for this question."` rather than short-circuiting in code. The
  "I don't have enough information" behavior is left entirely to the system prompt and the model's
  own judgment, never a hardcoded branch that returns a canned string — this keeps the refusal
  phrasing consistent with every other case where the model decides it can't answer, instead of
  having two different code paths that could drift apart.
- **Temperature defaults to `0.3`, not whatever the app's general default is.** Factual,
  document-grounded answers benefit from reduced sampling randomness — a RAG answer quoting a
  specific policy number shouldn't have the same creative-writing temperature as a general chat
  reply, and this default is never silently overridden by a higher application-wide setting.
- **Reuses `OpenaiService.chatCompletionWithMessages()` (Phase 2's own extension point) — no new
  LLM-calling code anywhere in `RagModule`.** The augmented prompt is just another
  `ChatCompletionMessageParam[]` array; Phase 3 needed zero new SDK-calling code to add generation,
  only a new way to _build_ the array.

#### `queryWithConversation()` — RAG inside an ongoing chat

```typescript
async queryWithConversation(conversationPublicId: string, question: string, options: RagOptions = {}): Promise<RagResult> {
  if (!question.trim()) throw new BadRequestException('question must not be empty or whitespace-only');

  const { id: conversationId, model: conversationModel } =
    await this.chatService.getConversationHandle(conversationPublicId);
  const model = options.model ?? conversationModel;

  await this.chatService.addUserMessage(conversationId, question);   // persisted before retrieval/generation

  const results = await this.searchService.search(question, { topK: options.topK, categoryFilter: options.categoryFilter });
  const { messages, chunksUsed } = await this.spliceRetrievedChunks(conversationId, question, results, model);

  const completion = await this.openaiService.chatCompletionWithMessages({
    messages, model, temperature: options.temperature ?? DEFAULT_RAG_TEMPERATURE,
  });

  await this.chatService.addAssistantMessage(conversationId, {
    content: completion.content || null, tokenCount: completion.usage.totalTokens,
    cost: completion.estimatedCost, latencyMs: completion.latencyMs, model: completion.model,
  });

  // ...shape RagResult, sources built from chunksUsed (post-budget-reduction), not the full result set
}
```

A new, small, purely-additive method landed on Phase 2's `ChatService` to make this possible —
`getConversationHandle(publicId): Promise<{ id: bigint; model: string }>`. `ConversationEntity`
deliberately never exposes the internal `bigint` row id that `buildContext()`/`addUserMessage()`/
`addAssistantMessage()` all require, and `RagService` only ever has a `publicId` — this is a thin
wrapper around `ChatService`'s already-existing private `findConversationOrThrow()`.

**The context-splicing trick** — how retrieved chunks get into an existing conversation without
inventing a new message role or a parallel storage concept:

```typescript
private spliceLastMessage(
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  question: string,
  chunksUsed: SearchResult[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const contextBlock = this.buildContextBlock(chunksUsed);
  const spliced = [...baseMessages];
  spliced[spliced.length - 1] = { role: 'user', content: `${contextBlock}\n\nQuestion: ${question}` };
  return spliced;
}
```

`ChatService.buildContext(conversationId)` (Phase 2) already ends with the just-persisted plain
question as its last array entry. `spliceLastMessage()` replaces _only that last entry's content_
— purely in-memory, on the array that's about to be sent to the model — with the chunk-augmented
version. The **persisted** `chat_messages` row is completely untouched: `GET
/chat/conversations/:publicId` shows the plain question, exactly like any other turn. This is the
concrete mechanism behind "a RAG-augmented conversation is stored and replayable through the exact
same `chat_messages` table Phase 2 already built — no parallel conversation-storage concept is
introduced" (the PRD's own stated Implementation Decision).

**Budget enforcement — never triggering Phase 2's context-length error:**

```typescript
private async spliceRetrievedChunks(conversationId, question, results, model) {
  const baseMessages = await this.chatService.buildContext(conversationId);
  const budget = await this.resolveContextBudget(model);
  const historyTokens = this.sumTokens(baseMessages.slice(0, -1), model);   // every message EXCEPT the last, fixed

  let chunksUsed = results;
  let messages = this.spliceLastMessage(baseMessages, question, chunksUsed);

  while (chunksUsed.length > 0 && historyTokens + this.lastMessageTokens(messages, model) > budget) {
    chunksUsed = chunksUsed.slice(0, -1);      // drop the lowest-ranked chunk (results are score-descending)
    messages = this.spliceLastMessage(baseMessages, question, chunksUsed);
  }

  return { messages, chunksUsed };
}
```

The loop sums every history message's token cost _once_ (fixed, since `buildContext()` already
made its own trimming decision and that's never revisited), then repeatedly re-measures just the
spliced last message and drops the weakest-ranked retrieved chunk until the combined total fits
`contextWindow * contextWindowPercentage` — the exact same budget formula Phase 2's own
`buildContext()` uses, read via the same config keys (`chat.defaultContextWindow`,
`chat.contextWindowPercentage`) rather than a separate RAG-specific budget concept.
`RagResult.sources`/`chunksRetrieved` reflect this post-reduction `chunksUsed` set — what was
_actually_ sent to the model, not the full, pre-trim `SearchService` result set.

### 7. MockDataService — data generation and pipeline evaluation

**What it does (non-technical):** Two jobs. First, it can conjure up realistic-looking fake
documents (guides, FAQs, changelogs) and matching test questions, so you can exercise the whole
pipeline without hand-writing content. Second, it can run a batch of questions through the real RAG
pipeline and grade how well it did, broken down by how hard each question was.

**What it does (technical):**

```typescript
// src/modules/rag/services/mock-data.service.ts
async generateDocuments(count: number, options?: MockOptions): Promise<DocumentEntity[]>
async generateQAPairs(count: number, documentIds?: string[]): Promise<QaPairEntity[]>
async seedDefaultDataset(): Promise<{ documents: number; qaPairs: number }>
async seedRealisticDataset(): Promise<{ documents: number; qaPairs: number }>
async findAllQaPairs(query: QueryQaPairsDto): Promise<PaginatedQaPairsResult>
async evaluate(sampleSize?: number, qaPairs?: EvaluateQaPairInput[]): Promise<EvaluationResult>
```

**Document generation — structure from templates, prose from faker:**

````typescript
// Tech guide: prerequisites, CLI-driven installation, configuration block, troubleshooting.
private buildGuideTemplate(): DocumentTemplate {
  const product = faker.commerce.productName();
  const cliName = product.toLowerCase().replace(/\s+/g, '-');
  const sections = [
    () => ['## Prerequisites', '', `- ${faker.hacker.noun()} version ${faker.system.semver()} or later`, ...].join('\n'),
    () => ['## Installation', '', `1. Download the ${product} package`, `2. Run \`${cliName} install\``, ...].join('\n'),
    () => ['## Configuration', '', faker.lorem.paragraph(3), '', '```', `${faker.hacker.noun()}...`, '```'].join('\n'),
    // ...troubleshooting sections
  ];
  return { title, header, nextSection: (index) => sections[index % sections.length]() };
}
````

Five category-specific builders exist (`buildGuideTemplate`/`buildFaqTemplate`/`buildDocsTemplate`/
`buildTutorialTemplate`/`buildChangelogTemplate`), each returning `{ title, header, nextSection }`.
`faker.commerce.productName()`/`faker.hacker.noun()`/`faker.system.semver()`/`faker.date.past()`
etc. are injected into the _structural_ elements (headings, CLI commands, version numbers, API
paths) — only `faker.lorem.*` fills prose body text. `assembleContent()` appends `nextSection()`
blocks until a target word count is reached, then truncates if it overshot the maximum.

**Key design decisions and why:**

- **Every generated document is really ingested**, via `DocumentService.createFromText()` —
  sequential `await`s in a loop, not `Promise.all()`'d, matching every other bulk-ingestion loop in
  this module. Generated documents are immediately searchable, not inert metadata sitting in a
  table nobody queries.
- **Q&A generation splits 60/25/15 (simple/multi-step/edge-case)**, with the remainder after
  rounding always absorbed into the edge-case count — so the three tiers' lengths always sum to
  exactly the requested `count` regardless of rounding drift.
  - **Simple** pairs round-robin documents × their chunks: `expectedAnswer` is exactly one chunk's
    own trimmed content — by construction, answerable from that single chunk.
  - **Multi-step** pairs prefer cross-document comparison (`Compare "A" and "B": ...`) when at
    least two documents exist, falling back to comparing two chunks within one document otherwise.
  - **Edge-case** pairs cycle a hardcoded pool of eight questions (solar eclipses, time machines,
    leap seconds — deliberately disjoint from `generateDocuments()`'s own faker vocabulary, so an
    edge-case question can never coincidentally match real generated content), each paired with
    `RAG_CONFIG.noInfoSentinel` verbatim as `expectedAnswer` — the exact phrase the real pipeline is
    instructed to say when it can't answer.
- **`seedRealisticDataset()` exists specifically because faker prose embeds weakly.** See the
  [Mock Data & Evaluation](#mock-data--evaluation) section below for the full story — this method
  reads 10 hand-written, coherent Markdown documents from `src/modules/rag/seed-data/` and a
  matching `qa-pairs.json`, ingests every document through the real
  `DocumentService.ingestFromFile()` pipeline, and persists the Q&A pairs as real `QaPair` rows
  tagged `'realistic-seed'` (kept independently filterable from `'mock-data'`).
- **`evaluate()`'s scoring is a documented heuristic, not a ground-truth grader** — a full
  LLM-as-judge approach was explicitly out of scope (a third per-question LLM call this codebase
  doesn't budget for). Edge-case pairs are scored on whether the answer _declines_ to answer
  (`looksLikeIDK()` — checks for `RAG_CONFIG.noInfoSentinel`'s core phrase plus common paraphrase
  variants), never on content similarity. Simple/multi-step pairs use a keyword-overlap ratio
  (`keywordOverlapRatio()` — fraction of `expectedAnswer`'s significant keywords, length ≥ 4 with
  stopwords filtered, that also appear in the generated answer) bucketed into
  `correct`/`partiallyCorrect`/`incorrect`.
- **`evaluate()` is bounded by construction, not just by default.** `take = Math.min(sampleSize ??
50, 200)` — a caller requesting more than 200 is silently clamped, never run unbounded, since
  every evaluated question is a live embedding + Pinecone + generation call. `EvaluateDto` enforces
  the same `200` cap again at the DTO layer (`@Max(200)`), belt-and-suspenders.
- **`evaluate()` accepts an explicit `qaPairs` array as an alternative to reading the database.**
  When supplied, those pairs are used directly instead of `qaPair.findMany()` — this is what lets
  the realistic seed dataset (`seedRealisticDataset()`'s pairs, which are _also_ persisted as real
  rows, but could equally be passed ad hoc) be evaluated without a prior seeding step at all, useful
  for one-off evaluation runs against a hand-curated set.

---

## OpenaiService Embedding Extension

Phase 1's `OpenaiService` only ever exposed chat completions. Phase 3 adds two new methods,
following exactly the same extension pattern Phase 2 used for `chatCompletionWithMessages()` —
never a new module bypassing the "only `OpenaiService` touches the SDK" rule:

```typescript
// src/modules/openai/services/openai.service.ts
async generateEmbedding(text: string, model?: string): Promise<number[]> {
  this.ensureConfigured();
  const resolvedModel = this.resolveEmbeddingModel(model);

  const response = await this.executeEmbedding({
    model: resolvedModel, input: text, requestId: crypto.randomUUID(), auditUserMessage: text,
  });
  return response.data[0]?.embedding ?? [];
}

async generateEmbeddingsBatch(texts: string[], model?: string): Promise<number[][]> {
  this.ensureConfigured();
  const resolvedModel = this.resolveEmbeddingModel(model);

  const response = await this.executeEmbedding({
    model: resolvedModel, input: texts, requestId: crypto.randomUUID(), auditUserMessage: texts[0] ?? '',
  });
  return response.data.map((embedding) => embedding.embedding);
}

private resolveEmbeddingModel(model?: string): string {
  return model ?? this.config.get<string>('rag.embeddingModel') ?? 'text-embedding-3-small';
}
```

Both share a private `executeEmbedding()` helper — structurally parallel to `chatCompletion()`'s/
`chatCompletionWithMessages()`'s shared `executeCompletion()` tail, but kept as a genuinely
separate helper rather than merged with it, since the embeddings response shape (`{ data:
Embedding[] }`) shares nothing structural with chat completions' `{ choices }`:

```typescript
private async executeEmbedding(params: {
  model: string; input: string | string[]; userId?: string; requestId: string; auditUserMessage: string;
}): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
  const retryTracker = { retryCount: 0 };
  const startTime = Date.now();

  try {
    const response = await this.retryService.executeWithRetry(
      () => this.openaiClient.embeddings.create({ model: params.model, input: params.input }),
      retryTracker,
    );

    const inputTokens = response.usage.prompt_tokens;
    const estimatedCost = await this.tokenService.calculateCost(params.model, inputTokens, 0);   // 0 output tokens

    void this.auditService.log({
      requestId: params.requestId, model: params.model, endpoint: OpenAIEndpoint.EMBEDDINGS,
      userMessage: params.auditUserMessage, inputTokens, outputTokens: 0, totalTokens: inputTokens,
      estimatedCost, latencyMs: Date.now() - startTime, status: AiAuditStatus.SUCCESS,
      retryCount: retryTracker.retryCount,
    });
    return response;
  } catch (error) {
    // ... identical FAILED-status audit write, then throw this.mapError(error)
  }
}
```

**How they reuse retry and audit from Phase 1, with zero new logic:**

- **`RetryService.executeWithRetry()`** wraps the raw `openaiClient.embeddings.create()` call
  exactly the way it wraps `chat.completions.create()` — the same exponential-backoff-with-jitter,
  the same error classification (429/500/503 retryable, 400/401/403/404 permanent), the same
  circuit breaker. An embedding call that trips the circuit throws the identical
  `CircuitOpenException` chat completions already produce.
- **`AiAuditService.log()`** writes to the _same_ `ai_audit_logs` table, with `endpoint:
'embeddings'` (`OpenAIEndpoint.EMBEDDINGS` — defined since Phase 1, unused until now) as the only
  structural difference from a chat-completion row. Cost tracking, per-model breakdowns, and the
  cost-summary endpoint all pick up embedding calls automatically with zero new aggregation code.
- **Cost reuses `TokenService.calculateCost(model, inputTokens, 0)`** — embeddings have no output
  tokens, so `0` is passed rather than adding a second cost-calculation code path. The existing DB
  → `MODEL_PRICING` → `0` fallback chain (Phase 1) applies completely unchanged.
- **Model resolution follows the same three-tier fallback** every other model-accepting method in
  this codebase uses: `model ?? config.get('rag.embeddingModel') ?? 'text-embedding-3-small'`.

**What's different from the chat-completion methods:** neither `generateEmbedding()` nor
`generateEmbeddingsBatch()` exposes `userId`/`requestId` parameters — `requestId` is generated
internally via `crypto.randomUUID()` on every call, `userId` is always `undefined` in the audit
row, and (for a batch call) `userMessage` on the audit row is the _first_ input text only, not a
reconstruction of the whole batch.

**Regression guarantee:** `chatCompletion()`/`chatCompletionWithMessages()` are completely
unmodified — Phase 1 and Phase 2's own `openai.service.spec.ts` suites still pass unchanged,
confirming these two new methods are purely additive.

---

## LangChain Integration

### What we use

Exactly one piece of LangChain, used as a pure utility with no I/O of its own:

```typescript
// src/modules/rag/services/document.service.ts
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize,
  chunkOverlap,
  separators: [...CHUNKING_CONFIG.separators], // ['\n\n', '\n', '. ', ' ', '']
  lengthFunction: (chunk: string) => this.tokenService.countTokens(chunk, tokenModel),
});

const rawChunks = await splitter.splitText(text);
```

`RecursiveCharacterTextSplitter` tries each separator in the configured priority order — first
attempting to split on paragraph breaks (`\n\n`), then line breaks, then sentence-ending periods,
then spaces, and only falling all the way to character-level splitting (`''`) as a last resort —
which is what makes the resulting chunks respect natural document structure instead of cutting
mid-sentence whenever possible. The `lengthFunction` override is the key integration point: instead
of the splitter's default character-count sizing, every chunk-size decision goes through Phase 1's
real `TokenService.countTokens()` — chunk sizing is genuinely token-accurate against the actual
model tokenizer, not a character-count approximation.

### What we deliberately don't use — even narrower than the spec originally called for

The spec and PRD both list `PDFLoader` (`@langchain/community`) and `OpenAIEmbeddings`
(`@langchain/openai`) as intended LangChain integration points, and both packages are installed as
dependencies (`package.json` lists both). **Neither is actually imported anywhere in the shipped
code.** Two narrower choices were made instead:

- **PDF parsing uses the `pdf-parse` package directly**, not LangChain's `PDFLoader` wrapper —
  `DocumentService.parsePdf()` calls `pdf-parse`'s class-based API (`new PDFParse({ data:
buffer })` → `getText()`) directly. `pdf-parse` is `PDFLoader`'s own underlying implementation
  in most LangChain versions anyway, so this skips a thin wrapper layer for the same result.
- **Embedding generation goes through `OpenaiService.generateEmbedding()`**, not LangChain's
  `OpenAIEmbeddings` class — for exactly the reason the PRD's own Implementation Decisions state:
  routing embeddings through Phase 1's own `OpenaiService` keeps retry, circuit-breaker, and audit
  logging identical to every other LLM-adjacent call in the app, which a separate LangChain
  embeddings client would have bypassed entirely.

Also unused, per the spec's own explicit "What We DON'T Use" list: LangChain's chains
(`RetrievalQAChain`, `ConversationalRetrievalChain`), agents, and its Pinecone vector-store wrapper.
`RagService` owns orchestration directly; `PineconeService` calls the Pinecone SDK directly.

### Why this approach — control over orchestration vs. convenience

LangChain's chains and agents are convenient precisely because they hide the individual API
calls — which is exactly the problem, given this codebase's own hard requirements from Phase 1:
every LLM call must be individually auditable, retryable with a shared circuit breaker, and
cost-tracked through one system. A `RetrievalQAChain` would make its own internal completion call
in a way this codebase's `AiAuditService`/`RetryService` would never see. By using only LangChain's
document-processing utilities (the text splitter, and originally the PDF loader before that got
simplified to `pdf-parse` directly) and writing the actual retrieval/generation orchestration by
hand in `RagService`, every single call — embedding or generation — stays on the exact same
audited, retried, cost-tracked path every other call in this app already uses. LangChain earns its
keep exactly where it's genuinely useful (parsing PDF binaries, splitting text intelligently on
document structure) and is skipped everywhere its abstractions would swallow a call this codebase
needs visibility into.

---

## Pinecone Integration

### How vectors are stored

Every vector written to Pinecone follows one shape, built in `DocumentService.ingestDocument()`:

```json
{
  "id": "chunk_4f83dab3-30cc-4d37-8930-baae654bd05a_0",
  "values": [0.023, -0.045, 0.012, "... 1536 numbers total"],
  "metadata": {
    "documentId": "4f83dab3-30cc-4d37-8930-baae654bd05a",
    "documentTitle": "CloudPulse Pricing Plans",
    "chunkIndex": 0,
    "tokenCount": 487,
    "category": "docs"
  }
}
```

The vector `id` is deterministic: `` `chunk_${documentPublicId}_${chunkIndex}` `` — this is what
lets `DocumentChunk.pineconeId` trace a chunk row straight back to its exact vector for debugging
or manual inspection, and what `SearchService.resolveChunks()` reverses to join a Pinecone match
back to PostgreSQL text. `category` is spread into the metadata object only when the document has
one — Pinecone's `RecordMetadata` type rejects `null`, so an uncategorized document's vectors
simply omit the key rather than sending `category: null`.

### How queries work — cosine similarity

Every vector in the index (`cosine` metric, configured at index-creation time — see [Setup]
(#setup) below) is compared against the query vector using **cosine similarity**: the cosine of
the angle between the two vectors, ranging from `-1` (opposite meaning) through `0` (unrelated) to
`1` (identical meaning). For normalized text embeddings, this is the standard metric — easy to
interpret, supported by every embedding model, and what `text-embedding-3-small` (this project's
default) was trained to produce meaningful distances under. `PineconeService.query()` asks for the
`topK` closest vectors and returns them pre-sorted, descending by score:

```typescript
async query(vector: number[], topK: number, filter?: Record<string, unknown>): Promise<PineconeMatch[]> {
  const index = this.getIndex();
  const response = await index.query({ vector, topK, includeMetadata: true, ...(filter !== undefined ? { filter } : {}) });
  return response.matches.map((match) => ({ id: match.id, score: match.score ?? 0, metadata: match.metadata ?? {} }));
}
```

A real captured response shape (condensed, from a live `POST /rag/search` call during
verification):

```json
{
  "results": [
    {
      "chunkPublicId": "6aa5a0e9-5520-4d3e-912f-df761327ea40",
      "documentPublicId": "4f83dab3-30cc-4d37-8930-baae654bd05a",
      "documentTitle": "CloudPulse Pricing Plans",
      "content": "# CloudPulse Pricing Plans\n\nCloudPulse offers three plans...",
      "chunkIndex": 0,
      "score": 0.493115932,
      "category": "docs"
    }
  ],
  "totalResults": 5,
  "searchLatencyMs": 13130
}
```

(`searchLatencyMs: 13130` here reflects a slow sandbox network path to Pinecone during live
verification, not a typical figure — see [Semantic Search Deep Dive](#semantic-search-deep-dive)
for the calibration story behind why `similarityThreshold` was tuned against real scores like
`0.493` above.)

### How deletion cascades work

Per spec §7.4, deleting a document is a defined two-system sequence, implemented exactly as
`DocumentService.delete()`:

```typescript
async delete(publicId: string): Promise<void> {
  await this.findDocumentOrThrow(publicId);
  await this.databaseService.document.delete({ where: { publicId } });   // cascades to document_chunks
  await this.pineconeService.deleteByFilter({ documentId: publicId });   // separate — no FK to Postgres
}
```

Postgres's own `onDelete: Cascade` (on `DocumentChunk.document`) handles the relational half for
free — deleting the `documents` row automatically removes every `document_chunks` row for it, no
manual cleanup code needed. Pinecone has no concept of a foreign key into Postgres at all, so the
second call — `deleteByFilter({ documentId: publicId })`, which matches every vector whose metadata
`documentId` equals this document's `publicId` — is the _only_ mechanism that prevents orphaned
vectors from silently continuing to match future searches after their source document is gone.
This exact two-step sequence, called from `RagController`'s real route (not a bypassed unit-level
call), is what `rag-controller-delete-cascade.integration.spec.ts` structurally proves — asserting
`dbMock.document.delete` and `pineconeServiceMock.deleteByFilter` are both called, with the
Postgres delete happening first.

### Namespace and setup

All document vectors live in a single Pinecone namespace, `'documents'` by default
(`PINECONE_NAMESPACE`, `PINECONE_CONFIG.namespace`) — `PineconeService.getIndex()` scopes every
operation to it automatically. Setting up a real index (done once, manually, outside this
codebase):

1. Create a free Pinecone account at pinecone.io.
2. Create a **serverless** index with dimension `1536` (matching `text-embedding-3-small`) and
   metric `cosine`.
3. Set `PINECONE_API_KEY` and `PINECONE_INDEX` in `.env`.

---

## Database Schema

Three tables were added in `AI-036` and `AI-049`, plus one pre-existing table (`EmbeddingCache`)
was realigned — all following the same `BigInt` PK + `publicId` UUID pattern every other table in
this codebase uses.

### `documents`

```prisma
model Document {
  id               BigInt          @id @default(autoincrement())
  publicId         String          @unique @default(uuid())
  title            String
  description      String?
  sourceType       String
  originalFilename String?
  fileSize         Int?
  totalChunks      Int             @default(0)
  totalTokens      Int             @default(0)
  embeddingModel   String
  embeddingStatus  String
  category         String?
  tags             String[]
  metadata         Json?           @db.JsonB
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  chunks           DocumentChunk[]
  qaPairs          QaPair[]

  @@index([category])
  @@index([embeddingStatus])
  @@map("documents")
}
```

| Field                           | Meaning                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceType`                    | `'pdf'` \| `'txt'` \| `'md'` \| `'generated'` — the last value is only ever written by `MockDataService.generateDocuments()`.                                                                       |
| `originalFilename` / `fileSize` | Populated only for real file uploads (`ingestFromFile()`) — `null` for text-created and mock-generated documents.                                                                                   |
| `totalChunks` / `totalTokens`   | `0` until ingestion completes; updated in the same transaction-adjacent write that flips `embeddingStatus` to `'completed'`.                                                                        |
| `embeddingModel`                | Resolved and recorded at _creation_ time (`rag.embeddingModel` config), not read fresh at ingestion — records which model will actually run, even before ingestion has happened.                    |
| `embeddingStatus`               | `'pending'` → `'processing'` → `'completed'`/`'failed'` — see the [ingestion pipeline](#3-documentservice--the-whole-postgresql-side-lifecycle-of-a-document) above for the exact transition logic. |
| `tags`                          | Plain `String[]`, filterable via `hasSome` in `findAll()` — same convention Phase 1's `PromptTemplate.tags` established.                                                                            |

### `document_chunks`

```prisma
model DocumentChunk {
  id              BigInt   @id @default(autoincrement())
  publicId        String   @unique @default(uuid())
  documentId      BigInt
  chunkIndex      Int
  content         String
  tokenCount      Int
  startChar       Int
  endChar         Int
  pineconeId      String?
  embeddingStatus String
  metadata        Json?    @db.JsonB
  createdAt       DateTime @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, chunkIndex])
  @@map("document_chunks")
}
```

| Field                   | Meaning                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`               | The chunk's actual text — the source of truth PostgreSQL owns; Pinecone never stores this.                                                                                                                                            |
| `startChar` / `endChar` | Character offsets into the _original_ document text. Together with `chunkIndex` ordering, this is what makes `reconstructText()` (used by `reindexDocument()`) able to rebuild the source without a separate raw-text storage column. |
| `pineconeId`            | The exact vector ID in Pinecone this row corresponds to (`chunk_<documentPublicId>_<chunkIndex>`) — the traceability link between the two storage systems.                                                                            |
| `embeddingStatus`       | Written `'completed'` at insert time (chunks are only ever persisted _after_ their embedding succeeded) — a chunk row never exists in a `'pending'` state today.                                                                      |

**Cascade delete**: `onDelete: Cascade` means deleting a `documents` row automatically removes
every `document_chunks` row for it — no manual cleanup code, verified structurally (not just read
from the schema) by `rag-controller-delete-cascade.integration.spec.ts`.

### `embedding_cache` (realigned from the original Phase 1 scaffold)

```prisma
model EmbeddingCache {
  id         BigInt   @id @default(autoincrement())
  publicId   String   @unique @default(uuid())
  textHash   String   @unique
  embedding  Json
  model      String
  tokenCount Int?
  createdAt  DateTime @default(now())

  @@index([model])
  @@map("embedding_cache")
}
```

This table existed since Phase 1's original project scaffold, but had never been read from or
written to by any service — its shape predated this codebase's `BigInt`-PK + `publicId` convention
(`id String @default(cuid())`, no `publicId`, no `tokenCount`). Since nothing had ever used it, it
was corrected in place rather than carrying the inconsistent shape forward into the phase that
finally uses it — a genuinely safe, zero-data-migration-risk schema change. `textHash` is
`@unique`, both the natural lookup key for `get()` and what makes `set()`'s `upsert()` idempotent
without any conflict-handling code.

### `qa_pairs`

```prisma
model QaPair {
  id               BigInt   @id @default(autoincrement())
  publicId         String   @unique @default(uuid())
  question         String
  expectedAnswer   String
  sourceDocumentId BigInt
  complexity       String
  createdAt        DateTime @default(now())

  sourceDocument Document @relation(fields: [sourceDocumentId], references: [id], onDelete: Cascade)

  @@index([sourceDocumentId])
  @@index([complexity])
  @@map("qa_pairs")
}
```

`complexity` is `'simple'` \| `'multi-step'` \| `'edge-case'` (backed by the `QaComplexity` enum,
stored as a plain string column — the same enum-in-code, string-in-DB convention every other
codebase enum follows). `onDelete: Cascade` on `sourceDocument` means deleting a document also
deletes every Q&A pair generated from it — no orphaned pairs pointing at a document that no longer
exists.

### How PostgreSQL and Pinecone work together

PostgreSQL is the source of truth for **text and metadata** — the actual chunk content,
document titles, categories, tags, ingestion status. Pinecone is the source of truth for
**vectors and similarity ranking** only — it stores the embedding plus the minimal metadata needed
for filtering (`documentId`, `category`, `chunkIndex`, `tokenCount`), and is never asked to return
or store full chunk text. Every search resolves Pinecone's ranked vector IDs back to PostgreSQL for
the actual readable content (`SearchService.resolveChunks()`) — Pinecone is a _ranking_ engine in
this architecture, not a text store, exactly the split the PRD's Implementation Decisions record:
"Pinecone is optimized for vector search but not for storing/retrieving full text."

### Chunking with overlap, explained

`CHUNKING_CONFIG.chunkOverlap` defaults to `50` tokens on `chunkSize: 500`-token chunks. Without
overlap, a sentence that happens to fall exactly on a chunk boundary gets split — half of it ends
up in chunk N, half in chunk N+1, and neither chunk alone contains the complete thought. With a
50-token overlap, chunk N+1 _repeats_ the last 50 tokens of chunk N, so any sentence spanning the
boundary is fully captured in at least one chunk. `RecursiveCharacterTextSplitter`'s
`chunkOverlap` option implements this automatically; `DocumentService.toChunkDescriptors()`'s
`text.indexOf(content, searchFrom)` offset-finding logic advances `searchFrom` to `startChar + 1`
(not `endChar`) after each match specifically _because_ chunks overlap — an `endChar`-based cursor
would skip straight past the next (overlapping) chunk's actual start position.

---

## All API Endpoints — With Usage Examples

All 17 endpoints are mounted under `/api/v1/rag` and are **unauthenticated**, matching Phase 1 and
2's explicit out-of-scope decision on auth for this learning project. Every successful response is
wrapped by the global `ResponseInterceptor` (`{ success: true, data: {...}, timestamp }`) —
examples below show the `data` payload only.

### Group: Documents

#### 1. `POST /api/v1/rag/documents`

Upload a PDF, TXT, or MD file (multipart) and start ingestion immediately.

```bash
curl -X POST http://localhost:3000/api/v1/rag/documents \
  -F "file=@return-policy.pdf" \
  -F "category=faq" \
  -F "tags=policy,returns"
```

Response (`DocumentResDto`, `201`):

```json
{
  "publicId": "5f25ba6c-b42c-4394-96e3-67bc58fa6036",
  "title": "return-policy.pdf",
  "sourceType": "pdf",
  "originalFilename": "return-policy.pdf",
  "fileSize": 45230,
  "totalChunks": 2,
  "totalTokens": 765,
  "embeddingModel": "text-embedding-3-small",
  "embeddingStatus": "completed",
  "category": "faq",
  "tags": ["policy", "returns"],
  "createdAt": "2026-07-10T10:13:44.481Z",
  "updatedAt": "2026-07-10T10:13:45.138Z"
}
```

Ingestion runs **synchronously** — the request blocks until embedding completes, since this
codebase has no job queue. `title` defaults to the filename if not overridden.

#### 2. `POST /api/v1/rag/documents/text`

Create and ingest a document directly from raw text — no file involved.

```bash
curl -X POST http://localhost:3000/api/v1/rag/documents/text \
  -H "Content-Type: application/json" \
  -d '{ "title": "Quick Note", "category": "docs", "content": "Our API rate limit is 300 requests per minute on the Pro plan." }'
```

Response: same `DocumentResDto` shape as above, `sourceType: "txt"`.

#### 3. `GET /api/v1/rag/documents`

```bash
curl "http://localhost:3000/api/v1/rag/documents?category=faq&status=completed&page=1&limit=20"
```

Response (`PaginatedDocumentsResDto`, `200`): `{ data: DocumentResDto[], total, page, limit }`.
Supports `category`, `status` (maps to `embeddingStatus`), `tags` (comma-separated), `search`
(title/description, case-insensitive).

#### 4. `GET /api/v1/rag/documents/:publicId`

```bash
curl http://localhost:3000/api/v1/rag/documents/5f25ba6c-b42c-4394-96e3-67bc58fa6036
```

Response (`DocumentWithChunksResDto`, `200`) — the full document plus every chunk, ordered by
`chunkIndex`. A document with no chunks yet returns `chunks: []`, not a `404`.

#### 5. `GET /api/v1/rag/documents/:publicId/chunks`

```bash
curl "http://localhost:3000/api/v1/rag/documents/5f25ba6c-b42c-4394-96e3-67bc58fa6036/chunks?page=1&limit=10"
```

Response (`PaginatedDocumentChunksResDto`, `200`) — for inspecting exactly what text was indexed,
useful when debugging retrieval quality.

#### 6. `PATCH /api/v1/rag/documents/:publicId`

```bash
curl -X PATCH http://localhost:3000/api/v1/rag/documents/5f25ba6c-b42c-4394-96e3-67bc58fa6036 \
  -H "Content-Type: application/json" \
  -d '{ "title": "Return & Refund Policy (updated)" }'
```

Only `title`/`description`/`category`/`tags` are patchable — no re-ingestion happens.

#### 7. `DELETE /api/v1/rag/documents/:publicId`

```bash
curl -X DELETE http://localhost:3000/api/v1/rag/documents/5f25ba6c-b42c-4394-96e3-67bc58fa6036 -i
```

`204 No Content`. Cascades chunks in PostgreSQL and vectors in Pinecone (see
[Deletion cascades](#how-deletion-cascades-work) above).

#### 8. `POST /api/v1/rag/documents/:publicId/reindex`

```bash
curl -X POST http://localhost:3000/api/v1/rag/documents/5f25ba6c-b42c-4394-96e3-67bc58fa6036/reindex
```

Reconstructs the original text from existing chunks, deletes the old chunks/vectors, and
re-ingests from scratch — useful after a chunking-config change.

### Group: Search

#### 9. `POST /api/v1/rag/search`

```bash
curl -X POST http://localhost:3000/api/v1/rag/search \
  -H "Content-Type: application/json" \
  -d '{ "query": "How do I return an item?", "topK": 5, "category": "faq" }'
```

Response (`SearchResDto`, `201`):

```json
{
  "results": [
    {
      "chunkPublicId": "f9eed391-db4e-4390-bf2a-f8d11e76bdfe",
      "documentPublicId": "5f25ba6c-b42c-4394-96e3-67bc58fa6036",
      "documentTitle": "CloudPulse Subscription Return & Refund Policy",
      "content": "Customers who purchase a Pro or Enterprise subscription may request a full refund within 30 days...",
      "chunkIndex": 0,
      "score": 0.57,
      "category": "faq"
    }
  ],
  "totalResults": 1,
  "searchLatencyMs": 120
}
```

**When you'd use this:** verifying retrieval quality in isolation, before ever involving
generation — the exact endpoint used to measure the similarity-threshold calibration described in
[Semantic Search Deep Dive](#semantic-search-deep-dive).

### Group: Q&A (RAG)

#### 10. `POST /api/v1/rag/ask`

```bash
curl -X POST http://localhost:3000/api/v1/rag/ask \
  -H "Content-Type: application/json" \
  -d '{ "question": "What is the return policy?", "temperature": 0.3 }'
```

Response (`AskResDto`, `201`):

```json
{
  "answer": "According to the documentation, Pro and Enterprise subscriptions may be refunded in full within 30 days of purchase. [Source: CloudPulse Subscription Return & Refund Policy]",
  "model": "tencent/hy3:free",
  "sources": [
    {
      "documentTitle": "CloudPulse Subscription Return & Refund Policy",
      "documentPublicId": "5f25ba6c-b42c-4394-96e3-67bc58fa6036",
      "chunkContent": "Customers who purchase a Pro or Enterprise subscription may request a full refund within 30 days...",
      "chunkIndex": 0,
      "similarityScore": 0.57
    }
  ],
  "usage": { "inputTokens": 450, "outputTokens": 85, "totalTokens": 535 },
  "estimatedCost": 0,
  "latencyMs": 2300,
  "chunksRetrieved": 1,
  "searchLatencyMs": 120,
  "generationLatencyMs": 2180
}
```

`includeSourceChunks: false` in the request body strips `sources` to `[]`; omitted or `true` keeps
them (the controller's `toAskRes()` mapping default).

#### 11. `POST /api/v1/rag/ask/conversation/:publicId`

```bash
curl -X POST http://localhost:3000/api/v1/rag/ask/conversation/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b \
  -H "Content-Type: application/json" \
  -d '{ "question": "What is the return policy?" }'
```

Same `AskResDto` response shape — but the turn is persisted into the existing conversation's
`chat_messages` history (see [RAG Deep Dive](#rag-within-a-conversation) below), so a follow-up
question like "tell me more about that" in a subsequent `POST /chat/conversations/:publicId/
messages` call correctly resolves "that" against this turn. `404` if the conversation doesn't
exist.

### Group: Mock Data

#### 12. `POST /api/v1/rag/mock/generate-documents`

```bash
curl -X POST http://localhost:3000/api/v1/rag/mock/generate-documents \
  -H "Content-Type: application/json" \
  -d '{ "count": 5, "categories": ["guide", "faq"] }'
```

Response: `DocumentResDto[]`, `201` — every returned document has already been fully ingested.

#### 13. `POST /api/v1/rag/mock/generate-qa`

```bash
curl -X POST http://localhost:3000/api/v1/rag/mock/generate-qa \
  -H "Content-Type: application/json" \
  -d '{ "count": 20 }'
```

Response: `QaPairResDto[]`, `201` — `count * 0.6` simple, `count * 0.25` multi-step, the remainder
edge-case.

#### 14. `POST /api/v1/rag/mock/seed`

```bash
curl -X POST http://localhost:3000/api/v1/rag/mock/seed
```

Response (`SeedResultResDto`, `201`): `{ "documents": 50, "qaPairs": 500 }` — the full faker-based
default seed (5 categories × 10 documents, 10 Q&A pairs per document).

#### 15. `POST /api/v1/rag/mock/seed-realistic`

```bash
curl -X POST http://localhost:3000/api/v1/rag/mock/seed-realistic
```

Response: `{ "documents": 10, "qaPairs": 50 }` — the hand-written CloudPulse dataset (see
[Mock Data & Evaluation](#mock-data--evaluation)). Takes 2–3 minutes on a cold embedding cache,
seconds on a warm one (identical content re-ingested hits the cache on every chunk).

#### 16. `GET /api/v1/rag/mock/qa-pairs`

```bash
curl "http://localhost:3000/api/v1/rag/mock/qa-pairs?complexity=simple&page=1&limit=20"
```

Response (`PaginatedQaPairsResDto`, `200`) — inspect what a future evaluation run will actually
test before spending API budget on it.

### Group: Evaluation

#### 17. `POST /api/v1/rag/evaluate`

```bash
curl -X POST http://localhost:3000/api/v1/rag/evaluate \
  -H "Content-Type: application/json" \
  -d '{ "sampleSize": 50 }'
```

Response (`EvaluateResDto`, `201`) — a real captured result from the realistic dataset after the
similarity-threshold recalibration (see [Mock Data & Evaluation](#mock-data--evaluation)):

```json
{
  "totalQuestions": 50,
  "correct": 37,
  "partiallyCorrect": 0,
  "incorrect": 5,
  "appropriateIDK": 8,
  "accuracy": 0.74,
  "avgLatencyMs": 29413,
  "avgTokens": 2810,
  "byComplexity": {
    "simple": { "total": 30, "correct": 27, "accuracy": 0.9 },
    "multi-step": { "total": 10, "correct": 10, "accuracy": 1 },
    "edge-case": { "total": 10, "correct": 8, "accuracy": 0.8 }
  }
}
```

Alternatively, evaluate an explicit set of pairs without reading the database at all:

```bash
curl -X POST http://localhost:3000/api/v1/rag/evaluate \
  -H "Content-Type: application/json" \
  -d '{ "qaPairs": [{ "question": "What is the Pro plan price?", "expectedAnswer": "$12/user/month", "complexity": "simple" }] }'
```

`sampleSize` is bounded to `200` at both the DTO level (`@Max(200)`) and the service level
(`Math.min(sampleSize, MAX_EVAL_SAMPLE_SIZE)`) — a request for `500` is rejected with a `400`
before the service ever runs.

### Group: Stats

#### `GET /api/v1/rag/stats`

```bash
curl http://localhost:3000/api/v1/rag/stats
```

Response (`StatsResDto`, `200`):

```json
{
  "totalDocuments": 10,
  "totalChunks": 21,
  "totalVectors": 21,
  "cacheHitRate": 0.99,
  "embeddingModel": "text-embedding-3-small",
  "indexDimensions": 1536
}
```

The one route that legitimately aggregates three different services in one call
(`DocumentService.getStats()`, `EmbeddingCacheService.getCacheStats()`,
`PineconeService.describeIndex()`) — every other route in this controller delegates to exactly
one service. If Pinecone is unreachable, `totalVectors`/`indexDimensions` degrade to `0`/`undefined`
rather than failing the whole response — document/chunk/cache stats stay useful even when Pinecone
is down, proven live against a genuinely broken Pinecone connection during `AI-051`'s
verification.

---

## RAG Deep Dive

### The full flow, step by step, with real code

```
1. SearchService.search(question, options)
     → embed the question (cache-checked)
     → PineconeService.query(embedding, topK, filter)
     → filter out matches below similarityThreshold
     → resolve surviving matches to real chunk text + document title
2. buildAugmentedMessages(question, results)
     → [ { role: 'system', content: RAG_CONFIG.systemPrompt },
         { role: 'user', content: `${contextBlock}\n\nQuestion: ${question}` } ]
3. OpenaiService.chatCompletionWithMessages({ messages, temperature: 0.3 })
     → the exact same audited, retried, cost-tracked call every other completion uses
4. Map the raw completion + the retrieval results into a RagResult
     → sources come from step 1's real data, never parsed from the model's own text
```

### The system prompt, and why it forces citations

```typescript
export const RAG_CONFIG = {
  // ...
  systemPrompt:
    "You are a knowledgeable assistant. Answer the user's question using ONLY the provided " +
    `context documents. If the context doesn't contain the answer, say "${NO_INFO_SENTINEL}" ` +
    'Always cite which document(s) you used in your answer using [Source: filename] format.',
} as const;
```

This is a **prompt-level control, not a code-level guarantee** — nothing in the code parses the
model's output to verify it actually cited a source or actually refused an unanswerable question.
Without an explicit instruction like this, a model tends to blend its training-data knowledge with
the provided context, producing plausible-sounding answers that may not actually be grounded in
what was retrieved — the entire reason RAG exists is defeated if the model quietly ignores the
context and answers from memory instead. Compliance with this instruction is verified by live
testing against real model behavior (see [SC-RAG-003/004] in the spec), not by a deterministic
unit test — a test can assert the prompt _contains_ the citation instruction, but can't fully
guarantee the model obeys it.

### How context tokens are managed

For a plain `POST /rag/ask` call (no conversation), there's no sliding-window trimming at all —
the augmented message array is always exactly two messages (system + user), and
`RAG_CONFIG.maxContextTokens` (4,000, configurable via `RAG_MAX_CONTEXT_TOKENS`) exists as a
documented budget but isn't actively enforced by truncating the context block in code today; in
practice, `topK` (default 5) chunks of `chunkSize` (500) tokens each naturally stays well under
that ceiling. For `queryWithConversation()`, real token-budget enforcement _does_ run — see
[RAG within a conversation](#rag-within-a-conversation) below, which reuses Phase 2's exact
sliding-window math.

### What happens when no relevant documents are found

```typescript
private buildContextBlock(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'Context: No relevant documents were found for this question.';
  }
  // ...numbered, titled chunk list
}
```

`RagService.query()` never short-circuits on an empty search result — it still calls the model,
with a context block that plainly states nothing relevant was found. The "I don't have enough
information" response is entirely the model's own decision, driven by the system prompt's explicit
instruction for exactly this situation — not a hardcoded early return. This keeps every refusal
(whether triggered by zero results or by results that don't actually answer the question) going
through the identical code path and identical phrasing logic.

### RAG within a conversation

`queryWithConversation()` (covered in full under [RagService](#6-ragservice--retrieval--generation-with-citations)
above) is the one place `RagModule` reaches into Phase 2's `ChatService`. The short version: it
resolves the conversation's internal id via the new `getConversationHandle()` method, persists the
plain question as a normal user message _before_ retrieval (crash-resilience — same ordering
`ChatService.sendMessage()` itself uses), splices the retrieved context into only the in-memory
copy of the last message sent to the model (never the stored row), enforces Phase 2's own
sliding-window token budget by dropping the lowest-ranked retrieved chunk first if needed, and
persists the assistant's answer as a completely normal assistant message. The net effect: `GET
/chat/conversations/:publicId` shows a RAG-augmented turn exactly the same way it shows any other
turn — the question, then the answer — with no special-cased storage format for a client to know
about.

---

## Embedding & Chunking Deep Dive

### How embeddings work — text in, 1,536 numbers out

`text-embedding-3-small` (this project's default model) takes a string of text and returns an
array of 1,536 floating-point numbers — a single point in a 1,536-dimensional space. The model was
trained so that text with similar meaning maps to nearby points; the specific numbers themselves
are not human-interpretable, but the _distance_ between two embeddings is a reliable proxy for how
semantically related the two pieces of text are. `OpenaiService.generateEmbedding()` is the single
call site in this entire app that produces one: `openaiClient.embeddings.create({ model, input })`
→ `response.data[0].embedding`.

### Why overlapping chunks matter — context at boundaries

Covered in full under [Chunking with overlap, explained](#chunking-with-overlap-explained) above.
The short version: a document's natural sentence and paragraph breaks rarely land exactly on
500-token boundaries, and without overlap, a sentence spanning two chunks would have half its
meaning in each — neither chunk alone would embed to a vector that reflects the complete thought.
A 50-token overlap (10% of `chunkSize`) means the tail of chunk N is repeated as the head of chunk
N+1, so any boundary-straddling sentence is fully captured in at least one of the two.

### The embedding cache — SHA-256 hash dedup

Every text that gets embedded — a document chunk, or a search query — is first checked against
`embedding_cache` by `SHA-256(text.trim().toLowerCase())`. A cache hit costs one indexed
PostgreSQL lookup (fast, free) instead of an OpenAI API round-trip (slower, costs money). Two
concrete places this pays off directly: re-ingesting an unchanged document costs zero embedding
calls (every chunk's hash already exists), and asking the same question twice costs one embedding
call total, not two. `getCacheStats()` exposes `hits`/`misses`/`totalCached` via `GET /rag/stats`'s
`cacheHitRate` field — during live verification of the realistic dataset, re-seeding an unchanged
set of 10 documents measured a `cacheHitRate` of `0.99`.

### Batch processing for rate-limit friendliness

`DocumentService.embedChunks()` groups every cache-miss chunk into batches of
`EMBEDDING_CONFIG.batchSize` (20, configurable via `EMBEDDING_BATCH_SIZE`) and calls
`OpenaiService.generateEmbeddingsBatch()` once per batch, rather than issuing one HTTP request per
chunk. The OpenAI embeddings endpoint natively accepts an array `input`, so no manual
request-throttling or queueing logic is needed inside `OpenaiService` itself — a 50-chunk document
becomes 3 batched API calls (⌈50/20⌉), not 50 individual ones, which is what keeps a large document
upload from tripping rate limits on its own.

---

## Semantic Search Deep Dive

### Cosine similarity explained with examples

Cosine similarity measures the angle between two vectors, ignoring their magnitude — for text
embeddings, this translates roughly to "how aligned in meaning are these two pieces of text,"
scored `0` (unrelated) to `1` (identical meaning). It's the standard metric for embedding-based
search precisely because it doesn't care about text _length_, only _direction_ in the embedding
space — a one-sentence chunk and a five-paragraph chunk about the same topic can still score highly
similar to a short query about that topic.

### `topK` and similarity threshold — and the real calibration story

`topK` (default `5`, `RAG_TOP_K`) bounds how many candidate chunks Pinecone returns before any
threshold filtering. `similarityThreshold` (default **`0.3`**, `RAG_SIMILARITY_THRESHOLD`) is the
floor below which a match is discarded entirely.

That `0.3` default is not the spec's original number — the spec and the first implementation both
shipped with `0.7`, following the reasoning that `0.7` "sounds like a sensible bar for relevance."
Live verification against a real Pinecone index told a different story. Measuring `POST
/rag/search` directly against both faker-generated mock content _and_ hand-written, coherent,
keyword-rich English documents, real relevant-match scores clustered at **0.4–0.6** —
even a query that near-verbatim copied a target chunk's own sentence
("Verified nonprofits and educational institutions receive 50% off Pro and Enterprise plans")
scored only `0.57` against that exact chunk. At the original `0.7` threshold, the overwhelming
majority of genuinely answerable questions retrieved _zero_ chunks and the model correctly (but
uselessly, for evaluation purposes) fell back to "I don't have enough information" — producing an
evaluation accuracy pattern that looked _backwards_ (simple questions scoring near `0%`,
edge-case questions scoring `100%`, since edge-case is the one tier where refusing is the right
answer). Lowering the threshold to `0.3` — informed directly by the measured score distribution,
not a guess — reversed this completely: a re-run against the same realistic dataset scored
`simple: 90%`, `multi-step: 100%`, `edge-case: 80%`. This is documented in full, with the exact
measurements, in `CLAUDE.md`'s "Similarity threshold recalibration" section and
`docs/issues/AI-055-live-api-smoke-test-rag.md`.

**The practical lesson:** a threshold that "sounds reasonable" on paper needs to be checked against
_this specific pipeline's_ actual score distribution — `text-embedding-3-small` against ~500-token,
multi-topic chunks simply doesn't produce `0.8`+ scores for realistic short factual questions,
regardless of how coherent or keyword-matched the source content is.

### Category and document filtering

`SearchOptions.categoryFilter`/`documentIds` translate into a Pinecone metadata filter, applied
_before_ the vector search itself (not a post-filter on results):

```typescript
private buildFilter(options: SearchOptions): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  if (options.categoryFilter) filter.category = options.categoryFilter;
  if (options.documentIds?.length) filter.documentId = { $in: options.documentIds };
  return Object.keys(filter).length > 0 ? filter : undefined;
}
```

A search with `category: 'faq'` only ever considers vectors whose stored metadata has
`category: 'faq'` — this is what powers "search within FAQ documents only" (spec SC-RAG-012) or
"search within this one document" (via `documentIds: [publicId]`) without either feature needing
any code beyond passing the right filter object through to Pinecone.

---

## Mock Data & Evaluation

### How faker generates structured documents

`MockDataService`'s five category templates (guide/FAQ/docs/tutorial/changelog) each define a
`header` and a `nextSection(index)` function. `faker.commerce.productName()`, `faker.hacker.noun()`,
`faker.system.semver()`, `faker.date.past()`, etc. are injected into the _structural_ elements —
headings, CLI commands, version numbers, API endpoint paths — so every generated document has a
deterministic, category-appropriate shape (numbered install steps for a guide, `## [x.y.z] - date`
version headers for a changelog) rather than being lorem-ipsum text under a random heading.
`faker.lorem.*` is used only for prose _body_ text within those structural sections.

### Three complexity tiers for Q&A pairs

`generateQAPairs()` splits `60% simple / 25% multi-step / 15% edge-case` (remainder-after-rounding
absorbed into edge-case, so the three counts always sum exactly to the requested total):

- **Simple** — `expectedAnswer` is exactly one chunk's own content; the question names that chunk's
  own topic (extracted from its leading markdown heading).
- **Multi-step** — compares two documents (or two chunks of one document, as a fallback), with
  `expectedAnswer` concatenating both source chunks.
- **Edge-case** — a hardcoded, deliberately off-topic question pool (solar eclipses, time
  machines), paired with `RAG_CONFIG.noInfoSentinel` verbatim as `expectedAnswer`.

### Why faker content wasn't enough, and what replaced it

The first live evaluation run (against faker-generated mock documents) produced a strange result:
`simple`/`multi-step` accuracy near `0%`, `edge-case` accuracy `100%` — the _opposite_ of what a
working RAG pipeline should show. The original hypothesis was that `faker.lorem.paragraph()`'s
meaningless Latin placeholder text produces weak, diffuse embeddings that don't align well with a
coherent natural-language question, even when the surrounding structure (a real heading, a real
endpoint path) is genuine.

To test that hypothesis directly, a second dataset was built: `src/modules/rag/seed-data/` holds 10
hand-written, internally-consistent Markdown documents (~700–1,000 words each) about a fictional
"CloudPulse" SaaS product — real facts, real numbers, no faker anywhere — plus a matching
`qa-pairs.json` (50 pairs, 5 per document). `MockDataService.seedRealisticDataset()` ingests every
file through the real `DocumentService.ingestFromFile()` pipeline and persists the Q&A pairs as
real `QaPair` rows, tagged `'realistic-seed'` to stay independently filterable from `'mock-data'`.

Running the identical evaluation against this _coherent, hand-written_ content produced the
**same** qualitative failure pattern. That result is what proved the real bottleneck was the
similarity threshold itself, not content quality — see [the calibration story above]
(#topk-and-similarity-threshold--and-the-real-calibration-story) for the full measurement and the
fix. Both datasets — `generateDocuments()`'s faker-based one and `seedRealisticDataset()`'s
hand-written one — remain available side by side; neither replaced the other, and `evaluate()`
works against either (or an ad hoc `qaPairs` array supplied directly in the request body).

### How evaluation scoring works

```typescript
private classifyAnswer(complexity: string, expectedAnswer: string, answer: string): EvaluationClassification {
  if (complexity === QaComplexity.EDGE_CASE) {
    return this.looksLikeIDK(answer) ? 'appropriateIDK' : 'incorrect';
  }
  const overlap = this.keywordOverlapRatio(expectedAnswer, answer);
  if (overlap >= 0.5) return 'correct';
  if (overlap >= 0.2) return 'partiallyCorrect';
  return 'incorrect';
}
```

Edge-case pairs are graded purely on whether the model _declined_ to answer (checked via a list of
"I don't have enough information"-style paraphrases, `IDK_PHRASES`) — never on content similarity,
since a confidently-wrong answer that happens to share vocabulary with the refusal sentinel (e.g.
the word "information") should still be marked wrong. Simple/multi-step pairs use a keyword-overlap
ratio between `expectedAnswer` and the generated answer — a cheap proxy for correctness, explicitly
not a ground-truth grader, chosen because exact-string matching is unreliable given normal LLM
phrasing variance and a full LLM-as-judge grader would mean a third paid API call per evaluated
question. `byComplexity[tier].correct` has tier-dependent meaning: "declined correctly" for
edge-case, "answered correctly" for simple/multi-step — both computed as `correct / total`
underneath, just with a different numerator per tier.

---

## How Phase 1 and Phase 2 Services Are Reused

| Service                                                          | From                          | How Phase 3 uses it                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenaiService`                                                  | Phase 1                       | Extended with `generateEmbedding()`/`generateEmbeddingsBatch()` — every embedding call in `RagModule` goes through it, inheriting retry/circuit-breaker/audit/cost for free. `chatCompletionWithMessages()` (Phase 2's own extension) is reused as-is for RAG's generation step. |
| `TokenService`                                                   | Phase 1                       | `countTokens()` drives `RecursiveCharacterTextSplitter`'s token-accurate chunk sizing; also used in `queryWithConversation()`'s budget math.                                                                                                                                     |
| `AiAuditService`                                                 | Phase 1                       | Every embedding call is automatically audited inside `OpenaiService.generateEmbedding()`/`generateEmbeddingsBatch()`, `endpoint: 'embeddings'` — no new audit infrastructure.                                                                                                    |
| `ModelRegistryService`                                           | Phase 1                       | `findModelByModelId()` supplies `contextWindow` for `queryWithConversation()`'s sliding-window budget — the exact same lookup Phase 2's `ChatService.buildContext()` already uses.                                                                                               |
| `RetryService`                                                   | Phase 1 (via `OpenaiService`) | Reused unmodified for every embedding call, transitively — an embedding call that trips the circuit breaker throws the identical `CircuitOpenException` chat completions already produce.                                                                                        |
| `ChatService`                                                    | Phase 2                       | `buildContext()`, `addUserMessage()`, `addAssistantMessage()` reused as-is; `getConversationHandle()` is one small, purely-additive new method — `queryWithConversation()`'s only reason to reach into Phase 2 at all.                                                           |
| `chatConfig` (`contextWindowPercentage`, `defaultContextWindow`) | Phase 2                       | Read directly by `RagService.resolveContextBudget()` — the same budget formula Phase 2's `buildContext()` uses, not a parallel RAG-specific concept.                                                                                                                             |

**The "never call the SDK directly" rule, once more preserved:** every embedding call in this
module goes through `OpenaiService`; every generation call goes through
`chatCompletionWithMessages()`. `PineconeService` is the one new SDK boundary this phase
introduces (Pinecone has no Phase 1/2 equivalent to reuse) — and it follows the exact same
"single narrow service owns the whole SDK surface" shape `OpenaiModule`'s `OPENAI_CLIENT` and
Phase 2's `StreamingService` already established.

---

## Constants, Enums, Environment Variables

### Constants & Enums Reference

| Enum / Constant      | Values                                                                                                                                                                                                                        | Used for                                                                                                                                        | Notes                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DocumentSourceType` | `PDF`, `TXT`, `MD`, `GENERATED`                                                                                                                                                                                               | `Document.sourceType`                                                                                                                           | `as const` object + derived union, not a native TypeScript `enum` — same convention every Phase 3 "enum" follows, since `@IsIn()` (not `@IsEnum()`) validates these DTO fields.                                                   |
| `EmbeddingStatus`    | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`                                                                                                                                                                                | `Document.embeddingStatus`, `DocumentChunk.embeddingStatus`                                                                                     | Drives the ingestion pipeline's status transitions — see [DocumentService](#3-documentservice--the-whole-postgresql-side-lifecycle-of-a-document).                                                                                |
| `DocumentCategory`   | `GUIDE`, `FAQ`, `DOCS`, `TUTORIAL`, `CHANGELOG`                                                                                                                                                                               | `Document.category`; `MockDataService`'s round-robin template selection                                                                         | Five values map 1:1 to `MockDataService`'s five document templates.                                                                                                                                                               |
| `QaComplexity`       | `SIMPLE` (`'simple'`), `MULTI_STEP` (`'multi-step'`), `EDGE_CASE` (`'edge-case'`)                                                                                                                                             | `QaPair.complexity`; `evaluate()`'s `byComplexity` breakdown keys                                                                               | The one Phase 3 constant with a real derived TypeScript union type export, not just an `as const` object.                                                                                                                         |
| `CHUNKING_CONFIG`    | `chunkSize: 500`, `chunkOverlap: 50`, `minChunkSize: 100`, `separators: ['\n\n', '\n', '. ', ' ', '']`                                                                                                                        | Fallback defaults for `chunkText()`, used only where `ragConfig` doesn't have a corresponding env var (`minChunkSize`, `separators` have none). | `chunkSize`/`chunkOverlap` prefer the live `rag` config namespace at call sites; this constant is the fallback.                                                                                                                   |
| `RAG_CONFIG`         | `topK: 5`, `similarityThreshold: 0.3` (recalibrated from `0.7` — see [Semantic Search Deep Dive](#topk-and-similarity-threshold--and-the-real-calibration-story)), `maxContextTokens: 4000`, `noInfoSentinel`, `systemPrompt` | RAG generation defaults                                                                                                                         | `noInfoSentinel` and `systemPrompt` have no env var — they're prompt-engineering constants, not tunable deployment config. `systemPrompt` is built from `noInfoSentinel` via template literal, so both share one source of truth. |
| `EMBEDDING_CONFIG`   | `model: 'text-embedding-3-small'`, `dimensions: 1536`, `batchSize: 20`, `maxRetries: 3`                                                                                                                                       | Fallback defaults for embedding calls                                                                                                           | `maxRetries` is defined but not separately wired — embedding calls reuse `RetryService`'s own general `maxRetries` config, not a dedicated embedding-specific retry count.                                                        |
| `PINECONE_CONFIG`    | `namespace: 'documents'`, `metric: 'cosine'`                                                                                                                                                                                  | Fallback defaults for `PineconeService`                                                                                                         | `metric` has no env var — it's fixed at index-creation time on Pinecone's own side, not something this app's config can change after the fact.                                                                                    |

### Environment Variables

| Variable                   | Required | Default                          | Controls                                                                                                                                                                               |
| -------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PINECONE_API_KEY`         | No       | — (`undefined`)                  | Auth for the Pinecone client. Missing → `PineconeService`'s client is `null`, every vector operation throws `ServiceUnavailableException` (503) at call time, but the app still boots. |
| `PINECONE_INDEX`           | No       | — (`undefined`)                  | Which Pinecone index to use. Same graceful-degradation behavior as above when unset.                                                                                                   |
| `PINECONE_NAMESPACE`       | No       | `'documents'`                    | Which namespace inside the index every operation is scoped to.                                                                                                                         |
| `EMBEDDING_MODEL`          | No       | `'text-embedding-3-small'`       | Which OpenAI embedding model `generateEmbedding()`/`generateEmbeddingsBatch()` default to when no `model` is passed explicitly.                                                        |
| `EMBEDDING_DIMENSIONS`     | No       | `1536`                           | Recorded config value — must match the dimension the real Pinecone index was created with, or upserts fail.                                                                            |
| `EMBEDDING_BATCH_SIZE`     | No       | `20`                             | How many cache-miss chunks `embedChunks()` groups per `generateEmbeddingsBatch()` call.                                                                                                |
| `RAG_TOP_K`                | No       | `5`                              | Default number of chunks `SearchService.search()` asks Pinecone for.                                                                                                                   |
| `RAG_SIMILARITY_THRESHOLD` | No       | `0.3` (recalibrated — was `0.7`) | The minimum cosine similarity score a match must clear to survive `SearchService.search()`'s filter.                                                                                   |
| `RAG_MAX_CONTEXT_TOKENS`   | No       | `4000`                           | Documented budget for retrieved context — not actively enforced by truncation in code today (see [How context tokens are managed](#how-context-tokens-are-managed)).                   |
| `CHUNK_SIZE`               | No       | `500`                            | Target tokens per chunk, passed to `RecursiveCharacterTextSplitter`.                                                                                                                   |
| `CHUNK_OVERLAP`            | No       | `50`                             | Overlapping tokens between adjacent chunks.                                                                                                                                            |

All eleven are `@IsOptional()` in `env.validation.ts` — a fresh clone with zero RAG-related env
vars set boots cleanly and behaves identically to one with every value explicitly set to its
default, exactly Phase 2's own `chat.*` precedent. `PINECONE_API_KEY`/`PINECONE_INDEX` were
originally hard-required (`!`-asserted) in the very first version of this phase's scaffold — made
optional specifically so a developer without a Pinecone account can still boot and explore every
other part of the app.

---

## How to Explain This to Others

**One-liner:**

> Phase 3 gives the model its own searchable library — upload documents, and it answers questions
> using only what's actually in them, with citations, instead of guessing from training data.

**30-second version:**

> Phases 1 and 2 gave us a reliable way to talk to a model and hold a conversation with it — but
> every answer still came exclusively from what the model memorized during training. Phase 3 adds
> Retrieval-Augmented Generation: documents get uploaded, split into overlapping chunks, and
> converted into vectors (embeddings) stored in Pinecone, a database built for "which of these is
> most similar to this" search. When a user asks a question, the app converts the question into
> the same kind of vector, asks Pinecone for the closest matching chunks, hands those chunks to the
> model with strict instructions to answer only from them and cite sources, and returns a grounded
> answer instead of a guess. Every embedding call and every generation call still goes through
> Phase 1's exact same retry, circuit-breaker, and audit-logging pipeline — this phase adds zero
> new SDK-calling code, only new ways to build the request.

**2-minute version:**

> Phase 3 adds a new `RagModule` with seven services on top of Phase 1's `OpenaiModule` and Phase
> 2's `AiChatModule`. `DocumentService` owns the whole lifecycle of a document: parsing (PDF via
> `pdf-parse`, TXT/MD directly), chunking with LangChain's `RecursiveCharacterTextSplitter` using
> real token counts (not character estimates) and 50-token overlaps so no sentence gets silently
> split across a chunk boundary, then embedding each chunk — checking a SHA-256-hash-based cache
> first, so re-ingesting unchanged content or asking a repeated question costs nothing extra — and
> upserting the results to Pinecone in batches to stay rate-limit friendly.
>
> `PineconeService` is the single boundary to the Pinecone SDK — vector CRUD only, no business
> logic, always scoped to one namespace. `SearchService` turns a question into a vector, asks
> Pinecone for the closest matches, filters out anything below a similarity threshold, and joins
> the survivors back to PostgreSQL for their actual readable text — PostgreSQL owns text and
> metadata, Pinecone owns vectors and ranking, and search always resolves one to the other rather
> than treating Pinecone as a text store.
>
> `RagService` is the orchestrator: it calls `SearchService` for retrieval, builds an augmented
> prompt (a system message that forces citations and an "I don't know" fallback, plus a user
> message with the retrieved context), and calls Phase 2's `chatCompletionWithMessages()` for
> generation — no new LLM-calling code anywhere in this module. `queryWithConversation()` splices
> retrieved chunks into an ongoing chat's context without inventing a new storage concept, respecting
> Phase 2's own context-window budget by dropping the weakest chunk first if things don't fit.
>
> `MockDataService` generates realistic-structured fake documents and three-tier Q&A pairs
> (simple/multi-step/edge-case) for testing the pipeline, plus an `evaluate()` that runs real
> questions through the real pipeline and scores accuracy with a documented heuristic. A genuinely
> interesting finding came out of live testing here: the first evaluation run showed simple
> questions scoring near 0% and edge-case questions scoring 100% — backwards from what a working
> pipeline should show. It turned out `text-embedding-3-small` against this pipeline's ~500-token,
> multi-topic chunks just doesn't produce the high similarity scores the original 0.7 threshold
> assumed, even for hand-written, coherent, keyword-matched content — real relevant matches scored
> 0.4–0.6. Lowering the threshold to 0.3, informed directly by that measurement, completely
> reversed the pattern: 90% simple, 100% multi-step, 80% edge-case on a re-run. That's the value of
> live verification this codebase keeps coming back to — a fully-mocked test suite could never
> have surfaced a miscalibration that only shows up against a real embedding model and a real
> vector index.

---

## Implementation Stats

- **Issues completed:** 20 (`AI-036` through `AI-055`), all marked `completed` — combined with
  Phase 1's 14 and Phase 2's 21, all 55 issues across all three PRDs are now done. See
  `docs/issues/index.md`. Phase 3's PRD (`docs/prd/2026-07-08-vector-search-rag.md`) is marked
  `completed`.
- **Services:** 7 (`EmbeddingService` — empty shell, `EmbeddingCacheService`, `DocumentService`,
  `PineconeService`, `SearchService`, `RagService`, `MockDataService`), plus 2 new methods on
  Phase 1's `OpenaiService` (`generateEmbedding()`, `generateEmbeddingsBatch()`) and 1 new method
  on Phase 2's `ChatService` (`getConversationHandle()`).
- **API endpoints:** 17, across 6 groups (documents, search, Q&A, mock data, evaluation, stats) —
  all under `/api/v1/rag`.
- **Database tables added:** 3 new (`documents`, `document_chunks`, `qa_pairs`), plus 1 realigned
  (`embedding_cache`, corrected from its original Phase 1-scaffold shape to this codebase's
  `BigInt`-PK + `publicId` convention).
- **New npm dependencies:** `@pinecone-database/pinecone`, `langchain`, `@langchain/openai`,
  `@langchain/community`, `@langchain/core`, `@langchain/textsplitters`, `pdf-parse`,
  `@faker-js/faker`, `axios` (promoted from transitive to direct), `@types/multer` (dev).
  Notably, `@langchain/openai` and `@langchain/community`'s `PDFLoader` are installed but
  never actually imported — see [LangChain Integration](#what-we-deliberately-dont-use--even-narrower-than-the-spec-originally-called-for).
- **Mock/seed data:** faker-based (`generateDocuments()`/`generateQAPairs()`, up to 50
  documents/500 Q&A pairs via `seedDefaultDataset()`) plus a hand-written realistic dataset (10
  CloudPulse documents, 50 Q&A pairs, `seedRealisticDataset()`) built specifically to isolate a
  content-quality question from a threshold-calibration question during live evaluation.
- **Unit + integration tests:** 190 passing across 12 spec files in `src/modules/rag/__tests__/`,
  bringing the full repo suite to 475 passing tests overall, with zero changes to any Phase 1/2
  spec file's assertions:

  | Spec file                                           | Tests |
  | --------------------------------------------------- | ----- |
  | `rag.controller.spec.ts`                            | 47    |
  | `mock-data.service.spec.ts`                         | 32    |
  | `document-upload-reindex.service.spec.ts`           | 13    |
  | `document.service.spec.ts`                          | 11    |
  | `pinecone.service.spec.ts`                          | 11    |
  | `search.service.spec.ts`                            | 11    |
  | `document-ingestion.service.spec.ts`                | 10    |
  | `document-parse-chunk.service.spec.ts`              | 10    |
  | `embedding-cache.service.spec.ts`                   | 9     |
  | `rag.service.spec.ts`                               | 17    |
  | `document-dtos.spec.ts`                             | 17    |
  | `rag-controller-delete-cascade.integration.spec.ts` | 2     |

- **Live smoke-tested end to end** (`AI-055` plus a same-day follow-up), not just unit-tested:
  real document ingestion against a real Pinecone index (`ai-product-integration-dev`, serverless,
  AWS `us-east-1`, dimension 1536, cosine), real semantic search, real RAG answers with correct
  citations, the "I don't have enough information" fallback for an unanswerable question, and the
  full FR-RAG-009 delete cascade (confirmed via direct `psql` and a direct Pinecone vector
  `fetch`) — plus the similarity-threshold recalibration described throughout this document,
  which only surfaced because of live verification against a real embedding model and a real
  vector index; no amount of mocked unit testing could have found it.
