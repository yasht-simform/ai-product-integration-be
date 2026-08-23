---
id: AI-049
title: MockDataService — Q&A pair generation + seedDefaultDataset()
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-09
completed_at: 2026-07-09
parent_epic: Epic 6 — Mock Data Generation & Evaluation
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-048
---

# What to Build

Implement `MockDataService.generateQAPairs(count, documentIds?)` per spec §5.7/§10.2 — for each source document (all documents, or a narrowed `documentIds` set), generate question/expectedAnswer pairs across three complexity tiers with the spec's stated distribution: 60% simple (a fact directly stated in one chunk), 25% multi-step (requires synthesizing across at least two chunks/documents — e.g. "compare X and Y" over two generated entities), 15% edge-case (deliberately unanswerable from indexed content, with `expectedAnswer` set to `RAG_CONFIG`'s "I don't have enough information" sentinel string so AI-050's evaluation can check for it).

**New schema needed**: spec §3 has no dedicated Q&A-pairs table, but `GET /rag/mock/qa-pairs` (spec §6.4) implies a queryable, persisted list. Add a small `QaPair` Prisma model as part of this issue (`BigInt` id + `publicId`, `question`, `expectedAnswer`, `sourceDocumentId` FK → `documents.id`, `complexity String`, `createdAt`) — small, additive, and tightly coupled to this feature, so it belongs here rather than as a separate schema issue.

`seedDefaultDataset()` — one-call convenience wrapping `generateDocuments(50)` (10 per category, per spec §10.1) + `generateQAPairs()` for all of them, returning `{ documents: number, qaPairs: number }`.

# User Stories Covered

- Story 45 — three-tier complexity Q&A generation
- Story 46 — one-call default dataset seed
- Story 47 — list generated Q&A pairs

# Acceptance Criteria

- [x] `generateQAPairs()` produces the 60/25/15 complexity distribution within reasonable tolerance for the requested count
- [x] Simple-tier questions are answerable from a single chunk of their source document
- [x] Edge-case questions' `expectedAnswer` matches the "I don't have enough information" sentinel, and their question content is verifiably unrelated to any indexed document's actual content
- [x] New `QaPair` Prisma model added and migrated
- [x] `seedDefaultDataset()` generates ~50 documents (10 per category) and their Q&A pairs, returning accurate counts
- [x] Unit tests: complexity-tier distribution, edge-case unanswerability heuristic, `seedDefaultDataset()` call counts and returned totals

# Dependencies

- AI-048 (generated documents to build Q&A pairs from)

# Testing Notes

`DeepMockProxy<DatabaseService>` for the new `QaPair` persistence; mock `DocumentService`/`generateDocuments()` for `seedDefaultDataset()`'s document-generation leg.

## Implementation Notes

**Schema**: added `QaPair` (`BigInt` id + `publicId` UUID, `question`, `expectedAnswer`,
`sourceDocumentId BigInt` FK → `documents.id` with `onDelete: Cascade`, `complexity String`,
`createdAt`) and a back-relation `Document.qaPairs QaPair[]` (required by Prisma's relation
validation — the opposite side of a `@relation` must exist on the related model). Migrated via
this phase's established non-interactive workaround (`prisma migrate diff --from-config-datasource
./prisma.config.ts --to-schema ./prisma/schema.prisma --script` → hand-created
`prisma/migrations/20260709000000_add_qa_pairs/migration.sql` → `npm run prisma:migrate:deploy`),
documented in `CLAUDE.md`'s AI-036 section. `sourceDocumentId` is the internal `BigInt` FK
(matching the issue's own "FK → documents.id" wording), mapped to the document's `publicId` string
at the service's entity-mapping boundary — `QaPairEntity.sourceDocumentId: string` — the same
publicId-at-the-edge convention every other cross-table reference in this codebase follows.

**Shared "no info" sentinel**: extracted the literal phrase embedded in `RAG_CONFIG.systemPrompt`
(AI-037) into its own `RAG_CONFIG.noInfoSentinel` field, with `systemPrompt` now built from it via
template literal — byte-identical output, verified by the unchanged `rag.service.spec.ts` suite
still passing. This gives `generateQAPairs()`'s edge-case `expectedAnswer` and AI-050's future
evaluation heuristic one shared source of truth instead of two copies of the same string that could
drift apart.

**`generateQAPairs(count, documentIds?)`**: queries `documents` (filtered by `publicId: { in:
documentIds }` when provided, otherwise all documents) with their `chunks` in one `findMany()` call
— the same direct-table-access convention `SearchService` already established for reading
`document`/`documentChunk` rows, rather than going through `DocumentService`. Documents with zero
chunks are filtered out of the usable pool (a title-only document with no ingested content can't
back any tier's question) — a pool left empty after that filter throws `BadRequestException`.

Counts are split `Math.round(count * 0.6)` / `Math.round(count * 0.25)` / remainder-into-edge-case
— the remainder bucket absorbs all rounding drift, so the three tiers' lengths always sum to
exactly `count` regardless of rounding.

- **Simple** (round-robin over documents × their chunks): `expectedAnswer` is set to exactly one
  chunk's own trimmed `content` — the fact the question asks about is, by construction, answerable
  from that single chunk (AC #2). The question text extracts the chunk's leading markdown heading
  (`extractTopic()`, stripping `#`/`` ` ``/`*`) as the topic, e.g. `According to "Acme Widget
Installation Guide", what is covered under "Installation"?`.
- **Multi-step**: when ≥2 usable documents exist, pairs two different documents' chunks
  (`Compare "A" and "B": how does each address "topicA" versus "topicB"?`, `expectedAnswer`
  concatenating both chunks prefixed by their document titles) — matching the spec's own "compare
  X and Y" example. Falls back to comparing two chunks _within_ the same document when only one
  document is available.
