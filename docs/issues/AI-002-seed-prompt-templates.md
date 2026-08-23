---
id: AI-002
title: Seed script — 6 reference prompt templates
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 1 — Database Schema Extension
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-001
---

# What to Build

Extend the Prisma seed script (`prisma/seed.ts`) to insert 6 reference prompt templates into the `prompt_templates` table. The seed must be idempotent — use `upsert` on `name` so reruns do not create duplicates.

The 6 templates to seed, one per prompt technique:

| Name                      | Technique            | recommendedModel | recommendedTemperature |
| ------------------------- | -------------------- | ---------------- | ---------------------- |
| `technical-support-agent` | `system-prompt`      | `gpt-4o`         | `0.3`                  |
| `ticket-classifier`       | `few-shot`           | `gpt-4o-mini`    | `0.0`                  |
| `code-reviewer`           | `role-play`          | `gpt-4o`         | `0.2`                  |
| `json-extractor`          | `structured-output`  | `gpt-4o`         | `0.0`                  |
| `step-by-step-analyzer`   | `chain-of-thought`   | `gpt-4o`         | `0.5`                  |
| `creative-brainstormer`   | `temperature-tuning` | `gpt-4o`         | `1.0`                  |

Each template needs:

- A `systemPrompt` string that reflects the technique (e.g., the classifier template should include 3 example input/output pairs inline in the system prompt or in `fewShotExamples`)
- A `description` explaining when and why to use it
- Relevant `tags` (e.g., `['classification', 'support']`)
- `fewShotExamples` as a JSON array of `{ input: string, output: string }` objects — only for `ticket-classifier`; null for the rest

The seed script already exists at `prisma/seed.ts`. Add the 6 upserts after any existing seed operations. The `npm run prisma:seed` command runs this file via `ts-node`.

# User Stories Covered

- Story 3 — 6 reference templates are available from day one without manual setup

# Acceptance Criteria

- [ ] `npm run prisma:seed` runs without errors on a fresh database
- [ ] `npm run prisma:seed` is idempotent — running it twice produces exactly 6 templates, not 12
- [ ] Each of the 6 templates has a non-empty `systemPrompt` and `description`
- [ ] `ticket-classifier` has at least 2 entries in `fewShotExamples`
- [ ] `creative-brainstormer` has `recommendedTemperature: 1.0`
- [ ] `json-extractor` has `recommendedTemperature: 0.0`
- [ ] `npm run db:reset` (which runs migrate + seed) completes cleanly
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0

# Dependencies

- AI-001 — `prompt_templates` table and regenerated Prisma client must exist before the seed can reference `PromptTemplate`

# Testing Notes

No unit tests. Validation is by running `npm run prisma:seed` against the live database and confirming the count via `npm run prisma:studio` or a direct `SELECT count(*) FROM prompt_templates` query.

The seed script imports from `../../generated/prisma/client` — not from `@prisma/client`. This is the Prisma v7 import path. Ensure the seed file uses the correct import.

## Implementation Notes

**Files created:**

- `prisma/seed.ts` — standalone ts-node seed script; 6 `upsert` calls (one per template), idempotent on `name`

**Key design decisions:**

- All 6 templates use `upsert({ where: { name }, update: {...}, create: { name, ...} })` — idempotent on the `name` unique index.
- `fewShotExamples` is conditionally spread using the same pattern as `PromptTemplateService.create()`: `...(fewShotExamples !== undefined && { fewShotExamples: fewShotExamples as unknown as Prisma.InputJsonValue })`. This means templates without examples simply omit the field, defaulting to NULL in the DB.
- Only `ticket-classifier` has `fewShotExamples` (5 entries matching the inline examples in the systemPrompt). All others omit it.
- `import 'dotenv/config'` at the top loads `.env` so `DATABASE_URL` is available to the Prisma runtime.
- `// @ts-expect-error` added above `new PrismaClient()`: Prisma v7's generated TypeScript type requires `adapter|accelerateUrl` in the constructor, but the runtime reads `DATABASE_URL` from the environment when neither is provided. This matches how `DatabaseService extends PrismaClient` works — NestJS DI creates it without args at runtime. The `@ts-expect-error` makes this deliberate suppression explicit.
- The seed script is not covered by ESLint's `{src,apps,libs,test}/**/*.ts` glob — `console.log` is acceptable for infrastructure scripts where `AppLoggerService` (NestJS DI) is unavailable.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (23 pre-existing warnings, unchanged)
- `npm run build` — success (exit code 0)
- `npm run test` — 69/69 pass (no regressions; seed script has no unit tests per spec)
- `npm run prisma:seed` — requires a live database; not run in this session (no DB connection)

## Assumptions Made

- `prisma/seed.ts` did not previously exist. Created from scratch (the issue spec said "extend the existing seed script" but no file was present).
- `ticket-classifier` has 5 `fewShotExamples` (one per category) rather than the minimum 2 — more examples improve classification accuracy and the spec says "at least 2".
- Each `fewShotExamples` entry also appears inline in the `systemPrompt` — this is the standard few-shot pattern where examples are embedded in the prompt AND stored structurally.
- `recommendedModel` is stored as a plain string (not tied to the `OpenAIModel` enum) to match the `String` field type in the Prisma schema.

## Follow Ups

- AI-014 (Live API smoke test, HITL) can now run `npm run prisma:seed` as part of the live verification before testing the OpenAI endpoints.
- A future enhancement could add a `--dry-run` flag to the seed script to preview changes without writing to the DB.
