---
title: Safety & Compliance — Moderation, Cost Budgets & Data Retention
status: completed
created: 2026-07-10
last_updated: 2026-07-11
phase: 4
tags:
  - moderation
  - cost-budgets
  - cost-analytics
  - data-retention
  - governance
authors:
  - Yash Trivedi
---

# Safety & Compliance — Moderation, Cost Budgets & Data Retention

## Problem Statement

Phases 1–3 built a complete AI feature surface — completions, multi-turn chat with streaming and
function calling, and document-grounded RAG — but nothing stands between a user and those features.
Any input, however harmful, reaches the model verbatim; any model output, however inappropriate,
reaches the client verbatim; any user can spend an unbounded amount of money through the audited
(but never _enforced_) cost pipeline; and every log row ever written (`ai_audit_logs`,
`chat_messages`, `embedding_cache`) accumulates forever. The system observes everything and governs
nothing.

From the **developer's learning perspective**, this phase teaches:

- How OpenAI's moderation endpoint works — category taxonomy, confidence scores, and the crucial
  operational fact that it is **free** (no per-call cost), which changes the cost/benefit calculus of
  "moderate everything" versus "moderate selectively"
- Where safety checks belong in the NestJS request lifecycle — a `CanActivate` guard for _input_
  (block before the handler spends money generating a response) versus an interceptor for _output_
  (the tokens are already spent; replace, don't throw)
- How to turn an existing observability layer (`ai_audit_logs`, built in Phase 1) into an
  _enforcement_ layer (per-user budgets) without a second bookkeeping table — aggregate on read,
  cache the aggregate
- Why budget exhaustion is a 429 and content violation is a 422 — mapping domain semantics onto
  correct HTTP status codes
- How to design time-based data retention that is safe by construction (only deletes old data, never
  active data) and operationally observable (per-run reports, batch deletes bounded in time)
- How to build cost analytics that a real finance/ops team would use — per-user, per-model,
  per-feature breakdowns, daily trends, and month-end projections — from an append-only audit table
  using `groupBy`/`aggregate` instead of a dedicated analytics store

From the **system's technical perspective**, Phase 4 fills the following gaps:

- `OpenaiService` exposes chat completions and embeddings but not moderations —
  `OpenAIEndpoint.MODERATIONS` has existed unused in the enum since Phase 1's scaffold
- Nothing prevents flagged content from entering (`sendMessage`, `/rag/ask`) or leaving (assistant
  responses) the system; there is no `moderation_logs` table and no record of what was checked
- `ai_audit_logs` records `estimatedCost` per call and `getCostSummary()` can aggregate it, but no
  code path ever _refuses_ a call based on spend — there is no `user_cost_budgets` table and no guard
- Cost reporting stops at Phase 1's single `getCostSummary()` — no per-feature split (chat vs. RAG
  vs. embeddings), no timeline, no projection
- No data ever expires: audit logs, moderation logs (once they exist), archived conversations, and
  embedding-cache rows grow unboundedly with no cleanup job

## Solution

Two new modules — `ModerationModule` and `CostManagementModule` — following the established one-way
dependency direction (new module → `OpenaiModule`, never the reverse), each exporting only the
pieces other modules need (the guards and the output interceptor), per spec
`Phase_4_Safety_Compliance_Requirement_Specification.md` §2.1.

**Module architecture:**

```
ModerationModule                          (imports OpenaiModule)
├── ModerationService                     ← classification + logging + log/stat queries
├── ModerationGuard                       ← CanActivate: moderate request input, 422 on flag
├── OutputModerationInterceptor           ← NestInterceptor: moderate AI output, replace on flag
└── ModerationController                  ← /moderation/check, /check-batch, /logs, /stats

CostManagementModule                      (imports nothing AI-specific — reads ai_audit_logs directly)
├── CostBudgetService                     ← budget CRUD + spend aggregation + cached checkBudget()
├── CostBudgetGuard                       ← CanActivate: 429 when over budget
├── CostAnalyticsService                  ← groupBy/aggregate analytics over ai_audit_logs
├── RetentionService                      ← cron-scheduled batch cleanup + manual trigger
└── CostManagementController              ← /cost/budgets, /cost/analytics/*, /retention/*
```

**Service responsibilities and boundaries:**

- **Only `OpenaiService` touches the OpenAI SDK** — unchanged Phase 1 rule. `OpenaiService` gains a
  `moderateText(input)` method wrapping `openaiClient.moderations.create()`, going through the same
  `RetryService.executeWithRetry()` → `AiAuditService.log()` → `mapError()` tail as
  `executeCompletion()`/`executeEmbedding()`, audited with the already-defined (and until now
  unused) `OpenAIEndpoint.MODERATIONS` and `estimatedCost: 0` (the endpoint is free).
  `ModerationService` is a consumer of this seam, never of the SDK.
