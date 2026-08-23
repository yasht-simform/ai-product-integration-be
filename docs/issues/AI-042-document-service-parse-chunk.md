---
id: AI-042
title: DocumentService — parse + chunk pipeline
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
  - AI-041
---

# What to Build

Add a parse-then-chunk step to `DocumentService`: given raw source content (a `Buffer` for PDF, a UTF-8 string for TXT/MD), produce an ordered array of chunk descriptors — `{ content, chunkIndex, tokenCount, startChar, endChar }` — with `startChar`/`endChar` as absolute offsets into the original source text. Keep this step directly unit-testable without touching the database, embeddings, or Pinecone (pure text-in, chunk-descriptors-out).

**Parsing**: PDF buffers via `pdf-parse` (extract `.text`). TXT/MD buffers decoded as UTF-8 directly — LangChain's `TextLoader` is file-path-based and awkward for an in-memory upload buffer, so a direct decode is the pragmatic choice for these two formats; `pdf-parse` is the one format that genuinely needs a parser library.

**Chunking**: LangChain's `RecursiveCharacterTextSplitter`, configured from `CHUNKING_CONFIG`/`ragConfig` (`chunkSize: 500`, `chunkOverlap: 50`, `separators`). `RecursiveCharacterTextSplitter`'s `chunkSize`/`chunkOverlap` options are character-based by default — since the spec's values are stated in _tokens_, configure the splitter with a custom token-aware `lengthFunction` backed by `TokenService.countTokens()` rather than approximating tokens-to-characters, so chunk sizing is accurate against the real tokenizer (FR-RAG-004).

A trailing chunk smaller than `CHUNKING_CONFIG.minChunkSize` (100 tokens) should be merged into the previous chunk rather than left as a tiny fragment — that's the documented purpose of `minChunkSize`.

# User Stories Covered

- Story 21 — chunking uses overlapping windows
- Story 22 — chunk token count via `TokenService.countTokens()`, not a character estimate
- Story 32 — PDF text extraction fails gracefully (not a crash) on unsupported/image-only PDFs

# Acceptance Criteria

- [x] PDF buffers parsed via `pdf-parse` into plain text
- [x] TXT/MD buffers decoded as UTF-8 text directly
- [x] Chunking uses `RecursiveCharacterTextSplitter` with a token-aware length function backed by `TokenService.countTokens()`, configured from `CHUNKING_CONFIG`/`ragConfig`
- [x] Each chunk descriptor has accurate `startChar`/`endChar` offsets into the source text
- [x] Adjacent chunks share overlapping content at their boundaries (SC-RAG-009) — verified by a test asserting the tail of chunk N appears in the head of chunk N+1
- [x] A trailing sub-`minChunkSize` chunk is merged into the previous one, not left standalone
- [x] An image-only/unparseable PDF produces a clear thrown error (caught upstream by the ingestion pipeline, AI-043/044) rather than an unhandled exception
- [x] Unit tests: PDF text extraction, TXT passthrough, chunk count for a known-length input, overlap verification, token-aware sizing (stub `TokenService.countTokens()` with a fixed-length function)

# Dependencies

- AI-041 (same service), AI-037 (dependencies installed, `CHUNKING_CONFIG` constant)

# Testing Notes

PDF parsing tested against a small real fixture buffer where practical (a minimal valid PDF committed as a test fixture, or generated inline); if producing a real PDF fixture isn't practical without adding another dependency, mock `pdf-parse`'s module export directly and treat PDF text extraction as trusted third-party behavior for that one test — prefer the real-fixture approach per the PRD's Testing Decisions if it's cheap to set up.

## Implementation Notes

Added `parseSource()`/`chunkText()` to `DocumentService` (`src/modules/rag/services/document.service.ts`)
per spec §5.3's ingestion-pipeline steps 1–2. Both are pure `Buffer`/`string` in, data out — no
`DatabaseService`/`EmbeddingService`/`PineconeService` calls — exactly as this issue's "keep this
step directly unit-testable" framing asked for.

