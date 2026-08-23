---
id: AI-056
title: Prisma schema — moderation_logs + user_cost_budgets
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 1 — Schema & Configuration Foundation
parent_prd: 2026-07-10-safety-compliance.md
blocked_by: []
---

# What to Build

Add the two Phase 4 tables to `schema.prisma` per spec §3, following the codebase's established
`BigInt @id @default(autoincrement())` PK + `publicId String @unique @default(uuid())` convention
(same as `AiAuditLog`/`ChatConversation`/`Document`):

- **`ModerationLog`** (`@@map("moderation_logs")`) — `requestId?`, `userId?`, `direction`
  (string: `'input'`/`'output'`), `content` (truncated to 1000 chars by the _service_, not a DB
  constraint), `isFlagged Boolean`, `categories Json @db.JsonB`, `categoryScores Json @db.JsonB`,
  `action` (string: `'allowed'`/`'blocked'`/`'replaced'`), `source`, `metadata Json? @db.JsonB`,
  `createdAt`. Append-only — no `updatedAt`, matching `AiAuditLog`/`ChatMessage`.
- **`UserCostBudget`** (`@@map("user_cost_budgets")`) — `userId String @unique`,
  `dailyLimitUsd Float?`, `monthlyLimitUsd Float?`, `isActive Boolean @default(true)`,
  `alertThreshold Float @default(0.8)`, `metadata Json? @db.JsonB`, `createdAt`, `updatedAt`.

Indexes per spec §3.3: `moderation_logs(userId, createdAt DESC)`, the partial index on
`is_flagged WHERE is_flagged = true`, and the unique index on `user_cost_budgets(user_id)`
(implied by `@unique`). **The partial index cannot be expressed in Prisma's schema DSL** — declare
a plain `@@index([isFlagged])` in the schema OR omit it there entirely, and add the real partial
index as hand-written SQL in the migration file (document the divergence with a schema comment).

Use this phase's established non-interactive migration workaround (AI-036): `npx prisma migrate
diff --from-config-datasource ./prisma.config.ts --to-schema ./prisma/schema.prisma --script` →
hand-create `prisma/migrations/<timestamp>_<name>/migration.sql` (appending the partial-index SQL)
→ `npm run prisma:migrate:deploy`. Regenerate the client with `npm run prisma:generate` (never
`prisma generate` directly — the patch script must run).

# User Stories Covered

- Story 9 — complete moderation audit trail has a table to live in
- Story 16/17 — per-user budget rows, unique per userId

# Acceptance Criteria

- [ ] Both models added with BigInt PK + publicId convention and correct `@@map` names
- [ ] `npm run prisma:validate` passes; migration applies cleanly via `prisma:migrate:deploy`
- [ ] Partial index on flagged rows present in the migration SQL (verified via `psql \d moderation_logs` or the migration file content)
- [ ] `userId` unique constraint on `user_cost_budgets` verified (second insert with same userId fails)
- [ ] `npm run prisma:generate` regenerates the client without breaking the build (`npm run build` passes)
- [ ] Full existing test suite still green (`npm run test`)

# Dependencies

None — can start immediately.

# Testing Notes

Schema-only slice — no service code, so no new unit tests. Validation is `prisma:validate`, a
clean `migrate:deploy` against the dev database, and the existing suite passing (proves the
regenerated client didn't drift). Verify the unique constraint and partial index by inspecting
the applied migration SQL rather than writing throwaway app code.

## Implementation Notes

Added two models to `prisma/schema.prisma`, both following the codebase's `BigInt @id
@default(autoincrement())` + `publicId String @unique @default(uuid())` convention:

- **`ModerationLog`** (`@@map("moderation_logs")`) — spec §3.1 fields verbatim. Append-only (no
  `updatedAt`, matching `AiAuditLog`/`ChatMessage`). `categories`/`categoryScores` are non-nullable
  `Json @db.JsonB`; `metadata` is nullable JSONB. Two schema indexes: `@@index([userId,
createdAt(sort: Desc)])` and `@@index([isFlagged])`.
- **`UserCostBudget`** (`@@map("user_cost_budgets")`) — spec §3.2 fields verbatim, including
  `userId String @unique`, `isActive` default `true`, and `alertThreshold` default `0.8`. Has
  `updatedAt` (mutable, unlike the append-only log tables).

**Partial index handling** followed the existing `20260625055424_fix_status_partial_index`
precedent exactly: Prisma's schema DSL can't express partial indexes, so `@@index([isFlagged])` is
declared plain in the schema (with an inline comment documenting the divergence), and the migration
SQL was hand-edited to make it partial — `CREATE INDEX "moderation_logs_isFlagged_idx" ON
"moderation_logs"("isFlagged") WHERE "isFlagged" = true`. The other three indexes
(`userId+createdAt DESC`, both `publicId` uniques, `userId` unique) come straight from the
`migrate diff` output unchanged.

**Migration** (`20260710000000_add_moderation_logs_and_user_cost_budgets`) was produced via this
phase's non-interactive workaround (`prisma migrate diff --from-config-datasource ... --to-schema
... --script` → hand-edit the partial index into the SQL → `prisma:migrate:deploy`), since
`prisma migrate dev` refuses to run non-interactively here. Client regenerated via
`npm run prisma:generate` so the `import.meta.url` → `__dirname` patch re-applied.

**DB verification** (via `psql` against `ai_product_integration_dev`): `moderation_logs_isFlagged_idx`
confirmed as a partial index (`WHERE ("isFlagged" = true)`); `user_cost_budgets_userId_key`
confirmed as a UNIQUE btree index; the `userId, createdAt DESC` composite index confirmed present.

## Validation Performed

- `npm run prisma:validate` — schema valid
- `npm run prisma:migrate:deploy` — migration applied cleanly (8 migrations total)
- `psql` index inspection — partial index + userId unique constraint confirmed in the live DB
- `npx tsc --noEmit --project tsconfig.build.json` — pass
- `npm run lint:check` — 0 errors (59 pre-existing `no-unsafe-*` warnings, unchanged)
- `npm run build` — pass (client regenerated + patched)
- `npm run test` — 475/475 pass, 33/33 suites (zero regressions; no test files touched)

## Assumptions Made

- Named the migration `20260710000000_add_moderation_logs_and_user_cost_budgets`, following the
  phase-3 timestamp-prefix convention and today's date.
- Kept `@@index([isFlagged])` declared in the schema (rather than omitting it) so `migrate diff`
  generates the index name Prisma expects, then made it partial in SQL — this keeps a future
  `migrate diff` from spuriously wanting to recreate the index, exactly as the status partial index
  precedent does.

## Follow Ups

- None. AI-057 (config namespaces + module scaffolds) is unblocked and can now inject
  `DatabaseService` typed against the regenerated client for the two new tables.
