---
id: AI-014
title: Live API smoke test — end-to-end verification with real OpenAI API key
type: HITL
status: in-review
priority: P2
assigned_to: Claude
started_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 6 — REST Controller, Swagger, and Validation
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-013
---

# What to Build

This is a human-in-the-loop verification issue. The agent starts the server and prepares curl commands, but a human must run them against a live `OPENAI_API_KEY` and verify the outputs match the expected responses from the requirement spec test scenarios.

The agent should:

1. Confirm the server starts without errors (`npm run dev`)
2. Confirm Swagger UI is accessible at `http://localhost:3000/api/docs`
3. Prepare and document the test commands for each scenario
4. Confirm that the token count endpoint (SC-AI-003) works without a real API key

The human should run the live API scenarios (SC-AI-001, SC-AI-002, SC-AI-008, SC-AI-010, SC-AI-011, SC-AI-013) and paste the results.

# User Stories Covered

- Story 15 — SC-AI-001: successful chat completion with real model response
- Story 28 — SC-AI-002: model comparison returns side-by-side results
- Story 16 — SC-AI-008: audit log captures every API call
- Story 22–26 — SC-AI-010: template CRUD end-to-end
- Story 27 — SC-AI-011: prompt-test with `templateName` loads from database
- Story 21 — SC-AI-013: cost summary aggregates correctly

# Acceptance Criteria

- [ ] `npm run dev` starts without any DI errors or TypeScript runtime errors
- [ ] `http://localhost:3000/api/docs` renders Swagger UI with `openai` tag showing all endpoints
- [ ] SC-AI-003 (token count): `POST /api/v1/openai/token-count` with `{ "text": "Hello world" }` returns `tokenCount: 2` without an API key
- [ ] SC-AI-001: `POST /api/v1/openai/chat` with a simple prompt returns a non-empty `content`, `usage.totalTokens > 0`, `estimatedCost > 0`, `latencyMs > 0` (requires real API key)
- [ ] SC-AI-002: `POST /api/v1/openai/compare` with `models: ["gpt-4", "gpt-4o"]` returns 2 results with `comparison.cheapest: "gpt-4o"` (requires real API key)
- [ ] SC-AI-008: after 2 successful requests, `GET /api/v1/openai/audit-logs` returns 2 rows with `status: "SUCCESS"` (requires real API key)
- [ ] SC-AI-010: full template CRUD cycle completes with 201/200/200/200/204/200 status codes
- [ ] SC-AI-012: empty prompt returns 400 with a validation error message (no API key needed)

# Dependencies

- AI-013 — all unit tests must pass and TypeScript/lint must be clean before live testing

# Testing Notes

This issue requires a real `OPENAI_API_KEY` in the `.env` file for the live scenarios. The token-count and CRUD scenarios do not require a live API key and can be verified by the agent.

**Manual testing prompts:**

For the agent (no API key required):

> Start the server with `npm run dev`. Confirm it boots without errors. Then run:
> `curl -X POST http://localhost:3000/api/v1/openai/token-count -H 'Content-Type: application/json' -d '{"text": "Hello world", "model": "gpt-4o"}' | jq .`
> Confirm `data.tokenCount` is `2`.

> Also run the validation check:
> `curl -X POST http://localhost:3000/api/v1/openai/chat -H 'Content-Type: application/json' -d '{"prompt": "", "temperature": 5}' | jq .`
> Confirm the response has `statusCode: 400` with field-level validation errors.

**For the human (API key required):**

> "With `OPENAI_API_KEY` set in `.env`, could you run these commands and paste the full JSON responses?
>
> 1. `curl -X POST http://localhost:3000/api/v1/openai/chat -H 'Content-Type: application/json' -d '{"prompt": "What is 2+2? Answer in one word."}' | jq .`
> 2. `curl -X POST http://localhost:3000/api/v1/openai/compare -H 'Content-Type: application/json' -d '{"prompt": "Explain REST APIs in one sentence.", "models": ["gpt-4o", "gpt-4o-mini"]}' | jq .data.comparison`
> 3. After step 1 and 2, run: `curl 'http://localhost:3000/api/v1/openai/audit-logs/cost-summary' | jq .data`
>
> I want to confirm: (a) the chat response has non-zero tokens and cost, (b) the comparison shows gpt-4o-mini as cheapest, and (c) the cost summary shows callCount ≥ 2 and non-zero totalCost."

