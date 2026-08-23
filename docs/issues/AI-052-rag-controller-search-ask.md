---
id: AI-052
title: RagController — search + ask endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Tests
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-045
  - AI-046
  - AI-047
---

# What to Build

Wire up the 3 remaining query endpoints from spec §6.2/§6.3:

- `POST /rag/search` — delegates to `SearchService.search()` (AI-045)
- `POST /rag/ask` — delegates to `RagService.query()` (AI-046)
- `POST /rag/ask/conversation/:publicId` — delegates to `RagService.queryWithConversation()` (AI-047)

Add their request/response DTOs (`SearchDto`/`SearchResDto`, `AskDto`/`AskResDto`) matching spec §6.2/§6.3's exact field tables and example response shapes byte-for-byte.

# User Stories Covered

- Stories 33, 37, 39, 41, 50 (search/ask endpoints, citations, conversation integration, Swagger)

# Acceptance Criteria

- [x] All 3 routes implemented, delegating with no business logic in the controller
- [x] Response shapes match spec §6.2/§6.3's documented examples field-for-field
- [x] An invalid/missing `question`/`query` field returns 400 via the global validation pipe
- [x] All 3 routes documented in Swagger under `rag`
- [x] Controller-level DTO validation + delegation tests

# Dependencies

- AI-045 (`SearchService`), AI-046 (`RagService.query()`), AI-047 (`RagService.queryWithConversation()`)

# Testing Notes

Mock `SearchService`/`RagService` as `jest.fn()`-based collaborators, matching `ChatController.spec.ts`'s pattern for `ChatService`.

## Implementation Notes

Extended `RagController` (AI-051) with the 3 remaining spec §6.2/§6.3 query routes. `SearchService`
and `RagService` are now injected into the controller's constructor alongside AI-051's
`DocumentService`.

Files created:

- `src/modules/rag/dto/search.dto.ts` — `SearchDto` (`query`, `topK?`, `similarityThreshold?`,
  `category?`, `documentIds?`)
- `src/modules/rag/dto/search-result-res.dto.ts` — `SearchResultResDto` (nested search result item)
- `src/modules/rag/dto/search-res.dto.ts` — `SearchResDto` (`results[]`, `totalResults`,
  `searchLatencyMs`)
- `src/modules/rag/dto/ask.dto.ts` — `AskDto` (`question`, `topK?`, `model?`, `temperature?`,
  `category?`, `includeSourceChunks?`), shared by both ask routes
- `src/modules/rag/dto/rag-source-res.dto.ts` — `RagSourceResDto` (nested citation item)
- `src/modules/rag/dto/ask-res.dto.ts` — `AskResDto` (`answer`, `model`, `sources[]`, `usage`,
  `estimatedCost`, `latencyMs`, `chunksRetrieved`, `searchLatencyMs`, `generationLatencyMs`)

Files modified:

- `src/modules/rag/rag.controller.ts` — added `search()`/`ask()`/`askInConversation()` routes +
  `SearchService`/`RagService` constructor deps + `toSearchResultRes()`/`toAskRes()` mappers
- `src/modules/rag/dto/index.ts` — barrel exports for the 6 new DTOs
- `src/modules/rag/__tests__/rag.controller.spec.ts` — added `SearchService`/`RagService` mocks to
  the existing `TestingModule` setup, DTO validation tests for `SearchDto`/`AskDto`, and delegation
  tests for all 3 new routes
- `CLAUDE.md` — new "RagController — search + ask endpoints (AI-052)" section

Design decisions:

- `searchLatencyMs` is measured by the controller itself around the `SearchService.search()` call
  (that method returns a bare `SearchResult[]`, no latency field), then wrapped into spec §6.2's
  `{ results, totalResults, searchLatencyMs }` shape.
- `AskDto` is shared by both `/rag/ask` and `/rag/ask/conversation/:publicId` — spec §6.3
  documents one request field table for both, and `RagOptions` (what both `RagService` methods
  accept) is identical either way.
- `includeSourceChunks` gating is implemented at the controller's response-mapping layer
  (`toAskRes()`): `false` strips `sources` to `[]`, anything else (including omitted) keeps them —
  closing the gap AI-046 explicitly left open ("likely a controller-level response-shaping
  decision for AI-052").
- All 3 new routes use `successStatus: 201`, matching this codebase's own established convention
  (every `POST` route in `openai.controller.ts`, including pure-computation ones like
  `token-count`/`pricing/calculate`, uses 201 — not RESTful purism, just this project's precedent).

**Live-verified**: booted `npm run dev` against real Postgres, exercised all 3 routes with `curl`.
400 correctly returned for missing `query`/`question` and an invalid `category` enum value; 404
correctly propagated on `POST /rag/ask/conversation/:publicId` for an unknown conversation; all 3
routes confirmed present in `/api/docs-json` under the `rag` tag. `POST /rag/search` and
`POST /rag/ask` both return 500 in this sandbox — root-caused via server logs to
`PineconeConnectionError: Request failed to reach Pinecone` (no network egress to Pinecone from
this environment), the same pre-existing environment limitation already flagged as a Follow Up in
AI-051, not a defect in this issue's code. DTO validation, routing, and error propagation were all
confirmed correct up to that boundary.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors on all files touched by this issue
- `npm run build` — succeeds
- `npm run test -- rag.controller` — 29/29 pass
- `npm run test` (full suite) — 448/448 pass, zero regressions (up from 433 before this issue)
- Live `npm run dev` + `curl` smoke test against real Postgres — see Implementation Notes

## Assumptions Made

- `includeSourceChunks`'s implicit default is `true` (sources included) — spec §6.3's example
  response always shows populated `sources`, and the field itself has no documented default value.
- No dedicated `AskDto` variant exists for the conversation-scoped ask route — reusing the plain
  `AskDto` for both routes matches the spec's own single shared field table, and `RagOptions` (the
  type both `RagService` methods accept) has no field that only makes sense for one route or the
  other.
- `category` (spec's field name in both request tables) is validated with the same
  `@IsIn(Object.values(DocumentCategory))` convention `QueryDocumentsDto`/`UploadDocumentDto`
  already use, then renamed to `categoryFilter` at the service-call boundary to match
  `SearchOptions`/`RagOptions`'s actual field name.

## Follow Ups

- Same as AI-051's Follow Up: this sandbox's Pinecone connectivity/credentials need to be resolved
  before AI-055's live smoke test can exercise `/rag/search`/`/rag/ask` end to end with real
  results.
- AI-054 (regression + full `RagController` test pass) should re-run the full suite once AI-053
  lands, to confirm this issue's tests still pass alongside the mock-data/evaluation endpoints.