- **`ModerationService`** owns classification semantics (mapping the raw API result to
  `ModerationResult` — `flaggedCategories`, `highestScore`, threshold application) and is the _only_
  writer/reader of the `moderation_logs` table. Every check — clean or flagged, input or output,
  guard-initiated or standalone — produces exactly one log row, written fire-and-forget in the
  `AiAuditService.log()` style so a moderation-log DB hiccup never fails the user's request.
- **`ModerationGuard`** extracts the user-supplied text from the request body (field name supplied
  per-route via decorator metadata, defaulting to `content`), calls
  `ModerationService.moderateText()`, and throws `UnprocessableEntityException` (422) carrying the
  flagged categories and scores when flagged. When `MODERATION_ENABLED` or
  `MODERATION_INPUT_ENABLED` is false, it returns `true` immediately without calling the API or
  writing a log row.
- **`OutputModerationInterceptor`** runs _inside_ the global `ResponseInterceptor` (route-level
  interceptors execute after global ones on the way in, before them on the way out), inspects the
  handler's returned payload for the assistant text field, and — when flagged — replaces the content
  with the safe message and logs the violation with the original content. It never throws for
  flagged output (the generation cost is already sunk); disabled by default
  (`MODERATION_OUTPUT_ENABLED=false`, opt-in).
- **`CostBudgetService`** owns the `user_cost_budgets` table (CRUD, one budget row per `userId`,
  P2002 → `ConflictException` like every other unique-keyed create in this codebase) and the spend
  math: daily (midnight UTC → now) and monthly (first of month UTC → now) `SUM(estimatedCost)`
  aggregates over `ai_audit_logs` where `status = SUCCESS`. `checkBudget()` reads through a
  per-user in-memory cache (TTL `COST_BUDGET_CACHE_TTL_MS`, default 60s) — same pattern as
  `TokenService`'s 5-minute pricing cache — so the per-request cost is a Map lookup, not an
  aggregate query (NFR-COST-001).
- **`CostBudgetGuard`** resolves the `userId` from the request, calls `checkBudget()`, throws a 429
  (`HttpException` with `HttpStatus.TOO_MANY_REQUESTS`, message including current spend and limit —
  FR-COST-002) when over either limit, and sets a warning response header when spend has crossed
  `alertThreshold × limit`. No budget row, or `isActive: false`, or `COST_BUDGET_ENABLED=false`
  means unlimited — the guard passes without any aggregate query.
- **`CostAnalyticsService`** is read-only over `ai_audit_logs` via Prisma `groupBy`/`aggregate` —
  no new table. The per-feature split maps the existing `endpoint` column
  (`chat.completions` / `embeddings` / `moderations`) plus, where distinguishable, the calling
  surface; projection is `(month-to-date spend ÷ elapsed days) × days in month` per FR-COST-004.
- **`RetentionService`** performs four independent batch cleanups (audit logs, moderation logs,
  archived conversations, stale embedding-cache rows), each a `deleteMany` bounded by a
  `createdAt`/`updatedAt` cutoff, looped in fixed-size batches so a 100K-row backlog completes
  within the 5-minute NFR without a single giant delete. Archived-conversation deletion relies on
  the existing `onDelete: Cascade` to remove messages. Scheduled via `SchedulerRegistry.addCronJob()`
  at `onModuleInit()` (not a static `@Cron()` decorator) so the `RETENTION_CRON` env var can supply
  the expression; each run logs a per-category deletion report. Runtime config overrides via
  `PATCH /retention/config` are in-memory only (reset on restart) — documented, not persisted.

**Data flow — moderated chat turn (input + output moderation both enabled):**

```
POST /chat/conversations/:id/messages
  → ModerationGuard: moderateText(dto.content, direction: 'input', source: 'chat')
      flagged? → 422 { flaggedCategories, categoryScores } + moderation_logs row (action: 'blocked')
      clean?   → moderation_logs row (action: 'allowed'), proceed
  → CostBudgetGuard: checkBudget(userId)
      over limit? → 429 "Daily budget exceeded ($1.02 of $1.00)"
      under?      → proceed (warning header if ≥ threshold)
  → ChatService.sendMessage() — unchanged Phase 2 path, audit-logged as before
  → OutputModerationInterceptor: moderateText(result.content, direction: 'output')
      flagged? → content := safe message, moderation_logs row (action: 'replaced', original content logged)
      clean?   → pass through
  → global ResponseInterceptor envelope (unchanged)
```

