---
id: AI-055
title: Live API smoke test — document ingestion, search, RAG citations, Pinecone deletion cascade
type: HITL
status: completed
priority: P2
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Tests
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-054
---

# What to Build

Nothing new — this is the human-in-the-loop verification pass, mirroring AI-014/AI-035. Requires a real Pinecone index (dimension 1536, metric cosine) and a working embedding-capable model reachable via the configured OpenAI/OpenRouter setup. Boot the app against real Postgres + real Pinecone, then manually exercise: upload a small real document and confirm ingestion completes with chunks/vectors both present; run a search proving relevant content ranks highest; ask a question answerable from the uploaded content and confirm the answer cites the correct source; ask an unrelated question and confirm the "I don't have enough information" fallback fires; delete the document and confirm both Postgres chunks and Pinecone vectors are gone; run a small mock-data-seeded evaluation and sanity-check the accuracy breakdown looks directionally reasonable (simple-tier noticeably higher than edge-case).

# User Stories Covered

Live verification of Stories 1, 7, 33, 37, 39, 48 — the properties that can't be proven by a fully-mocked unit test suite.

# Acceptance Criteria

- [x] Document upload → ingestion completes with `embeddingStatus: 'completed'`, chunks and Pinecone vectors both confirmed to exist
- [x] Search for content from the uploaded document ranks the relevant chunk highest with `score > 0.7`
- [x] A question answerable from the document → citation correctly names the uploaded document
- [x] An unrelated question → "I don't have enough information" (or a close variant) returned
- [x] Document deletion → chunks gone from Postgres (confirmed via `psql`), vectors gone from Pinecone (confirmed via direct Pinecone vector fetch)
- [x] A small seeded mock dataset + evaluation run produces a `byComplexity` breakdown where simple-tier accuracy is meaningfully higher than edge-case accuracy. **Resolved by a follow-up threshold fix** (`RAG_CONFIG.similarityThreshold` 0.7 → 0.3) after being root-caused across two rounds of investigation — see the "Resolution" section below.
- [~] No unhandled exceptions crashed the app, but 2 uncaught `PineconeConnectionError` stack traces did appear in the server log (transient network flakiness, recovered on retry) — see Implementation Notes.

# Dependencies

- AI-054

# Testing Notes

**Manual testing prompts:**

> "Could you set up a free Pinecone index (dimension 1536, metric cosine) if you haven't already, add `PINECONE_API_KEY`/`PINECONE_INDEX` to your `.env`, start the dev server, and upload a short text document via `POST /api/v1/rag/documents/text`? Paste the response — I want to confirm ingestion completes and reaches `embeddingStatus: 'completed'`."

> "Could you run a search via `POST /api/v1/rag/search` with a query about that document's content and paste the response? I want to confirm the correct chunk ranks highest with a score above 0.7."

> "Could you ask a question via `POST /api/v1/rag/ask` that's answerable from the uploaded document, then a second question totally unrelated to it, and paste both responses? I want to confirm citations work on the first and the 'I don't have enough information' fallback fires on the second."

> "Could you delete the document via `DELETE /api/v1/rag/documents/:publicId`, then check `GET /api/v1/rag/stats` and confirm the vector/chunk counts dropped accordingly?"

> "Could you run `POST /api/v1/rag/mock/seed` with a small count, then `POST /api/v1/rag/evaluate` against the generated pairs, and paste the `byComplexity` breakdown? I want to confirm simple-tier accuracy is meaningfully higher than edge-case."

## Implementation Notes

Executed the full live scenario against real Postgres + a newly created real Pinecone index +
real OpenRouter-backed OpenAI completions. Session status: **in-review**, not auto-completed —
one acceptance criterion was genuinely not met and is root-caused below, requiring a product
decision rather than a code fix within this HITL verification's own scope.

### Setup performed

- Set `PINECONE_API_KEY` (user-provided) in `.env`.
- No Pinecone index existed yet. Created `ai-product-integration-dev` via Pinecone's control-plane
  REST API — serverless, AWS `us-east-1`, dimension `1536`, metric `cosine` (spec §7.1 exactly).
  Index reached `Ready` state immediately.
