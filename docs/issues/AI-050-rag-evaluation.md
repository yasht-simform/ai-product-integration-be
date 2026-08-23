---
id: AI-050
title: RAG evaluation — score Q&A pairs by complexity tier
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
  - AI-049
  - AI-046
---

# What to Build

Implement an evaluation capability (add to `MockDataService`, since it already owns the `QaPair` concept from AI-049) that runs a bounded set of `QaPair` rows through `RagService.query()`, compares each generated answer against `expectedAnswer`, classifies each result into `correct` / `partiallyCorrect` / `incorrect` / `appropriateIDK`, and aggregates accuracy overall and per complexity tier, matching spec §6.5's response shape.

Exact-string matching between a generated answer and `expectedAnswer` is unreliable given LLM phrasing variance, so use a documented heuristic, not a ground-truth grader: for edge-case pairs, classify as `appropriateIDK` if the answer contains the configured "I don't have enough information" phrase (or a close variant), otherwise `incorrect`; for simple/multi-step pairs, use a lightweight text-similarity check (keyword/entity overlap between the generated answer and `expectedAnswer`) to bucket `correct`/`partiallyCorrect`/`incorrect`. A fully rigorous grader (e.g. LLM-as-judge) is out of scope — it would add a third per-question LLM call this codebase doesn't currently budget for, and isn't required by the spec.

**Must be explicitly bounded**: accept a `sampleSize`/`count` parameter (default to a small number, e.g. 50) rather than defaulting to "evaluate every generated pair" — each evaluated question costs a live embedding + Pinecone + generation call, and the target Q&A volume (10K+) makes an unbounded default a real cost/rate-limit hazard.

# User Stories Covered

- Story 48 — evaluation scores accuracy by complexity tier
- Story 49 — evaluation is explicitly boundable, not "evaluate everything" by default

# Acceptance Criteria

- [x] Evaluation runs a bounded set of `QaPair`s (explicit count/sample, never "all" by default) through `RagService.query()`
- [x] Each result is classified into one of the four buckets and aggregated into the spec §6.5 response shape (`totalQuestions`, `correct`, `partiallyCorrect`, `incorrect`, `appropriateIDK`, `accuracy`, `avgLatencyMs`, `avgTokens`, `byComplexity`)
- [x] Edge-case pairs are scored primarily on whether the answer correctly declines, not on content similarity
- [x] Unit tests: classification heuristic for each of the four buckets against fixture answer strings, aggregate math (accuracy/averages) against a small fixture result set, bounded-sampling behavior (requesting more than available/configured max doesn't silently run unbounded)

# Dependencies

- AI-049 (`QaPair` generation), AI-046 (`RagService.query()`)

# Testing Notes

Unit tests validate the classification/aggregation _logic_ against fixture inputs (mocked `RagService.query()` responses), not that the heuristic produces good real-world judgments — real judgment quality is a live/manual concern, noted in AI-055.

## Implementation Notes

Added `evaluate(sampleSize?)` to `MockDataService` (`src/modules/rag/services/mock-data.service.ts`)
— the service already owned the `QaPair` concept from AI-049, so this issue adds no new service or
schema.

**Bounded sampling**: `take = Math.min(sampleSize ?? DEFAULT_EVAL_SAMPLE_SIZE(50),
MAX_EVAL_SAMPLE_SIZE(200))` — a caller can never exceed the hard cap regardless of what it
requests, satisfying AC #1/#4. `databaseService.qaPair.findMany({ take, orderBy: { id: 'asc' } })`
reads directly (same direct-table-access convention `SearchService`/`generateQAPairs()` already
use), with deterministic ordering for reproducible evaluation runs. Each pair is run through
`RagService.query(pair.question)` **sequentially**, not `Promise.all()`'d — matching this
codebase's established preference for sequential loops wherever a call is both rate-limit-sensitive
and needs deterministic ordering (same rationale `DocumentService.embedChunks()`'s cache-check loop
already documents).

**Classification heuristic** (`classifyAnswer()`, private) — explicitly documented as a heuristic,
not a ground-truth grader, per this issue's own scope boundary:

- **Edge-case pairs**: classified `appropriateIDK` if the generated answer contains any of a
  hardcoded list of "I don't have enough information" paraphrase variants (`IDK_PHRASES` —
  covering the exact `RAG_CONFIG.noInfoSentinel` substring plus common alternate phrasings an LLM
  might use instead of reproducing the sentinel verbatim), otherwise `incorrect` —
  **never** compared against `expectedAnswer` by content similarity, satisfying AC #3 directly. A
  confident-sounding wrong answer that happens to share vocabulary with the sentinel (e.g. the word
  "information") is still `incorrect`, covered by its own test.
- **Simple/multi-step pairs**: a keyword-overlap ratio (`keywordOverlapRatio()`) — the fraction of
  `expectedAnswer`'s significant keywords (length ≥ 4, common stopwords filtered) that also appear
  in the generated answer — buckets into `correct` (≥ 0.5), `partiallyCorrect` (≥ 0.2), or
  `incorrect` (below). Documented as a cheap proxy for correctness, not exact-string matching,
  since LLM phrasing variance makes exact matching unreliable (this issue's own stated rationale).

**Aggregation** (`aggregateEvaluations()`, private): global `correct`/`partiallyCorrect`/
`incorrect`/`appropriateIDK` are raw classification-bucket counts across all evaluated pairs;
overall `accuracy` is `correct / totalQuestions` — matching the spec §6.5 example's own arithmetic
exactly (72/100 = 0.72, not counting `appropriateIDK` or `partiallyCorrect` toward the numerator).
`byComplexity` is always populated with all three `QaComplexity` tiers (even a `{ total: 0 }` tier
if no evaluated pair fell into it), and — this is the resolution of AC #3 at the aggregate level —
each tier's own `correct` field means "declined correctly" for `edge-case` (i.e. counts
`appropriateIDK` classifications) but "answered correctly" for `simple`/`multi-step` (counts
`correct` classifications); both interpretations use the identical `correct / total` accuracy
formula, just with a different numerator definition per tier. `avgLatencyMs`/`avgTokens` are the
mean of `RagResult.latencyMs`/`RagResult.usage.totalTokens` across all evaluated pairs, rounded to
the nearest integer; `accuracy` values are rounded to 2 decimal places, matching the spec example's
own precision (`0.72`, `0.87`, etc.). All aggregates safely resolve to `0` (not `NaN`/a crash) when
zero pairs are evaluated.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 59 warnings (unchanged from the AI-049 baseline)
- `npm run build` — succeeds
- `npm run test -- mock-data.service` — 32/32 pass (22 pre-existing + 10 new `evaluate()` tests:
  default/clamped sample size, edge-case IDK-phrase detection both ways, simple-tier
  correct/partiallyCorrect/incorrect keyword-overlap buckets, fixture aggregate math
  (totals/accuracy/avgLatencyMs/avgTokens), `byComplexity.edge-case`'s "declined correctly"
  semantics, empty-pool zeroed result with no `RagService.query()` calls)
- `npm run test` (full suite) — 419/419 pass (up from 409, +10 new tests, zero regressions)

## Assumptions Made

- **`evaluate()` lives on `MockDataService`, not a new `EvaluationService`** — the issue's own "What
  to Build" text explicitly directs this ("add to `MockDataService`, since it already owns the
  `QaPair` concept"), so no new service/module wiring was needed.
- **`byComplexity`'s per-tier `correct` field has tier-dependent meaning** (declined-correctly for
  edge-case, answered-correctly for simple/multi-step) rather than always meaning "classified as the
  raw `'correct'` bucket" — this is the direct, literal reading of AC #3 applied consistently at
  both the per-answer classification level and the per-tier aggregate level; the alternative (always
  using the raw `'correct'` count) would make `byComplexity.edge-case.correct` permanently `0`,
  contradicting the spec §6.5 example's non-zero edge-case `correct: 5`.
