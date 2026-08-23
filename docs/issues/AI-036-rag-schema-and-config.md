---
id: AI-036
title: Prisma schema — documents, document_chunks + EmbeddingCache realignment + Pinecone/RAG config
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 1 — Database Schema & Configuration Foundation
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by: []
---

# What to Build

Extend `schema.prisma` with two new models and realign one existing model, following the exact `BigInt @id @default(autoincrement())` internal PK + `publicId String @unique @default(uuid())` external identifier pattern already established by `AiAuditLog`/`AiModel`/`ChatConversation`.

**`Document`** (`@@map("documents")`): `title String`, `description String?`, `sourceType String`, `originalFilename String?`, `fileSize Int?`, `totalChunks Int @default(0)`, `totalTokens Int @default(0)`, `embeddingModel String`, `embeddingStatus String`, `category String?`, `tags String[]`, `metadata Json? @db.JsonB`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, and a `chunks DocumentChunk[]` relation.

**`DocumentChunk`** (`@@map("document_chunks")`): `documentId BigInt`, a `document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)`, `chunkIndex Int`, `content String`, `tokenCount Int`, `startChar Int`, `endChar Int`, `pineconeId String?`, `embeddingStatus String`, `metadata Json? @db.JsonB`, `createdAt DateTime @default(now())`. No `updatedAt` — append-only, matching `ChatMessage`'s pattern.

**Realign `EmbeddingCache`**: this model already exists from the Phase 1 scaffold but predates the codebase's `BigInt`+`publicId` convention (`id String @default(cuid())`, no `publicId`, no `tokenCount`). Since no service has ever read or written this table, correct it now: `id BigInt @id @default(autoincrement())`, add `publicId String @unique @default(uuid())`, add `tokenCount Int?`. Keep `textHash String @unique`, `embedding Json`, `model String`, `createdAt DateTime @default(now())` as-is.

**Indexes** (spec §3.4):

- `document_chunks (document_id, chunk_index ASC)`
- `documents (category)`
- `documents (embedding_status)`
- confirm `embedding_cache.text_hash`'s unique index survives the realignment

