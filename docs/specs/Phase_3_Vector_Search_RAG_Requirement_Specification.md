# Phase 3: Vector Search & RAG — Requirement Specification

**For**: Engineering team (L&D — G3 AI Product Integration)
**Created**: 2026-07-08
**Status**: Draft
**Goal Document**: `G3_AI_Product_Integration.pdf`
**Depends On**: Phase 1 (OpenAI API Foundations — completed), Phase 2 (Chat, Streaming, Function Calling — completed)

---

## 1. Overview

Phase 3 builds the intelligence layer — the ability for the AI to answer questions using YOUR documents instead of its training data. This is **Retrieval-Augmented Generation (RAG)**, the most valuable AI integration pattern for enterprise applications. Instead of the AI guessing or hallucinating, it first searches a knowledge base, finds relevant information, and then generates an answer grounded in real documents with citations.

This phase covers everything from the goal doc's "Vector Search & RAG" learning area plus Practice App 1 (Knowledge Base Q&A) and the tools Pinecone, LangChain, and @faker-js/faker for mock data.

| System                  | Purpose                                                                                                              | Consumers                            | Storage                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| **Embedding Service**   | Generates vector embeddings from text using OpenAI's embedding models (or free alternatives via OpenRouter)          | Document pipeline, search service    | Vectors stored in Pinecone                                            |
| **Document Pipeline**   | Ingests documents (PDF, TXT, MD), chunks them, generates embeddings, stores in Pinecone with metadata                | Admin API, seed script               | `documents` + `document_chunks` tables (metadata), Pinecone (vectors) |
| **Semantic Search**     | Takes a user query, converts to embedding, finds the most similar document chunks in Pinecone                        | RAG service, standalone search API   | Pinecone (read)                                                       |
| **RAG Service**         | Orchestrates the full RAG flow: query → search → retrieve → augment prompt → generate answer with citations          | Chat integration, standalone Q&A API | Uses Phase 1 OpenaiService + Phase 2 ChatService                      |
| **Mock Data Generator** | Generates 50-100 realistic documents and 10K+ Q&A pairs using @faker-js/faker for testing the pipeline               | Seed script, evaluation              | `documents` table                                                     |
| **Embedding Cache**     | Caches generated embeddings to avoid re-embedding identical text (the "Cache Embeddings" practice from the goal doc) | Embedding service (internal)         | `embedding_cache` table (already exists from Phase 1 scaffold)        |

---

## 2. System Architecture

### 2.1 Module Structure

```
RagModule
├── EmbeddingService          ← generates embeddings via OpenAI/OpenRouter embedding models
├── DocumentService           ← document CRUD, chunking pipeline, metadata management
├── PineconeService           ← Pinecone client wrapper: upsert, query, delete vectors
├── SearchService             ← semantic search: query → embedding → Pinecone → ranked results
├── RagService                ← full RAG orchestration: search + augment + generate with citations
├── MockDataService           ← generates fake documents and Q&A pairs with faker
├── EmbeddingCacheService     ← cache layer for embeddings (hash-based dedup)
└── RagController             ← REST endpoints for documents, search, Q&A, mock data
```

`RagModule` imports `OpenaiModule` (Phase 1) for embeddings and completions, and optionally integrates with `AiChatModule` (Phase 2) for RAG-augmented conversations.

### 2.2 The RAG Flow — End to End

**Ingestion (one-time per document):**

```
Upload document (PDF/TXT/MD)
  → DocumentService.ingest()
      ├── Parse document content (extract text from PDF, read TXT/MD)
      ├── Chunk into overlapping segments (~500 tokens each, 50 token overlap)
      ├── For each chunk:
      │     ├── EmbeddingCacheService.get(hash) — check cache first
      │     ├── If miss: EmbeddingService.generateEmbedding(chunkText)
      │     ├── EmbeddingCacheService.set(hash, embedding) — cache for reuse
      │     └── PineconeService.upsert(chunkId, embedding, metadata)
      └── Save document + chunk metadata to PostgreSQL
```

**Query (every user question):**

```
User asks: "What is the return policy?"
  → RagService.query(question)
      ├── EmbeddingService.generateEmbedding(question)
      ├── PineconeService.query(questionEmbedding, topK=5)
      ├── Retrieve chunk texts from PostgreSQL using returned chunk IDs
      ├── Build augmented prompt:
      │     System: "Answer using ONLY the provided context. Cite sources."
      │     Context: [chunk1, chunk2, chunk3, chunk4, chunk5]
      │     User: "What is the return policy?"
      ├── OpenaiService.chatCompletionWithMessages(augmentedMessages)
      └── Return answer with citations (which documents were used)
```

### 2.3 Integration with Phase 1 and Phase 2

```
RagModule
├── imports OpenaiModule
│     ├── OpenaiService.chatCompletionWithMessages() — for the generation step
│     ├── TokenService.countTokens() — for chunking decisions
│     ├── AiAuditService.log() — embedding calls are audited too
│     └── RetryService (via OpenaiService) — retries on embedding API failures
├── imports AiChatModule (optional integration)
│     └── ChatService — inject RAG context into chat conversations
└── uses DatabaseModule (global) — document/chunk metadata storage
```

### 2.4 LangChain Integration

