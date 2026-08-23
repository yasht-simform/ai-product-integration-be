---
id: AI-048
title: MockDataService.generateDocuments() — faker-based document generation
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 6 — Mock Data Generation & Evaluation
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-043
  - AI-037
---

# What to Build

Implement `MockDataService.generateDocuments(count, options?)` per spec §5.7/§10.1. Distribute `count` documents across the 5 categories (guide, faq, docs, tutorial, changelog) using `@faker-js/faker` for names/dates/product names/technical terms, with real structure — markdown-style headings, paragraphs, lists, not flat lorem-ipsum text — and word count within `options.minWords`/`options.maxWords` (default 200–2000).

Provide 5 distinct content-template builders, one per category, so generated text has category-appropriate structure (e.g. tutorials get numbered steps, changelogs get dated version headers, FAQs get a question/answer format) — this is FR-RAG-010's "structured, realistic documents — not random gibberish" requirement made concrete. Generic lorem-ipsum-with-headings reused across every category does not satisfy this.

Each generated document should be created and ingested through AI-043's create-and-ingest-from-text flow, so generated documents are immediately searchable — the entire point of mock data is to exercise the retrieval pipeline, so leaving generated documents unindexed defeats the purpose.

# User Stories Covered

- Story 43 — generate documents across categories
- Story 44 — realistic structure per category

# Acceptance Criteria

- [x] `generateDocuments(10)` produces 10 documents spanning multiple categories (not all one category unless `options.categories` narrows it)
- [x] Each document's word count falls within `[minWords, maxWords]`
- [x] Each category has a visibly distinct structural template — verified by a test asserting category-specific markers (e.g. changelog documents contain version-like headers, tutorials contain numbered steps)
- [x] Generated documents reach `embeddingStatus: 'completed'` (or `'failed'`, never left at `'pending'`) via the ingestion pipeline
- [x] Unit tests: category distribution across a generated batch, word-count bounds, structural markers per category, ingestion call counts match the requested count

# Dependencies

- AI-043 (create-and-ingest-from-text flow), AI-037 (`@faker-js/faker` installed, `DocumentCategory` constant)

# Testing Notes

Mock `DocumentService`'s create-and-ingest method — this issue tests generation/structure logic, not the ingestion pipeline itself (already covered by AI-043's own tests).

## Implementation Notes

Implemented `MockDataService.generateDocuments(count, options?)` (`src/modules/rag/services/mock-data.service.ts`),
previously an empty shell from AI-037.

**Distribution**: round-robin over `options.categories` (cast to `DocumentCategory[]`) or all five
`DocumentCategory` values by default (`categories[i % categories.length]`) — deterministic and
guarantees even coverage across a batch, satisfying "spans multiple categories" without needing
randomized selection.

**Five template builders** (`buildGuideTemplate`/`buildFaqTemplate`/`buildDocsTemplate`/
`buildTutorialTemplate`/`buildChangelogTemplate`), each returning `{ title, header, nextSection
(index) => string }`:

- **Guide**: Prerequisites → numbered CLI installation steps → a fenced config block → two
  troubleshooting subsections, cycling through a 5-entry section pool.
- **FAQ**: a rotating bank of 6 question headings (`## What is <product>?`, etc.), each paired with
  a generated answer paragraph.
- **Docs**: a features list, two API-reference entries (`` `GET /api/<noun>` ``/`` `POST
/api/<noun>` ``), and an architecture section.
- **Tutorial**: unbounded `### Step <n>: <verb> the <noun>` headings, `n` strictly incrementing
  (not cycled) so step numbering is always sequential regardless of how many sections a document
  needs.
- **Changelog**: unbounded `## [<semver>] - <date>` version headers (date via
  `faker.date.past()`) each with `### Added`/`### Fixed` subsections — the version number climbs
  with the section index rather than repeating.

Every builder injects `faker.commerce.productName()`/`faker.hacker.noun()`/`faker.system.semver()`/
`faker.date.past()`/etc. into the structural elements themselves (headings, CLI commands, config
keys, version numbers) — `faker.lorem.paragraph()`/`.sentence()` fill the prose body text only.
This is what makes the acceptance criteria's structural-marker test meaningful: the shape (headings,
numbered lists, dated version blocks) is deterministic per category, not just "lorem ipsum under a
random heading."

