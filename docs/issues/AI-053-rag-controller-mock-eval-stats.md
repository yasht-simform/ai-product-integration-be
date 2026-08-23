---
id: AI-053
title: RagController — mock data, evaluation & stats endpoints
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
  - AI-048
  - AI-049
  - AI-050
  - AI-040
  - AI-039
---

# What to Build

Wire up the remaining 6 endpoints from spec §6.4/§6.5/§6.6:

- `POST /rag/mock/generate-documents`, `POST /rag/mock/generate-qa`, `POST /rag/mock/seed`, `GET /rag/mock/qa-pairs` — delegate to `MockDataService` (AI-048/049)
- `POST /rag/evaluate` — delegates to AI-050's evaluation method; enforces the bounded sample-size parameter (omitting it uses a small safe default, never "evaluate everything")
- `GET /rag/stats` — the one route in this module that legitimately touches multiple services directly, aggregating: total documents (`DocumentService`/`DatabaseService` count), total chunks, total vectors in Pinecone (`PineconeService.describeIndex()`), cache hit rate (`EmbeddingCacheService.getCacheStats()`), embedding model, index dimensions

# User Stories Covered

- Stories 43, 45, 46, 47, 48, 49, 50, 55 (mock data endpoints, evaluation, stats, Swagger)

# Acceptance Criteria