- **Edge-case**: cycles a hardcoded pool of eight scenario questions (solar eclipses, time
  machines, leap seconds — see `EDGE_CASE_QUESTIONS`) that are deliberately unrelated to
  `generateDocuments()`'s own faker vocabulary (`hacker.noun()`/`commerce.productName()`/etc.),
  precisely so an edge-case question can never coincidentally match real generated content.
  `expectedAnswer` is always `RAG_CONFIG.noInfoSentinel` verbatim.

All drafts are persisted in one `qaPair.createMany()` call — `publicId`/`createdAt` are generated
client-side (`randomUUID()`/`new Date()`) at draft-build time rather than left to Prisma's schema
defaults, since `createMany()` doesn't return the created rows and the method needs to return the
full `QaPairEntity[]` (including `publicId`) without a second round-trip query.

**`seedDefaultDataset()`**: `generateDocuments(5 categories × 10)` → `generateQAPairs(documents.length
× 10, documents.map(d => d.publicId))` — the explicit `documentIds` restricts Q&A generation to
exactly the documents this call just created, so re-running the seed against a database that
already has other documents in it never pulls unrelated pre-existing content into the "default
dataset."

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 59 warnings (unchanged from the AI-048 baseline — the one new
  `no-unsafe-member-access` warning in the test file's pre-existing `calls()` helper is the same
  warning that was already there, not a new instance)
- `npm run build` — succeeds (`prisma:generate` regenerated the client with `QaPair` + the
  `Document.qaPairs` back-relation; `nest build` succeeds)
- `npx prisma migrate deploy` — applied `20260709000000_add_qa_pairs` cleanly against the live dev
  database (verified via `prisma migrate diff` producing an empty diff afterward — schema and DB
  are in sync)
- `npm run test -- mock-data.service` — 22/22 pass (12 pre-existing `generateDocuments()` tests
  regrouped into their own nested `describe()`, 9 new `generateQAPairs()` tests, 1 new
  `seedDefaultDataset()` test)
- `npm run test` (full suite) — 409/409 pass (up from 399, +10 new tests, zero regressions —
  `rag.service.spec.ts`'s `RAG_CONFIG.systemPrompt`-dependent assertions still pass unchanged after
  the sentinel-extraction refactor)

## Assumptions Made

- **`QaPair.sourceDocumentId` is the internal `BigInt` FK, not a `publicId` string column** — the
  issue's own schema description says "FK → documents.id", and `documents.id` is the `BigInt`
  primary key. The public-facing `QaPairEntity.sourceDocumentId` (service return type) is the
  document's `publicId` string, resolved at the mapping boundary — consistent with every other
  service in this codebase never exposing an internal `BigInt` id past its own layer.
- **`seedDefaultDataset()`'s Q&A count is `documents.length × 10`, not a fixed 500** — matches the
  spec's "~10 Q&A pairs each" framing exactly and stays correct even if `generateDocuments()`
  somehow returns a different count than requested (it always returns `count` today, but this
  avoids hardcoding "500" as a second, driftable copy of `50 × 10`).
- **`generateQAPairs()`'s service-layer return type is `QaPairEntity[]` (with `publicId`/
  `createdAt`), not spec §5.7's literal `QAPair[]` interface** — same "entities at the service
  layer, response DTOs added when a controller lands" convention `MockDataService.generateDocuments()`
  (AI-048) already established for `DocumentEntity[]` vs. spec's `DocumentResDto[]`; AI-053's future
  `GET /rag/mock/qa-pairs` endpoint is the natural place to add a `QaPairResDto`.
  A caller wanting spec's exact narrower shape gets it for free — `QaPairEntity` is a strict
  superset of `{ question, expectedAnswer, sourceDocumentId, complexity }`.
- **Multi-step questions read cleanly as "requires two chunks" even though nothing enforces the
  _generated document_ content actually needs both to answer** — the mock generator's job (per this
  issue's Testing Notes) is to produce _labeled_ training/eval data at the right structural shape,
  not to guarantee semantic multi-hop necessity against arbitrary faker-generated prose; AI-050's
  evaluation will measure the RAG pipeline's actual behavior against these labels, not validate the
  labels' semantic difficulty.
- **A document with zero chunks is silently excluded from the source pool rather than raising an
  error per-document** — only an _entirely empty_ usable pool (zero documents with any chunks)
  throws; a partially-ingested or still-`pending` document mixed into a `documentIds` list is
  treated as "not yet usable," not a hard failure, mirroring `DocumentService`'s own
  degrade-rather-than-crash conventions elsewhere in this phase.

## Follow Ups

- AI-050 (RAG evaluation — score Q&A pairs by complexity tier) is the direct next consumer: it will
  run every persisted `QaPair` through `RagService.query()` and check the answer's tier-appropriate
  correctness, including a substring/semantic check against `RAG_CONFIG.noInfoSentinel` for the
  edge-case tier — the same constant this issue's edge-case pairs are built from.
- No `GET /rag/mock/qa-pairs` endpoint exists yet (spec §6.4) — that's AI-053's job, once a
  `QaPairResDto` and a `findAll`-style paginated read method are added to `MockDataService` (this
  issue only implements the two generation methods the issue text asked for).
- The multi-step "compare two documents" question format assumes at least a loosely comparable pair
  once ≥2 documents exist in the pool; with a very small or single-category `documentIds` set the
  two compared documents can be structurally similar (e.g. two guides), which is fine for
  generating _labeled_ eval data but worth knowing if AI-050's tier-accuracy numbers ever look
  suspiciously easy for the multi-step tier.