**Blocking environment issue found and fixed first**: `@langchain/textsplitters`'s
`RecursiveCharacterTextSplitter` requires `@langchain/core` as a peer, which turned out to be
completely absent from `node_modules` — the exact same `--legacy-peer-deps` silent-drop footgun
CLAUDE.md already documents for `axios` (AI-037), just for a different package. Fixed by explicitly
installing `@langchain/core` and, since this service also imports `@langchain/textsplitters`
directly (previously only a transitive dependency of `langchain`/`@langchain/community`), adding
that as an explicit direct dependency too — same "don't rely on transitive hoisting for a package
you `import` from" reasoning as the `axios` fix.

**`parseSource(buffer, sourceType)`**: dispatches to `parsePdf()` for `DocumentSourceType.PDF`,
otherwise `buffer.toString('utf-8')` — TXT/MD/`generated` all take the plain-decode path, per this
issue's framing that only PDF genuinely needs a parser library. `parsePdf()` uses `pdf-parse@2.4.5`'s
class-based `PDFParse` API (`new PDFParse({ data: buffer })` → `await parser.getText({ pageJoiner:
'' })` → `.text`, verified live against the installed version — this is a different surface than the
older function-style `pdf-parse@1.x` API most examples online show). `pageJoiner: ''` suppresses the
library's default `"-- page_number of total_number --"` page-boundary markers from polluting the
extracted text. An empty/whitespace-only result after `.trim()` (the image-only-PDF case — verified
live that `pdf-parse` does NOT throw for this, it just returns blank text) throws a dedicated `'No
extractable text found in PDF...'` error; any other thrown error (verified live: `pdf-parse` throws
`Invalid PDF structure.` for a garbage buffer) is rewrapped as `'Failed to parse PDF: <message>'` —
one consistent error shape for the ingestion pipeline (AI-043/044) to catch. `parser.destroy()` runs
in a `finally` block regardless of outcome.