- [x] All 6 routes implemented and documented in Swagger under `rag`
- [x] `/rag/evaluate` enforces the bounded sample-size parameter — omitting it uses a small safe default
- [x] `/rag/stats` correctly aggregates data from `DocumentService`, `PineconeService`, and `EmbeddingCacheService` in one response
- [x] Controller-level DTO validation + delegation tests (the stats endpoint's test mocks all three underlying services)

# Dependencies

- AI-048, AI-049, AI-050 (`MockDataService` methods), AI-040 (`PineconeService.describeIndex()`), AI-039 (`EmbeddingCacheService.getCacheStats()`)

# Testing Notes

Standard controller-test seam — mock every underlying service, assert delegation and response shaping only.

## Implementation Notes

Extended `RagController` (AI-051/052) with spec §6.4/§6.5/§6.6's final 6 routes.
`MockDataService`, `PineconeService`, `EmbeddingCacheService`, `ConfigService`, and
`AppLoggerService` are now injected into the controller's constructor.

Files created:

- `src/modules/rag/dto/generate-documents.dto.ts` — `GenerateDocumentsDto` (`count`, `categories?`,
  `minWords?`, `maxWords?`)
- `src/modules/rag/dto/generate-qa.dto.ts` — `GenerateQaDto` (`count`, `documentIds?`)
- `src/modules/rag/dto/query-qa-pairs.dto.ts` — `QueryQaPairsDto` (`documentId?`, `complexity?`,
  `page?`, `limit?`)
- `src/modules/rag/dto/evaluate.dto.ts` — `EvaluateDto` (`sampleSize?`, `@Max(200)`)
- `src/modules/rag/dto/qa-pair-res.dto.ts` — `QaPairResDto`
- `src/modules/rag/dto/paginated-qa-pairs-res.dto.ts` — `PaginatedQaPairsResDto`
- `src/modules/rag/dto/seed-result-res.dto.ts` — `SeedResultResDto` (`documents`, `qaPairs` counts)
- `src/modules/rag/dto/evaluate-res.dto.ts` — `EvaluationComplexityBreakdownResDto` + `EvaluateResDto`
  (mirrors spec §6.5's example response field-for-field, `byComplexity` as an inline `Record`
  schema matching the existing `ModelPricingResDto` convention)
- `src/modules/rag/dto/stats-res.dto.ts` — `StatsResDto`

Files modified:

- `src/modules/rag/rag.controller.ts` — added `generateMockDocuments()`/`generateMockQa()`/
  `seedMockData()`/`findAllQaPairs()`/`evaluate()`/`getStats()` routes + 5 new constructor deps +
  `toQaPairRes()` mapper
- `src/modules/rag/dto/index.ts` — barrel exports for the 9 new DTOs
- `src/modules/rag/services/document.service.ts` — added `getStats()` (two parallel `count()`
  queries)
- `src/modules/rag/services/mock-data.service.ts` — added `findAllQaPairs()` (paginated, filterable
  by `documentId`/`complexity`)
- `src/modules/rag/types/rag.types.ts` — added `PaginatedQaPairsResult`, `DocumentStatsResult`
- `src/modules/rag/__tests__/rag.controller.spec.ts` — added mocks for the 5 new dependencies, DTO
  validation tests for the 4 new request DTOs, delegation tests for all 6 new routes (17 new tests)
- `CLAUDE.md` — new "RagController — mock data, evaluation & stats endpoints (AI-053)" section

Design decisions:

- `GET /rag/mock/qa-pairs` needed a new `MockDataService.findAllQaPairs()` method — no listing
  method existed on that service before this issue. Follows `DocumentService.findAll()`'s exact
  pagination shape; an unresolvable `documentId` filter returns an empty page, not a 404 (listing
  filter, not a resource lookup).
- `GET /rag/stats` needed a new `DocumentService.getStats()` method rather than the controller
  touching `DatabaseService` directly — keeps the "controllers never touch `DatabaseService`"
  invariant intact everywhere else in this codebase, while still satisfying the issue's own framing
  of this route as "the one that legitimately touches multiple services."
- `GET /rag/stats` degrades gracefully when `PineconeService.describeIndex()` throws (wrapped in
  its own try/catch, logs a warning, falls back to `totalVectors: 0`/`indexDimensions: undefined`)
  rather than failing the whole response — proven immediately useful against this sandbox's actual
  broken Pinecone connectivity during live verification.
- `/rag/evaluate`'s bounded sample size is enforced at both the DTO layer (`@Max(200)`) and the
  service layer (`MockDataService.evaluate()`'s existing internal clamp from AI-050) —
  belt-and-suspenders, and the DTO-level check means an over-limit request never reaches the
  service at all.
- `POST /rag/mock/generate-documents`/`generate-qa` have no request-body caps beyond `@Min(1)` —
  unlike `evaluate`, neither the spec nor `MockDataService`'s own implementation treats these as
  needing a hard ceiling (no `MAX_*` constant exists in the service for either), so none was added
  at the DTO layer either, keeping scope tight to what the issue actually asked for.

**Live-verified**: booted `npm run dev` against real Postgres, exercised all 6 routes with `curl`.
`GET /rag/stats` returned 200 with the graceful-degradation path engaging for real (this sandbox's
Pinecone credentials are genuinely broken — same issue flagged in AI-051/052) — document/chunk/cache
stats still correctly populated. `POST /rag/evaluate` correctly 400'd at `sampleSize: 500`.
`POST /rag/mock/generate-documents` with `count: 2` created two real faker-generated documents
end-to-end. `POST /rag/mock/generate-qa` against a zero-chunk pool correctly propagated
`MockDataService`'s `BadRequestException`. All 6 routes confirmed present in `/api/docs-json`.
Verification documents were deleted afterward.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors on all files touched by this issue
- `npm run build` — succeeds
- `npm run test -- rag.controller` — 46/46 pass
- `npm run test -- src/modules/rag` — 180/180 pass
- `npm run test` (full suite) — 465/465 pass, zero regressions (up from 448 before this issue)
- Live `npm run dev` + `curl` smoke test against real Postgres — see Implementation Notes

## Assumptions Made

- No dedicated ingestion-status-style cap exists for `generate-documents`/`generate-qa` counts —
  only `evaluate`'s sample size is bounded, per the issue's own explicit framing distinguishing it
  from the other mock-data routes.
- `POST /rag/mock/seed` takes no request body — `MockDataService.seedDefaultDataset()`'s signature
  is parameterless, and spec §6.4 documents it as running "the full default seed" with no
  configurable inputs.
- `GET /rag/stats`'s graceful Pinecone-failure degradation (falling back to `totalVectors: 0`
  rather than propagating a 503) was not explicitly specified either way — chosen because a stats
  endpoint that goes fully dark whenever one of three data sources is unavailable is less useful
  than one that reports what it can, and this matches the codebase's established
  degrade-gracefully convention elsewhere (`ToolExecutorService.execute()`, `DocumentService
.ingestDocument()`).

## Follow Ups

- Same as AI-051/052's Follow Up: this sandbox's Pinecone connectivity/credentials need to be
  resolved before AI-055's live smoke test can exercise ingestion-dependent routes
  (`generate-qa`, `evaluate`, non-zero `/rag/stats` vector counts) end to end with real results.
- AI-054 (regression + full `RagController` test pass) should re-run the full suite now that all
  three of AI-051/052/053 are complete, confirming the whole controller's test suite is coherent
  together.