LangChain.js is used as the **document processing framework** — not as a replacement for our services, but as a toolkit for:

1. **Document Loaders** — `PDFLoader`, `TextLoader`, `DirectoryLoader` from `langchain/document_loaders`
2. **Text Splitters** — `RecursiveCharacterTextSplitter` from `langchain/text_splitters` for intelligent chunking
3. **Embeddings** — `OpenAIEmbeddings` from `@langchain/openai` (configured with our OpenRouter base URL)

We do NOT use LangChain's chain/agent abstractions — our `RagService` orchestrates the flow directly using our own services. This keeps the architecture consistent with Phase 1/2 and avoids a framework lock-in. LangChain is a **utility**, not the backbone.

---

## 3. Database Schema

### 3.1 `documents` Table

Stores metadata about uploaded documents. The actual text content is in chunks.

| Field              | Type                                   | Description                                                                  |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------- |
| `id`               | `BigInt @id @default(autoincrement())` | Internal PK                                                                  |
| `publicId`         | `String @unique @default(uuid())`      | External identifier                                                          |
| `title`            | `String`                               | Document title (filename or user-provided)                                   |
| `description`      | `String?`                              | Optional description of the document                                         |
| `sourceType`       | `String`                               | `'pdf'`, `'txt'`, `'md'`, `'generated'` (for mock data)                      |
| `originalFilename` | `String?`                              | Original uploaded filename                                                   |
| `fileSize`         | `Int?`                                 | File size in bytes                                                           |
| `totalChunks`      | `Int @default(0)`                      | Number of chunks after splitting                                             |
| `totalTokens`      | `Int @default(0)`                      | Total tokens across all chunks                                               |
| `embeddingModel`   | `String`                               | Model used for embeddings                                                    |
| `embeddingStatus`  | `String`                               | `'pending'`, `'processing'`, `'completed'`, `'failed'`                       |
| `category`         | `String?`                              | Document category: `'guide'`, `'faq'`, `'docs'`, `'tutorial'`, `'changelog'` |
| `tags`             | `String[]`                             | Searchable tags                                                              |
| `metadata`         | `Json? @db.JsonB`                      | Extensible context                                                           |
| `createdAt`        | `DateTime @default(now())`             | Upload timestamp                                                             |
| `updatedAt`        | `DateTime @updatedAt`                  | Last modified                                                                |

### 3.2 `document_chunks` Table

Stores individual chunks of a document with their text content.

| Field             | Type                                   | Description                                  |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| `id`              | `BigInt @id @default(autoincrement())` | Internal PK                                  |
| `publicId`        | `String @unique @default(uuid())`      | External identifier                          |
| `documentId`      | `BigInt`                               | FK → `documents.id`                          |
| `chunkIndex`      | `Int`                                  | Position within the document (0, 1, 2...)    |
| `content`         | `String`                               | The actual text of this chunk                |
| `tokenCount`      | `Int`                                  | Tokens in this chunk                         |
| `startChar`       | `Int`                                  | Character offset in original document        |
| `endChar`         | `Int`                                  | End character offset                         |
| `pineconeId`      | `String?`                              | The ID used in Pinecone (matches this chunk) |
| `embeddingStatus` | `String`                               | `'pending'`, `'completed'`, `'failed'`       |
| `metadata`        | `Json? @db.JsonB`                      | Additional chunk context                     |
| `createdAt`       | `DateTime @default(now())`             | Created timestamp                            |

### 3.3 `embedding_cache` Table

Already exists from Phase 1 project scaffold. Used to cache embeddings by text hash.

| Field        | Type                                   | Description                            |
| ------------ | -------------------------------------- | -------------------------------------- |
| `id`         | `BigInt @id @default(autoincrement())` | Internal PK                            |
| `publicId`   | `String @unique @default(uuid())`      | External identifier                    |
| `textHash`   | `String @unique`                       | SHA-256 hash of the input text         |
| `embedding`  | `Json @db.JsonB`                       | The embedding vector (array of floats) |
| `model`      | `String`                               | Embedding model used                   |
| `tokenCount` | `Int?`                                 | Tokens in the input text               |
| `createdAt`  | `DateTime @default(now())`             | Created timestamp                      |

### 3.4 Indexes

```sql
-- Chunks by document, ordered by position
CREATE INDEX idx_document_chunks_document ON document_chunks (document_id, chunk_index ASC);

-- Documents by category for filtering
CREATE INDEX idx_documents_category ON documents (category);

-- Documents by embedding status for pipeline monitoring
CREATE INDEX idx_documents_embedding_status ON documents (embedding_status);

-- Embedding cache lookup by hash
CREATE UNIQUE INDEX idx_embedding_cache_hash ON embedding_cache (text_hash);
```

### 3.5 Relations