**`chunkText(text, model?)`**: configures `RecursiveCharacterTextSplitter` with `chunkSize`/
`chunkOverlap` from `ragConfig` (falling back to `CHUNKING_CONFIG`'s hardcoded defaults) and a custom
`lengthFunction` that calls `TokenService.countTokens()` synchronously (verified `countTokens()`'s
real signature is sync, not async — no `Promise` wrapping needed even though the splitter's
`lengthFunction` type accepts either). This makes `chunkSize: 500`/`chunkOverlap: 50` genuinely
token-based rather than an approximated character count, per FR-RAG-004. `model` defaults through
`model ?? ragConfig.embeddingModel ?? EMBEDDING_CONFIG.model` — chunk sizing is measured against the
tokenizer of the model that will actually embed the chunk, not an unrelated chat model's tokenizer
(not explicitly specified by the issue; see Assumptions Made).

Offsets are computed by a private `toChunkDescriptors()`: since `RecursiveCharacterTextSplitter`
returns exact substrings of the source text (verified live — every returned chunk is found via
`indexOf`), each chunk's `startChar` is located via `text.indexOf(content, searchFrom)`, with
`searchFrom` advanced to `startChar + 1` after each match (not `endChar`) specifically so overlapping
chunks — which start _before_ the previous chunk ends — are still found correctly by the next
`indexOf` call. A private `mergeTrailingChunk()` then checks the last descriptor's `tokenCount`
against the hardcoded `CHUNKING_CONFIG.minChunkSize` (100 — this constant has no corresponding env
var, so it's read directly rather than through `ragConfig`, matching the project's established
"only fall back to the constant for values with no env var" convention); if it's under threshold and
there's a previous chunk to merge into, the previous descriptor is replaced with one spanning
`[previous.startChar, last.endChar]` (re-sliced from the source text, not string-concatenated, so the
shared overlap region isn't duplicated) with a freshly recomputed `tokenCount`.

**Live-verified two environment facts before writing any test** (both confirmed via direct `node -e`
runs against the installed package versions, not assumed from documentation): (1) a hand-built
minimal PDF with no `xref` table still parses successfully — `pdf.js` reconstructs it — so a tiny
inline fixture is viable in principle; (2) `pdf-parse`'s `PDFParse` internally sets up a `pdf.js`
worker via a dynamic `import()` that **fails under Jest's default CJS transform** with `"A dynamic
import callback was invoked without --experimental-vm-modules"` — reproducible regardless of PDF
content, confirmed to be an environment limitation and not fixable by a better fixture. Adding that
Node flag would mean changing the whole project's Jest invocation for one test file's benefit, which
this issue's own Testing Notes explicitly frames as the trigger to fall back to mocking `pdf-parse`'s
module export instead ("if producing a real PDF fixture isn't practical without adding another
dependency" — read as "without an environment change," which an experimental Node flag qualifies
as). `__tests__/document-parse-chunk.service.spec.ts` therefore mocks `pdf-parse` at the module level
for all three PDF-path tests, documenting this reasoning inline; the TXT/MD-decode tests and all
`chunkText()` tests exercise the real code paths with no mocking beyond `TokenService.countTokens()`.

`__tests__/document-parse-chunk.service.spec.ts` (10 tests) uses a word-count-based fake tokenizer
(`wordCount()`) for `chunkText()` tests, per this issue's own Testing Notes suggestion — deterministic
and easy to reason about, unlike a real tiktoken encoder. The overlap and offset tests were run first
against the real `RecursiveCharacterTextSplitter`/`indexOf` implementation to confirm actual behavior
(a 60-word input at `chunkSize: 10`/`chunkOverlap: 3` genuinely produces adjacent chunks whose
3-word tails/heads overlap) before the assertions were written — not hand-derived from documentation.
The merge test scales the fake tokenizer by a multiplier (`wordCount(text) * 20`) so a naturally-small
tail chunk (a handful of words) reliably falls under the real, non-overridable
`CHUNKING_CONFIG.minChunkSize: 100` threshold; the "unmerged" counterpart test uses an even word split
with no tail remainder so nothing needs merging, proving the merge path isn't unconditional.

Added `ChunkDescriptor` (`{ content, chunkIndex, tokenCount, startChar, endChar }`) to
`src/modules/rag/types/rag.types.ts`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 56 warnings (unchanged from AI-041's baseline — no new warning
  categories introduced)
- `npm run build` — succeeds
- `npx jest --testPathPatterns=document` — 31/31 pass (3 suites: CRUD, DTOs, parse+chunk)
- `npm run test` (full suite) — 334/334 pass, 26/26 suites, no regressions (up from 324)
- Live boot check: `node dist/src/main.js` — `RagModule dependencies initialized` and `Application
running on port 3000` both present, no DI/import errors from the new `@langchain/textsplitters`/
  `pdf-parse` imports
- Live `node -e` verification (outside Jest) of the real `pdf-parse`/`RecursiveCharacterTextSplitter`
  behavior described above — both libraries work correctly in the actual app runtime; the dynamic-
  import failure is Jest-transform-specific, not a runtime defect

## Assumptions Made

- `chunkText()`'s default token-counting model is `ragConfig.embeddingModel` (falling back to
  `EMBEDDING_CONFIG.model`), not `openai.defaultModel` or any other model — chunk sizing should
  reflect the tokenizer of whichever model will actually generate the embedding, and this issue's
  spec text doesn't name a specific model to use.
- An image-only/textless PDF is detected via `.text.trim() === ''` after extraction, since
  `pdf-parse` itself does not throw for this case (verified live) — this issue's own Acceptance
  Criteria requires "a clear thrown error," so the check had to be added explicitly rather than
  relying on the library.
- Mocking `pdf-parse`'s module export for all three PDF-path tests (not just the "impractical
  fixture" one) — since the underlying Jest/dynamic-import limitation affects every call path
  identically (success, empty-text, and error), using a real fixture for some PDF tests and a mock
  for others would have been an inconsistent testing strategy for the same root cause.

## Follow Ups

- AI-043 (embed/cache/upsert/persist) composes `parseSource()` + `chunkText()` with
  `EmbeddingCacheService`/`EmbeddingService`/`PineconeService` to implement
  `DocumentService.ingestDocument()`'s full pipeline, writing real `DocumentChunk` rows and updating
  the parent `Document`'s `totalChunks`/`totalTokens`/`embeddingStatus`.
- AI-044 (`ingestFromFile()`) will pass an uploaded `Express.Multer.File`'s `.buffer` directly into
  `parseSource()`.
- If a future issue needs to run the automated suite with real (non-mocked) PDF text extraction, the
  project's Jest invocation would need `NODE_OPTIONS=--experimental-vm-modules` — a global change
  intentionally not made by this issue, since it's out of this vertical slice's scope.