- `OPENAI_API_KEY`/`OPENAI_BASE_URL` (OpenRouter) were already configured from earlier phases.
- **`OPENAI_DEFAULT_MODEL` changed from `meta-llama/llama-3.3-70b-instruct:free` to
  `tencent/hy3:free`** — the default model hit a 429 rate limit on both the first live `/rag/ask`
  call and the first live `/rag/evaluate` call. `MockDataService.evaluate()` calls
  `RagService.query(pair.question)` with no `model` override, so unlike `/rag/ask` (which accepts
  a per-request `model` field), there was no way to route around the rate limit without changing
  the default. This is the exact "swap to tencent/hy3:free ... only if this recurs" contingency
  AI-035 documented — it recurred, so the swap was made permanent this time rather than reverted
  after the session (AI-035 left it as a per-request-only override since the default "wasn't
  broken, just slow" — this session's evidence is stronger: outright 429s on both routes tested).

### What passed cleanly

1. **Ingestion**: `POST /rag/documents/text` with a real ~1000-character English policy document
   ("Acme Cloud Storage — Return and Refund Policy") reached `embeddingStatus: 'completed'`,
   `totalChunks: 1`, `totalTokens: 212`. Confirmed via `GET .../chunks` (chunk row present) and
   `GET /rag/stats` (`totalVectors: 1`, `indexDimensions: 1536`).
2. **Search**: `POST /rag/search` with a query mirroring the document's own topic phrasing ranked
   the correct chunk highest at **score 0.814** (> 0.7). A narrower sub-question scored 0.60 —
   still correctly the top (only) result, illustrating that cosine similarity for a single
   multi-topic chunk varies with how closely the query phrasing tracks the chunk's dominant
   topic — expected embedding behavior, not a defect.
3. **Ask (answerable)**: `POST /rag/ask` correctly answered "How many days do I have to request a
   refund on my Acme Cloud Storage plan?" with the accurate 30-day figure (and the 14-day
   enterprise-contract exception), citing `[Source: Acme Cloud Storage — Return and Refund
Policy]` both inline and in the structured `sources[]` array.
4. **Ask (unrelated)**: "What is the weather like in Paris today?" correctly returned _exactly_
   "I don't have enough information to answer that based on the available documentation." with
   `sources: []` and `chunksRetrieved: 0`.
5. **Delete cascade (FR-RAG-009)**: `DELETE /rag/documents/:publicId` → 204. Confirmed via `psql`
   directly against `documents`/`document_chunks` (both 0 rows for that document immediately
   after). `GET /rag/stats`'s `totalVectors` count did _not_ drop immediately (Pinecone
   serverless `describeIndexStats` is eventually consistent — a known Pinecone characteristic, not
   an app bug) — confirmed the actual vector was gone by directly `fetch`-ing its exact ID
   (`chunk_<publicId>_0`) against the Pinecone data-plane API, which returned an empty result.

### What did NOT pass: mock-data evaluation accuracy ordering

Ran this twice, independently, with different mock-document sizes, both times with the same
qualitative result:

| Run | Doc size                           | `simple` accuracy | `multi-step` accuracy | `edge-case` accuracy |
| --- | ---------------------------------- | ----------------- | --------------------- | -------------------- |
| 1   | `minWords: 150` (→ 1 chunk/doc)    | 0% (0/6)          | 0% (0/3)              | 100% (1/1)           |
| 2   | `minWords: 900` (→ 4-5 chunks/doc) | 0% (0/6)          | 0% (0/3)              | 100% (1/1)           |

This is the _opposite_ of the criterion's expectation. Root-caused via direct inspection, not
guesswork:

- `POST /rag/search` against the exact question text for a `simple` pair (e.g. "According to
  'Modern Aluminum Pants Documentation', what is covered under 'API Reference'?" — a question that
  literally names a heading present verbatim in the target chunk) returned the correct chunk at
  **score 0.33**, with the highest-scoring chunk in the whole index at only 0.53 — both far below
  the 0.7 default `similarityThreshold`. Retrieval itself fails before generation or scoring ever
  happen.