## Epic Breakdown

### Epic 1: Schema & Configuration Foundation

**Goal**

Both new tables (`moderation_logs`, `user_cost_budgets`) exist with the codebase's BigInt-PK +
`publicId` UUID convention and the spec §3.3 indexes; all eleven Phase 4 env vars are validated,
defaulted, and exposed through two new config namespaces (`moderation`, `costManagement` — or
equivalently split `retention` out as a third); both module scaffolds (`ModerationModule`,
`CostManagementModule`) are registered in `AppModule` with empty-shell services, guards,
interceptor, and stub controllers, mirroring how AI-016/AI-037 scaffolded prior phases.

**Stories Included**

- Stories 1–3, 30

**Dependencies**

- External: `DatabaseModule` (global), `ConfigModule`, the established non-interactive migration
  workaround (`prisma migrate diff` → hand-written `migration.sql` → `prisma:migrate:deploy`)

**Risks**

- `prisma migrate dev` is non-interactive-hostile in this environment — must use the documented
  diff-based workaround from Phase 3 (AI-036)
- Partial index (`WHERE is_flagged = true`) is raw SQL that Prisma's schema DSL can't express —
  add it in the hand-written migration and document that `migrate diff` output needs that manual
  addition

**Success Criteria**

- `npm run prisma:validate` passes; migration applies cleanly via `prisma:migrate:deploy`
- App boots with none of the eleven env vars set (all `@IsOptional()` with defaults)
- Both modules appear in the boot log with no DI errors; all existing tests still pass

### Epic 2: OpenaiService Moderation Extension

**Goal**

`OpenaiService.moderateText(input)` (and a batch variant accepting `string[]` — the moderation API
natively accepts an array input) exists as the single SDK seam for moderations, with the same
retry/circuit-breaker/audit/error-mapping tail as completions and embeddings, audited under
`OpenAIEndpoint.MODERATIONS` with `estimatedCost: 0`.

**Stories Included**

- Stories 4–6

**Dependencies**