## Implementation Notes

**Two runtime bugs discovered and fixed before the server could start:**

### Bug 1: Prisma v7 + Node.js 20.19+ ESM/CJS conflict

`generated/prisma/client.ts` contained `import.meta.url` (ESM-only syntax). Node.js 20.19+ introduced unflagged `require(esm)` support — any `.js` file containing `import.meta` syntax is detected as ESM and loaded via the ESM module loader. The compiled `dist/generated/prisma/client.js` therefore ran in ESM context, where `exports` is not defined → `ReferenceError: exports is not defined`.

**Fix:** Replaced lines 15–16 in `generated/prisma/client.ts`:

- Removed: `import { fileURLToPath } from 'node:url'` and `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))`
- Added: `globalThis['__dirname'] = __dirname` (CJS-native equivalent)

Added `scripts/patch-prisma-client.cjs` to re-apply this patch after every `prisma generate`. Updated `prisma:generate` script: `prisma generate && node scripts/patch-prisma-client.cjs`.

### Bug 2: Prisma v7 requires explicit database adapter

Prisma v7's runtime no longer reads `DATABASE_URL` automatically from the environment when `new PrismaClient()` is called without arguments. The old behavior (auto-read env) was removed; an explicit adapter must be passed.

**Fix:** Installed `@prisma/adapter-pg` and updated `DatabaseService`:

- Added `import { PrismaPg } from '@prisma/adapter-pg'`
- Added constructor calling `super({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }) })`

`process.env['DATABASE_URL']` is safe here: `ConfigModule.forRoot()` loads dotenv before `DatabaseModule` initializes, and `env.validation.ts` has already validated DATABASE_URL is non-empty.

**Files created/modified:**

- `generated/prisma/client.ts` — patched (removed `import.meta.url`)
- `scripts/patch-prisma-client.cjs` — post-generate patch script
- `package.json` — `prisma:generate` runs patch; `@prisma/adapter-pg` added to dependencies
- `src/database/database.service.ts` — added `PrismaPg` adapter constructor

## Agent-Verified Scenarios

All agent-automatable acceptance criteria confirmed against the live server:

- [x] `npm run dev` — boots cleanly, 0 errors, all 13 OpenAI routes mapped, Swagger at `http://localhost:3000/api/docs`
- [x] SC-AI-003: `tokenCount: 2` for "Hello world" — ✓
- [x] SC-AI-012: empty prompt + temperature:5 → 400 with 3 field-level validation errors — ✓
- [x] SC-AI-010: full template CRUD cycle — POST 201, GET 200, PATCH 200 (tags updated), DELETE 204, GET 404 — ✓
- [x] `GET /api/v1/openai/health` → `{ circuitState: "CLOSED", status: "ok" }` — ✓
- [x] `GET /api/v1/openai/models/pricing` → correct pricing table for gpt-4 / gpt-4o / gpt-4o-mini — ✓

## Pending Human Verification (requires OPENAI_API_KEY in .env)

Set a real `OPENAI_API_KEY` in `.env`, run `npm run dev`, then execute:

```bash
# SC-AI-001: chat completion
curl -X POST http://localhost:3000/api/v1/openai/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "What is 2+2? Answer in one word."}' | jq .

# SC-AI-002: model comparison
curl -X POST http://localhost:3000/api/v1/openai/compare \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Explain REST APIs in one sentence.", "models": ["gpt-4o", "gpt-4o-mini"]}' | jq .data

# SC-AI-008 + SC-AI-013: audit logs after above 2 calls
curl 'http://localhost:3000/api/v1/openai/audit-logs' | jq '.data | length'
curl 'http://localhost:3000/api/v1/openai/audit-logs/cost-summary' | jq .data

# SC-AI-011: prompt-test with a seeded template
curl -X POST http://localhost:3000/api/v1/openai/prompt-test \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Fix this SQL: SELECT * form users", "templateName": "code-reviewer"}' | jq .
```

Confirm: (a) SC-AI-001 has non-empty `content`, `usage.totalTokens > 0`, `estimatedCost > 0`; (b) SC-AI-002 `comparison.cheapest` is `gpt-4o-mini`; (c) SC-AI-008 audit-logs returns ≥2 rows with `status: "SUCCESS"`; (d) SC-AI-013 cost-summary has `callCount ≥ 2` and `totalCost > 0`.
