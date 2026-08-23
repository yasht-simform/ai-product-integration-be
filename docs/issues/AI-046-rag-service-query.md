---
id: AI-046
title: RagService.query() — RAG generation with citations
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
  - AI-045
---

# What to Build

Implement `RagService.query(question, options?)` per spec §5.6/§2.2. Call `SearchService.search()` for retrieval, then build an augmented `OpenAI.Chat.ChatCompletionMessageParam[]` — `RAG_CONFIG.systemPrompt` as the system message, and a user message combining the retrieved chunks (labeled clearly enough for the model to cite them, e.g. numbered and tagged with document title per spec §2.2's example) plus the question. Call `OpenaiService.chatCompletionWithMessages()` (Phase 2's extension point) with `temperature` defaulting to `0.3` (RAG's low-temperature default for factual answers) and `model` passed through or defaulted.

Build `RagResult.sources` from `SearchService`'s actual retrieved chunks — not by parsing the model's citation text — since the retrieved data is already structured and authoritative; the model's prose citation is a display convenience, not the source of truth for what was actually retrieved. Report `searchLatencyMs` and `generationLatencyMs` as independently measured values, plus a combined `latencyMs`. `usage`/`estimatedCost` reflect the generation call only (embedding cost from the search step is separately audited via AI-038's embedding audit path).

A question with zero results above threshold must still call the model (with an explicit "no context found" context block) rather than short-circuiting — the "I don't have enough information" behavior is a property of the prompt/model, not a code branch that skips generation.

# User Stories Covered

- Story 37 — prompt instructs context-only answers with citations
- Story 38 — structured `sources` in the response
- Story 39 — "I don't have enough information" fallback path reachable (code path only — actual model compliance verified live, AI-055)
- Story 40 — separate search vs. generation latency reporting

# Acceptance Criteria

- [x] Augmented prompt includes `RAG_CONFIG.systemPrompt` verbatim as the system message
- [x] Context block includes all retrieved chunks, labeled clearly enough for citation
- [x] Generation uses `temperature: 0.3` by default, overridable via `options.temperature`
- [x] `RagResult.sources` is built from `SearchService`'s actual results
- [x] `searchLatencyMs`/`generationLatencyMs` both reported, independently measured; `latencyMs` is their approximate sum plus orchestration overhead
- [x] A zero-results question still calls the model and returns an answer rather than throwing or returning early
- [x] Unit tests: happy path with mocked search results and a mocked `chatCompletionWithMessages()` response, sources correctly mapped, zero-results path still generates, latency fields populated

# Dependencies

- AI-045 (`SearchService`)

# Testing Notes

Mock `SearchService.search()` and `OpenaiService.chatCompletionWithMessages()`. This is the one service whose real "correctness" (does the model actually cite properly, does it actually decline unanswerable questions) can't be fully proven by a mocked unit test — that's AI-055's job; this issue's tests prove the orchestration code path is structurally correct.

## Implementation Notes

Implemented `RagService.query(question, options?)` (`src/modules/rag/services/rag.service.ts`),
previously an empty shell from AI-037:

1. Calls `SearchService.search(question, { topK: options.topK, categoryFilter:
options.categoryFilter })` (AI-045) — `RagOptions` has no `documentIds`/`similarityThreshold`
   fields per spec §5.6, so those aren't forwarded; `SearchService` already applies its own
   `ragConfig` fallbacks for anything left `undefined`.
2. Builds the augmented message array via a private `buildAugmentedMessages()`: a `system` message
   whose `content` is `RAG_CONFIG.systemPrompt` **verbatim** (no interpolation/modification), and a
   `user` message combining a numbered, title-tagged context block with the question. The context
   block (private `buildContextBlock()`) renders each result as `[N] (Source: "<documentTitle>")\n<content>`
   joined by blank lines — clear enough for the model to cite by document title, per spec §2.2's
   flow description. A zero-results question renders `"Context: No relevant documents were found for
this question."` instead of an empty block, so `chatCompletionWithMessages()` is still called
   normally rather than the code short-circuiting — the "I don't have enough information" behavior
   is left entirely to the prompt/model, not a code branch.