- Inspecting the raw chunk content explains why: `MockDataService`'s body text is
  `faker.lorem.paragraph()`/`faker.lorem.sentence()` — fake Latin placeholder words with no
  semantic content (verified: e.g. _"Umbra textilis occaecati bis aperte audio abduco decens
  debitis"_). An embedding model correctly produces a diffuse, low-signal embedding for a chunk
  that's ~90% meaningless placeholder text, which doesn't align well with a coherent
  natural-language question embedding — even when the real anchor text (a heading, an endpoint
  path) is present verbatim in both.
- This is a **design mismatch, not a regression**: `MockDataService` was explicitly built (AI-048)
  to use faker for "reproducible, fast, free" _structural_ realism, never for semantic/embedding
  realism — that tradeoff was made deliberately per this codebase's own §16 decision table ("Mock
  data uses faker for structure, not LLM-generated content ... LLM-generated mock data would cost
  money and produce non-deterministic results"). Nobody had previously run real embeddings against
  this content before this session — `mock-data.service.spec.ts`'s tests mock `RagService.query()`
  entirely, so this characteristic was structurally invisible to the whole unit-test suite. This is
  precisely the class of finding a live smoke test exists to surface.
- **Independent proof the RAG/search pipeline itself is not at fault**: the same pipeline, same
  default threshold, same model, correctly scored 0.814 and answered/cited correctly against real
  natural-language content (the Acme Cloud Storage document) earlier in this same session.
- `classifyAnswer()`'s keyword-overlap heuristic compounds this on the rare occasions retrieval
  _does_ succeed: `expectedAnswer` for a `simple`/`multi-step` pair is the raw chunk text, so most
  of its "significant keywords" (≥4 chars, non-stopword) are fake Latin words an LLM would never
  organically reproduce even when directly quoting real technical terms it did retrieve correctly.

**This is not something to silently work around inside a verification-only issue** — fixing it
would require a design choice (e.g. give `MockOptions` a "coherent English filler" mode instead of
raw `faker.lorem`; lower `evaluate()`'s effective similarity threshold; or move to an LLM-judge
grader instead of keyword overlap) that's out of AI-055's scope. Recorded as a Follow Up below.

### Secondary finding: transient Pinecone network flakiness, uncaught in the query path

Across the session, `PineconeService` calls intermittently threw `PineconeConnectionError`/
timed out (10-25s round-trips observed even on success) — reproducible from this sandbox
specifically (a standalone Node script using the same SDK version succeeded instantly when tested
in isolation, so this is sandbox network-path flakiness to Pinecone, not a credentials or SDK
issue). Two distinct manifestations:

- **`DocumentService.ingestDocument()`** already catches this (AI-043's design) — degrades to
  `embeddingStatus: 'failed'` instead of throwing. Observed once; retry succeeded.
- **`SearchService.search()`/`RagService.query()` do not catch it** — a transient Pinecone timeout
  during `POST /rag/evaluate`'s per-question loop surfaced as an uncaught `PineconeConnectionError`,
  aborting the _entire_ batch (500, `Internal server error`) rather than just that one question.
  Retrying the whole `/rag/evaluate` call succeeded. The app itself never crashed and kept serving
  requests throughout — this is a per-request 500, not an outage — but it does mean a single flaky
  network blip loses an entire evaluation batch's progress, worth a Follow Up (wrapping
  `PineconeService` calls in `RetryService`, matching the retry/backoff pattern already used for
  OpenAI calls).

## Resolution (second follow-up, same day)

The realistic-dataset follow-up above (documented in `CLAUDE.md`'s "Realistic seed dataset +
inline-qaPairs evaluation" section) had already ruled out faker-content quality as the primary
cause and pointed at `RAG_CONFIG.similarityThreshold` (default `0.7`) itself: five different
simple-tier questions measured top `POST /rag/search` scores of only 0.45–0.59 against real,
hand-written, keyword-matched content, and even a near-verbatim query/chunk match scored just
0.57 — all below the threshold, causing most `simple`/`multi-step` questions to retrieve zero
chunks and correctly-but-uselessly fall back to "I don't have enough information."

Acted on option (b) from the Follow Ups below: `RAG_CONFIG.similarityThreshold`
(`src/modules/rag/constants/rag-config.constant.ts`) and the `RAG_SIMILARITY_THRESHOLD` env
fallback (`ragConfig.similarityThreshold` in `src/config/app.config.ts`, plus `.env.example`)
were changed from `0.7` to `0.3`, globally (not `evaluate()`-scoped only) — with an inline
comment recording the measured score distribution as the rationale. Chunking strategy and
embedding model were deliberately left unchanged, matching this fix's explicit scope.

Re-ran the full live flow against the same real Pinecone index and the same 10-document/50-pair
realistic dataset: `POST /rag/mock/seed-realistic` → `POST /rag/evaluate` (`sampleSize: 50`).
Result:

| Tier         | Total | Correct | Accuracy |
| ------------ | ----- | ------- | -------- |
| `simple`     | 30    | 27      | 90%      |
| `multi-step` | 10    | 10      | 100%     |
| `edge-case`  | 10    | 8       | 80%      |

Overall: 37 correct / 0 partial / 5 incorrect / 8 appropriateIDK out of 50 — accuracy 74%. This is
a complete reversal of the pre-fix ordering (previously `simple` 3%, `multi-step` 0%, `edge-case`
100%) and now matches the acceptance criterion's original expectation: simple-tier accuracy is
meaningfully higher than edge-case, with edge-case still correctly rejecting 80% of genuinely
unanswerable questions rather than degenerating to always-refuse.

**Two of three live `/rag/evaluate` attempts during this verification failed transiently** with
uncaught `PineconeConnectionError` mid-batch (the exact "Secondary finding" already documented
below) — confirmed via a direct `POST /rag/search` call in between attempts that Pinecone
connectivity itself was healthy (13s round-trip, real ranked results), so these were sandbox
network blips, not a regression from the threshold change. The third attempt completed cleanly.
This makes wrapping `PineconeService` in `RetryService` (see Follow Ups) more clearly worth
prioritizing, now with three reproductions across two sessions.

Test data (10 documents, cascade-deleted chunks/QA pairs) was deleted afterward;
`GET /rag/stats` confirmed `totalDocuments: 0`/`totalChunks: 0` (Postgres-side, confirmed
immediately; `totalVectors` lagged briefly, the same documented Pinecone eventual-consistency
behavior). Dev server stopped, port 3000 confirmed free.

Full regression: `npm run test` → 475/475 passing, `npx tsc --noEmit --project
tsconfig.build.json` clean, `npm run lint:check` → 0 errors (59 pre-existing warnings, unchanged
baseline).

## Validation Performed

Live-only issue — no automated test suite run (AI-054 already covers that). All verification was
direct `curl`/`psql`/Pinecone-REST-API interaction against a real running `npm run dev` instance,
documented step-by-step above. The threshold-fix resolution above additionally ran the full
`npm run test`/`tsc`/`lint:check` suite since it touched production config/constant files.

## Assumptions Made

- Interpreted "no unhandled exceptions... across the whole session" as "the application process
  never crashed / stayed responsive," not literally "zero ERROR-level log lines" — under that
  reading the criterion is met (confirmed: the app served requests continuously for the full
  ~50-minute session, including immediately after both uncaught-exception incidents). Marked it
  `[~]` rather than `[x]` in the acceptance criteria above since the literal wording is stricter
  than what was actually observed to be true.
- `OPENAI_DEFAULT_MODEL`'s change to `tencent/hy3:free` was made permanent in `.env` rather than
  reverted, since `/rag/evaluate` has no per-call override and the original default rate-limited
  reproducibly on two different routes in this session.
- Did not attempt a full `POST /rag/mock/seed` (50 docs + 500 Q&A pairs) — used
  `generate-documents`/`generate-qa` with small explicit counts (3 docs, 10 pairs) twice instead,
  per the issue's own testing prompt wording ("a small count"), given each mock document's live
  ingestion cost ~15-40s in this network-latency-affected sandbox (a full 50-document seed would
  have taken 15-30+ minutes of ingestion alone before evaluation could even start).

## Follow Ups

- **Resolved**: built a second, hand-written realistic dataset (`src/modules/rag/seed-data/`,
  `MockDataService.seedRealisticDataset()`, `POST /rag/mock/seed-realistic`) to test whether the
  original finding was a faker-content problem. It wasn't, or at least not primarily — the same
  qualitative failure pattern (`simple` 3%, `multi-step` 0%, `edge-case` 100%) reproduced against
  10 coherent, internally-consistent, keyword-rich English documents, with `POST /rag/search`
  measuring top scores of only 0.45–0.59 for well-matched questions — pointing at option (b) below
  (the similarity threshold) rather than (a). That option was then implemented:
  `RAG_CONFIG.similarityThreshold` was lowered from `0.7` to `0.3` (see "Resolution" section
  above), and re-running the identical realistic-dataset evaluation produced the expected ordering
  (`simple` 90%, `multi-step` 100%, `edge-case` 80%). `MockDataService`'s faker-based content
  itself was never modified — the threshold fix alone was sufficient.
- Wrap `PineconeService`'s SDK calls in `RetryService` (or an equivalent backoff), matching the
  retry pattern already applied to OpenAI calls — `SearchService.search()`/`RagService.query()`
  currently let a single transient Pinecone timeout abort an entire `/rag/evaluate` batch. Now
  reproduced 3 times across 2 sessions (this issue's original session once, this resolution's
  verification twice) — worth prioritizing over the other, now-closed, `PineconeService` Follow
  Up above.
- This sandbox's network path to Pinecone is slow/flaky enough (6-25s per call, occasional hard
  failures) that it's worth re-verifying performance/reliability from the actual target deployment
  environment before drawing conclusions about production latency from this session's numbers.
- All test data created during this session (documents, chunks, vectors, Q&A pairs) was deleted
  before the session ended — confirmed via `GET /rag/stats` showing `0` across the board.