- **`RAG_CONFIG.noInfoSentinel` (AI-049) is checked via substring/paraphrase matching, not exact
  equality** — an LLM's actual refusal text will rarely match the configured sentinel verbatim even
  though the system prompt instructs it to use that exact phrase; the `IDK_PHRASES` list is a
  pragmatic, documented compromise, not a claim of completeness.
- **Sampling order is deterministic (`orderBy: { id: 'asc' }`), not random** — makes evaluation runs
  reproducible for debugging/testing; a future issue could add random sampling if evaluating a
  representative cross-section (rather than the earliest-created pairs) becomes important once the
  Q&A table grows past a few thousand rows.
- **No new DTOs/controller route were added** — this issue's own scope is the `MockDataService`
  method only; `POST /api/v1/rag/evaluate` (spec §6.5) is AI-053's job, per the same
  service-first-then-controller sequencing this phase has followed throughout (documents → DTOs
  landed together in AI-041, but chat/tool-style features have consistently split service logic
  and controller wiring across separate issues).

## Follow Ups

- AI-053 (`RagController` — mock data, evaluation & stats endpoints) is the direct next consumer:
  `POST /rag/evaluate` wiring `sampleSize` from the request body/query into `evaluate()`, plus a
  Swagger response DTO matching spec §6.5's JSON shape exactly.
- AI-055 (live smoke test) is explicitly where this heuristic's real-world judgment quality should
  be sanity-checked against actual LLM answers — this issue's own Testing Notes and spec SC-RAG-008
  both flag that as a live/manual concern, not something these unit tests claim to validate.
- The keyword-overlap thresholds (`CORRECT_OVERLAP_THRESHOLD = 0.5`, `PARTIAL_OVERLAP_THRESHOLD =
0.2`) and the `IDK_PHRASES` list are hand-picked constants, not tuned against real evaluation
  data — worth revisiting once AI-055's live run produces a batch of real answers to calibrate
  against.