3. Calls `OpenaiService.chatCompletionWithMessages()` (Phase 2's extension point) with `temperature:
options.temperature ?? 0.3` and `model: options.model` (passed through as-is;
   `chatCompletionWithMessages()` already has its own `openai.defaultModel` fallback chain when
   `model` is `undefined`, so `RagService` doesn't need to duplicate that resolution).
4. `RagResult.sources` is mapped directly from `SearchService`'s returned `SearchResult[]` — never
   parsed from the model's answer text, per this issue's own explicit design note (the retrieved
   data is structured and authoritative; the model's prose citation is a display convenience only).
5. Latency: `searchLatencyMs`/`generationLatencyMs` are independently measured around each call;
   `latencyMs` is a separately-measured wall-clock span from the top of `query()` to just before
   return (not a literal sum of the two), so it naturally includes the small orchestration overhead
   of building the augmented messages and mapping `sources` — matching the acceptance criterion's
   "approximate sum plus orchestration overhead" wording more precisely than an actual addition
   would.
6. `usage`/`estimatedCost`/`model` on the returned `RagResult` come straight from the generation
   call's `ChatCompletionResult` — embedding cost from the search step is separately audited via
   AI-038's own embedding audit path, per this issue's explicit scope note.

Three new interfaces landed in `types/rag.types.ts`: `RagOptions`
(`topK?`/`model?`/`temperature?`/`categoryFilter?`/`includeSourceChunks?`), `RagSource`
(`documentTitle`/`documentPublicId`/`chunkContent`/`chunkIndex`/`similarityScore`), and `RagResult`
— matching spec §5.6's interfaces verbatim.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors, 58 warnings (unchanged from the prior baseline)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npm run test -- rag.service` — 10/10 pass
- `npm run test` (full suite) — 378/378 pass (up from 368, +10 new tests, zero regressions)

## Assumptions Made

- **`RagOptions.includeSourceChunks` is accepted on the type but not branched on by `query()`** —
  `RagResult.sources` is unconditionally populated from `SearchService`'s results, per this issue's
  own explicit acceptance criterion ("`RagResult.sources` is built from `SearchService`'s actual
  results", stated without a conditional). Reading spec §5.6's comment ("include the raw chunks in
  the response") together with this issue's silence on the flag, the more likely intent is a
  controller-level response-shaping decision (AI-052 trimming `RagSource.chunkContent` out of the
  wire payload when unset) rather than something `RagService.query()` itself needs to gate —
  deferred to that issue since it depends on the controller's actual response DTO shape.
- **Context block format**: spec §2.2's flow diagram shows only a placeholder
  (`Context: [chunk1, chunk2, chunk3, chunk4, chunk5]`), not a literal template. Implemented as
  `[N] (Source: "<title>")\n<content>` per chunk, joined by blank lines — satisfies "labeled
  clearly enough for citation" (acceptance criterion) without the spec dictating an exact string
  format.
- **`ChatService` had to be mocked at the module level in the new spec file** (`jest.mock(...
database.service...)`) even though this issue doesn't touch `ChatService`'s behavior — `RagService`'s
  existing constructor (from AI-037's scaffold) already injects it for AI-047's
  `queryWithConversation()`, and merely _importing_ `ChatService`'s module transitively loads
  `DatabaseService` → the Prisma-generated ESM client, which fails under Jest (the same documented
  gotcha `document.service.spec.ts` et al. already work around). No production code needed changing
  for this — purely a test-file wiring requirement.

## Follow Ups

- AI-047 (`RagService.queryWithConversation()`) is the next consumer of this same `query()` logic,
  integrating with Phase 2's `ChatService` (already injected but unused by this issue).
- AI-052 (`RagController` — search + ask endpoints) will add request/response DTOs for `RagOptions`/
  `RagResult` and resolve the `includeSourceChunks` behavior noted above.
- AI-055's live smoke test is the actual proof that the model complies with the "answer using ONLY
  the provided context" instruction and correctly declines unanswerable questions — this issue's
  tests only prove the orchestration code path is structurally correct, per its own Testing Notes.
