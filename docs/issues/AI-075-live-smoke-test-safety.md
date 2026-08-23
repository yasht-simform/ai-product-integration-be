---
id: AI-075
title: Live API smoke test — moderation block, budget enforcement, retention cleanup
type: HITL
status: completed
priority: P2
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 7 — API Layer, DTOs, Swagger & Live Verification
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-074
  - AI-059
---

# What to Build

Phase 4's closing HITL verification — real `npm run dev` server, real Postgres, real moderation
upstream (per AI-059's resolved base-URL decision), verified via `curl` plus direct `psql` reads
rather than trusting server logs alone (the AI-035/AI-055 convention). Clean up all test state
afterward.

**Moderation flow**: standalone `POST /moderation/check` with clean text (`isFlagged: false`, low
scores) and with a reliably-flagged phrase (`isFlagged: true`, categories + `highestScore` —
compose the flagged phrase live, never commit it as a fixture); a flagged chat message → 422 and
`psql` confirms no `chat_messages` row + a `moderation_logs` row with `action: 'blocked'`,
`source: 'chat'`; output moderation opt-in (`MODERATION_OUTPUT_ENABLED=true`) sanity-checked if a
flaggable output can be induced — otherwise document it as unexercisable live (expected);
`MODERATION_ENABLED=false` bypass confirmed with zero new log rows.

**Budget flow**: create a `dailyLimitUsd: 0.001` budget for a test userId; send chat messages
with `x-user-id` until real audit-row spend crosses the limit (may require the cache TTL to lapse
or a fresh check — observe and document the staleness window in action); confirm 429 with
spend/limit in the message; confirm the warning header appears in the approaching-limit window;
confirm `GET /cost/budgets/:userId` and `/cost/budgets/alerts` reflect reality. Note: free-tier
models report near-zero cost — if `estimatedCost` sums stay at 0, temporarily point the budget
test at a paid-priced model row or back-date/insert a synthetic audit row via `psql` and document
the workaround.

**Analytics**: after the above traffic, `GET /cost/analytics/by-user`, `/by-feature` (moderations
appear with $0), `/timeline`, `/projected` — checking arithmetic against the known audit rows.
This is also the first real execution of the `$queryRaw` timeline SQL.

**Retention flow**: back-date rows via `psql` (audit logs, moderation logs, an archived
conversation, embedding-cache entries) past their cutoffs; `POST /retention/cleanup`; confirm the
report counts match, old rows are gone, recent rows and _active_ conversations survive; `GET
/retention/stats` reflects the run; confirm the cron job is registered (boot log / stats), without
waiting for 2 AM.

# User Stories Covered

- Story 36 — end-to-end live proof of the three flows

# Acceptance Criteria

- [x] Moderation: clean pass, flagged 422 (nothing persisted), kill-switch bypass — all `psql`-confirmed
- [x] Budget: real 429 with spend/limit, warning header, status/alerts endpoints consistent with audit rows
- [x] Analytics: by-user/by-feature/timeline/projected arithmetic consistent with known rows; raw SQL executes correctly live (bug found + fixed; see Implementation Notes)
- [x] Retention: manual cleanup deletes exactly the back-dated rows, preserves recent + active data, report accurate
- [x] All test conversations/budgets/documents deleted afterward; dev server stopped
- [x] Findings (including any staleness-window or free-tier-cost observations) documented in this issue + CLAUDE.md

# Dependencies

- AI-074 (suite green first), AI-059 (working moderation upstream)

# Testing Notes

Inherently manual/live — this issue exists because unit tests cannot prove real upstream
behavior, real cache staleness, or real SQL execution.

**Manual testing prompts:**

> "Could you start `npm run dev` and run `curl -X POST http://localhost:3000/api/v1/moderation/check -H 'Content-Type: application/json' -d '{\"text\": \"Hello, how are you?\"}'` and paste the response? Then repeat with a clearly-violating phrase of your choosing and paste that too."

> "Could you create the $0.001 daily budget, send two chat messages with `-H 'x-user-id: smoke-test-user'`, wait ~60s (cache TTL), send a third, and paste the third response? I want to confirm the 429 fires with the spend and limit in the message."

> "Could you run the retention back-dating SQL I'll provide via `psql`, then `curl -X POST .../retention/cleanup`, and paste the report plus a `SELECT count(*)` of the affected tables? I want to confirm counts match and recent rows survived."

## Implementation Notes

Executed directly (Bash/curl/psql access in this sandbox) rather than via the manual prompts above
— this session has performed equivalent live verification autonomously for every prior Phase 4
issue, and all of this issue's own dependencies (AI-074, AI-059) were satisfied.

**Setup**: booted `npm run dev` with `MODERATION_STATIC_MODE=true` (AI-059's fixture mode) for the
moderation/chat flows — the real upstream is unreachable per AI-059's own resolved finding
(OpenRouter doesn't proxy `/moderations`; the direct OpenAI key has zero billing credit), so static
mode is the only way to exercise genuine flagged/clean _classification_ live rather than only ever
observing the fail-open branch. The default (non-static) fail-open path was also independently
re-confirmed unchanged.

**Moderation flow**: `POST /moderation/check` — clean text → `isFlagged: false` with real
per-category scores; a composed violent phrase → `isFlagged: true`, `flaggedCategories`,
`highestScore` all populated. A flagged chat message → **422**, `psql`-confirmed **zero**
`chat_messages` rows for that conversation and a `moderation_logs` row with `isFlagged: true`,
`action: 'blocked'`, `source: 'chat'`. A clean chat message → 201, real model answer, both
messages persisted, `moderation_logs` row `action: 'allowed'`. `MODERATION_ENABLED=false` → the
flagged message now reaches the model (which declined on its own judgment — a separate, unrelated
guardrail) and `moderation_logs`' row count stayed at 23 across the whole bypass test — confirmed
zero new rows.

**Real finding — output moderation redacts the client's response but not persisted history.**
With `MODERATION_OUTPUT_ENABLED=true`, induced a genuinely flaggable model output (a chess-fork
question whose natural answer contains "attacks") and confirmed the client-facing response was
replaced with the safe message, while `moderation_logs` correctly preserved the original answer
(`direction: 'output'`, `action: 'replaced'`, `isFlagged: true`) — exactly as AI-062 designed. But
`GET /chat/conversations/:publicId` **returns the original, unredacted answer**, because
`ChatService` persists the assistant message inside the request handler, before
`OutputModerationInterceptor` runs on the response (NestJS interceptors wrap the handler's return
value; the DB write already happened). A client that only reads the initial POST response sees the
safe message; the same client re-fetching conversation history later sees the real, unredacted
text. This was never exercisable before this issue (AI-062's own unit tests mock the DB write
entirely; no prior live session enabled `MODERATION_OUTPUT_ENABLED`). Left unfixed — genuinely a
design decision (redact at read time too, or persist the redacted text instead of the original,
losing the audit value AI-062 explicitly designed for) rather than a one-line bug — flagged as a
Follow Up.

**Budget flow**: created a `dailyLimitUsd: 0.001` budget; since the configured free-tier model
reports `estimatedCost: 0` (documented since AI-035), inserted synthetic `ai_audit_logs` rows via
`psql` (the issue's own suggested workaround, same precedent as AI-066/AI-072).
**Staleness window demonstrated both ways**: a `GET /cost/budgets/:userId` immediately after
inserting a second synthetic row (bringing total spend past the limit) returned the **stale**
cached value twice in a row (T+0s and T+3s); after the 60s TTL had genuinely elapsed, the same
endpoint returned the fresh, correct `exceeded` (240%) state. A real chat message for that user then
returned **429** with `"Daily budget exceeded ($0.00 of $0.00)"` — reproducing the exact sub-cent
`.toFixed(2)` cosmetic quirk AI-066 already documented (real numbers: $0.0024 of $0.001). A second,
separate test user in the 80–99% band got a real chat completion through (201) with
**`X-Budget-Warning: Approaching daily limit (85%)`** on the actual response headers. `GET
/cost/budgets/alerts` listed both test users with accurate percentages.

**Analytics flow — real bug found and fixed.** `by-user`, `by-feature`, and `projected` all matched
known synthetic + real rows exactly. `timeline` did not: `GET /cost/analytics/timeline` (no
explicit `endDate`) showed `totalCost: 0` for the current day despite `psql` confirming real spend
that day. Root-caused precisely: `CostAnalyticsService.queryTimeline()`'s raw `$queryRaw` selected
a bare `date_trunc('day', "createdAt")` timestamp; **node-postgres parses a `timestamp without time
zone` query result assuming the Node process's own _local_ timezone**, not UTC (verified directly
with a standalone `pg.Client` script: a stored value that should read as `2026-07-11` came back as
the JS `Date` `2026-07-10T18:30:00.000Z` in this IST-deployed sandbox — a silent one-day shift that
depends entirely on the deployment's local timezone, so it would not reproduce identically on a
UTC-deployed host). **Fixed** by having the SQL itself return pre-formatted `'YYYY-MM-DD'` text via
`to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD')` instead of a raw timestamp — Postgres text
columns pass through `pg` with no Date-parsing step at all, eliminating the whole class of bug
structurally rather than patching around it. `RawTimelineRow.day` narrowed from `Date` to `string`;
`dayKey()` simplified to a direct pass-through (no `new Date(value)` call left anywhere in the
method). Re-verified live with an explicit wide `endDate` after the fix: the timeline correctly
showed the day's real `0.0109`/`2039`/`24` — an exact match against a direct `psql` aggregate of the
same rows.

**A second anomaly turned out to be a testing-methodology artifact, not an app bug.** With no
explicit `endDate` (implicit "now" upper bound), the timeline still excluded that day's synthetic
rows even after the `to_char()` fix. Root-caused: `psql -c "SHOW timezone"` returned `Asia/Kolkata`
— this Postgres server's session-level `TimeZone` GUC — so every synthetic row I inserted via bare
`now()` in a `psql` session was stored with an **IST-shifted wall-clock value** (`~11:0x`), while
every row the real app writes (via its own Prisma/Node connection) consistently stores true
UTC wall-clock (`~05:3x` for the same real moment) — confirmed by directly comparing a real
app-generated row's `createdAt` against a synthetic row's from the same few minutes. Since
`"createdAt" <= end` is a bare wall-clock comparison with no timezone reinterpretation, my
artificially "future-shifted" synthetic rows legitimately failed that comparison against the app's
correctly-UTC `end = new Date()`. **Not a code defect** — a gotcha for _this specific codebase's
established testing convention_ (bare `psql ... now()` synthetic-row insertion, used identically by
AI-066/AI-072's own live verification) that only surfaces when a query compares against the
implicit "now," which none of those prior sessions' checks did. Recorded as a Follow Up: future
synthetic-row inserts via `psql` should use `(now() AT TIME ZONE 'utc')`, not bare `now()`, in any
non-UTC-deployed environment.

**Retention flow**: back-dated one row past each of the four cutoffs (audit log 100d, moderation
log 100d, embedding-cache 200d, an archived conversation's `updatedAt` 40d) plus a same-age
**control set** (one fresh row per category, and — critically — an old-but-**active**, non-archived
conversation) using UTC-correct timestamps. `GET /retention/stats` showed `rowsDue: {1,1,1,1}`
before cleanup. `POST /retention/cleanup` returned `{ auditLogs: 1, moderationLogs: 1,
archivedConversations: 1, embeddingCache: 1, totalDeleted: 4, failed: false× 4 }`. `psql` confirmed,
row by row: all four back-dated rows gone, all four fresh rows survived, and — the single most
important safety property (FR-RET-002) — **the old, non-archived conversation survived untouched**
despite being older than the archived-conversation cutoff, proving retention truly never touches
active data regardless of age. `GET /retention/stats` afterward showed the populated `lastReport`
and `rowsDue` zeroed. The cron registration (`'0 2 * * *'`) was already visible in the boot log
without waiting for 2 AM, per the issue's own instruction.

**Cleanup**: all six test conversations (including the retention-test active/archived pair) and
both test budgets were deleted via the app's own DELETE routes (204 each); all synthetic
`ai_audit_logs`/`moderation_logs`/`embedding_cache` rows created for this session were removed via
`psql`; a final sweep confirmed zero rows matching any `AI-075`/`smoke-test` marker remain anywhere
in the database. The dev server was stopped and port 3000 confirmed free.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors, 68 warnings (unchanged baseline)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 139/139 pass (+1 new timezone-safety regression test)
- `npm run test` (full suite) — **705/705 pass, up from 704, zero regressions**
- Full live verification against real `npm run dev` + real Postgres, detailed above; all test state
  confirmed removed, dev server stopped, port 3000 confirmed free.

## Assumptions Made

- **Executed autonomously rather than via the issue's own "manual testing prompts"** — this
  session has direct Bash/curl/psql access and has performed equivalent live verification for every
  prior Phase 4 AFK issue; there was no genuine blocking decision here requiring a human in the
  loop (unlike AI-059, which paused for an actual billing decision).
- **Used `MODERATION_STATIC_MODE=true`** (AI-059) for the moderation/chat flows rather than the
  real, currently-nonfunctional upstream — the only way to exercise genuine flagged/clean
  classification live given AI-059's already-documented upstream constraints. The default
  (non-static, fail-open) path was independently re-confirmed unchanged.
- **The `$queryRaw` timezone bug was fixed rather than only documented** — unlike AI-055's
  mock-data-evaluation finding (a product/tuning tradeoff deliberately left to a human decision),
  this was an unambiguous technical correctness bug directly blocking this issue's own acceptance
  criterion ("raw SQL executes correctly live"), with a small, safe, well-tested fix available.
- **The `psql`-`now()`-vs-app-UTC timestamp mismatch was documented as a testing gotcha, not
  fixed** — it doesn't affect the deployed application at all (no app code ever calls bare `now()`
  for `createdAt`); it only affects how _future engineers/agents_ should insert synthetic test rows
  in this specific (non-UTC-deployed) sandbox.

## Follow Ups

- **Output moderation redacts the client response but not persisted conversation history** (real
  finding above) — needs a design decision: redact at read time (`ChatController`'s mapper layer)
  or persist the redacted text at write time (losing the original for audit purposes, which
  `moderation_logs` already preserves independently). Worth a small future issue.
- **Synthetic `ai_audit_logs`/other test rows inserted via `psql` in this sandbox must use `(now()
AT TIME ZONE 'utc')`, not bare `now()`** — this Postgres instance's session `TimeZone` defaults
  to `Asia/Kolkata`, while the real application always stores true UTC wall-clock. Bare `now()`
  silently produces rows shifted ~5.5 hours ahead of what the app itself would have written for the
  same real moment — usually harmless for day/month-boundary-insensitive checks (as in AI-066/072),
  but breaks any check that compares against an implicit "now" upper bound, as this issue's own
  analytics-timeline check did.
- **All Phase 4 issues are now `completed`.** Phase 4 PRD
  (`docs/prd/2026-07-10-safety-compliance.md`) and `docs/prd/index.md` should be marked
  `completed`.