```prisma
model Document {
  chunks DocumentChunk[]
  // Cascade: deleting a document deletes all its chunks
}

model DocumentChunk {
  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

### 3.6 Table Mappings

```prisma
@@map("documents")
@@map("document_chunks")
// embedding_cache already mapped from Phase 1
```

---

## 4. Enums and Constants

### 4.1 Document Source Type

```typescript
export const DocumentSourceType = {
  PDF: 'pdf',
  TXT: 'txt',
  MD: 'md',
  GENERATED: 'generated',
} as const;
```

### 4.2 Embedding Status

```typescript
export const EmbeddingStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
```

### 4.3 Document Category

```typescript
export const DocumentCategory = {
  GUIDE: 'guide',
  FAQ: 'faq',
  DOCS: 'docs',
  TUTORIAL: 'tutorial',
  CHANGELOG: 'changelog',
} as const;
```

### 4.4 Chunking Configuration

```typescript
export const CHUNKING_CONFIG = {
  chunkSize: 500, // target tokens per chunk
  chunkOverlap: 50, // overlapping tokens between chunks
  minChunkSize: 100, // minimum tokens — don't create tiny chunks
  separators: ['\n\n', '\n', '. ', ' ', ''], // split priority for RecursiveCharacterTextSplitter
};
```

### 4.5 RAG Configuration

```typescript
export const RAG_CONFIG = {
  topK: 5, // number of chunks to retrieve
  similarityThreshold: 0.7, // minimum cosine similarity to include
  maxContextTokens: 4000, // max tokens for retrieved context
  systemPrompt: `You are a knowledgeable assistant. Answer the user's question using ONLY the provided context documents. If the context doesn't contain the answer, say "I don't have enough information to answer that based on the available documentation." Always cite which document(s) you used in your answer using [Source: filename] format.`,
};
```

### 4.6 Embedding Configuration

```typescript
export const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small', // OpenAI embedding model (works via OpenRouter too)
  dimensions: 1536, // vector dimensions for text-embedding-3-small
  batchSize: 20, // chunks per embedding API call (rate limit friendly)
  maxRetries: 3, // retries per batch
};
```

### 4.7 Pinecone Configuration

```typescript
export const PINECONE_CONFIG = {
  namespace: 'documents', // Pinecone namespace for document embeddings
  metric: 'cosine', // similarity metric
};
```

---

## 5. Service Interfaces

### 5.1 EmbeddingService

Generates vector embeddings. Wraps the OpenAI embeddings API (works through OpenRouter).

```typescript
generateEmbedding(text: string): Promise<number[]>
generateEmbeddingsBatch(texts: string[]): Promise<number[][]>
getEmbeddingDimensions(): number
```

Uses the OpenAI SDK's `openai.embeddings.create()` endpoint. Routed through `RetryService` for resilience. Every call logged in `ai_audit_logs` with `endpoint: 'embeddings'`.

### 5.2 EmbeddingCacheService

Hash-based deduplication for embeddings. Same text → same embedding, don't regenerate.

```typescript
get(text: string): Promise<number[] | null>          // returns cached embedding or null
set(text: string, embedding: number[], model: string): Promise<void>
invalidate(textHash: string): Promise<void>
getCacheStats(): Promise<{ hits: number; misses: number; totalCached: number }>
```

Hash function: SHA-256 of the normalized (trimmed, lowercased) text.

### 5.3 DocumentService

Document CRUD and the ingestion pipeline.

```typescript
// CRUD
create(dto: CreateDocumentDto): Promise<DocumentResDto>
findAll(query: QueryDocumentsDto): Promise<PaginatedDocumentsResDto>
findOne(publicId: string): Promise<DocumentWithChunksResDto>
update(publicId: string, dto: UpdateDocumentDto): Promise<DocumentResDto>
delete(publicId: string): Promise<void>

// Ingestion
ingestDocument(publicId: string): Promise<void>        // triggers full pipeline: parse → chunk → embed → upsert
ingestFromFile(file: Express.Multer.File): Promise<DocumentResDto>  // upload + ingest
reindexDocument(publicId: string): Promise<void>       // re-chunk and re-embed
getIngestionStatus(publicId: string): Promise<IngestionStatusResDto>

// Chunks
getChunks(documentPublicId: string, query: QueryChunksDto): Promise<PaginatedChunksResDto>
```

**Ingestion pipeline detail:**

1. **Parse**: Extract text from file (PDF via `pdf-parse`, TXT/MD read directly)
2. **Chunk**: Split using LangChain's `RecursiveCharacterTextSplitter` with config from `CHUNKING_CONFIG`
3. **Embed**: For each chunk, check `EmbeddingCacheService` first. On miss, call `EmbeddingService.generateEmbedding()`. On hit, use cached vector. Cache new embeddings.
4. **Upsert**: Store vector in Pinecone via `PineconeService.upsert()` with metadata (documentId, chunkIndex, category, title)
5. **Save**: Write `DocumentChunk` rows to PostgreSQL with text, token count, character offsets, pineconeId
6. **Update status**: Set `document.embeddingStatus = 'completed'` and `document.totalChunks` / `document.totalTokens`

Chunking uses **overlapping windows**: chunk N's last 50 tokens overlap with chunk N+1's first 50 tokens. This prevents context loss at chunk boundaries.

### 5.4 PineconeService

Wraps the Pinecone client. Single responsibility: vector CRUD.

```typescript
upsert(vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[]): Promise<void>
query(vector: number[], topK: number, filter?: Record<string, unknown>): Promise<PineconeMatch[]>
deleteByIds(ids: string[]): Promise<void>
deleteByFilter(filter: Record<string, unknown>): Promise<void>
describeIndex(): Promise<PineconeIndexStats>
```

`PineconeMatch`:

```typescript
interface PineconeMatch {
  id: string;
  score: number; // cosine similarity (0-1)
  metadata: Record<string, unknown>;
}
```

### 5.5 SearchService

Semantic search — takes a text query, returns ranked document chunks.

```typescript
search(query: string, options?: SearchOptions): Promise<SearchResult[]>
searchWithScores(query: string, options?: SearchOptions): Promise<ScoredSearchResult[]>
```

```typescript
interface SearchOptions {
  topK?: number; // default: RAG_CONFIG.topK (5)
  similarityThreshold?: number; // default: RAG_CONFIG.similarityThreshold (0.7)
  categoryFilter?: string; // filter by document category
  documentIds?: string[]; // filter to specific documents
}

