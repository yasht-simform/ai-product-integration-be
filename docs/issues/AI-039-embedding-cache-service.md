---
id: AI-039
title: EmbeddingCacheService — hash-based embedding dedup
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

Implement `EmbeddingCacheService` per spec §5.2/§9. Hash function: `SHA-256` (Node's built-in `crypto` module) over normalized text — `text.trim().toLowerCase()` — applied identically at every call site that touches the hash.

```typescript
get(text: string): Promise<number[] | null>
set(text: string, embedding: number[], model: string): Promise<void>
invalidate(textHash: string): Promise<void>
getCacheStats(): Promise<{ hits: number; misses: number; totalCached: number }>
```

- `get(text)`: hash the normalized text, look up `embedding_cache.textHash`, return the parsed `embedding` array on a hit or `null` on a miss. Increment an in-memory hit/miss counter either way (scoped to the service instance — no new schema field needed for this; hit/miss stats resetting on app restart is an accepted tradeoff, documented as a decision rather than a gap).
- `set(text, embedding, model)`: upsert by `textHash` — calling `set()` twice for the same text must not throw (same text always produces the same embedding under a given model, so this is idempotent by design, not an error case).
- `invalidate(textHash)`: deletes the single row matching that hash.
- `getCacheStats()`: `totalCached` comes from a real `embedding_cache` row count; `hits`/`misses` come from the in-memory counter.

# User Stories Covered

- Story 13 — identical text hits the cache on the second call
- Story 14 — cache key based on normalized text
- Story 15 — manual cache flush path (this issue provides `invalidate()`; the bulk-flush endpoint itself is Epic 7's concern)
- Story 16 — cache hit/miss counts exposed

# Acceptance Criteria

- [x] `get(text)` hashes normalized text (SHA-256), queries by `textHash`, returns the parsed embedding or `null`
- [x] `set(text, embedding, model)` is idempotent — no error on a duplicate hash
- [x] `invalidate(textHash)` deletes the matching row
- [x] `getCacheStats()` returns `{ hits, misses, totalCached }` with `totalCached` from a real DB count
- [x] Unit tests: cache-hit path, cache-miss path, normalization (differing whitespace/case hash identically — e.g. `"Hello World"` and `"  hello world  "` produce the same hash), `invalidate()` removes the row, `getCacheStats()` counts increment correctly across a sequence of hits/misses

# Dependencies

- AI-036 (realigned `embedding_cache` schema)
- AI-037 (module scaffold, service shell)

# Testing Notes

Follow the standard `DeepMockProxy<DatabaseService>` unit-test pattern with `DatabaseService` jest-mocked at the module level (per `CLAUDE.md`'s documented Jest/ESM gotcha). No real embedding vectors needed in tests — small fixed arrays (e.g. `[0.1, 0.2, 0.3]`) are sufficient since only cache mechanics are under test.

## Implementation Notes

`EmbeddingCacheService` (`src/modules/rag/services/embedding-cache.service.ts`) implements all four
methods per spec §5.2. `hash(text)` — a private helper — normalizes via `text.trim().toLowerCase()`
then SHA-256s it with Node's `crypto.createHash()` (imported from `'crypto'`, matching this
codebase's existing convention in `request-logger.middleware.ts` rather than the `'node:crypto'`
prefix). `get()` calls `embeddingCache.findUnique({ where: { textHash } })`, casts the returned
`Json` field to `number[]` on a hit, and increments a private in-memory `hits`/`misses` counter
either way — no new schema field, matching this issue's own stated decision that hit/miss stats
reset on app restart.

`set()` uses `embeddingCache.upsert()` keyed on `textHash` — idempotent by construction, no P2002
handling needed (unlike `ToolRegistryService.createTool()`'s create-only path, `upsert()` sidesteps
the conflict entirely). The `number[]` embedding is cast through `Prisma.InputJsonValue` in one step
(a plain `as` cast, not the `as unknown as` double-cast some other services need for less
structurally-compatible types) since a numeric array is directly assignable to Prisma's JSON input
type. `tokenCount` is intentionally omitted from both `create`/`update` — the `set()` signature
this issue specifies takes no `tokenCount` parameter, matching the schema's `Int?` optional field.

`invalidate(textHash)` uses `deleteMany({ where: { textHash } })` rather than `delete()` — a
`delete()` on a non-matching unique key throws Prisma's P2025 "record not found," which would make
invalidating an already-gone or never-cached hash an error case; `deleteMany()` is naturally
idempotent (0 or 1 rows affected, never throws), consistent with `set()`'s own idempotency framing
in this issue.

`getCacheStats()` returns the in-memory `hits`/`misses` alongside a real `embeddingCache.count()`
for `totalCached`.

`__tests__/embedding-cache.service.spec.ts` is the first spec file under `src/modules/rag/`, so it
also establishes the `__tests__/` directory for this module. Follows
`model-registry.service.spec.ts`'s exact `DeepMockProxy<DatabaseService>` + module-level
`DatabaseService` jest-mock pattern. A `hashOf()` test helper duplicates the service's own hashing
logic (trim/lowercase/SHA-256) so tests can assert on the exact `textHash` value passed to Prisma
calls, including a dedicated normalization test that captures both calls' `where.textHash` mock
arguments and asserts they're identical for `'Hello World'` vs. `'  hello world  '`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 54 warnings (unchanged from the pre-existing baseline)
- `npm run build` — succeeds
- `npx jest --testPathPatterns=embedding-cache.service` — 9/9 pass
- `npm run test` (full suite) — 292/292 pass, 22/22 suites, no regressions
- Live boot check: `node dist/src/main.js` — starts cleanly, no DI/runtime errors

## Assumptions Made

- `invalidate()` on a non-existent hash resolves silently rather than throwing — the spec doesn't
  specify this explicitly, but it's the more defensible choice for a cache-invalidation operation
  (an already-absent cache entry is not a failure state for the caller) and mirrors this issue's own
  "not an error case" framing for `set()`'s idempotency.
- `tokenCount` is never written by this service, even though the (optional) schema column exists —
  this issue's own interface signature for `set()` has no `tokenCount` parameter, so there's no
  value to write; a future caller that wants token counts tracked would need to extend the
  interface, not something assumed here.

## Follow Ups

- AI-043 (document ingestion pipeline) and AI-045 (semantic search) both call
  `EmbeddingCacheService.get()`/`set()` directly per their own issue text — this service is now
  fully ready for both.
