---
id: AI-001
title: Prisma schema extension — ai_audit_logs, prompt_templates, and env config
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-25
completed_at: 2026-06-25
created: 2026-06-25
parent_epic: Epic 1 — Database Schema Extension
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by: []
---

# What to Build

Extend the Prisma schema with two new models, extend the OpenAI config factory with the five missing retry/timeout variables, and run a migration.

**Schema additions:**

Add `AiAuditLog` model mapped to `ai_audit_logs`. The table is append-only — no `updatedAt`, no `deletedAt`. Use `BigInt @id @default(autoincrement())` for the internal PK and a separate `publicId String @unique @default(uuid())` for the external identifier. Include all 20 fields listed in the requirement spec Section 3.1: `requestId`, `userId`, `model`, `endpoint`, `systemPrompt`, `userMessage`, `assistantResponse`, `inputTokens`, `outputTokens`, `totalTokens`, `estimatedCost`, `latencyMs`, `temperature`, `maxTokens`, `status`, `errorCode`, `errorMessage`, `retryCount`, `metadata`, `createdAt`. The `metadata` field is `Json? @db.JsonB`. Add the four indexes from spec Section 3.3: by `(userId, createdAt DESC)`, by `(model, createdAt DESC)`, a partial index on non-SUCCESS status, and the unique index on `name` for `prompt_templates`.

Add `PromptTemplate` model mapped to `prompt_templates`. Also uses `BigInt @id @default(autoincrement())` + `publicId String @unique @default(uuid())`. Fields: `name String @unique`, `description String?`, `systemPrompt String`, `fewShotExamples Json? @db.JsonB`, `technique String`, `recommendedModel String @default("gpt-4o")`, `recommendedTemperature Float @default(0.7)`, `tags String[]`, `isActive Boolean @default(true)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.

**Config extension:**

The existing `openaiConfig` factory in `app.config.ts` already has `apiKey`, `orgId`, and `defaultModel`. Extend it with five more fields read from environment:

- `maxRetries` → `OPENAI_MAX_RETRIES` (default: 5)
- `retryBaseDelayMs` → `OPENAI_RETRY_BASE_DELAY_MS` (default: 1000)
- `circuitFailureThreshold` → `OPENAI_CIRCUIT_FAILURE_THRESHOLD` (default: 5)
- `circuitCooldownMs` → `OPENAI_CIRCUIT_COOLDOWN_MS` (default: 60000)
- `timeoutMs` → `OPENAI_TIMEOUT_MS` (default: 30000)

Use `parseInt(..., 10)` with a default fallback for each numeric field (the same pattern already used in `throttleConfig`).

Update `env.validation.ts` to declare all five new env vars as `@IsOptional() @IsInt() @Min(1)` (they all have defaults, so they are not required). Also add `OPENAI_ORG_ID` and `OPENAI_DEFAULT_MODEL` as `@IsOptional() @IsString()` if they are not already declared.

After schema edits, run `npm run prisma:migrate` to create and apply the migration. Then run `npm run prisma:generate` to regenerate the Prisma client.

# User Stories Covered

- Story 1 — ai_audit_logs table exists in the database
- Story 2 — prompt_templates table exists in the database
- Story 4 — Prisma client regenerated automatically on `npm run build`

# Acceptance Criteria

- [x] `AiAuditLog` and `PromptTemplate` models appear in `schema.prisma` with all fields from spec Section 3.1 and 3.2
- [x] Both models use `BigInt @id @default(autoincrement())` + `publicId String @unique @default(uuid())`
- [x] `AiAuditLog` has no `updatedAt` — append-only
- [x] `PromptTemplate` has `updatedAt DateTime @updatedAt`
- [x] `metadata` is `Json? @db.JsonB` on `AiAuditLog`; `fewShotExamples` is `Json? @db.JsonB` on `PromptTemplate`
- [x] All four indexes from spec Section 3.3 are defined
- [x] `openaiConfig` factory returns all 8 fields (existing 3 + 5 new) with correct defaults
- [x] `env.validation.ts` declares the 5 new vars as optional integers
- [x] `npm run prisma:migrate` runs without errors
- [x] `npm run prisma:generate` completes without errors
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0 after the migration

# Dependencies

None — can start immediately.

# Testing Notes

No unit tests in this issue. Validation is via:

1. `npx prisma validate` — confirms the schema is syntactically correct
2. `npm run prisma:migrate` — confirms the migration applies against the running database
3. `npx tsc --noEmit --project tsconfig.build.json` — confirms the generated Prisma client compiles cleanly

The partial index on non-SUCCESS status (`WHERE status != 'SUCCESS'`) must be expressed as a raw `@@index` with a `map` argument or via `prisma migrate` SQL — check Prisma v7 docs for partial index support; if not supported in the schema DSL, add it directly in the migration SQL file.

## Implementation Notes

**Files modified:**

- `prisma/schema.prisma` — added `AiAuditLog` (21 fields, 3 indexes) and `PromptTemplate` (13 fields) models
- `src/config/app.config.ts` — extended `openaiConfig` with 5 retry/timeout fields using `parseInt` + default fallback pattern
- `src/config/env.validation.ts` — added `OPENAI_DEFAULT_MODEL` (optional string) and 5 optional integer vars

**Files created:**

- `prisma/migrations/20260625055249_add_ai_audit_logs_and_prompt_templates/migration.sql` — tables + standard indexes
- `prisma/migrations/20260625055424_fix_status_partial_index/migration.sql` — drops regular status index, creates `WHERE status != 'SUCCESS'` partial index

**Design decision:** Prisma's `@@index` DSL does not support partial index `WHERE` clauses. The regular index was created in the first migration; a second migration manually wrote the `DROP INDEX` + `CREATE INDEX ... WHERE` SQL. The schema DSL `@@index([status])` remains as a no-op marker for documentation — the actual partial index is maintained via raw SQL in the second migration.

## Validation Performed

- `npx prisma validate` — schema valid
- `npm run prisma:migrate` — 2 migrations applied without errors
- `npm run prisma:generate` — Prisma Client 7.8.0 generated to `./generated/prisma`
- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (11 pre-existing warnings in throttler guard and e2e test)
- `npm run test` — 1/1 tests pass

## Assumptions Made

None — the spec was complete and unambiguous for all schema fields, index requirements, and config defaults.

## Follow Ups

- The `@@index([status])` entry in the schema will generate a redundant `CREATE INDEX` in any future migrations if the schema drifts. A future cleanup could remove it from the DSL and rely solely on the manually maintained partial index.