interface SearchResult {
  chunkPublicId: string;
  documentPublicId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;
  category: string | null;
}
```

### 5.6 RagService

The orchestrator — combines search + generation.

```typescript
query(question: string, options?: RagOptions): Promise<RagResult>
queryWithConversation(conversationPublicId: string, question: string, options?: RagOptions): Promise<RagResult>
```

```typescript
interface RagOptions {
  topK?: number;
  model?: string;
  temperature?: number;
  categoryFilter?: string;
  includeSourceChunks?: boolean; // include the raw chunks in the response
}

interface RagResult {
  answer: string;
  model: string;
  sources: RagSource[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
  chunksRetrieved: number;
  searchLatencyMs: number;
  generationLatencyMs: number;
}

interface RagSource {
  documentTitle: string;
  documentPublicId: string;
  chunkContent: string; // the actual text used as context
  chunkIndex: number;
  similarityScore: number;
}
```

**`queryWithConversation`** integrates with Phase 2's `ChatService` — it retrieves relevant chunks, injects them as context messages before the user's question, and uses the conversation's existing history + system prompt. This enables RAG-augmented conversations where the AI answers from documents AND remembers prior turns.

### 5.7 MockDataService

Generates realistic test data using @faker-js/faker.

```typescript
generateDocuments(count: number, options?: MockOptions): Promise<DocumentResDto[]>
generateQAPairs(count: number, documentIds?: string[]): Promise<QAPair[]>
seedDefaultDataset(): Promise<{ documents: number; qaPairs: number }>
```

```typescript
interface MockOptions {
  categories?: string[]; // which categories to generate
  minWords?: number; // minimum words per document (default: 200)
  maxWords?: number; // maximum words per document (default: 2000)
}

interface QAPair {
  question: string;
  expectedAnswer: string;
  sourceDocumentId: string;
  complexity: 'simple' | 'multi-step' | 'edge-case';
}
```

**Document generation**: Creates realistic tech guides, FAQs, product docs, tutorials, and changelogs using faker for names, dates, product names, and technical terms. Documents are structured with headings, paragraphs, and lists — not random gibberish.

**Q&A generation**: For each document, generates questions at three complexity tiers (from the goal doc):

- **Simple facts** (60%): "What is the return policy?" — answer in one chunk
- **Multi-step reasoning** (25%): "Compare Product A vs Product B" — needs multiple chunks
- **Edge cases** (15%): Questions the docs don't fully answer — expects "I don't have enough information"

---

## 6. API Endpoints

### 6.1 Documents

```
POST   /api/v1/rag/documents                        — Upload and create document (multipart form)
POST   /api/v1/rag/documents/text                    — Create document from raw text (JSON body)
GET    /api/v1/rag/documents                         — List documents (paginated, filterable by category, status, tags)
GET    /api/v1/rag/documents/:publicId                — Get document with chunk count and status
GET    /api/v1/rag/documents/:publicId/chunks          — Get document's chunks (paginated)
PATCH  /api/v1/rag/documents/:publicId                — Update metadata (title, description, category, tags)
DELETE /api/v1/rag/documents/:publicId                — Delete document + chunks + Pinecone vectors
POST   /api/v1/rag/documents/:publicId/reindex        — Re-chunk and re-embed a document
```

**Upload Document Request** (multipart/form-data):

| Field         | Type   | Required | Description                        |
| ------------- | ------ | -------- | ---------------------------------- |
| `file`        | File   | Yes      | PDF, TXT, or MD file               |
| `title`       | string | No       | Override title (default: filename) |
| `description` | string | No       | Document description               |
| `category`    | string | No       | Document category                  |
| `tags`        | string | No       | Comma-separated tags               |

**Upload Document Response**:

```json
{
  "code": "RAG_001",
  "message": "Document uploaded and ingestion started",
  "data": {
    "publicId": "uuid",
    "title": "Product Return Policy",
    "sourceType": "pdf",
    "originalFilename": "return-policy.pdf",
    "fileSize": 45230,
    "totalChunks": 0,
    "embeddingStatus": "processing",
    "category": "docs",
    "tags": ["policy", "returns"],
    "createdAt": "2026-07-08T10:00:00Z"
  }
}
```

### 6.2 Search

```
POST   /api/v1/rag/search                           — Semantic search across all documents
```

**Search Request**:

| Field                 | Type     | Required | Description                  |
| --------------------- | -------- | -------- | ---------------------------- |
| `query`               | string   | Yes      | Search question              |
| `topK`                | number   | No       | Results count (default: 5)   |
| `similarityThreshold` | number   | No       | Min score 0-1 (default: 0.7) |
| `category`            | string   | No       | Filter by category           |
| `documentIds`         | string[] | No       | Limit to specific documents  |

**Search Response**:

```json
{
  "code": "RAG_002",
  "message": "Search complete",
  "data": {
    "results": [
      {
        "chunkPublicId": "uuid",
        "documentPublicId": "uuid",
        "documentTitle": "Product Return Policy",
        "content": "Items can be returned within 30 days of purchase...",
        "chunkIndex": 3,
        "score": 0.92,
        "category": "docs"
      }
    ],
    "totalResults": 5,
    "searchLatencyMs": 120
  }
}
```

### 6.3 Q&A (RAG)

```
POST   /api/v1/rag/ask                              — Ask a question, get RAG-powered answer with citations
POST   /api/v1/rag/ask/conversation/:publicId        — Ask within an existing conversation (RAG + chat history)
```

**Ask Request**:

| Field                 | Type    | Required | Description                                             |
| --------------------- | ------- | -------- | ------------------------------------------------------- |
| `question`            | string  | Yes      | The question                                            |
| `topK`                | number  | No       | Chunks to retrieve (default: 5)                         |
| `model`               | string  | No       | Model for generation                                    |
| `temperature`         | number  | No       | Generation temperature (default: 0.3 — low for factual) |
| `category`            | string  | No       | Limit search to category                                |
| `includeSourceChunks` | boolean | No       | Include raw chunks in response                          |

**Ask Response**:

```json
{
  "code": "RAG_003",
  "message": "Answer generated from knowledge base",
  "data": {
    "answer": "According to the documentation, items can be returned within 30 days of purchase with a valid receipt. [Source: Product Return Policy]",
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "sources": [
      {
        "documentTitle": "Product Return Policy",
        "documentPublicId": "uuid",
        "chunkContent": "Items can be returned within 30 days...",
        "chunkIndex": 3,
        "similarityScore": 0.92
      }
    ],
    "usage": { "inputTokens": 450, "outputTokens": 85, "totalTokens": 535 },
    "estimatedCost": 0,
    "latencyMs": 2300,
    "chunksRetrieved": 5,
    "searchLatencyMs": 120,
    "generationLatencyMs": 2180
  }
}
```

### 6.4 Mock Data

```
POST   /api/v1/rag/mock/generate-documents           — Generate N fake documents
POST   /api/v1/rag/mock/generate-qa                   — Generate Q&A pairs from existing documents
POST   /api/v1/rag/mock/seed                          — Run the full default seed (50 docs + 500 Q&A pairs)
GET    /api/v1/rag/mock/qa-pairs                      — List generated Q&A pairs (for evaluation)
```

### 6.5 Evaluation

```
POST   /api/v1/rag/evaluate                          — Run Q&A pairs through RAG and score accuracy
```

**Evaluate Response**:

```json
{
  "code": "RAG_005",
  "message": "Evaluation complete",
  "data": {
    "totalQuestions": 100,
    "correct": 72,
    "partiallyCorrect": 15,
    "incorrect": 8,
    "appropriateIDK": 5,
    "accuracy": 0.72,
    "avgLatencyMs": 2100,
    "avgTokens": 520,
    "byComplexity": {
      "simple": { "total": 60, "correct": 52, "accuracy": 0.87 },
      "multi-step": { "total": 25, "correct": 15, "accuracy": 0.6 },
      "edge-case": { "total": 15, "correct": 5, "accuracy": 0.33 }
    }
  }
}
```

### 6.6 Embedding Stats

```
GET    /api/v1/rag/stats                             — Embedding pipeline stats
```

Returns: total documents, total chunks, total vectors in Pinecone, cache hit rate, embedding model, index dimensions.

---

## 7. Pinecone Integration Specification

### 7.1 Setup

- Create a free Pinecone account at **pinecone.io**
- Create an index with dimension `1536` (matches `text-embedding-3-small`) and metric `cosine`
- Store API key and index name in `.env`

### 7.2 Vector Structure in Pinecone

Each vector stored in Pinecone:

```json
{
  "id": "chunk_<documentPublicId>_<chunkIndex>",
  "values": [0.023, -0.045, 0.012, ...],
  "metadata": {
    "documentId": "uuid",
    "documentTitle": "Product Return Policy",
    "chunkIndex": 3,
    "category": "docs",
    "tokenCount": 487
  }
}
```

### 7.3 Namespace

All document vectors live in a single namespace: `documents`. Future phases could add separate namespaces for different data types.

### 7.4 Deletion Cascade

When a document is deleted:

1. Delete all `document_chunks` rows from PostgreSQL (cascade)
2. Delete all corresponding vectors from Pinecone by filter: `{ documentId: publicId }`
3. Delete the `documents` row

---

## 8. LangChain Integration Specification

### 8.1 What We Use from LangChain

```typescript
// Document loading
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
// Embeddings (configured to use our OpenRouter base URL)
import { OpenAIEmbeddings } from '@langchain/openai';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
// Text splitting
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitters';
```

### 8.2 What We DON'T Use from LangChain

- **Chains** (RetrievalQAChain, ConversationalRetrievalChain) — our `RagService` handles orchestration directly
- **Agents** — not needed; Phase 2's tool system already handles agent-like behavior
- **Vector stores** (LangChain's Pinecone wrapper) — we use the Pinecone SDK directly for full control
- **Memory** — Phase 2's `ChatService` already manages conversation context

### 8.3 Why This Approach

LangChain's chains and agents add a layer of abstraction that hides the actual API calls, making it harder to:

- Audit every LLM call (Phase 1 requirement)
- Control retry/circuit-breaker behavior (Phase 1's RetryService)
- Track costs per call (Phase 1's TokenService)

By using only LangChain's **document loaders and text splitters** (the genuinely useful utilities), we keep full control over the orchestration while benefiting from LangChain's file parsing capabilities.

---

## 9. Embedding Cache Specification

### 9.1 The Problem

Embedding the same text twice wastes money and time. If you re-index a document without changing it, or if two documents contain the same paragraph, the embeddings should be computed once and reused.

### 9.2 The Solution

`EmbeddingCacheService` implements a hash-based cache:

1. Before embedding: compute `SHA-256(normalize(text))` where normalize = `text.trim().toLowerCase()`
2. Check `embedding_cache` table for this hash
3. **Cache hit**: return the stored embedding vector (zero API calls, zero cost)
4. **Cache miss**: call `EmbeddingService.generateEmbedding()`, store result in cache, return

### 9.3 Cache Invalidation

- No automatic expiration — embeddings for the same text with the same model never change
- Manual invalidation: `DELETE /api/v1/rag/cache/flush` clears the entire cache
- Model change: if `EMBEDDING_MODEL` changes, all cached embeddings are stale — flush and re-embed

---

## 10. Mock Data Specification

From the goal doc: "Generate 10k+ sample Q&A pairs with @faker-js/faker. Create 5-10 realistic documents (tech guides, FAQs). Vary query complexity."

### 10.1 Document Generation

`MockDataService.generateDocuments()` creates structured documents with:

- **Tech Guides** (10 docs): Installation, configuration, troubleshooting guides with steps, code blocks, and CLI commands
- **FAQs** (10 docs): Product questions, pricing, policies with Q&A format
- **Product Docs** (10 docs): Feature descriptions, API references, architecture overviews
- **Tutorials** (10 docs): Step-by-step how-tos with numbered instructions
- **Changelogs** (10 docs): Version history with dates, features, and bug fixes

Each document: 200–2000 words, structured with headings and paragraphs, uses `@faker-js/faker` for names, dates, product names, company names, technical terms.

### 10.2 Q&A Pair Generation

For each document, generate Q&A pairs at three complexity tiers:

| Tier         | Percentage | Description                        | Example                                                           |
| ------------ | ---------- | ---------------------------------- | ----------------------------------------------------------------- |
| Simple facts | 60%        | Answer found in one chunk          | "What is the default port?"                                       |
| Multi-step   | 25%        | Needs multiple chunks or inference | "Compare the free vs premium plan features"                       |
| Edge cases   | 15%        | Not fully answerable from the docs | "What happens if I exceed the rate limit during a solar eclipse?" |

Total: 50 documents × ~10 Q&A pairs each = ~500 pairs (scaled up to 10K+ with the generation endpoint).

---

## 11. Functional Requirements

**FR-RAG-001**: `EmbeddingService.generateEmbedding()` MUST call the OpenAI embeddings API (via OpenRouter) and return a vector of the correct dimension (1536 for `text-embedding-3-small`).

**FR-RAG-002**: `EmbeddingCacheService` MUST check the cache before every embedding call. Cache hit rate MUST be logged and exposed via the stats endpoint.

**FR-RAG-003**: `DocumentService.ingestDocument()` MUST parse the document, chunk it with overlapping windows, embed each chunk (cache-aware), and upsert to Pinecone — in that order.

**FR-RAG-004**: Chunking MUST use LangChain's `RecursiveCharacterTextSplitter` with configurable chunk size, overlap, and separators.

**FR-RAG-005**: `PineconeService.query()` MUST return results sorted by cosine similarity score, descending.

**FR-RAG-006**: `SearchService.search()` MUST filter results below `similarityThreshold` and return only results above it.

**FR-RAG-007**: `RagService.query()` MUST build an augmented prompt with the system prompt from `RAG_CONFIG`, retrieved chunks as context, and the user's question — then call `OpenaiService.chatCompletionWithMessages()`.

**FR-RAG-008**: RAG answers MUST include source citations — which document(s) and chunk(s) were used.

**FR-RAG-009**: Deleting a document MUST cascade-delete chunks from PostgreSQL AND delete corresponding vectors from Pinecone.

**FR-RAG-010**: `MockDataService.generateDocuments()` MUST create structured, realistic documents — not random text.

**FR-RAG-011**: Q&A pairs MUST be categorized by complexity tier (simple, multi-step, edge-case).

**FR-RAG-012**: The evaluation endpoint MUST run Q&A pairs through the RAG pipeline and report accuracy by complexity tier.

**FR-RAG-013**: Every embedding API call MUST be logged in `ai_audit_logs` with `endpoint: 'embeddings'`.

**FR-RAG-014**: `queryWithConversation()` MUST inject retrieved chunks into the conversation context alongside existing chat history, respecting the sliding-window token budget.

**FR-RAG-015**: File upload MUST support PDF (via `pdf-parse`), TXT, and MD formats. Other formats MUST return a 400 error.

---

## 12. Non-Functional Requirements

**NFR-RAG-001**: Embedding a 500-token chunk MUST complete in under 2 seconds (excluding cache hit which is < 50ms).

**NFR-RAG-002**: Semantic search (query → Pinecone → results) MUST complete in under 500ms for topK=5.

**NFR-RAG-003**: Full RAG query (search + generation) MUST complete in under 5 seconds for typical queries.

**NFR-RAG-004**: Ingesting a 50-page PDF MUST complete in under 60 seconds.

**NFR-RAG-005**: No `any` types. TypeScript strict compliance.

**NFR-RAG-006**: No `console.*` — use `AppLoggerService`.

**NFR-RAG-007**: All endpoints MUST have Swagger documentation.

**NFR-RAG-008**: Cache hit/miss ratio MUST be trackable via the stats endpoint.

---

## 13. Environment Variables

| Variable                   | Required      | Default                  | Description                       |
| -------------------------- | ------------- | ------------------------ | --------------------------------- |
| `PINECONE_API_KEY`         | Yes (for RAG) | —                        | Pinecone API key                  |
| `PINECONE_INDEX`           | Yes (for RAG) | —                        | Pinecone index name               |
| `PINECONE_NAMESPACE`       | No            | `documents`              | Namespace for document vectors    |
| `EMBEDDING_MODEL`          | No            | `text-embedding-3-small` | OpenAI embedding model            |
| `EMBEDDING_DIMENSIONS`     | No            | `1536`                   | Vector dimensions                 |
| `EMBEDDING_BATCH_SIZE`     | No            | `20`                     | Chunks per embedding API call     |
| `RAG_TOP_K`                | No            | `5`                      | Default chunks to retrieve        |
| `RAG_SIMILARITY_THRESHOLD` | No            | `0.7`                    | Minimum cosine similarity         |
| `RAG_MAX_CONTEXT_TOKENS`   | No            | `4000`                   | Max tokens for retrieved context  |
| `CHUNK_SIZE`               | No            | `500`                    | Target tokens per chunk           |
| `CHUNK_OVERLAP`            | No            | `50`                     | Overlapping tokens between chunks |

---

## 14. Test Scenarios

**SC-RAG-001**: Upload a PDF and verify ingestion

> Upload a 10-page PDF. Verify: document created with status `processing` → `completed`, chunks created, vectors in Pinecone, cache entries created.

**SC-RAG-002**: Semantic search finds relevant content

> Upload a document about "return policy". Search: "How do I return an item?" Expect: the return policy chunk ranks highest with score > 0.8.

**SC-RAG-003**: RAG answers from documents with citations

> Upload 3 documents. Ask a question answerable from one document. Expect: answer cites the correct source document.

**SC-RAG-004**: RAG says "I don't know" for unanswerable questions

> Upload documents about product features. Ask: "What's the weather today?" Expect: "I don't have enough information..."

**SC-RAG-005**: Embedding cache prevents duplicate API calls

> Upload the same document twice. Verify: second ingestion has near-100% cache hit rate, significantly faster, zero embedding API calls.

**SC-RAG-006**: Document deletion cascades to Pinecone

> Upload a document, verify vectors exist. Delete the document. Verify: chunks gone from PostgreSQL, vectors gone from Pinecone.

**SC-RAG-007**: Mock data generation creates structured content

> Generate 10 documents. Verify: each has realistic structure (headings, paragraphs), varied categories, different lengths.

**SC-RAG-008**: RAG evaluation scores correctly

> Seed 50 documents + Q&A pairs. Run evaluation. Expect: simple questions > 80% accuracy, multi-step > 50%, edge cases handled gracefully.

**SC-RAG-009**: Chunking preserves context with overlap

> Upload a document. Verify: adjacent chunks share overlapping content at boundaries.

**SC-RAG-010**: RAG within a conversation maintains chat history

> Create a chat conversation. Use RAG Q&A within it. Send follow-up: "Tell me more about that." Verify: the AI remembers both the RAG context and the previous turn.

**SC-RAG-011**: Large batch ingestion handles rate limits

> Upload 50 documents. Verify: all complete without 429 errors (rate-limit-friendly batching).

**SC-RAG-012**: Search filters by category and document

> Upload docs in different categories. Search with `category: 'faq'`. Verify: only FAQ documents appear.

---

## 15. Out of Scope

- **Image/table extraction from PDFs** — only text content is extracted
- **OCR for scanned PDFs** — PDFs must be text-based, not image-based
- **Real-time document sync** — documents are manually uploaded, not synced from external sources
- **Document versioning** — upload a new version = delete old + upload new
- **Multi-language support** — English only for embeddings and search
- **Hybrid search** (keyword + vector) — pure vector search only in this phase
- **Re-ranking models** — results ranked by cosine similarity only, no cross-encoder re-ranking
- **Streaming RAG answers** — the answer is returned complete, not streamed (can be added later by calling Phase 2's streaming endpoint)
- **Authentication on RAG endpoints** — unguarded like Phase 1 and 2

---

## 16. Decisions on Record

| Decision                                                           | Rationale                                                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LangChain for document loading + splitting only, not chains/agents | Keeps full control over orchestration, audit, retry, and cost tracking. LangChain abstractions hide the LLM calls Phase 1 requires auditing                 |
| Pinecone SDK directly, not LangChain's vector store wrapper        | Full control over upsert, metadata, filtering, and deletion. Avoids another abstraction layer                                                               |
| `text-embedding-3-small` as default, not `text-embedding-3-large`  | Cheaper (10x), 1536 dimensions is sufficient for document search, and it works through OpenRouter                                                           |
| Cosine similarity metric in Pinecone                               | Standard for text embeddings, supported by all models, easy to interpret (0 = unrelated, 1 = identical)                                                     |
| Overlap in chunking (50 tokens)                                    | Prevents losing context at chunk boundaries — if a sentence spans two chunks, the overlap ensures both chunks capture it                                    |
| SHA-256 hash for embedding cache                                   | Deterministic, fast, collision-resistant. Same text always produces the same hash, enabling exact deduplication                                             |
| RAG system prompt forces citations                                 | Without forcing citations, the model often generates plausible-sounding answers from its training data rather than the retrieved documents                  |
| Temperature 0.3 default for RAG                                    | Low temperature for factual, document-grounded answers. Higher temperature increases hallucination risk in RAG                                              |
| Mock data uses faker for structure, not LLM-generated content      | Reproducible, fast, free. LLM-generated mock data would cost money and produce non-deterministic results                                                    |
| PostgreSQL for chunk text + Pinecone for vectors                   | Pinecone is optimized for vector search but not for storing/retrieving full text. PostgreSQL stores the text, Pinecone stores the vector + minimal metadata |

---

## 17. Dependencies on Phase 1 and Phase 2

| Component                                        | How Phase 3 Uses It                                            |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `OpenaiService.chatCompletionWithMessages()`     | Generation step in RAG — sends augmented prompt to LLM         |
| `OpenaiService` (new: embeddings support needed) | Embedding generation via `openai.embeddings.create()`          |
| `TokenService.countTokens()`                     | Chunking decisions — know token count per chunk                |
| `TokenService.calculateCost()`                   | Embedding cost tracking                                        |
| `RetryService` (via OpenaiService)               | Retries on embedding API failures                              |
| `AiAuditService.log()`                           | Log every embedding call (endpoint: 'embeddings')              |
| `ModelRegistryService`                           | Look up embedding model pricing                                |
| `ChatService.buildContext()`                     | RAG-augmented conversations need to inject chunks into context |
| `ChatService.sendMessage()`                      | RAG answers can be added to ongoing conversations              |
| `ConfigService`                                  | RAG-specific env vars under `rag` and `pinecone` namespaces    |

---

## 18. Folder Structure

```
src/modules/rag/
├── rag.module.ts                      ← imports OpenaiModule, AiChatModule
├── rag.controller.ts                  ← REST endpoints
├── services/
│   ├── embedding.service.ts           ← embedding generation via OpenAI
│   ├── embedding-cache.service.ts     ← hash-based embedding dedup
│   ├── document.service.ts            ← document CRUD + ingestion pipeline
│   ├── pinecone.service.ts            ← Pinecone client wrapper
│   ├── search.service.ts              ← semantic search orchestration
│   ├── rag.service.ts                 ← full RAG flow: search → augment → generate
│   └── mock-data.service.ts           ← faker-based document + Q&A generation
├── dto/
│   ├── create-document.dto.ts
│   ├── update-document.dto.ts
│   ├── document-res.dto.ts
│   ├── chunk-res.dto.ts
│   ├── search.dto.ts
│   ├── search-res.dto.ts
│   ├── ask.dto.ts
│   ├── ask-res.dto.ts
│   ├── query-documents.dto.ts
│   ├── mock-generate.dto.ts
│   ├── evaluate-res.dto.ts
│   ├── stats-res.dto.ts
│   └── index.ts
├── constants/
│   ├── document-source-type.constant.ts
│   ├── embedding-status.constant.ts
│   ├── document-category.constant.ts
│   ├── chunking-config.constant.ts
│   ├── rag-config.constant.ts
│   ├── embedding-config.constant.ts
│   ├── pinecone-config.constant.ts
│   └── index.ts
└── __tests__/
    ├── embedding.service.spec.ts
    ├── embedding-cache.service.spec.ts
    ├── document.service.spec.ts
    ├── pinecone.service.spec.ts
    ├── search.service.spec.ts
    ├── rag.service.spec.ts
    ├── mock-data.service.spec.ts
    └── rag.controller.spec.ts
```

---

## 19. New Dependencies

| Package                       | Purpose                                 | Free?               |
| ----------------------------- | --------------------------------------- | ------------------- |
| `@pinecone-database/pinecone` | Pinecone vector database SDK            | Free tier available |
| `langchain`                   | Document loaders, text splitters        | Free (open source)  |
| `@langchain/openai`           | OpenAI embeddings adapter for LangChain | Free (open source)  |
| `@langchain/community`        | PDF loader and other community loaders  | Free (open source)  |
| `pdf-parse`                   | Extract text from PDF files             | Free (open source)  |
| `@faker-js/faker`             | Generate realistic mock data            | Free (open source)  |