- Internal: none (purely additive to Phase 1's `OpenaiService`)
- External: `RetryService`, `AiAuditService`, `OPENAI_CLIENT`

**Risks**

- **OpenRouter may not proxy `/moderations`.** The spec asserts it works through OpenRouter, but
  this is unverified; if `OPENAI_BASE_URL` points at OpenRouter and the endpoint 404s, moderation
  needs its own client instance targeting `api.openai.com` directly (a second, moderation-only
  `baseURL`/key). Resolve during this epic with a live probe, not at the final smoke test —
  everything downstream depends on it.
- Circuit breaker is shared across endpoints in `RetryService` — a moderation outage tripping the
  circuit would also block chat/embeddings (and vice versa). Acceptable for this learning project;
  document rather than redesign.

**Success Criteria**

- Unit tests prove the retry wrapper engages, the audit row is written with `endpoint:
'moderations'` and zero cost, and the raw SDK response maps through unchanged
- Existing `openai.service.spec.ts` assertions untouched and green (additive-only proof, same bar
  AI-018/AI-038 met)

### Epic 3: Moderation Core — Service, Guard, Interceptor

**Goal**

`ModerationService.moderateText()`/`moderateBatch()` classify content (threshold application,
`flaggedCategories`, `highestScore`) and log every check to `moderation_logs`;
`ModerationGuard` blocks flagged input with 422; `OutputModerationInterceptor` replaces flagged
output with the safe message; all three honor the four `MODERATION_*` toggles with no code changes.
Guard and interceptor are applied to the Phase 2/3 AI entrypoints (`POST
/chat/conversations/:id/messages`, `.../messages/stream`, `POST /rag/ask`,
`POST /rag/ask/conversation/:id`).

**Stories Included**

- Stories 7–15

**Dependencies**

- Internal: Epics 1–2
- External: `AiChatModule`/`RagModule` route decorators (the only cross-module edits this phase
  makes to existing modules)

**Risks**

- The SSE streaming route returns via raw `@Res()` with an async generator — the output
  interceptor's payload-inspection model doesn't apply there. Input moderation via the guard works
  unchanged; output moderation on the streamed path is **out of scope** (documented, matching the
  spec's opt-in/default-off posture for output checks).
- Guard needs the text field name per route (`content` for chat, `question` for RAG ask) — solved
  with decorator metadata + `Reflector`, defaulting to `content`.
- Fire-and-forget log writes must not swallow _moderation_ failures — only _logging_ failures. A
  moderation API error should fail open or closed per an explicit decision (see Implementation
  Decisions: fail open, log loudly).

**Success Criteria**

- SC-MOD-001/002/003/004/005 covered at the unit level: clean pass, flagged block (422 shape),
  output replacement, disabled-via-config passthrough with zero API calls and zero log rows
- Every check writes exactly one `moderation_logs` row with correct
  `direction`/`action`/`source`/truncated content (1000 chars)

### Epic 4: Cost Budgets — Service & Guard

**Goal**

`CostBudgetService` implements budget CRUD (unique per `userId`), `getUserSpend()` daily/monthly
aggregates over `ai_audit_logs`, cached `checkBudget()` (60s TTL in-memory), and
`getUsersApproachingLimit()`; `CostBudgetGuard` enforces 429 on either limit and emits the
threshold warning header; enforcement is applied to the same AI entrypoints as moderation.

**Stories Included**

- Stories 16–22

**Dependencies**

- Internal: Epic 1
- External: `ai_audit_logs` (Phase 1's `AiAuditService` write path is unchanged — this epic only
  reads), `AiChatModule`/`RagModule` route decorators

**Risks**

- **`userId` provenance**: there is no auth (spec Out of Scope). The guard reads `userId` from the
  request (`x-user-id` header, falling back to `body.userId`/`query.userId`); a request with no
  resolvable userId passes unenforced (you can't budget an anonymous caller). Must match whatever
  convention Phase 1's audit path already uses for `userId` so spend attribution and enforcement
  key on the same identity.
- Cache staleness: up to 60s of overshoot past a limit is accepted by design (spec §8.3 Decision on
  Record); the cache entry must be invalidated on budget CRUD so limit changes apply immediately.
- Guard ordering: `CostBudgetGuard` must run _after_ `ModerationGuard` (don't count a request that
  moderation would have blocked anyway) — route-level `@UseGuards()` order is documented and tested.

**Success Criteria**

- SC-COST-001/002/003 covered: under-limit pass, over-limit 429 with spend+limit in message,
  threshold warning surfaced
- Fake-timer test proves the cache serves within TTL (one aggregate query for N checks) and
  refreshes after expiry
- No budget row / inactive / feature-disabled all bypass enforcement with zero aggregate queries

### Epic 5: Cost Analytics

**Goal**

`CostAnalyticsService` delivers the six spec §5.3 queries — by-user (paginated, sortable),
by-model, by-feature, timeline (daily buckets), daily trend (last N days), and projected monthly
spend — all as `groupBy`/`aggregate` reads over `ai_audit_logs` with date-range filtering.

**Stories Included**

- Stories 23–26

**Dependencies**

- Internal: Epic 1 (module scaffold only — analytics has no schema of its own)
- External: `ai_audit_logs`

**Risks**

- Prisma `groupBy` can't group by a date _truncation_ (day bucket) natively — timeline/trend either
  use `$queryRaw` with `date_trunc` (typed via `Prisma.sql`) or group in application code over a
  bounded date-range read. Prefer `$queryRaw` for the two time-bucketed queries; document it as the
  codebase's first raw-SQL usage.
- "Feature" attribution: `endpoint` distinguishes embeddings/moderations from completions, but chat
  vs. RAG completions share `chat.completions` — attribute via the audit row's existing metadata
  where possible, and document the limitation otherwise (don't add a new audit column in this
  phase).

**Success Criteria**

- SC-COST-004/005 covered: multi-user fixture produces correct per-user sums; projection formula
  is exactly month-to-date average × days in month (deterministic with a frozen clock)
- All queries exclude `status != SUCCESS` rows, matching the budget spend definition

### Epic 6: Data Retention

**Goal**

`RetentionService` implements the four cleanups (audit logs 90d, moderation logs 90d, archived
conversations 30d, embedding cache 180d) as batched `deleteMany` loops, a `runFullCleanup()`
aggregating a per-category `RetentionReport`, a cron registration honoring `RETENTION_CRON` via
`SchedulerRegistry`, and in-memory config read/update.

**Stories Included**

- Stories 27–29

**Dependencies**

- Internal: Epic 1
- External: `@nestjs/schedule` (installed since Phase 1), existing `onDelete: Cascade` on
  `ChatMessage`

**Risks**

- Safety invariants are the whole point: active conversations and documents/chunks must be
  structurally untouchable (the conversation delete is filtered on `isArchived: true AND updatedAt
< cutoff`; no document/chunk cleanup method exists at all — FR-RET-002 by omission, tested).
- Embedding-cache rows have no reference link to chunks, so "not referenced by any active chunk" is
  unenforceable as specified — retained as pure time-based deletion (see Implementation Decisions).
- A dynamic cron job registered at `onModuleInit()` must not double-register under hot-reload
  (`npm run dev` file watch) — guard by name in `SchedulerRegistry`.

**Success Criteria**

- SC-RET-001/002/003 covered: old-vs-recent boundary exact (a row created exactly at the cutoff is
  kept), archived-only deletion, active rows untouched
- Batch loop proven: a mocked 2.5-batch backlog issues 3 `deleteMany` calls and sums counts
  correctly
- Cron registration verified via `SchedulerRegistry` lookup, not by waiting for 2 AM

### Epic 7: API Layer, DTOs, Swagger & Live Verification

**Goal**

All 20 routes across the two controllers (spec §6.1–§6.4) as thin delegates with request/response
DTOs, `@ApiEndpoint()` Swagger coverage under new `moderation` and `cost-management` tags,
controller delegation tests, DTO validation tests, a full regression run, and the phase-closing
HITL live smoke test (real moderation API, real budget enforcement over real audit rows, real
cleanup against seeded stale data).

**Stories Included**

- Stories 31–36

**Dependencies**

- Internal: Epics 1–6
- External: live OpenAI moderation endpoint availability (and the Epic 2 OpenRouter question's
  answer)

**Risks**

- Route ordering: `GET /cost/budgets/alerts` must be declared before `GET /cost/budgets/:userId`
  or NestJS matches `alerts` as a userId — same class of bug as any param-route shadowing;
  delegation tests must pin this.
- Spec §6's example responses show a `code: "MOD_001"` envelope — this codebase's global
  `ResponseInterceptor` envelope (`{ success, data, timestamp }`) wins, per the precedent set in
  Phases 1–3 (spec envelopes were never adopted).
- Live flagged-content testing requires policy-violating inputs — use the mildest reliably-flagged
  phrasing (e.g. explicit threats of violence in an obviously-test framing) and keep them out of
  committed fixtures; unit tests use mocked API responses only.

**Success Criteria**

- All routes in `/api/docs-json` under their tags; delegation + DTO validation tests green;
  full `npm run test`, `lint:check`, `tsc --noEmit`, and `build` clean with zero Phase 1–3
  assertion changes
- Live: a flagged message 422s and is absent from `chat_messages`; a $0.001 daily budget blocks a
  second call with 429; manual cleanup deletes seeded stale rows and preserves fresh ones

## User Stories

1. As a developer, I want `OpenaiService.moderateText()` to call the moderation API through the
   existing retry/audit pipeline, so that moderation gets the same resilience and observability as
   completions and embeddings.
2. As a developer, I want moderation audit rows to record `endpoint: 'moderations'` with
   `estimatedCost: 0`, so that cost analytics stay accurate for a free endpoint.
3. As an operator, I want the app to boot with no Phase 4 env vars set, so that safe defaults apply
   everywhere and configuration is opt-in.
4. As a user, I want clean text sent to `POST /moderation/check` to return `isFlagged: false` with
   per-category scores, so that I can inspect classification confidence.
5. As a user, I want `POST /moderation/check-batch` to moderate multiple texts in one call, so that
   bulk screening doesn't need N round trips.
6. As a developer, I want a moderation API outage to fail open (request proceeds, loud error log)
   rather than blocking all AI traffic, so that a free auxiliary endpoint can't take down the
   product's core features.
7. As a user, I want a flagged chat message to be rejected with 422 listing the flagged categories
   and scores, so that I know what was objected to and nothing is persisted or sent to the model.
8. As a user, I want a clean chat message to pass through the guard with no observable latency
   beyond the moderation call itself, so that safety doesn't degrade the experience.
9. As a compliance reviewer, I want _every_ moderation check — allowed, blocked, or replaced —
   logged with direction, source, truncated content, categories, and scores, so that the audit
   trail is complete rather than violations-only.
10. As an operator, I want `MODERATION_ENABLED=false` to bypass all checks with zero API calls and
    zero log rows, so that the kill switch is total and cheap.
11. As an operator, I want input and output moderation independently toggleable, so that I can run
    input-only (the default) without code changes.
12. As a user, I want a flagged AI _response_ replaced with a safe message instead of an error, so
    that my conversation continues even when generation went somewhere it shouldn't.
13. As a compliance reviewer, I want the original (pre-replacement) output content preserved in the
    moderation log, so that replaced responses remain reviewable.
14. As a developer, I want the moderation block threshold (`MODERATION_BLOCK_THRESHOLD`) applied to
    category scores, so that borderline content handling is tunable without redeploying.
15. As a compliance reviewer, I want `GET /moderation/logs` (paginated, filterable by user, flagged
    status, direction, date range) and `GET /moderation/stats` (totals, violation rate, top
    categories), so that moderation behavior is queryable.
16. As an admin, I want to create a per-user budget with daily and monthly USD limits and an alert
    threshold, so that spend is bounded per user.
17. As an admin, I want creating a second budget for the same userId to fail with 409, so that
    budget rows stay one-per-user.
18. As a user under budget, I want my AI calls to proceed normally, so that enforcement is
    invisible until relevant.
19. As a user over my daily or monthly limit, I want a 429 stating my current spend and my limit,
    so that the block is self-explanatory (never a 403).
20. As a user at 85% of a limit with an 80% threshold, I want a warning surfaced on the response,
    so that I'm alerted before I'm blocked.
21. As a developer, I want `checkBudget()` served from a 60-second in-memory cache that is
    invalidated on budget CRUD, so that per-request cost is a Map lookup (NFR-COST-001) but limit
    changes apply immediately.
22. As an admin, I want `GET /cost/budgets/alerts` to list users approaching their limits, so that
    intervention can precede blocking.
23. As an admin, I want spend broken down by user (paginated, sortable) and by model, so that I can
    see who and what drives cost.
24. As an admin, I want spend broken down by feature (chat vs. embeddings vs. moderations), so that
    I can see which capability drives cost.
25. As an admin, I want a daily spend timeline and last-N-days trend, so that a dashboard can chart
    cost over time.
26. As an admin, I want projected monthly spend computed as month-to-date daily average × days in
    the month, so that I can anticipate the bill mid-month (FR-COST-004).
27. As an operator, I want a daily 2 AM cleanup that deletes audit logs and moderation logs older
    than 90 days, archived conversations older than 30 days (cascading their messages), and
    embedding-cache rows older than 180 days, logging a per-category report.
28. As an operator, I want retention to be structurally incapable of deleting active conversations,
    documents, or chunks, so that a misconfigured retention period can't destroy live data
    (FR-RET-002).
29. As an operator, I want cleanup to delete in fixed-size batches, so that a 100K-row backlog
    finishes within five minutes without long-held locks (NFR-RET-001).
30. As an operator, I want retention periods and the cron expression configurable via env vars, so
    that policy changes don't require code changes (FR-RET-003).
31. As an admin, I want `GET /retention/config`, `PATCH /retention/config`, `POST
/retention/cleanup`, and `GET /retention/stats`, so that retention is inspectable and manually
    triggerable.
32. As an API consumer, I want all Phase 4 endpoints documented in Swagger under `moderation` and
    `cost-management` tags with typed request/response DTOs, so that the surface is discoverable.
33. As a developer, I want invalid payloads (negative limits, thresholds outside 0–1, missing
    `text`, unknown query filters) rejected with 400 by the global ValidationPipe, so that DTO
    contracts are enforced.
34. As a developer, I want controller delegation tests for all 20 routes plus the
    param-route-shadowing pin for `/cost/budgets/alerts`, so that the API layer is regression-safe.
35. As a developer, I want the full Phase 1–3 test suite to pass unchanged after Phase 4 lands, so
    that guards/interceptors added to existing routes are proven non-breaking.
36. As a developer, I want a live HITL smoke test of the three flows (moderation block, budget
    block, retention cleanup) against real infrastructure, so that unit-level proofs are confirmed
    end to end.

## Implementation Decisions

- **Two modules, not one.** Moderation and cost management are separate capability boundaries with
  separate consumers; each exports only its guard(s)/interceptor, matching the "export only what's
  needed externally" convention from Phases 2–3.
- **SDK access stays behind `OpenaiService`.** Moderation gets `moderateText()` on `OpenaiService`
  exactly as embeddings got `generateEmbedding()` in Phase 3 — same retry/audit/error-mapping tail,
  `OpenAIEndpoint.MODERATIONS`, zero cost. If the configured `OPENAI_BASE_URL` (OpenRouter) turns
  out not to proxy `/moderations`, add a moderation-only fallback base URL/key rather than moving
  SDK access into `ModerationModule`.
- **Guard for input, interceptor for output** (spec Decision on Record): guards run before the
  handler (block before money is spent); interceptors see the handler's result (replace, never
  throw, because the generation cost is sunk). Output moderation is opt-in and does not apply to
  the SSE streaming route in this phase.
- **Moderation fails open.** A moderation _API_ failure (after retries) logs an error and lets the
  request proceed; a moderation _flag_ blocks. Blocking all AI traffic whenever a free auxiliary
  endpoint hiccups is the wrong availability tradeoff for this system, and the audit trail records
  the gap.
- **Every check is logged, fire-and-forget.** One `moderation_logs` row per check (clean or
  flagged), content truncated to 1000 chars, written in the `AiAuditService.log()` non-blocking
  style so log-write failures never affect the request.
- **422 for content, 429 for budget** — semantically correct codes, per spec; budget 429 message
  always includes current spend and the limit.
- **Budgets aggregate `ai_audit_logs` on read; no spend table.** Daily = midnight UTC → now;
  monthly = first of month UTC → now; only `status: SUCCESS` rows count. A per-user in-memory cache
  (default 60s TTL, invalidated on budget CRUD) satisfies the 100ms budget-check NFR; staleness of
  up to one TTL past a limit is accepted by design.
- **Unenforceable-userId requests pass.** With auth out of scope, `userId` comes from the request
  (`x-user-id` header primary); absent a userId there is nothing to key a budget on, so the guard
  passes — enforcement is exactly as strong as the identity signal, and that's a documented Phase 4
  boundary, not a bug.
- **Guard order on AI routes: moderation, then budget.** Don't charge a budget check against a
  request moderation would reject.
- **Analytics use `groupBy`/`aggregate`; day-bucketed queries use `$queryRaw` with `date_trunc`.**
  The codebase's first raw SQL, confined to the two timeline queries where Prisma's DSL can't
  express the grouping. Chat-vs-RAG feature attribution is best-effort from existing audit columns;
  no new audit column this phase.
- **Retention is time-based only, batched, and safe by omission.** No cleanup method exists for
  documents/chunks or active conversations at all. Embedding-cache cleanup is pure
  `createdAt`-cutoff deletion — the spec's "not referenced by an active chunk" condition is
  unenforceable because cache rows carry no chunk reference, and a deleted cache row's only cost is
  one re-embedding on next encounter. Cron is registered dynamically from `RETENTION_CRON` via
  `SchedulerRegistry` (a static `@Cron()` decorator can't read env config), guarded against
  double-registration. `PATCH /retention/config` overrides are in-memory and reset on restart.
- **Response envelope**: the global `{ success, data, timestamp }` envelope applies to all Phase 4
  endpoints; the spec's `code: "MOD_001"`-style examples are not adopted (consistent with Phases
  1–3).
- **Environment variables** per spec §12: all eleven optional with defaults, validated in
  `env.validation.ts`, exposed via new `registerAs()` namespaces alongside the existing eight.

## Testing Decisions

- **Unit seams follow the established patterns exactly**: `DeepMockProxy<DatabaseService>`
  (jest-mock-extended) with the mandatory `jest.mock('.../database.service', ...)` Prisma-ESM
  stub in every spec that transitively touches it; `OPENAI_CLIENT` mocked at the token for
  `OpenaiService.moderateText()` tests (scripted `moderations.create` responses — no live calls);
  services under test receive plain `jest.fn()` collaborator mocks.
- **Guard tests** build a fake `ExecutionContext` (`switchToHttp().getRequest()` returning a
  hand-built request with body/headers) — assert 422 shape, passthrough, config-toggle bypass with
  zero service calls, and text-field resolution via `Reflector` metadata.
- **Interceptor tests** invoke `intercept(context, { handle: () => of(payload) })` directly and
  assert the mapped observable output — replaced content on a flagged payload, identity on clean,
  bypass when disabled; no HTTP transport involved.
- **Budget cache** tested with `jest.useFakeTimers()`: N checks within TTL → one aggregate query;
  advance past TTL → refresh; CRUD → immediate invalidation. Spend-window boundaries tested with a
  frozen system clock so "midnight UTC" and "first of month" are deterministic.
- **Analytics** tested against mocked `groupBy`/`aggregate`/`$queryRaw` returns with fixture rows,
  asserting the exact Prisma call arguments (where-clauses, date ranges, `status: SUCCESS` filter)
  and the projection arithmetic against a frozen date.
- **Retention** tested by calling cleanup methods directly (never by waiting on cron): cutoff
  boundary exactness, archived-only filters, batch-loop call counts, report aggregation, and
  `SchedulerRegistry` registration by job name. `onModuleInit()` called explicitly post-`compile()`
  per the documented TestingModule gotcha.
- **Controller tests** mirror `chat.controller.spec.ts`/`rag.controller.spec.ts`: `TestingModule` +
  `jest.fn()` service mocks, all-route delegation + entity→ResDto mapping, DTO `validate()` smoke
  tests (one invalid + one valid payload per request DTO), and the `/cost/budgets/alerts`
  route-ordering pin.
- **Integration test** in the AI-034 style: real `ModerationGuard` + real `ModerationService` +
  real `OpenaiService` wired through a `TestingModule` with only `DatabaseService` and
  `OPENAI_CLIENT` mocked — proving a flagged input 422s before the (mocked) chat handler runs and
  writes exactly one `moderation_logs` row.
- **Regression risk**: the only edits to existing modules are route decorators on
  `ChatController`/`RagController` — the full Phase 1–3 suite must pass with zero assertion
  changes, and guard-disabled config must be the default posture in existing controller specs so
  they don't suddenly need moderation mocks.
- **Live verification** (phase-closing HITL): real moderation endpoint (resolving the OpenRouter
  question), real budget block over real audit rows, real batched cleanup against deliberately
  back-dated seed rows; flagged-content test phrases are never committed as fixtures.

## Out of Scope

Per spec §14:

- Real authentication/authorization — `userId` is a request-supplied parameter, not a JWT claim
- Email/Slack budget alerts — alert data is queryable via API only, no push
- Real-time budget websockets — per-request checks only
- Custom moderation models — OpenAI's built-in moderation only
- Moderation appeal/review workflow — blocked is blocked
- GDPR right-to-erasure — retention is time-based, not user-request-based
- Encryption at rest, multi-tenancy / org-level budgets

Additionally scoped out by this PRD (documented above): output moderation on the SSE streaming
route, chunk-reference-aware embedding-cache cleanup, persisted runtime retention-config overrides,
and per-endpoint circuit-breaker isolation in `RetryService`.

## Further Notes

- **Assumption**: `ai_audit_logs.userId` is populated wherever budget enforcement matters. Today
  most call paths pass `userId` optionally; the live smoke test must exercise budget enforcement
  with the same identity convention (`x-user-id` header → audit row `userId`) end to end, and Epic
  4 may need to thread `userId` from the guard's resolution into the existing call chains if any
  audited path drops it.
- **Risk — OpenRouter moderation support** is the phase's biggest unknown and is deliberately
  front-loaded into Epic 2 (see that epic's risks). Budget for a moderation-specific base
  URL/key fallback.
- **Free-tier model flakiness** (documented across AI-025/032/033/035/055) affects the live smoke
  test's chat calls, not moderation itself — reuse the current default (`tencent/hy3:free`) and
  the per-request model override escape hatch.
- **Future phases**: budget alert push notifications, Redis-backed spend counters, org-level
  budgets, and streaming output moderation are natural Phase 5+ candidates; the module boundaries
  chosen here (guards/interceptor as the exported surface) keep those additive.

## Tracking

Status: ready-for-agent

Issues:

- Epic 1: AI-056 (schema), AI-057 (config + module scaffolds)
- Epic 2: AI-058 (`OpenaiService` moderation seam), AI-059 (HITL — OpenRouter `/moderations` probe)
- Epic 3: AI-060 (`ModerationService`), AI-061 (`ModerationGuard`), AI-062
  (`OutputModerationInterceptor`), AI-063 (application to chat/RAG routes)
- Epic 4: AI-064 (budget CRUD + DTOs), AI-065 (spend aggregation + cached `checkBudget()`),
  AI-066 (`CostBudgetGuard` + route application)
- Epic 5: AI-067 (by-user/model/feature analytics), AI-068 (timeline/trend/projection)
- Epic 6: AI-069 (batched cleanups + report), AI-070 (cron registration + runtime config)
- Epic 7: AI-071 (`ModerationController`), AI-072 (budget endpoints), AI-073
  (analytics + retention endpoints), AI-074 (tests + regression), AI-075 (HITL — live smoke test)

See `docs/issues/index.md` — Phase 4 section.

Dependencies:

- `OpenaiModule` — `OpenaiService` (moderation seam), `RetryService`, `AiAuditService`,
  `OPENAI_CLIENT`
- `DatabaseModule` (global) — new tables + audit-log reads
- `AiChatModule` / `RagModule` — route-level guard/interceptor application (decorator edits only)
- `@nestjs/schedule` — retention cron via `SchedulerRegistry`
- `ConfigModule` — three new namespaces, eleven env vars

Open Questions:

- Does OpenRouter proxy `POST /moderations`? If not, moderation needs a dedicated base URL/key
  (resolve in Epic 2 with a live probe).
- Should chat-vs-RAG feature attribution get a dedicated audit column later? (Out of scope now;
  analytics documents the limitation.)

Related PRDs:

- `2026-06-25-openai-api-foundations.md` (Phase 1 — audit/retry/cost pipeline this phase enforces
  against)
- `2026-07-06-chat-streaming-function-calling.md` (Phase 2 — chat routes receiving guards)
- `2026-07-08-vector-search-rag.md` (Phase 3 — RAG routes receiving guards; embedding cache subject
  to retention)