**Config — extend `pineconeConfig`** in `app.config.ts`: add `namespace: process.env.PINECONE_NAMESPACE ?? 'documents'`. Change `PINECONE_API_KEY`/`PINECONE_INDEX` in `env.validation.ts` from required to `@IsOptional()` — the app must still boot cleanly with no Pinecone account configured, with RAG-specific services failing clearly at call time instead (this deviates from `pineconeConfig`'s current `!`-asserted required fields, which today block app boot entirely without a Pinecone key even though nothing has used them yet).

**Config — add a new `ragConfig` namespace** (`registerAs('rag', ...)`, following `chatConfig`'s exact pattern), covering the env-tunable values from spec §4.4–§4.7: `embeddingModel` (`EMBEDDING_MODEL`, default `'text-embedding-3-small'`), `embeddingDimensions` (`EMBEDDING_DIMENSIONS`, default `1536`), `embeddingBatchSize` (`EMBEDDING_BATCH_SIZE`, default `20`), `topK` (`RAG_TOP_K`, default `5`), `similarityThreshold` (`RAG_SIMILARITY_THRESHOLD`, default `0.7`), `maxContextTokens` (`RAG_MAX_CONTEXT_TOKENS`, default `4000`), `chunkSize` (`CHUNK_SIZE`, default `500`), `chunkOverlap` (`CHUNK_OVERLAP`, default `50`). Register `ragConfig` in `AppModule`'s `ConfigModule.forRoot({ load: [...] })` array alongside the other seven namespaces.

Add all new env vars to `env.validation.ts` as `@IsOptional()` with appropriate validators (`@IsInt()`/`@IsNumber()` + `@Min()`/`@Max()` where sensible, matching `chatConfig`'s validators) and to `.env.example` under a new `# RAG / Pinecone` section.

After schema edits: `npm run prisma:migrate` then `npm run prisma:generate`.

# User Stories Covered

Foundational — enables Stories 1, 4, 5, 6, 7 and every later epic's persistence needs. No user-facing behavior yet.

# Acceptance Criteria

- [x] `Document`, `DocumentChunk` models exist in `schema.prisma` with all fields listed above
- [x] `DocumentChunk.document` relation uses `onDelete: Cascade`
- [x] `DocumentChunk` has no `updatedAt` field
- [x] All three new indexes exist (verify generated migration SQL)
- [x] `EmbeddingCache` realigned to `BigInt` id + `publicId` + `tokenCount`, `textHash` unique index preserved
- [x] `pineconeConfig` extended with `namespace` (default `'documents'`)
- [x] `PINECONE_API_KEY`/`PINECONE_INDEX` are `@IsOptional()` in `env.validation.ts` — app boots with neither set
- [x] New `ragConfig` namespace registered with all eight values, `@IsOptional()` with defaults matching spec §4
- [x] All new env vars documented in `.env.example`
- [x] `npx prisma validate`, `npm run prisma:migrate`, `npx tsc --noEmit --project tsconfig.build.json` all pass

# Dependencies

None — can start immediately.

# Testing Notes

No unit tests in this issue — validated via `npx prisma validate`, `npm run prisma:migrate:deploy`, and `npx tsc --noEmit`, matching AI-001/AI-015's precedent. Confirmed no existing code path assumed `pinecone.apiKey`/`pinecone.index` were always present (no Pinecone-consuming service exists yet).

## Implementation Notes

Added `Document`/`DocumentChunk` models to `prisma/schema.prisma` following the `BigInt` PK + `publicId` UUID pattern, with `DocumentChunk.document` using `onDelete: Cascade` and the three requested indexes (`documents(category)`, `documents(embeddingStatus)`, `document_chunks(documentId, chunkIndex)`). Realigned `EmbeddingCache` to `BigInt` id + `publicId` + new `tokenCount Int?` field, keeping `textHash`'s unique constraint intact — safe since the table was confirmed empty (`SELECT COUNT(*) FROM embedding_cache` → 0) and grepped as unread/unwritten by any service.

**Migration workflow deviation**: `prisma migrate dev` refused to run at all in this non-interactive shell ("Prisma Migrate has detected that the environment is non-interactive, which is not supported" — this fires even with `--create-only`, unlike Phase 1/2's apparent interactive sessions). Worked around it with the standard CI-safe pattern: generated the SQL via `prisma migrate diff --from-config-datasource ./prisma.config.ts --to-schema ./prisma/schema.prisma --script` (diffing the live database against the target schema), hand-created the migration folder `20260708123128_add_documents_document_chunks_and_realign_embedding_cache/migration.sql` with that output, then applied it with `prisma migrate deploy` (fully non-interactive). This is worth carrying forward as the standard approach for every remaining schema-touching issue in this phase, since the environment constraint won't change.

`pineconeConfig` extended with `namespace` (default `'documents'`); `apiKey`/`index` changed from `!`-asserted required strings to plain `string | undefined` reads, matching the now-optional env vars. Added a new `ragConfig` namespace (`registerAs('rag', ...)`) with all eight spec §4.4–§4.7 tunables, registered in `AppModule`'s `ConfigModule.forRoot({ load: [...] })` array. Added `RagConfig` type export alongside the other `ConfigType<typeof x>` exports.

`env.validation.ts`: `PINECONE_API_KEY`/`PINECONE_INDEX` moved to `@IsOptional() @IsString()`, added `PINECONE_NAMESPACE` (optional) plus eight new optional RAG env vars (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BATCH_SIZE`, `RAG_TOP_K`, `RAG_SIMILARITY_THRESHOLD`, `RAG_MAX_CONTEXT_TOKENS`, `CHUNK_SIZE`, `CHUNK_OVERLAP`) with `@IsInt()`/`@IsNumber()` + `@Min()`/`@Max()` validators matching `chatConfig`'s precedent. `.env.example` updated with `PINECONE_NAMESPACE` under the existing Pinecone section and a new `# RAG / Embeddings` section with all eight defaults.

## Validation Performed

- `npx prisma validate` — passes
- `npm run prisma:migrate:deploy` — migration `20260708123128_add_documents_document_chunks_and_realign_embedding_cache` applied cleanly; `npm run prisma:migrate:status` confirms schema up to date (6 migrations)
- `npm run prisma:generate` — client regenerated + patched successfully
- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 54 pre-existing warnings (all in files untouched by this issue)
- `npm run build` — succeeds
- `npm run test` — 271/271 pass (21/21 suites), no regressions
- Live boot check: built app started successfully (`node dist/src/main.js`) with `PINECONE_API_KEY`/`PINECONE_INDEX` explicitly unset — confirms the app no longer hard-requires Pinecone config to start

## Assumptions Made

- `prisma migrate dev` being unusable in this environment is an infrastructure constraint, not something to work around by skipping migrations — used the `migrate diff` + hand-placed `migration.sql` + `migrate deploy` pattern instead, which produces an identical committed migration history to what `migrate dev` would have generated.
- No default value was added for `EmbeddingCache.publicId`/`documents`/`document_chunks` columns beyond what Prisma generates, since the table was empty — a production system with existing data would need a backfill step, but that's out of scope here (documented as a non-issue given the table's confirmed-empty, never-used state).

## Follow Ups

- AI-037 onward should reuse the same `migrate diff`/`migrate deploy` workflow for any further schema changes (e.g. AI-049's `QaPair` model) rather than re-attempting `migrate dev`.