**Word-count control** (private `assembleContent()`): appends `nextSection(index)` blocks to the
header in a loop until the running word count reaches `minWords` (capped at `MAX_SECTION_ITERATIONS
= 200` as a safety net against a pathological empty-section template), then falls back to a
word-level truncation (`truncateToWordCount()`) if the last appended section pushed the total past
`maxWords`. In practice, stopping the loop the instant `minWords` is reached — rather than trying to
get close to `maxWords` — keeps every generated document comfortably inside a generous default
range (200–2000) without the truncation path ever engaging; it exists as a correctness guarantee
for narrow custom ranges, not the common path.

**Ingestion**: each document is created via `DocumentService.createFromText({ title, category,
tags: ['mock-data'], content })` — AI-043's create-and-ingest-from-text flow — so every generated
document is immediately searchable, not just persisted as inert metadata. Calls are sequential
(`await` inside a `for` loop, not `Promise.all()`), matching this codebase's established preference
for deterministic, assertable write-path ordering over speculative concurrency (same rationale
`DocumentService.embedChunks()`'s cache-check loop already documents).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 59 warnings (up from the 58-warning baseline by exactly one:
  `mock-data.service.spec.ts`'s array-destructure-of-a-mock-call-argument triggers the same
  pre-existing `no-unsafe-*` warning class already present at similar call sites elsewhere in this
  test suite — not a new category)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- mock-data.service` — 12/12 pass
- `npm run test` (full suite) — 399/399 pass (up from 387, +12 new tests, zero regressions)
- Live sanity check (outside Jest): `node -e "require('@faker-js/faker')"` and a direct property
  call on the required object both succeeded with no error, confirming the compiled CJS output's
  `require("@faker-js/faker")` genuinely works at runtime in this environment — see the dependency
  footgun note below for why this needed explicit verification rather than being assumed safe.

## Assumptions Made

- **Generated documents get `sourceType: 'txt'`, not `'generated'`** — `DocumentService.createFromText()`
  (AI-043) hardcodes `sourceType: DocumentSourceType.TXT` and this issue's own text directs reuse of
  that exact flow rather than a new entry point. `DocumentSourceType.GENERATED` remains an unused
  enum value; wiring it through would mean modifying `DocumentService`'s ingestion entry point,
  which is out of this issue's stated scope.
- **Documents are tagged `['mock-data']`** — not required by the acceptance criteria, but a small,
  low-risk addition giving future callers (AI-049's Q&A generation, AI-053's mock endpoints, or a
  future admin cleanup task) an easy way to identify/filter/bulk-delete generated content without
  needing a separate tracking mechanism.
- **Service-layer return type is `DocumentEntity[]`, not spec §5.7's literal `DocumentResDto[]`** —
  matches every other Rag service's established convention (entities at the service layer, Swagger
  response DTOs added when a controller lands — AI-053 for this method).
- **`MockOptions.categories` (`string[]`) is cast directly to `DocumentCategory[]` without runtime
  validation** — acceptable at the service layer per this issue's scope; a future controller-facing
  DTO (AI-053) is the natural place for `@IsIn(Object.values(DocumentCategory))`-style validation of
  caller-supplied category strings.

## Follow Ups

- **Dependency footgun, fourth occurrence** (same class as `axios`/`@langchain/core`/`@types/multer`
  from AI-037/042/044): `@faker-js/faker@10` ships pure ESM, which Jest's default CJS transform
  cannot parse (`SyntaxError: Cannot use import statement outside a module`) — the _same_
  Jest/ESM-only-package incompatibility already documented for `pdf-parse`'s dynamic-import worker
  in AI-042, not a new failure mode. Fixed the same way: `jest.mock('@faker-js/faker', ...)` in
  `mock-data.service.spec.ts` with a small deterministic fake (fixed word-count paragraphs/sentences)
  rather than a global Jest config change — this also made the word-count-bound assertions exact
  instead of merely regex-plausible. Verified separately (see Validation Performed) that the real
  package works correctly outside Jest, so no production code or build config needed changing;
  purely a test-file wiring requirement, worth checking for again if a future issue imports another
  ESM-only package directly into test-covered code.
- AI-049 (`MockDataService.generateQAPairs()`/`seedDefaultDataset()`) is the next consumer,
  generating Q&A pairs against the documents this issue creates.
