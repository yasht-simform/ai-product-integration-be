---
id: AI-040
title: PineconeService — Pinecone client wrapper
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 3 — Embedding Cache & Pinecone Client
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-036
  - AI-037
---

# What to Build

Implement `PineconeService` per spec §5.4/§7 — the single boundary to `@pinecone-database/pinecone` in this codebase; no other service imports the Pinecone SDK directly.

```typescript
upsert(vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[]): Promise<void>
query(vector: number[], topK: number, filter?: Record<string, unknown>): Promise<PineconeMatch[]>
deleteByIds(ids: string[]): Promise<void>
deleteByFilter(filter: Record<string, unknown>): Promise<void>
describeIndex(): Promise<PineconeIndexStats>
```

Instantiate the Pinecone client directly inside the service's constructor from `ConfigService` (`pinecone.apiKey`) rather than adding a separate DI injection token like `OPENAI_CLIENT` — `PineconeService` is the only consumer of this client in the whole app, so a factory-provider token (useful for `OPENAI_CLIENT` because multiple services need it) would be unnecessary indirection here. All operations scope to `index.namespace(pineconeConfig.namespace)` (default `'documents'`).

`query()` maps Pinecone's raw match response to `PineconeMatch[]` (`{ id, score, metadata }`), preserving Pinecone's own descending-score ordering. `deleteByFilter()` issues a metadata-filter delete (e.g. `{ documentId: { $eq: publicId } }`) rather than requiring the caller to enumerate vector IDs. `describeIndex()` maps to `PineconeIndexStats` (vector count, dimension — whatever Pinecone's `describeIndexStats()` response actually exposes).

Since `PINECONE_API_KEY`/`PINECONE_INDEX` are optional (AI-036), guard every method with a clear "Pinecone is not configured" error when either is unset — mirroring `OpenaiService`'s `isConfigured`/`ensureConfigured()` guard — rather than letting a raw, confusing Pinecone SDK error surface.

# User Stories Covered

- Story 17 — batch upsert
- Story 18 — query results sorted by score descending
- Story 19 — delete by metadata filter in one call
- Story 20 — `describeIndex()` reports vector count and dimension

# Acceptance Criteria

- [x] `PineconeService` wraps the Pinecone client, scoped to `pineconeConfig.namespace` for every operation
- [x] `upsert`/`query`/`deleteByIds`/`deleteByFilter`/`describeIndex` implemented matching spec §5.4 signatures
- [x] `query()` results mapped to `PineconeMatch[]`, preserving Pinecone's descending-score order
- [x] A clear "Pinecone is not configured" error is thrown by every method when `PINECONE_API_KEY`/`PINECONE_INDEX` are unset, not a raw SDK exception
- [x] Unit tests mock `@pinecone-database/pinecone`'s client entirely — assert the correct namespace/method/argument shape is passed for each of the five methods, plus the not-configured guard

# Dependencies

- AI-036 (`pineconeConfig.namespace`, optional Pinecone env vars)
- AI-037 (module scaffold, `PINECONE_CONFIG` constant, dependency installed)

# Testing Notes

No live Pinecone calls in the automated suite — mock the client's `index()`/`namespace()`/`upsert()`/`query()`/`deleteMany()`/`describeIndexStats()` methods entirely. Live verification is deferred to AI-055.

## Implementation Notes

`PineconeService` (`src/modules/rag/services/pinecone.service.ts`) constructs a `Pinecone` client
directly in its constructor from `ConfigService` (`pinecone.apiKey`/`pinecone.index`), per this
issue's own architecture decision — no `PINECONE_CLIENT` DI token, since this service is the SDK's
only consumer. `client` is typed `Pinecone | null`: `null` when either `apiKey` or `indexName` is
missing (both are optional per AI-036), with a one-time `logger.warn()` at construction time so an
unconfigured deployment is visible in boot logs, not just at first call.

A private `getIndex()` is the single choke point every public method calls first — it destructures
`{ client, indexName }` into locals (narrowing both away from `null`/`undefined` without a
non-null-assertion `!`) and throws `ServiceUnavailableException('Pinecone is not configured')`
before any SDK call if either is absent, then returns `client.index({ name: indexName }).namespace(
this.namespace)` — the SDK v8 API's `index()` accepts either `name` or `host` and lazily resolves
the host via an internal `describeIndex()` call on first real data-plane request, so no extra
round-trip is needed just to obtain a scoped `Index` handle.

Exported three interfaces used by later issues: `PineconeVector` (upsert input shape, matching this
issue's inline signature), `PineconeMatch` (`{ id, score, metadata }`), `PineconeIndexStats`
(`{ totalRecordCount, dimension? }`, mapped directly from the SDK's `IndexStatsDescription` —
`describeIndexStats()`, not the control-plane `Pinecone.describeIndex()`, since only the former
reports live vector counts per namespace).

Type casting notes: `upsert()`'s `metadata: Record<string, unknown>` needs `as unknown as
RecordMetadata` since Pinecone's SDK metadata type (`Record<string, string | boolean | number |
string[]>`) isn't directly comparable to `Record<string, unknown>` — the same
double-cast pattern this codebase already uses at other JSON-like SDK boundaries. The reverse
direction (`query()`'s `match.metadata` → `Record<string, unknown>`) needed **no** cast at all —
`RecordMetadata`'s narrower value union is structurally assignable to `unknown`, so TypeScript
accepts it directly.

`query()` uses the same optional-conditional-spread pattern as `chatCompletion()`'s
`temperature`/`maxTokens` (`...(filter !== undefined ? { filter } : {})`) so an omitted filter is
never sent as `filter: undefined` in the request payload.

`__tests__/pinecone.service.spec.ts` mocks `@pinecone-database/pinecone` entirely via
`jest.mock('@pinecone-database/pinecone', () => ({ Pinecone: jest.fn().mockImplementation(...) }))`
— a chain of `jest.fn()`s standing in for `client.index().namespace()` and its four data-plane
methods. A `createService(overrides)` helper builds a fresh `TestingModule` per test (needed since
the constructor's not-configured branching must run with different `ConfigService` values across
tests, and the client is only ever constructed once per instance). Covers all five methods'
argument shapes plus three not-configured-guard tests (missing `apiKey`, missing `index`, and one
proving the guard applies uniformly across `deleteByIds`/`deleteByFilter`/`describeIndex`).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 55 warnings (54 pre-existing baseline + 1 new instance of an
  already-present category — `expect.not.objectContaining()` triggers the identical
  `no-unsafe-assignment` warning `openai.service.spec.ts` already has at its own
  `not.objectContaining({ tools: expect.anything() })` line; not a new pattern, not a regression)
- `npm run build` — succeeds
- `npx jest --testPathPatterns=pinecone.service` — 11/11 pass
- `npm run test` (full suite) — 303/303 pass, 23/23 suites, no regressions
- Live boot check: `node dist/src/main.js` — both configured (real `.env` values) and explicitly
  unconfigured (`PINECONE_API_KEY=` `PINECONE_INDEX=`) boots verified; the unconfigured boot logs
  `Pinecone is not configured (...) — vector operations will fail until configured` as a `WARN`,
  never crashes, and `RagModule dependencies initialized` appears in both cases

## Assumptions Made

- `describeIndex()`'s `PineconeIndexStats` shape is `{ totalRecordCount, dimension? }` — the spec's
  own text only says "vector count and dimension," so this is the most direct mapping from
  `describeIndexStats()`'s actual response fields, used verbatim rather than inventing a richer
  shape (e.g. per-namespace breakdown) the spec never asked for.
- Chose `index({ name: indexName })` (the SDK's non-deprecated options-object form) over the legacy
  string-argument overload (`index(indexName)`), since the latter is marked `@deprecated` in the
  installed SDK version and scheduled for removal in a future major version.

## Follow Ups

- AI-041 (`DocumentService` CRUD) needs `PineconeService.deleteByFilter({ documentId })` for its
  delete cascade — now available.
- AI-043/AI-045 (ingestion pipeline, search) both need `upsert()`/`query()` — now available.
- AI-053 (stats endpoint) needs `describeIndex()` — now available.
