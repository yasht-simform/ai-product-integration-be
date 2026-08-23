# Phase 4: Safety & Compliance — Complete Guide

> Reference document for `src/modules/moderation/` and `src/modules/cost-management/`, plus the
> moderation seam Phase 4 added to `src/modules/openai/services/openai.service.ts` and the four
> decorator-only edits to `ChatController`/`RagController`. Written against the code as it exists on
> `feat/openai-api-setup`. If the code and this doc ever disagree, trust the code and update this
> file. Companion to [`phase-1-complete-guide.md`](./phase-1-complete-guide.md),
> [`phase-2-complete-guide.md`](./phase-2-complete-guide.md), and
> [`phase-3-complete-guide.md`](./phase-3-complete-guide.md) — read those first if you haven't;
> this phase governs everything they built, it doesn't replace any of it.

---

## What I Built (Non-Technical Summary)

Phases 1–3 built a complete AI feature surface: reliable single-shot completions, a multi-turn
chat assistant that streams and uses tools, and a RAG pipeline that answers questions from your own
documents. All three phases share one blind spot — **nothing stands between a user and the model**.
Any input, however harmful, reaches the model verbatim. Any output, however inappropriate, reaches
the user verbatim. Any single user can run up an unbounded bill. And every log row the app has ever
written piles up forever, with no cleanup job in sight. Phase 4 is the governance layer that closes
all four gaps at once, without touching a single line of Phase 1–3's actual AI logic — it only adds
checkpoints around it.

### Content moderation — the bouncer at the door checking IDs

Think of a nightclub bouncer. They don't decide what happens _inside_ — that's the DJ's, the bar's,
the crowd's job. Their entire responsibility is standing at the door, checking every single person
against a short list of rules, and turning away anyone who fails the check — instantly, before they
ever get inside. `ModerationGuard` is that bouncer for every message a user sends: before
`ChatService` or `RagService` ever spends a token generating a response, the message is checked
against OpenAI's content-policy categories (hate, violence, self-harm, and so on). Fail the check
and the request is rejected on the spot — a clear "not allowed," no wasted API call, no persisted
message. There's a second bouncer too, this one checking people _on the way out_: if the model's own
answer turns out to say something it shouldn't, `OutputModerationInterceptor` swaps it for a safe,
generic reply before it ever reaches the user — the "generation already happened, don't make things
worse" version of the same idea.

### Cost budgets — the spending limit on a corporate card

A corporate card doesn't ask permission for every swipe — it just silently declines once the
monthly limit is hit, and it can warn the cardholder ahead of time once they're getting close.
`CostBudgetGuard` does exactly this for AI spend: give a user a daily and/or monthly dollar limit,
and every AI call checks their real spend (pulled straight from Phase 1's own audit log) against it.
Under the limit, nothing changes — completely invisible. Over the limit, the request is politely
declined with a message stating exactly how much was spent and what the limit is. Approaching the
limit surfaces a quiet warning instead of an outright block, so nobody gets surprised by a sudden
cutoff.

### Data retention — the office shredder on a schedule

Most offices don't keep every piece of paper they've ever printed — old, low-value records
(yesterday's meeting notes, expired invoices) go through the shredder on a schedule, while active
files stay in the cabinet untouched. `RetentionService` is that shredder for four categories of
this app's own accumulating data: audit logs, moderation logs, archived (not active!) conversations,
and stale embedding-cache rows. Each has its own "how old is too old" number, a daily 2 AM cleanup
run deletes anything past its cutoff, and — critically — the shredder is physically incapable of
touching an active conversation or a live document, no matter how old it is, because no code path
exists that would let it try.

### Cost analytics — the finance team's monthly spending report

A finance team doesn't just know "we spent $4,200 this month" — they can tell you _who_ spent it,
_which tool_ drove it, whether spend is trending up or down day by day, and roughly what next
month's bill will look like based on the current pace. `CostAnalyticsService` is that report,
built entirely by asking smarter questions of data Phase 1 was already collecting in
`ai_audit_logs` — no new table, no new tracking code, just `groupBy`/`aggregate` queries slicing the
same rows six different ways: by user, by model, by feature, over time, and projected forward.

**The unifying idea across all four:** every one of these capabilities is a checkpoint wrapped
_around_ Phase 1–3's existing pipeline, never a rewrite of it. `ModerationService` and
`CostBudgetService` don't touch the OpenAI SDK or the chat/RAG logic at all — they read the same
audit trail Phase 1 already built, or call the exact same `OpenaiService` seam every other phase
uses, and the only edits to `ChatController`/`RagController` are four decorator lines each. That's
deliberate: a safety layer that requires rewriting the feature it's protecting is a safety layer
nobody will actually ship.

---

## Architecture Overview

### Two-module diagram

```
AppModule
├── OpenaiModule                                   (Phase 1 — 1 new method, no other changes)
│   └── exports: OPENAI_CLIENT, OpenaiService, RetryService*, AiAuditService, TokenService,
│                ModelRegistryService
│        *RetryService isn't actually exported (unchanged from Phase 1) — listed for clarity
│         that every phase inherits its retry/circuit-breaker behavior transitively via OpenaiService
│
├── AiChatModule                                   (Phase 2 — 4 new decorator lines, 2 new imports)
│   └── imports: OpenaiModule, HttpModule, ModerationModule, CostManagementModule
│
├── RagModule                                      (Phase 3 — 4 new decorator lines, 2 new imports)
│   └── imports: OpenaiModule, AiChatModule, ModerationModule, CostManagementModule
│
├── ModerationModule                    (src/modules/moderation/moderation.module.ts)
│   ├── imports: OpenaiModule
│   ├── providers: ModerationService, ModerationGuard, OutputModerationInterceptor
│   ├── controllers: ModerationController          (4 routes: check, check-batch, logs, stats)
│   └── exports: ModerationService, ModerationGuard, OutputModerationInterceptor
│
└── CostManagementModule                (src/modules/cost-management/cost-management.module.ts)
    ├── imports: (none — reads ai_audit_logs directly via the global DatabaseModule)
    ├── providers: CostBudgetService, CostAnalyticsService, RetentionService, CostBudgetGuard
    ├── controllers: CostManagementController (10 routes: budgets + analytics),
    │                RetentionController (4 routes)
    └── exports: CostBudgetService, CostBudgetGuard
```

Both new modules follow the same one-way dependency rule every prior phase established: a new
module can import an older one, never the reverse. `ModerationModule` imports `OpenaiModule` (for
the moderation SDK seam); `CostManagementModule` imports nothing AI-specific at all, since it only
ever reads the `ai_audit_logs` table the global, already-injectable `DatabaseService` gives it
directly. Neither Phase 1, 2, nor 3 has any idea Phase 4 exists — the _only_ two files from earlier
phases this phase edits are `ChatController` and `RagController`, and both edits are decorator-only.

### Why both modules export their guard _and_ their service — a real gotcha, twice

`ModerationModule`'s `exports` array is `[ModerationService, ModerationGuard,
OutputModerationInterceptor]` — not just the guard/interceptor, which is what the PRD's own module
diagram originally sketched. Same story for `CostManagementModule`: `exports: [CostBudgetService,
CostBudgetGuard]`, not just the guard. This was a real bug discovered live, not a decision made up
front:

```typescript
// src/modules/moderation/moderation.module.ts
@Module({
  imports: [OpenaiModule],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationGuard, OutputModerationInterceptor],
  // ModerationService must be exported too, not just the guard/interceptor: NestJS resolves a
  // class referenced via @UseGuards()/@UseInterceptors() by constructing it within the *host*
  // module's own injector scope (AiChatModule/RagModule via AI-063), not by reusing the instance
  // already built inside ModerationModule. That construction needs ModerationService resolvable
  // from the host module's own import graph, so it must be visible here too.
  exports: [ModerationService, ModerationGuard, OutputModerationInterceptor],
})
export class ModerationModule {}
```

When `ChatController` writes `@UseGuards(ModerationGuard, CostBudgetGuard)`, NestJS doesn't reuse
the singleton `ModerationGuard` instance already constructed inside `ModerationModule` — it
constructs a _fresh_ `ModerationGuard` scoped to `AiChatModule`'s own injector, and that fresh
instance needs its own constructor dependency (`ModerationService`) resolvable from
`AiChatModule`'s import graph. `AiChatModule` imports `ModerationModule`, so `ModerationService`
had to be visible through that import — exporting only the guard wasn't enough. This surfaced as a
real `UnknownDependenciesException` on app boot the first time the guard was applied
(`AI-063`); the exact same class of bug was then hit — and avoided proactively the second time,
having already learned the lesson — when `CostBudgetGuard` was wired up in `AI-066`.

### How guards and interceptors fit into the NestJS request lifecycle

NestJS runs a fixed pipeline for every incoming request, and Phase 4 deliberately slots into two
different points in it — one before the handler runs, one after:

```
Incoming request
  │
  ▼
Middleware              (request-logger.middleware.ts — Phase 1, unchanged)
  │
  ▼
Guards                  ← ModerationGuard, then CostBudgetGuard (both @UseGuards() on the route)
  │   throws 422/429 here → request never reaches the handler, nothing is charged or persisted
  ▼
Interceptors (before)   ← route-level interceptors run their "before" logic here
  │
  ▼
Pipes                   (ValidationPipe — Phase 1, unchanged)
  │
  ▼
Route Handler           ← ChatService.sendMessage() / RagService.query() — completely unmodified
  │   returns the assistant's response object
  ▼
Interceptors (after)    ← OutputModerationInterceptor inspects/replaces the payload here
  │
  ▼
Global ResponseInterceptor   ← Phase 1's { success, data, timestamp } envelope, unchanged
  │
  ▼
Exception Filter        (HttpExceptionFilter — Phase 1, unchanged — catches the guards' 422/429 too)
  │
  ▼
Response sent
```

The key architectural fact this diagram makes concrete: **a guard can stop a request from ever
costing money; an interceptor can only clean up after money has already been spent.** That's
precisely why input moderation and budget enforcement are both guards (`CanActivate`, run before
the handler, throw to reject) while output moderation is an interceptor
(`NestInterceptor`, wraps the handler's already-returned result, replaces rather than throws). This
distinction is spelled out as an explicit "Decision on Record" in the PRD, not something either
Nest or the spec forced — a different design could have made output moderation reject with an error
instead of substituting safe text, but that would throw away a completion the app already paid for.

### Request flow: moderation guard → budget guard → handler → output interceptor

```
POST /chat/conversations/:id/messages
  │
  ├─▶ ModerationGuard.canActivate()
  │     moderateText(dto.content, direction: 'input', source: 'chat')
  │       flagged? → throw UnprocessableEntityException (422) — request stops here entirely
  │       clean?   → return true, continue
  │
  ├─▶ CostBudgetGuard.canActivate()
  │     checkBudget(userId)
  │       over limit?  → throw HttpException(TOO_MANY_REQUESTS) (429) — stops here
  │       near limit?  → set X-Budget-Warning response header, continue
  │       under limit? → continue, no side effect
  │
  ├─▶ ChatController.sendMessage() → ChatService.sendMessage()   (Phase 2, completely unmodified)
  │     audited, cost-tracked, persisted exactly as before Phase 4 existed
  │
  └─▶ OutputModerationInterceptor.intercept()
        moderateText(result.content, direction: 'output', source: 'chat')
          flagged? → response.content replaced with the safe message before it leaves the server
          clean?   → response passes through completely unchanged
```

Both guards are listed in one `@UseGuards(ModerationGuard, CostBudgetGuard)` call, moderation
first — a deliberate, tested ordering (see [Guard ordering](#guard-ordering-why-moderation-runs-before-budget)
below): a request that moderation would reject is never charged against a budget.

### How Phase 1–3 services are reused, not reinvented

| What Phase 4 needs                                             | Which existing service supplies it                                                   | New code required                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Call the moderation API                                        | `OpenaiService.moderateText()`/`moderateBatch()` (new methods, Phase 4)              | 2 new methods on an existing service — same pattern as Phase 3's `generateEmbedding()`   |
| Retry a flaky moderation call, trip the shared circuit breaker | `RetryService` (Phase 1, via `OpenaiService`)                                        | None — inherited automatically, transitively                                             |
| Log every moderation call for cost visibility                  | `AiAuditService.log()` (Phase 1, via `OpenaiService`)                                | None — `endpoint: 'moderations'`, `estimatedCost: 0`, same table                         |
| Know how much a user has spent                                 | `ai_audit_logs` (Phase 1's own audit table)                                          | None — `CostBudgetService`/`CostAnalyticsService` only ever _read_ it                    |
| Apply moderation/budget checks to chat                         | `ChatController` (Phase 2)                                                           | 4 decorator lines on 2 existing routes — zero logic changes                              |
| Apply moderation/budget checks to RAG                          | `RagController` (Phase 3)                                                            | 4 decorator lines on 2 existing routes — zero logic changes                              |
| Cascade-delete a conversation's messages on retention cleanup  | `ChatMessage.conversation`'s `onDelete: Cascade` (Phase 2's own schema)              | None — `RetentionService` never manually deletes a message row                           |
| Read/change runtime config                                     | `ConfigService` + three new `registerAs()` namespaces (Phase 1's own config pattern) | 3 new namespaces, same `@IsOptional()`-with-defaults convention every phase already uses |

**The "only `OpenaiService` touches the SDK" rule holds once more.** `ModerationService` never
imports the `openai` package — it calls `OpenaiService.moderateText()`, exactly the way
`DocumentService`/`SearchService` call `OpenaiService.generateEmbedding()` in Phase 3. No module in
this codebase has ever had a second door to the OpenAI SDK, and Phase 4 doesn't open one either.

---

## The Services Explained

### ModerationService — classify, threshold, log

**What it does (non-technical):** Takes a piece of text, asks OpenAI's moderation model "does this
violate any content policy, and how confident are you per category," decides — using a tunable
confidence threshold — whether that counts as a violation, and writes down exactly what happened
(clean or flagged, what it checked, what it decided) so nothing is ever moderated silently.

**What it does (technical):**

```typescript
// src/modules/moderation/services/moderation.service.ts
async moderateText(text: string, options: ModerationOptions = {}): Promise<ModerationResult>
async moderateBatch(texts: string[]): Promise<ModerationResult[]>
async getModerationLogs(query: QueryModerationLogsParams): Promise<PaginatedModerationLogsResult>
async getModerationStats(query: ModerationStatsQueryParams): Promise<ModerationStatsResult>
```

```typescript
async moderateText(text: string, options: ModerationOptions = {}): Promise<ModerationResult> {
  if (!this.isEnabled()) {
    return this.cleanResult();
  }

  const direction = options.direction ?? ModerationDirection.INPUT;
  const source = options.source ?? DEFAULT_SOURCE;
  const requestId = options.requestId ?? requestContext.getStore()?.requestId;

  try {
    const moderation = await this.openaiService.moderateText(text);
    const result = this.buildResult(moderation);
    const action = result.isFlagged
      ? (options.action ?? ModerationAction.BLOCKED)
      : ModerationAction.ALLOWED;

    void this.logModeration({ direction, content: text, result, source,
      userId: options.userId, requestId, action });

    return result;
  } catch (error) {
    this.logger.error('ModerationService: moderation API call failed — failing open', String(error));

    const result = this.cleanResult();
    void this.logModeration({ direction, content: text, result, source,
      userId: options.userId, requestId, action: ModerationAction.ALLOWED,
      metadata: { failedOpen: true } });

    return result;
  }
}
```

The threshold-application logic — turning OpenAI's raw category scores into this app's own
`ModerationResult` shape:

```typescript
private buildResult(moderation: OpenAiModerationResult): ModerationResult {
  const threshold =
    this.configService.get<number>('moderation.blockThreshold') ?? DEFAULT_BLOCK_THRESHOLD;

  const categories: Record<string, boolean> = {};
  const flaggedCategories: string[] = [];
  let highest = { category: '', score: 0 };
  let highestScoreSeen = -Infinity;

  for (const [category, score] of Object.entries(moderation.categoryScores)) {
    const flagged = (moderation.categories[category] ?? false) || score >= threshold;
    categories[category] = flagged;
    if (flagged) flaggedCategories.push(category);
    if (score > highestScoreSeen) {
      highestScoreSeen = score;
      highest = { category, score };
    }
  }

  return {
    isFlagged: flaggedCategories.length > 0,
    categories,
    categoryScores: moderation.categoryScores,
    flaggedCategories,
    highestScore: highest,
  };
}
```

**Key design decisions and why:**

- **A category counts as flagged when OpenAI's own boolean is `true` OR its score clears
  `moderation.blockThreshold` (default `0.7`).** This OR-check is what makes borderline content
  tunable — the raw API `flagged` boolean is untuned and can't be adjusted without OpenAI changing
  it, but this app's own `isFlagged` (derived from the threshold-checked category set, never the
  API's own top-level `flagged` field) can be dialed via a single env var.
- **Every check produces exactly one log row — clean or flagged, guard-initiated or standalone —
  written fire-and-forget**, the identical pattern `AiAuditService.log()` established in Phase 1:
  `void this.logModeration(...)` means a database hiccup while writing the log never fails the
  caller's actual request. The try/catch _inside_ `logModeration()` is a second, independent
  safety net specifically for the log write itself.
- **A moderation API failure fails open, not closed.** The `catch` block around the real API call
  logs the failure loudly (`this.logger.error(...)`) but returns a _clean_ result rather than
  rejecting the request — the fail-open result is itself logged with `metadata: { failedOpen: true
}`, so the gap is visible in the audit trail even though it didn't block anything. This is a
  deliberate availability tradeoff, not an oversight: blocking all AI traffic whenever a free,
  auxiliary safety endpoint hiccups is the wrong tradeoff for a system where the moderation call
  itself has no SLA of its own.
- **Action resolution differs between clean and flagged.** `moderateText()`'s caller can pass a
  hint (`options.action`) for what it _intends_ to do with a flagged result — but that hint only
  ever matters on the flagged branch. A clean result is always logged `ALLOWED`, regardless of what
  the caller passed, since there's nothing else a clean result could mean.
- **`moderateBatch()` takes no per-item options** — matching the spec's exact interface — so every
  batched check logs with a fixed `direction: 'input'`, `source: 'standalone'`, no `userId`. This
  is deliberately the narrower, standalone-only entry point (`POST /moderation/check-batch`); the
  guard/interceptor always call `moderateText()` one item at a time, with full context.
- **The kill switch is checked before anything else, in both methods.** `isEnabled()` gates on
  `moderation.enabled` (default `true`) with zero downstream calls when `false` — no
  `OpenaiService` call, no database write, nothing. Every consumer of this service (the standalone
  API, the guard, the interceptor) inherits the kill switch for free from this one place.

### CostBudgetService — budget CRUD, spend aggregation, cached enforcement

**What it does (non-technical):** Owns the list of who has a spending limit and what it is; can
answer "how much has this user spent today/this month" by adding up their real API calls; and
answers the yes/no question "can this user make another call right now" fast enough to check on
every single request without slowing anything down.

**What it does (technical):**

```typescript
// src/modules/cost-management/services/cost-budget.service.ts
async createBudget(dto: CreateBudgetDto): Promise<BudgetEntity>
async findAllBudgets(query: QueryBudgetsParams): Promise<PaginatedBudgetsResult>
async findBudgetByUserId(userId: string): Promise<BudgetEntity | null>
async updateBudget(publicId: string, dto: UpdateBudgetDto): Promise<BudgetEntity>
async deleteBudget(publicId: string): Promise<void>

async getUserSpend(userId: string, period: BudgetPeriod): Promise<number>
async checkBudget(userId: string): Promise<BudgetCheckResult>
async getUsersApproachingLimit(threshold?: number): Promise<BudgetAlertDto[]>
```

The raw spend aggregate — a direct read over Phase 1's own audit table, nothing new:

```typescript
async getUserSpend(userId: string, period: BudgetPeriod): Promise<number> {
  const result = await this.databaseService.aiAuditLog.aggregate({
    where: {
      userId,
      status: AiAuditStatus.SUCCESS,
      createdAt: { gte: this.getPeriodStart(period) },
    },
    _sum: { estimatedCost: true },
  });
  return result._sum?.estimatedCost ?? 0;
}

private getPeriodStart(period: BudgetPeriod): Date {
  const now = new Date();
  return period === BudgetPeriod.DAILY
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
```

The cached enforcement check that runs on every gated request:

```typescript
async checkBudget(userId: string): Promise<BudgetCheckResult> {
  if (!this.isEnabled()) return this.unrestrictedResult();

  const budget = await this.databaseService.userCostBudget.findUnique({ where: { userId } });
  if (!budget || !budget.isActive) return this.unrestrictedResult();

  const { dailySpend, monthlySpend } = await this.getCachedSpend(userId);
  const { dailyLimitUsd: dailyLimit, monthlyLimitUsd: monthlyLimit, alertThreshold } = budget;

  const dailyPercentage = dailyLimit ? (dailySpend / dailyLimit) * 100 : 0;
  const monthlyPercentage = monthlyLimit ? (monthlySpend / monthlyLimit) * 100 : 0;
  const dailyExceeded = dailyLimit !== null && dailySpend >= dailyLimit;
  const monthlyExceeded = monthlyLimit !== null && monthlySpend >= monthlyLimit;
  const allowed = !dailyExceeded && !monthlyExceeded;

  let warning: string | undefined;
  if (allowed) {
    if (dailyLimit !== null && dailySpend >= alertThreshold * dailyLimit) {
      warning = `Approaching daily limit (${Math.round(dailyPercentage)}%)`;
    } else if (monthlyLimit !== null && monthlySpend >= alertThreshold * monthlyLimit) {
      warning = `Approaching monthly limit (${Math.round(monthlyPercentage)}%)`;
    }
  }

  return { allowed, dailySpend, monthlySpend, dailyLimit, monthlyLimit,
    dailyPercentage, monthlyPercentage, warning };
}
```

The in-memory spend cache — one `Map`, per-key TTL:

```typescript
private readonly spendCache = new Map<string, { entry: SpendSnapshot; expiresAt: number }>();

private async getCachedSpend(userId: string): Promise<SpendSnapshot> {
  const cached = this.spendCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.entry;

  const [dailySpend, monthlySpend] = await Promise.all([
    this.getUserSpend(userId, BudgetPeriod.DAILY),
    this.getUserSpend(userId, BudgetPeriod.MONTHLY),
  ]);
  const entry: SpendSnapshot = { dailySpend, monthlySpend };
  this.spendCache.set(userId, { entry, expiresAt: Date.now() + this.getCacheTtlMs() });
  return entry;
}

private invalidateSpendCache(userId: string): void {
  this.spendCache.delete(userId);
}
```

**Key design decisions and why:**

- **No new spend table — budgets aggregate `ai_audit_logs` on read.** The alternative (a running
  counter updated on every AI call) would need to touch every write path in `OpenaiService` and
  risk drifting out of sync with the audit log's own truth. Reading `SUM(estimatedCost)` from the
  table that's already the single source of truth for cost is simpler and can never disagree with
  it.
- **Only `status: SUCCESS` rows count toward spend.** A failed call that still burned tokens (rare,
  but possible on a partial response before an error) isn't counted — spend tracking mirrors the
  same success-only definition Phase 1's own `getCostSummary()` uses.
- **Daily/monthly boundaries are computed entirely with `Date.UTC()`, never a local-time method.**
  `getPeriodStart()` never calls `getDate()`/`getMonth()` (local-time) — only their `getUTC*()`
  equivalents — so "midnight" and "the first of the month" mean the same instant regardless of
  which timezone the server process happens to be running in. This matters more than it might look:
  a Node process running in IST computing "midnight" via local-time methods would draw the daily
  boundary 5.5 hours off from a UTC-run process checking the exact same budget.
- **The spend cache is a per-key-TTL `Map`, not a single-shared-expiry cache like `TokenService`'s
  pricing cache (Phase 1).** `TokenService`'s cache refreshes its _entire_ contents on one timer,
  which is fine for a small, slowly-changing pricing table. Budget spend is different: each user's
  cache entry needs to expire independently, based on when _that specific user_ was last checked —
  a shared expiry would either check a busy user too rarely or refresh an idle user's spend for no
  reason.
- **The cache is invalidated immediately on every budget write** (`createBudget`/`updateBudget`/
  `deleteBudget` all call `invalidateSpendCache(userId)`), so a limit change or deletion takes
  effect on the very next `checkBudget()` call — never waiting out the TTL. The TTL only bounds
  staleness from _real spend_ accumulating between checks (up to `COST_BUDGET_CACHE_TTL_MS`,
  default 60s) — an explicitly accepted tradeoff (NFR-COST-001), not an oversight.
- **No budget row, an inactive budget, or `COST_BUDGET_ENABLED=false` all short-circuit to
  `unrestrictedResult()` with zero aggregate queries.** "Zero aggregate queries" specifically means
  the two expensive `SUM()` reads — `checkBudget()` still does one cheap `findUnique()` to _learn_
  there's no active budget, which is unavoidable, but never pays for the spend math on an
  unenforced user.
- **`deleteBudget()` is a genuine hard delete**, deliberately _not_ the soft-delete
  (`isActive: false`) convention `ModelRegistryService` uses elsewhere in this codebase. An
  inactive-but-present budget already has a first-class representation (`isActive: false`) — hard
  deletion is the only way to fully remove enforcement and its row, and both are meaningfully
  different states a caller might want.

### CostAnalyticsService — read-only aggregates, no new table

**What it does (non-technical):** Answers the finance-team questions — who's spending the most,
which model costs the most, which feature (chat vs. embeddings vs. moderation) drives spend, how
spend trends day by day, and roughly what the month's total bill will be — entirely by asking
different questions of the same audit log Phase 1 already keeps.

**What it does (technical):**

```typescript
// src/modules/cost-management/services/cost-analytics.service.ts
async getSpendByUser(query: SpendByUserQueryDto): Promise<SpendByUserResult>
async getSpendByModel(query: SpendByModelQueryDto): Promise<SpendByModelResult>
async getSpendByFeature(query: SpendByFeatureQueryDto): Promise<SpendByFeatureResult>
async getSpendTimeline(query: SpendTimelineQueryDto): Promise<SpendTimelineResult>
async getDailySpendTrend(days?: number): Promise<SpendTimelineResult>
async getProjectedMonthlySpend(): Promise<ProjectedSpendResult>
```

`groupBy` is the workhorse for the three static breakdowns:

```typescript
async getSpendByUser(query: SpendByUserQueryDto): Promise<SpendByUserResult> {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 20, 100);
  const sortOrder = query.sortOrder ?? 'desc';
  const where = this.buildWhere(query);

  const [groups, allGroups] = await Promise.all([
    this.databaseService.aiAuditLog.groupBy({
      by: ['userId'], where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCost: sortOrder } },
      skip: (page - 1) * limit, take: limit,
    }),
    // Distinct-user count for pagination `total` — groupBy has no built-in total-groups count.
    this.databaseService.aiAuditLog.groupBy({ by: ['userId'], where }),
  ]);

  return {
    data: groups.map((group) => ({
      userId: group.userId ?? ANONYMOUS_BUCKET,
      totalCost: group._sum.estimatedCost ?? 0,
      totalTokens: group._sum.totalTokens ?? 0,
      callCount: group._count._all,
    })),
    total: allGroups.length, page, limit,
  };
}
```

The projected-spend arithmetic — spec FR-COST-004's exact formula:

```typescript
async getProjectedMonthlySpend(): Promise<ProjectedSpendResult> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();

  const aggregate = await this.databaseService.aiAuditLog.aggregate({
    where: { status: AiAuditStatus.SUCCESS, createdAt: { gte: monthStart } },
    _sum: { estimatedCost: true },
  });
  const monthToDate = aggregate._sum?.estimatedCost ?? 0;
  const dailyAverage = daysElapsed > 0 ? monthToDate / daysElapsed : 0;
  const projected = dailyAverage * daysInMonth;

  return { monthToDate, dailyAverage, daysElapsed, daysInMonth, projected };
}
```

**Key design decisions and why:**

- **The two time-bucketed queries (`timeline`/`daily-trend`) use `$queryRaw`, the codebase's first
  raw SQL — because Prisma `groupBy` cannot group by a date _truncation_.** `groupBy` can group by
  a literal column value, but "group every row into its own calendar day" requires a SQL-level
  `date_trunc()`, which has no Prisma-DSL equivalent. This is a documented, deliberate exception to
  "always go through the Prisma client," not a precedent for reaching for raw SQL elsewhere.
- **The date bucket is returned as pre-formatted `'YYYY-MM-DD'` text via `to_char(date_trunc('day',
"createdAt"), 'YYYY-MM-DD')`, not a raw timestamp** — this fixes a real bug found during live
  verification, covered in full in [the timezone deep dive below](#the-queryraw-timezone-fix). The
  short version: a raw `timestamp without time zone` column gets parsed by `node-postgres` assuming
  the Node process's own _local_ timezone, silently shifting every day-bucket by that offset in any
  non-UTC deployment. A plain text column sidesteps `Date` parsing — and the timezone bug — entirely.
- **Every query filters `status: SUCCESS`**, exactly matching `CostBudgetService.getUserSpend()`'s
  own spend definition — analytics and enforcement can never disagree about what counts as "spend."
- **A null `userId` collapses into a literal `'anonymous'` bucket, never dropped.** Unattributed
  spend from a request with no resolvable identity is still real spend, and hiding it from
  `by-user` breakdowns would understate total cost.
- **Chat and RAG spend cannot be told apart, and this is documented rather than hidden.**
  `ai_audit_logs.endpoint` distinguishes `chat.completions` from `embeddings` from `moderations`,
  but both plain chat _and_ RAG answer generation call `chatCompletionWithMessages()` and log
  identically under `chat.completions` — there is no audit-log column recording which feature made
  the call, a deliberate no-new-audit-column decision for this phase. `FEATURE_LABELS` folds
  RAG-driven completions into the `'chat'` bucket, and the response DTO's own field description
  says so explicitly rather than silently misrepresenting the split.
- **`fillGapDays()` back-fills every day in the requested range with a zero bucket**, even days
  with no rows at all — a chart consuming this data gets a contiguous x-axis with no gaps to
  special-case, rather than a sparse array a frontend would have to reconcile against calendar
  dates itself.

#### The `$queryRaw` timezone fix

This is worth its own callout because it's a genuine bug that live verification caught and unit
tests structurally could not have — every mocked test scripts `$queryRaw`'s _return value_ directly,
so a bug in how the real Postgres driver parses that return value is invisible to them by
construction.

The original query selected a bare `date_trunc('day', "createdAt")` — a Postgres `timestamp without
time zone` value. `node-postgres` (the driver underneath Prisma's raw-query path) parses that type
by interpreting it in the _Node process's own local timezone_, not UTC. On a server running in IST
(`Asia/Kolkata`, UTC+5:30), a stored value that should read `2026-07-11` in the timeline came back
as the JavaScript `Date` `2026-07-10T18:30:00.000Z` — silently shifted a full day earlier, entirely
dependent on where the app happens to be deployed. The fix, confirmed by a standalone `pg.Client`
repro script before touching the real service, was to have the SQL itself return already-formatted
text:

```sql
-- before (bug): a raw timestamp column, parsed with an implicit local-timezone assumption
SELECT date_trunc('day', "createdAt") AS day, ...

-- after (fix): pre-formatted text — no Date parsing step exists for this column at all
SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, ...
```

`RawTimelineRow.day`'s type narrowed from `Date` to `string`, and `dayKey()` simplified to a direct
pass-through — there's no `new Date(value)` call left anywhere in the method, which eliminates the
entire bug class rather than patching around one symptom of it.

### RetentionService — batched cleanup, cron scheduling, in-memory config

**What it does (non-technical):** Runs a daily cleanup that deletes old audit logs, old moderation
logs, conversations that were both archived _and_ haven't been touched in a while, and stale cached
embeddings — each with its own "how old is too old" — and it does this deletion in small, bounded
chunks so a huge backlog can't lock the database for minutes at a time.

**What it does (technical):**

```typescript
// src/modules/cost-management/services/retention.service.ts
async cleanupAuditLogs(retentionDays: number): Promise<{ deleted: number }>
async cleanupModerationLogs(retentionDays: number): Promise<{ deleted: number }>
async cleanupArchivedConversations(retentionDays: number): Promise<{ deleted: number }>
async cleanupStaleEmbeddingCache(retentionDays: number): Promise<{ deleted: number }>
async runFullCleanup(): Promise<RetentionReport>
async getRetentionStats(): Promise<RetentionStatsResult>
getRetentionConfig(): RetentionRuntimeConfig
updateRetentionConfig(partial: Partial<RetentionRuntimeConfig>): void
```

The batched-delete engine every cleanup method shares:

```typescript
private async runBatchedDelete(
  fetchIds: (take: number) => Promise<Array<{ id: bigint }>>,
  deleteByIds: (ids: bigint[]) => Promise<number>,
): Promise<number> {
  let deleted = 0;
  let hasMore = true;
  while (hasMore) {
    const rows = await fetchIds(RETENTION_BATCH_SIZE);   // 1000
    if (rows.length === 0) break;
    deleted += await deleteByIds(rows.map((row) => row.id));
    hasMore = rows.length === RETENTION_BATCH_SIZE;
  }
  return deleted;
}
```

The one cleanup with a genuine safety condition, not just an age cutoff:

```typescript
async cleanupArchivedConversations(retentionDays: number): Promise<{ deleted: number }> {
  const cutoff = this.computeCutoff(retentionDays);
  const deleted = await this.runBatchedDelete(
    (take) => this.databaseService.chatConversation.findMany({
      where: { isArchived: true, updatedAt: { lt: cutoff } },   // BOTH conditions, not just age
      select: { id: true }, orderBy: { id: 'asc' }, take,
    }),
    (ids) => this.databaseService.chatConversation
      .deleteMany({ where: { id: { in: ids } } })
      .then((result) => result.count),
  );
  return { deleted };
}
```

Cron registration, done dynamically at boot rather than with a static decorator:

```typescript
onModuleInit(): void {
  if (this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
    this.logger.log(`Retention cron '${CRON_JOB_NAME}' already registered — skipping`);
    return;
  }

  const cronExpression = this.getRetentionConfig().cron;
  let job: CronJob;
  try {
    job = new CronJob(cronExpression, () => {
      this.runFullCleanup().catch((error: unknown) => {
        this.logger.error(`Retention cron tick failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  } catch (error) {
    this.logger.error(`Invalid RETENTION_CRON expression '${cronExpression}' — cron not registered`);
    return;
  }

  this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
  job.start();
  this.logger.log(`Retention cleanup cron registered: '${cronExpression}'`);
}
```

**Key design decisions and why:**

- **Active conversations are safe by omission, not by a filter that could be misconfigured.**
  There is no method anywhere in `RetentionService` that deletes a non-archived conversation —
  `cleanupArchivedConversations()` is the _only_ conversation-deleting method, and its `where`
  clause hard-codes `isArchived: true`. This is FR-RET-002's structural guarantee: a retention
  period set to `1` day can never destroy live data, because the code path to do so simply doesn't
  exist, rather than relying on a runtime check that a future edit could accidentally loosen.
  Documents and document chunks (Phase 3) get the identical treatment — no cleanup method for
  either exists at all.
- **Message cascade-deletion is inherited from Phase 2's schema, never done manually.**
  `cleanupArchivedConversations()` deletes `chat_conversations` rows and relies entirely on
  `ChatMessage.conversation`'s existing `onDelete: Cascade` to remove the messages — Phase 4 adds
  zero new cascade logic anywhere.
- **Every cleanup is batched at a fixed size (1000 rows), looping until a page comes back short.**
  A 100,000-row backlog issues roughly 100 `findMany`+`deleteMany` pairs instead of one giant
  `deleteMany` — bounding both query time and lock duration regardless of how large the backlog
  ever gets (NFR-RET-001). The loop's own stop condition (`hasMore = rows.length ===
RETENTION_BATCH_SIZE`) avoids one wasted extra probe query on the last, short page.
- **Embedding-cache cleanup is pure time-based deletion, with no "still referenced" check** — a
  documented limitation, not an accident. Cache rows carry no foreign key back to the document
  chunks that produced them, so "not referenced by an active chunk" (the spec's original wording)
  is literally unenforceable from the schema as it exists. The accepted cost of over-deleting a
  still-useful cache row is exactly one re-embedding call the next time that text is encountered —
  cheap enough that adding a reference column just for this check wasn't worth the schema change.
- **The cron job is registered dynamically at `onModuleInit()`, not with a static `@Cron()`
  decorator**, because a static decorator's expression is a compile-time literal — it can't read
  `RETENTION_CRON` from `ConfigService` at runtime. `SchedulerRegistry.doesExist()` guards against
  `npm run dev`'s file-watch re-running `onModuleInit()` and throwing on a duplicate registration; a
  malformed cron expression is caught and logged rather than crashing the whole app on boot.
- **`updateRetentionConfig()` explicitly rejects a `cron` key with a `BadRequestException`,** rather
  than silently ignoring it — changing the schedule at runtime would mean re-registering (or
  replacing) a live `SchedulerRegistry` job, which is real complexity this phase didn't need;
  restarting with a new `RETENTION_CRON` is the supported path. The four day-count fields _are_
  runtime-overridable, held in a plain in-memory object that resets on restart — a documented,
  not-persisted tradeoff, since this is a learning project without an operator UI that would need
  the setting to survive a redeploy.
- **A single category's cleanup failing doesn't abort the run.** `runCategory()` wraps every
  cleanup call in its own try/catch — a partial cleanup (three categories succeed, one fails) beats
  an all-or-nothing run that aborts the moment the first category hits an error, and the report
  marks exactly which category failed and why.

---

## Guards and Interceptors

### ModerationGuard — how `CanActivate` works, what 422 means

```typescript
// src/modules/moderation/guards/moderation.guard.ts
@Injectable()
export class ModerationGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isInputModerationEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const metadata = this.reflector.getAllAndOverride<ModerateFieldMetadata | undefined>(
      MODERATE_FIELD_KEY,
      [context.getHandler(), context.getClass()],
    );
    const field = metadata?.field ?? DEFAULT_FIELD; // 'content'
    const source = metadata?.source ?? DEFAULT_SOURCE; // 'standalone'

    const body = request.body as Record<string, unknown> | undefined;
    const text = body?.[field];
    if (typeof text !== 'string') return true; // missing/non-string field — the ValidationPipe's job, not this guard's

    const result = await this.moderationService.moderateText(text, {
      direction: ModerationDirection.INPUT,
      source,
      userId: resolveUserId(request),
      requestId: requestContext.getStore()?.requestId,
      action: ModerationAction.BLOCKED,
    });

    if (result.isFlagged) {
      throw new UnprocessableEntityException({
        message: 'Content flagged by moderation policy',
        error: 'Unprocessable Entity',
        flaggedCategories: result.flaggedCategories,
        categoryScores: result.categoryScores,
        highestScore: result.highestScore,
      });
    }

    return true;
  }
}
```

A NestJS guard implements `CanActivate` — a single method, `canActivate(context)`, that returns (or
resolves to) `true`/`false`, or throws. Returning `true` lets the request continue to the next
guard, then the handler; throwing an `HttpException` subclass (here,
`UnprocessableEntityException`) short-circuits the whole pipeline straight to
`HttpExceptionFilter`, and the handler never runs at all — no message is persisted, no tokens are
spent generating a response. **422 (Unprocessable Entity)** is the semantically correct code here:
the request was syntactically well-formed (the `ValidationPipe` already accepted it), but its
_content_ violates a policy the server refuses to act on — distinct from a 400 (malformed request)
or a 403 (forbidden by permission).

**Which field to check, and where that comes from:** a `@ModerateField(field, source)` decorator
(`SetMetadata`-based) lets each route declare what to moderate — `content` for chat,
`question` for RAG — and the guard reads it back via `Reflector.getAllAndOverride()`, falling back
to `field: 'content'`/`source: 'standalone'` for any route that doesn't set the metadata at all.

### OutputModerationInterceptor — why replace instead of throw

```typescript
// src/modules/moderation/interceptors/output-moderation.interceptor.ts
intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
  if (!this.isOutputModerationEnabled()) return next.handle();

  const metadata = this.reflector.getAllAndOverride<ModerateOutputFieldMetadata | undefined>(
    MODERATE_OUTPUT_FIELD_KEY, [context.getHandler(), context.getClass()],
  );
  const field = metadata?.field ?? DEFAULT_FIELD;
  const source = metadata?.source ?? DEFAULT_SOURCE;
  const request = context.switchToHttp().getRequest<Request>();

  return next.handle().pipe(
    switchMap((payload: unknown) => this.moderatePayload(payload, field, source, request)),
  );
}

private async moderatePayload(payload, field, source, request): Promise<unknown> {
  if (typeof payload !== 'object' || payload === null || !(field in payload)) return payload;

  const record = payload as Record<string, unknown>;
  const text = record[field];
  if (typeof text !== 'string') return payload;

  const result = await this.moderationService.moderateText(text, {
    direction: ModerationDirection.OUTPUT, source,
    userId: this.resolveUserId(request),
    requestId: requestContext.getStore()?.requestId,
    action: ModerationAction.REPLACED,
  });

  if (!result.isFlagged) return payload;
  return { ...record, [field]: SAFE_REPLACEMENT_MESSAGE };
}
```

An interceptor implements `NestInterceptor` — its `intercept(context, next)` method calls
`next.handle()` to actually invoke the route handler (and everything downstream of it), getting
back an RxJS `Observable` of whatever the handler returns. `switchMap()` maps that value through
`moderatePayload()` — an `async` function is fine here, since `switchMap` accepts anything that
resolves to an Observable-compatible value, including a `Promise`.

**Why replace instead of throw:** by the time this code runs, the handler has already executed —
`ChatService.sendMessage()` already called the model, already paid for the tokens, and (as of this
same request) already persisted the message. Throwing an error at this point would waste that
entire cost _and_ still show the user nothing useful. Swapping the flagged field for
`SAFE_REPLACEMENT_MESSAGE` ("I'm sorry, I can't provide that type of content.") means the user gets
a coherent response and the sunk cost isn't compounded by also failing the request. This is why
input moderation is a guard (stop it before it costs anything) and output moderation is an
interceptor (the cost is sunk — degrade gracefully instead).

**Why the original content is still fully recoverable, with no extra code:**
`ModerationService.moderateText()` is called with the _pre-replacement_ text — the interceptor only
swaps the field in the value it _returns_, after the moderation check already logged the real
content. The `moderation_logs` row for a replaced response therefore always preserves exactly what
the model actually said, even though the client never sees it.

**Default off, and why:** `moderation.outputEnabled` defaults to `false` — the one config flip
whose polarity is inverted from `moderation.enabled`/`moderation.inputEnabled` (both default
`true`). Checking every model response doubles the moderation-API traffic a request generates, and
this project's own live verification found a real limitation worth knowing before turning it on by
default — see [the SSE streaming limitation](#input-vs-output-moderation--when-and-why-each-applies)
below.

### CostBudgetGuard — how 429 works, the `x-user-id` header convention

```typescript
// src/modules/cost-management/guards/cost-budget.guard.ts
@Injectable()
export class CostBudgetGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = resolveUserId(request);
    if (!userId) return true; // no resolvable identity — nothing to budget against

    const result = await this.costBudgetService.checkBudget(userId);

    if (!result.allowed) {
      throw new HttpException(this.buildExceededMessage(result), HttpStatus.TOO_MANY_REQUESTS);
    }

    if (result.warning) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('X-Budget-Warning', result.warning);
    }

    return true;
  }

  private buildExceededMessage(result: BudgetCheckResult): string {
    if (result.dailyLimit !== null && result.dailySpend >= result.dailyLimit) {
      return `Daily budget exceeded ($${result.dailySpend.toFixed(2)} of $${result.dailyLimit.toFixed(2)})`;
    }
    const monthlyLimit = result.monthlyLimit ?? 0;
    return `Monthly budget exceeded ($${result.monthlySpend.toFixed(2)} of $${monthlyLimit.toFixed(2)})`;
  }
}
```

**429, never 403.** A 403 says "you are not allowed to do this, ever." A 429 (Too Many Requests)
says "you've used up your allotment for now — try again later (or with a higher limit)." Budget
exhaustion is unambiguously the second kind of thing, and the message always states both the
current spend and the limit, so the block is self-explanatory without a separate lookup.

**The `x-user-id` header convention.** With real authentication explicitly out of scope for this
phase (spec §14 — `userId` is a request-supplied parameter, not a JWT claim), the guard needs _some_
way to know who's calling. `resolveUserId()` (`src/common/utils/resolve-user-id.util.ts`) checks
the `x-user-id` request header first, falling back to `body.userId` — this exact function is shared
between `ModerationGuard` and `CostBudgetGuard`, extracted specifically so both guards resolve
identity identically:

```typescript
// src/common/utils/resolve-user-id.util.ts
export function resolveUserId(request: Request): string | undefined {
  const header = request.headers['x-user-id'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header)) return header[0];

  const body = request.body as Record<string, unknown> | undefined;
  const bodyUserId = body?.['userId'];
  return typeof bodyUserId === 'string' ? bodyUserId : undefined;
}
```

**What happens with no userId: the guard passes, unenforced.** If neither the header nor the body
supplies an identity, `checkBudget()` is never even called — `canActivate()` returns `true`
immediately. This is a deliberate, documented boundary: enforcement is exactly as strong as the
identity signal available, and with no real auth in this phase, an anonymous request genuinely has
nothing to budget against. It's a Phase 4 scope boundary, not a bug to be fixed inside this phase.

### Guard ordering: why moderation runs before budget

```typescript
// src/modules/ai-chat/chat.controller.ts
@UseGuards(ModerationGuard, CostBudgetGuard)
@ModerateField('content', 'chat')
@UseInterceptors(OutputModerationInterceptor)
@ModerateOutputField('content', 'chat')
@Post('conversations/:publicId/messages')
async sendMessage(...) { ... }
```

`@UseGuards()` accepts multiple guards in a single call, and NestJS runs them **in the order
listed**. `ModerationGuard` always runs before `CostBudgetGuard` on every gated route — a deliberate
choice, not an incidental one: a request that moderation would reject anyway should never be charged
against a user's budget. Charging first and moderating second would mean a user could burn through
their daily limit sending messages that were always going to be rejected. Both `chat.controller.spec.ts`
and `rag.controller.spec.ts` carry a structural regression test that reads
`Reflect.getMetadata('__guards__', ...)` directly and asserts the array is exactly `[ModerationGuard,
CostBudgetGuard]` on every gated route — pinning the order against an accidental future reorder, not
just testing that both guards exist.

---

## OpenaiService Moderation Extension

### `moderateText()` and the retry/audit pipeline

```typescript
// src/modules/openai/services/openai.service.ts
async moderateText(input: string): Promise<ModerationResult> {
  this.ensureConfigured();
  const response = await this.executeModeration({
    input, requestId: crypto.randomUUID(), auditUserMessage: input,
  });
  return this.toModerationResult(response.results[0]);
}

async moderateBatch(inputs: string[]): Promise<ModerationResult[]> {
  this.ensureConfigured();
  const response = await this.executeModeration({
    input: inputs, requestId: crypto.randomUUID(), auditUserMessage: inputs[0] ?? '',
  });
  return response.results.map((result) => this.toModerationResult(result));
}

private toModerationResult(result: OpenAI.Moderations.Moderation | undefined): ModerationResult {
  return {
    flagged: result?.flagged ?? false,
    categories: (result?.categories as unknown as Record<string, boolean>) ?? {},
    categoryScores: (result?.category_scores as unknown as Record<string, number>) ?? {},
  };
}
```

Both share a private `executeModeration()` tail — structurally parallel to `executeCompletion()`
(Phase 1) and `executeEmbedding()` (Phase 3), the same `RetryService.executeWithRetry()` →
`AiAuditService.log()` → `mapError()` shape every SDK-calling method in this codebase follows:

```typescript
private async executeModeration(params: {
  input: string | string[]; userId?: string; requestId: string; auditUserMessage: string;
}): Promise<OpenAI.Moderations.ModerationCreateResponse> {
  const retryTracker = { retryCount: 0 };
  const startTime = Date.now();
  const staticMode = this.config.get<boolean>('openai.moderationStaticMode') ?? false;

  try {
    const response = await this.retryService.executeWithRetry(
      () => staticMode
        ? Promise.resolve(buildStaticModerationResponse(params.input))
        : this.moderationClient.moderations.create({ input: params.input }),
      retryTracker,
    );

    void this.auditService.log({
      requestId: params.requestId, userId: params.userId, model: response.model,
      endpoint: OpenAIEndpoint.MODERATIONS,
      userMessage: this.truncateForAudit(params.auditUserMessage),
      inputTokens: 0, outputTokens: 0, totalTokens: 0,
      estimatedCost: 0,                                          // moderation is free
      latencyMs: Date.now() - startTime,
      status: AiAuditStatus.SUCCESS, retryCount: retryTracker.retryCount,
    });
    return response;
  } catch (error) {
    // ... identical FAILED-status audit write, then throw this.mapError(error)
  }
}
```

**How it reuses retry and audit, with zero new logic:** `RetryService.executeWithRetry()` wraps
the raw `moderations.create()` call exactly the way it wraps `chat.completions.create()` — the same
backoff-with-jitter, the same 429/500/503-retryable classification, the same shared circuit
breaker. A moderation call that trips the circuit throws the identical `CircuitOpenException` chat
completions already produce. `AiAuditService.log()` writes to the _same_ `ai_audit_logs` table,
with `endpoint: 'moderations'` (`OpenAIEndpoint.MODERATIONS` — defined since Phase 1, unused until
this phase) as the only structural difference from a chat-completion row.

### Why moderation is free (`$0` per call)

`estimatedCost` is hardcoded to `0` on every audit row this method writes — never routed through
`TokenService.calculateCost()` the way completions and embeddings are. OpenAI's moderation endpoint
genuinely has no per-call price, and analytics must never attribute cost to a free endpoint just
because it happened to log through the same table. `getSpendByFeature()` (Cost Analytics) reflects
this directly: a `moderations` row in that breakdown always shows `totalCost: 0`, by construction —
not because no one's using it, but because moderation calls are free by design.

### The OpenRouter/static mode workaround

The PRD flagged, as its single biggest open risk, that OpenRouter (this project's default
`OPENAI_BASE_URL`) might not actually proxy `POST /moderations` the way it proxies chat completions
and embeddings. A live probe settled it decisively: `curl -X POST
"https://openrouter.ai/api/v1/moderations"` returned **404 with `content-type: text/html`** — a
Cloudflare-served marketing-site 404 page, not a JSON API error — while `GET /models` and `POST
/chat/completions` on the exact same base URL both returned 200. **OpenRouter simply doesn't expose
a `/moderations` route at all.**

The fix, confined entirely to `OpenaiModule` so `ModerationModule` never has to know or care which
upstream actually serves moderation:

```typescript
// src/modules/openai/openai.module.ts
{
  provide: MODERATION_CLIENT,
  inject: [ConfigService, OPENAI_CLIENT],
  useFactory: (config: ConfigService, primaryClient: OpenAI) =>
    resolveModerationClient({
      moderationApiKey: config.get<string>('openai.moderationApiKey'),
      moderationApiBaseUrl: config.get<string>('openai.moderationApiBaseUrl'),
      timeoutMs: config.get<number>('openai.timeoutMs'),
      primaryClient,
    }),
},
```

```typescript
// src/modules/openai/utils/resolve-moderation-client.util.ts
export function resolveModerationClient(params: {
  moderationApiKey: string | undefined;
  moderationApiBaseUrl: string | undefined;
  timeoutMs: number | undefined;
  primaryClient: OpenAI;
}): OpenAI {
  if (!params.moderationApiKey) {
    return params.primaryClient; // zero behavior change for a deployment that never sets it
  }
  return new OpenAI({
    apiKey: params.moderationApiKey,
    baseURL: params.moderationApiBaseUrl || undefined,
    timeout: params.timeoutMs,
  });
}
```

`OpenaiService` gained a second constructor dependency, `@Inject(MODERATION_CLIENT)
moderationClient`, and `executeModeration()` calls `this.moderationClient.moderations.create(...)`
instead of `this.openaiClient...`. When `MODERATION_API_KEY` is unset (the default, and every
existing deployment's actual state), `MODERATION_CLIENT` resolves to the **exact same instance** as
`OPENAI_CLIENT` — nothing changes at all unless a deployment explicitly opts in.

**Static mode — a narrow escape hatch for testing without real API access.** A direct OpenAI key
was available to genuinely prove the fallback client, but the account had zero billing credit
(`429 Too Many Requests` — OpenAI's generic quota-exceeded error, _not_ a 401/403, which is
important: authentication succeeded, only billing failed). Rather than leave the moderation
pipeline entirely unprovable end-to-end, `MODERATION_STATIC_MODE=true` makes `executeModeration()`
skip the network and call a pure function instead:

```typescript
// src/modules/openai/utils/static-moderation-fixture.util.ts
export function buildStaticModerationResponse(
  input: string | string[],
): OpenAI.Moderations.ModerationCreateResponse {
  const fixture = loadFixture(); // fixtures/static-moderation-responses.json
  const inputs = Array.isArray(input) ? input : [input];
  const results = inputs.map((text) =>
    isFlaggedInput(text, fixture.flaggedKeywords) ? fixture.flagged : fixture.clean,
  );
  return {
    id: 'static-fixture',
    model: fixture.model,
    results,
  } as unknown as OpenAI.Moderations.ModerationCreateResponse;
}
```

A simple keyword match (`hurt`, `kill`, `attack`, `weapon`, `suicide`, ...) against a small curated
fixture picks between a canned "flagged" and "clean" OpenAI-shaped response, so both branches of the
real pipeline stay exercisable through the real HTTP surface with no network call at all. It's a
single `if` branch inside the existing `retryService.executeWithRetry()` call — the surrounding
try/catch/audit-logging tail is completely unchanged, a static-mode call still produces a real
`ai_audit_logs` row (`model: 'static-fixture-moderation'`, clearly distinguishable from a genuine
call), and a mandatory `logger.warn()` fires on every use so static mode can never silently
masquerade as live behavior in application logs. Default is `false` — opt-in only.

---

## Database Schema

### `moderation_logs`

```prisma
model ModerationLog {
  id             BigInt   @id @default(autoincrement())
  publicId       String   @unique @default(uuid())
  requestId      String?
  userId         String?
  direction      String
  content        String
  isFlagged      Boolean
  categories     Json     @db.JsonB
  categoryScores Json     @db.JsonB
  action         String
  source         String
  metadata       Json?    @db.JsonB
  createdAt      DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@index([isFlagged])           // migration adds WHERE "isFlagged" = true — a partial index
  @@map("moderation_logs")
}
```

One row per moderation check, ever — clean or flagged, input or output, guard-initiated or a
standalone API call. Append-only, exactly like Phase 1's `ai_audit_logs`: no `updatedAt` column,
because a moderation decision is never revised after the fact.

- **`direction`/`action`/`source` are plain strings, not database enum types** — validated at the
  service layer (`ModerationDirection`/`ModerationAction` as-const objects), the same convention
  `Document.sourceType`/`embeddingStatus` already established in Phase 3. Adding a new source (a
  future feature moderating its own input) never needs a migration.
- **`categories`/`categoryScores` are non-nullable `Json @db.JsonB`** — every check, flagged or not,
  always has a full category map, so there's no null case to design around.
- **The partial index on `isFlagged`** (`WHERE "isFlagged" = true`) exists because the real
  operational query this table serves is "show me the violations," not "show me everything" — a
  full index over a column that's `false` for the overwhelming majority of rows would waste space
  indexing values nobody queries for. Prisma's schema DSL can't express a partial index
  (`@@index([isFlagged])` is declared plain in `schema.prisma`), so the `WHERE` clause is added by
  hand in the migration SQL — the exact same divergence Phase 1's own `ai_audit_logs.status` partial
  index already established as this codebase's precedent.

### Why `content` is truncated to 1,000 characters

```typescript
private truncateContent(content: string): string {
  return content.length > MAX_LOG_CONTENT_LENGTH  // 1000
    ? content.slice(0, MAX_LOG_CONTENT_LENGTH)
    : content;
}
```

There's no database-level length constraint on the column — the truncation happens entirely in
`ModerationService` before the write. The audit trail needs to show _what was checked_, not store an
unbounded copy of every message a potentially high-volume, free endpoint ever sees. 1,000 characters
is comfortably enough to recognize a violation and its context without treating this table as a
second, unbounded copy of the actual conversation content (which `chat_messages` already stores,
under its own separate retention policy).

### `user_cost_budgets`

```prisma
model UserCostBudget {
  id              BigInt   @id @default(autoincrement())
  publicId        String   @unique @default(uuid())
  userId          String   @unique
  dailyLimitUsd   Float?
  monthlyLimitUsd Float?
  isActive        Boolean  @default(true)
  alertThreshold  Float    @default(0.8)
  metadata        Json?    @db.JsonB
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("user_cost_budgets")
}
```

Mutable, unlike the append-only log tables — a budget's limits genuinely change over time, so it
carries a real `updatedAt`.

### Why budgets are one-per-`userId`

`userId String @unique` is the whole enforcement mechanism for "exactly one budget row per user."
`createBudget()` relies on this at the database level rather than checking for an existing row
first — attempting to insert a second budget for a `userId` that already has one throws Postgres's
`P2002` unique-constraint violation, which `CostBudgetService` catches and re-throws as a `409
ConflictException`:

```typescript
async createBudget(dto: CreateBudgetDto): Promise<BudgetEntity> {
  try {
    const budget = await this.databaseService.userCostBudget.create({ data: { ... } });
    this.invalidateSpendCache(dto.userId);
    return this.toEntity(budget);
  } catch (error) {
    if (this.isP2002(error)) {
      throw new ConflictException(`Budget for userId "${dto.userId}" already exists`);
    }
    throw error;
  }
}
```

A user having two simultaneous budget rows would make "check the budget" ambiguous — which one
applies? — so the schema makes the ambiguous state simply unrepresentable, rather than handling it
in application logic every time a budget is read.

---

## All API Endpoints — With Usage Examples

All 20 routes are **unauthenticated**, matching every prior phase's explicit out-of-scope decision
on auth. Every successful response is wrapped by the global `ResponseInterceptor` (`{ success:
true, data: {...}, timestamp }`) — examples below show the `data` payload only.

### Group: Moderation

#### 1. `POST /api/v1/moderation/check`

```bash
curl -X POST http://localhost:3000/api/v1/moderation/check \
  -H "Content-Type: application/json" \
  -d '{ "text": "Hello, how are you today?" }'
```

Response (`ModerationResultResDto`, `201`):

```json
{
  "isFlagged": false,
  "categories": {
    "hate": false,
    "violence": false,
    "sexual": false,
    "harassment": false,
    "self-harm": false
  },
  "categoryScores": {
    "hate": 0.0002,
    "violence": 0.0001,
    "sexual": 0.0001,
    "harassment": 0.001,
    "self-harm": 0.0
  },
  "flaggedCategories": [],
  "highestScore": { "category": "harassment", "score": 0.001 }
}
```

#### 2. `POST /api/v1/moderation/check-batch`

```bash
curl -X POST http://localhost:3000/api/v1/moderation/check-batch \
  -H "Content-Type: application/json" \
  -d '{ "texts": ["Hello!", "I want to hurt someone"] }'
```

Response: `ModerationResultResDto[]`, `201` — one result per input, in order, up to 50 texts per
call (`@ArrayMaxSize(50)` on `CheckBatchModerationDto`).

#### 3. `GET /api/v1/moderation/logs`

```bash
curl "http://localhost:3000/api/v1/moderation/logs?isFlagged=true&direction=input&page=1&limit=20"
```

Response (`PaginatedModerationLogsResDto`, `200`): `{ data: ModerationLogResDto[], total, page,
limit }`. Filterable by `userId`, `isFlagged`, `direction` (`input`/`output`), `source`, and a
`startDate`/`endDate` range.

#### 4. `GET /api/v1/moderation/stats`

```bash
curl "http://localhost:3000/api/v1/moderation/stats?startDate=2026-07-01"
```

Response (`ModerationStatsResDto`, `200`):

```json
{
  "totalChecks": 33,
  "flaggedCount": 4,
  "violationRate": 0.121,
  "byDirection": { "input": 29, "output": 4 },
  "topCategories": [{ "category": "violence", "count": 4 }]
}
```

### Group: Cost Budgets

#### 5. `POST /api/v1/cost/budgets`

```bash
curl -X POST http://localhost:3000/api/v1/cost/budgets \
  -H "Content-Type: application/json" \
  -d '{ "userId": "demo-user", "dailyLimitUsd": 1.00, "monthlyLimitUsd": 20.00, "alertThreshold": 0.8 }'
```

Response (`BudgetResDto`, `201`). A second `POST` for the same `userId` returns `409 Conflict`.

#### 6. `GET /api/v1/cost/budgets`

```bash
curl "http://localhost:3000/api/v1/cost/budgets?isActive=true&page=1&limit=20"
```

Response (`PaginatedBudgetsResDto`, `200`).

#### 7. `GET /api/v1/cost/budgets/alerts`

```bash
curl http://localhost:3000/api/v1/cost/budgets/alerts
```

Response: `BudgetAlertResDto[]`, `200` — every active-budget user whose spend has crossed their
alert threshold. **Must stay declared before `GET /cost/budgets/:userId`** in the controller —
NestJS matches routes in declaration order, so a later position would match the literal path
segment `alerts` as a `:userId` value. A structural test pins both the method declaration order and
each route's actual metadata path, so neither a reorder nor a rename silently breaks this.

#### 8. `GET /api/v1/cost/budgets/:userId`

```bash
curl http://localhost:3000/api/v1/cost/budgets/demo-user
```

Response (`BudgetStatusResDto`, `200`) — the budget merged with live spend and a derived status:

```json
{
  "userId": "demo-user",
  "dailySpend": 0.45,
  "monthlySpend": 3.1,
  "dailyLimit": 1.0,
  "monthlyLimit": 20.0,
  "dailyPercentage": 45,
  "monthlyPercentage": 15.5,
  "status": "within_budget"
}
```

`status` is `within_budget` / `approaching_limit` / `exceeded`, derived from the same
`checkBudget()` result the guard uses. `404` for a `userId` with no budget row at all.

#### 9. `PATCH /api/v1/cost/budgets/:publicId`

```bash
curl -X PATCH http://localhost:3000/api/v1/cost/budgets/5f25ba6c-b42c-4394-96e3-67bc58fa6036 \
  -H "Content-Type: application/json" \
  -d '{ "dailyLimitUsd": 2.00 }'
```

Response: `BudgetResDto`, `200` — the spend cache is invalidated for this `userId` immediately, so
the new limit is enforced on the very next check.

#### 10. `DELETE /api/v1/cost/budgets/:publicId`

```bash
curl -X DELETE http://localhost:3000/api/v1/cost/budgets/5f25ba6c-b42c-4394-96e3-67bc58fa6036 -i
```

`204 No Content` — a genuine hard delete; the user has no budget row at all afterward, which
`checkBudget()` reads as unlimited.

### Group: Cost Analytics

#### 11. `GET /api/v1/cost/analytics/by-user`

```bash
curl "http://localhost:3000/api/v1/cost/analytics/by-user?sortOrder=desc&page=1&limit=20"
```

Response (`SpendByUserResDto`, `200`):

```json
{
  "data": [
    { "userId": "anonymous", "totalCost": 0.001182, "totalTokens": 373968, "callCount": 346 }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

#### 12. `GET /api/v1/cost/analytics/by-model`

```bash
curl http://localhost:3000/api/v1/cost/analytics/by-model
```

Response (`SpendByModelResDto`, `200`) — spend-descending, no pagination.

#### 13. `GET /api/v1/cost/analytics/by-feature`

```bash
curl http://localhost:3000/api/v1/cost/analytics/by-feature
```

Response (`SpendByFeatureResDto`, `200`):

```json
{
  "data": [
    {
      "feature": "chat",
      "endpoint": "chat.completions",
      "totalCost": 0.0011,
      "totalTokens": 373000,
      "callCount": 320
    },
    {
      "feature": "moderations",
      "endpoint": "moderations",
      "totalCost": 0,
      "totalTokens": 0,
      "callCount": 33
    }
  ]
}
```

#### 14. `GET /api/v1/cost/analytics/timeline`

```bash
curl "http://localhost:3000/api/v1/cost/analytics/timeline?startDate=2026-07-01&endDate=2026-07-11"
```

Response (`SpendTimelineResDto`, `200`) — one entry per UTC calendar day in range, zero-filled where
there's no spend:

```json
{ "data": [{ "date": "2026-07-11", "totalCost": 0.0109, "totalTokens": 2039, "callCount": 24 }] }
```

#### 15. `GET /api/v1/cost/analytics/daily-trend`

```bash
curl "http://localhost:3000/api/v1/cost/analytics/daily-trend?days=7"
```

Response: same `SpendTimelineResDto` shape as `timeline` (they share one DTO, since both service
methods return identical daily buckets) — the trailing N days, clamped to `1`–`365`.

#### 16. `GET /api/v1/cost/analytics/projected`

```bash
curl http://localhost:3000/api/v1/cost/analytics/projected
```

Response (`ProjectedSpendResDto`, `200`):

```json
{
  "monthToDate": 0.001182,
  "dailyAverage": 0.0001075,
  "daysElapsed": 11,
  "daysInMonth": 31,
  "projected": 0.003332
}
```

### Group: Data Retention

#### 17. `GET /api/v1/retention/config`

```bash
curl http://localhost:3000/api/v1/retention/config
```

Response (`RetentionConfigResDto`, `200`):

```json
{
  "auditDays": 90,
  "moderationDays": 90,
  "archivedConversationDays": 30,
  "embeddingCacheDays": 180,
  "cron": "0 2 * * *"
}
```

#### 18. `PATCH /api/v1/retention/config`

```bash
curl -X PATCH http://localhost:3000/api/v1/retention/config \
  -H "Content-Type: application/json" \
  -d '{ "auditDays": 7 }'
```

Response: `RetentionConfigResDto`, `200` — a re-read of the config after applying the override.
Sending `{ "cron": "0 3 * * *" }` returns `400` (`forbidNonWhitelisted` — `cron` isn't even declared
on `UpdateRetentionConfigDto`). Changes are in-memory only; a server restart resets them.

#### 19. `POST /api/v1/retention/cleanup`

```bash
curl -X POST http://localhost:3000/api/v1/retention/cleanup
```

Response (`RetentionReportResDto`, `201`):

```json
{
  "auditLogs": { "deleted": 4, "failed": false },
  "moderationLogs": { "deleted": 1, "failed": false },
  "archivedConversations": { "deleted": 1, "failed": false },
  "embeddingCache": { "deleted": 0, "failed": false },
  "totalDeleted": 6,
  "ranAt": "2026-07-11T05:12:00.000Z",
  "durationMs": 9
}
```

#### 20. `GET /api/v1/retention/stats`

```bash
curl http://localhost:3000/api/v1/retention/stats
```

Response (`RetentionStatsResDto`, `200`) — the last run's report (`null` before any run) plus rows
currently past their cutoff:

```json
{
  "lastReport": { "...": "the RetentionReportResDto shown above" },
  "rowsDue": {
    "auditLogs": 0,
    "moderationLogs": 0,
    "archivedConversations": 0,
    "embeddingCache": 0
  }
}
```

---

## Content Moderation Deep Dive

### OpenAI's moderation API: categories, scores, how it works

OpenAI's moderation endpoint takes a piece of text and returns a score (0–1) for each of eleven
content categories, plus a boolean for each saying whether OpenAI's own model considers it flagged:

```typescript
// ModerationCategory (src/modules/moderation/constants/moderation-category.constant.ts)
('hate',
  'hate/threatening',
  'harassment',
  'harassment/threatening',
  'self-harm',
  'self-harm/intent',
  'self-harm/instructions',
  'sexual',
  'sexual/minors',
  'violence',
  'violence/graphic');
```

This app never trusts the API's own top-level `flagged` boolean as the final word — instead,
`ModerationService.buildResult()` re-derives `isFlagged` per category as _either_ OpenAI's own flag
_or_ the score clearing `MODERATION_BLOCK_THRESHOLD` (default `0.7`), whichever fires first. That
threshold is the one knob an operator can turn without OpenAI ever changing anything on their end —
lowering it makes the app stricter than OpenAI's own default judgment; raising it makes it more
permissive.

### The fail-open decision — API error lets the request through, a flag blocks it

These are two entirely different failure modes, handled two entirely different ways:

| What happened                                                                       | What the app does                                                                            | Why                                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The moderation _API call itself_ failed (network error, 500, timeout after retries) | **Fail open** — return a clean result, log the gap loudly (`metadata: { failedOpen: true }`) | A free, auxiliary safety endpoint hiccuping should never take down the product's core AI features. |
| The moderation _check_ succeeded and the content _is flagged_                       | **Block** — 422 (input) or replace (output)                                                  | This is the check working correctly; blocking is the entire point.                                 |

The distinction matters because "the moderation system had an outage" and "the moderation system
did its job and found a violation" are opposite outcomes that would look identical if you only
checked "did the request get blocked?" — this codebase's design deliberately keeps them
distinguishable both in behavior (fail open vs. block) and in the log (`metadata.failedOpen`).

### Input vs. output moderation — when and why each applies

**Input moderation is on by default** (`MODERATION_ENABLED=true`, `MODERATION_INPUT_ENABLED=true`)
because it's cheap to reason about: check the user's message before spending anything on it. It's a
guard, runs before every gated route's handler, and rejects with 422.

**Output moderation is opt-in, off by default** (`MODERATION_OUTPUT_ENABLED=false`) because it
roughly doubles moderation-API traffic per request and — as this project's own live verification
found — has a real limitation worth knowing before turning it on:

> **Live finding: output moderation redacts the client's immediate response, but not persisted
> history.** With output moderation enabled, a genuinely flaggable model answer was correctly
> replaced in the response the client received _for that request_ — and the `moderation_logs` row
> correctly preserved the original text (`action: 'replaced'`). But `GET
/chat/conversations/:publicId`, fetched afterward, returns the **original, unredacted** answer.
> Why: `ChatService.sendMessage()` persists the assistant message to `chat_messages` _inside the
> handler_, before `OutputModerationInterceptor` ever runs on the returned response —
> interceptors wrap a handler's _return value_, they can't reach back and change what the handler
> already wrote to the database. A client reading the initial POST response is protected; a client
> re-fetching conversation history later sees the real text. This is documented as an open Follow
> Up (redact at read time, or persist the redacted text and lose the audit-preserved original — a
> real design tradeoff, not a one-line bug), and it was never previously exercisable live because no
> prior session had enabled `MODERATION_OUTPUT_ENABLED` before this.

### Static mode for testing without real API access

Covered in full under [The OpenRouter/static mode workaround](#the-openrouterstatic-mode-workaround)
above — `MODERATION_STATIC_MODE=true` swaps the live API call for a keyword-matched canned fixture,
letting both the flagged and clean branches of the entire pipeline (guard → service → interceptor →
log) be exercised through the real HTTP surface with zero network calls and zero billing.

### The SSE streaming limitation

`OutputModerationInterceptor` works by wrapping a handler's _returned value_ — but
`ChatController.sendMessageStream()` (Phase 2) uses a raw `@Res()` parameter and writes SSE frames
directly to the response stream, bypassing NestJS's normal interceptor-mapping pipeline entirely
(the same reason the _global_ `ResponseInterceptor`'s envelope never applies to it either). There is
no single "return value" for an interceptor to inspect on that route — the response is a sequence of
frames written imperatively, not one object returned once. Consequently, `sendMessageStream()` only
ever gets `@UseGuards(ModerationGuard, CostBudgetGuard)` — input moderation and budget enforcement
both apply — but never `@UseInterceptors(OutputModerationInterceptor)`. This is a documented,
deliberate scope boundary from the PRD, not a gap discovered by accident: streaming output
moderation is a natural candidate for a future phase, requiring token-by-token or end-of-stream
inspection logic this phase's interceptor-based design doesn't attempt.

---

## Cost Budget Deep Dive

### Budget enforcement flow with in-memory cache

```
CostBudgetGuard.canActivate()
  │
  ├─▶ isEnabled()?  no → return true (zero calls)
  ├─▶ resolveUserId(request)  none → return true (zero calls)
  │
  └─▶ CostBudgetService.checkBudget(userId)
        │
        ├─▶ isEnabled()?  no → unrestrictedResult()
        ├─▶ findUnique({ userId })  no row / isActive: false → unrestrictedResult()
        │
        └─▶ getCachedSpend(userId)
              cache hit (within TTL)?  → return cached { dailySpend, monthlySpend }
              cache miss / expired?    → 2 parallel getUserSpend() aggregate queries,
                                          cache the result for costBudget.cacheTtlMs (default 60s)
              │
              └─▶ compare spend against dailyLimitUsd/monthlyLimitUsd
                    exceeded either? → { allowed: false, ... }  → guard throws 429
                    near either (≥ alertThreshold × limit)? → { allowed: true, warning: "..." }
                    otherwise → { allowed: true }
```

### 60-second cache TTL tradeoff

Checking budget on _every single AI request_ by running two `SUM(estimatedCost)` aggregate queries
against `ai_audit_logs` would add a real, avoidable latency cost to every chat/RAG call — and at
any real volume, would mean thousands of nearly-identical aggregate queries per user per day. The
cache turns this into a `Map` lookup for the overwhelming majority of requests, at the cost of
accepting **up to one TTL's worth of overshoot past a limit** — a user could, in the worst case,
spend past their budget by however much they can spend in 60 seconds before the next cache refresh
catches up. This is an explicit, documented tradeoff (NFR-COST-001's stated acceptance), not an
oversight — for a learning project with no real payment processor behind it, bounded overshoot is
categorically preferable to adding meaningful per-request latency to every gated call. A production
system handling real money would likely need a tighter TTL, a push-based invalidation on every
write, or both.

### Daily/monthly spend calculation from audit logs

Both periods are computed with pure UTC arithmetic (`Date.UTC(...)`), never a local-time method —
covered in full under [CostBudgetService](#costbudgetservice--budget-crud-spend-aggregation-cached-enforcement)
above. The practical consequence: "midnight" and "the first of the month" mean the same real-world
instant no matter what timezone the server process happens to be running in, which matters a great
deal for a budget that's supposed to reset predictably.

### Alert threshold and warning headers

`alertThreshold` (default `0.8`, i.e. 80%) is per-budget, not global — a cautious user can set it
lower to get warned earlier. Once spend crosses `alertThreshold × limit` while still under the hard
limit, `checkBudget()` sets a `warning` string, and the guard surfaces it as a response header
rather than blocking anything:

```typescript
if (result.warning) {
  const response = context.switchToHttp().getResponse<Response>();
  response.setHeader('X-Budget-Warning', result.warning);
}
```

A client that never inspects response headers experiences nothing different at all — the warning is
purely additive, discoverable, and never disruptive.

### What happens with no `userId`

Covered above under [CostBudgetGuard](#costbudgetguard--how-429-works-the-x-user-id-header-convention)
— the guard resolves `userId` via the shared `resolveUserId()` util and, finding none, returns
`true` immediately with zero calls to `CostBudgetService` at all. An anonymous request simply isn't
enforceable in a system with no real authentication layer, and that's a documented Phase 4 boundary
rather than an edge case the guard tries to guess around.

---

## Cost Analytics Deep Dive

### The 6 analytics queries and what each tells you

| Query                        | Question it answers                 | Grouping                                  | Paginated?              |
| ---------------------------- | ----------------------------------- | ----------------------------------------- | ----------------------- |
| `getSpendByUser()`           | Who is driving spend?               | `groupBy(['userId'])`                     | Yes, sortable by cost   |
| `getSpendByModel()`          | Which model is expensive?           | `groupBy(['model'])`                      | No                      |
| `getSpendByFeature()`        | Chat vs. embeddings vs. moderation? | `groupBy(['endpoint'])`, mapped to labels | No                      |
| `getSpendTimeline()`         | Spend over an explicit date range   | `$queryRaw` day buckets                   | No (date-range bounded) |
| `getDailySpendTrend()`       | Spend over the trailing N days      | Same as timeline, different window        | No                      |
| `getProjectedMonthlySpend()` | What will this month cost?          | `aggregate()` since month start           | N/A                     |

### Projected monthly spend formula

```
dailyAverage = monthToDate ÷ daysElapsed     (daysElapsed counts today as elapsed)
projected    = dailyAverage × daysInMonth
```

Both `daysElapsed` and `daysInMonth` are computed with `Date.UTC()` arithmetic — `daysInMonth` via
the "day 0 of next month is the last day of this month" trick (`new Date(Date.UTC(year, month + 1,
0)).getUTCDate()`), which correctly handles every month length including February in a leap year
with no month-length lookup table. Zero spend or zero elapsed days both resolve to `projected: 0`,
never `NaN`.

### Revisiting the `$queryRaw` timezone fix

Covered in full under [CostAnalyticsService](#the-queryraw-timezone-fix) above — a real bug found
during live verification (a raw `date_trunc()` timestamp silently shifted by the deployment's local
timezone) and fixed by having the SQL return pre-formatted `'YYYY-MM-DD'` text instead of a
`Date`-parsed column, eliminating the entire bug class rather than special-casing one symptom.

### Feature attribution from the `endpoint` column

`ai_audit_logs.endpoint` records exactly one of three values — `chat.completions`, `embeddings`,
`moderations` — and `FEATURE_LABELS` maps them to human-readable feature names for
`getSpendByFeature()`. The honest limitation: **chat and RAG generation calls are indistinguishable
at this layer.** Both `ChatService.sendMessage()` (Phase 2) and `RagService.query()` (Phase 3) call
the identical `OpenaiService.chatCompletionWithMessages()` seam and log identically as
`chat.completions` — there is no audit-row column recording which feature initiated the call. This
was a deliberate no-new-audit-column decision for this phase (adding one would mean touching Phase
2 and Phase 3's own call sites, a bigger change than a governance layer should need), and the
response DTO's own field description states the limitation directly rather than silently folding RAG
spend into "chat" with no explanation.

---

## Data Retention Deep Dive

### The 4 cleanup categories with retention periods

| Category               | Default retention | Cutoff field | Extra safety condition                                                  |
| ---------------------- | ----------------- | ------------ | ----------------------------------------------------------------------- |
| Audit logs             | 90 days           | `createdAt`  | none — pure age                                                         |
| Moderation logs        | 90 days           | `createdAt`  | none — pure age                                                         |
| Archived conversations | 30 days           | `updatedAt`  | **`isArchived: true`** — active conversations are never eligible at all |
| Embedding cache        | 180 days          | `createdAt`  | none — pure age (see below for why)                                     |

### Batch deletion for performance

Every cleanup method delegates to one shared `runBatchedDelete()` helper (covered in full under
[RetentionService](#retentionservice--batched-cleanup-cron-scheduling-in-memory-config) above),
paging ids ascending in chunks of 1,000, deleting each page by id, and stopping the moment a page
comes back shorter than the batch size. A 2,500-row backlog issues exactly 3 `findMany`+`deleteMany`
pairs — one per full batch, one short final batch — never one unbounded `deleteMany` over however
large the backlog happens to be (NFR-RET-001's stated bound: a 100K-row backlog must finish within
five minutes without long-held locks).

### Safety: why active conversations are structurally untouchable

This is the single most important property in the whole retention system, and it's enforced by
_omission_, not by a runtime check: **there is no method anywhere in `RetentionService` that can
delete a non-archived conversation.** `cleanupArchivedConversations()` is the only
conversation-deleting method that exists, and its `where` clause hard-codes `isArchived: true`
alongside the age cutoff — both conditions, not just one. A misconfigured `RETENTION_ARCHIVED_CONVERSATION_DAYS=1`
can only ever accelerate cleanup of conversations a user has already explicitly archived; it cannot
touch a conversation still in active use, no matter how old that conversation is. The same principle
extends to documents and document chunks (Phase 3) — no cleanup method for either exists at all, so
there's nothing a retention config, however aggressive, could ever delete.

Live verification proved this directly rather than assuming it: an old-but-active (never archived)
conversation, artificially back-dated well past the archived-conversation cutoff, survived a real
cleanup run untouched, while an equally old _archived_ conversation and every other back-dated row
across all four categories were correctly deleted.

### Cron scheduling via `SchedulerRegistry`

Covered in full under [RetentionService](#retentionservice--batched-cleanup-cron-scheduling-in-memory-config)
above. The short version: a static `@Cron('0 2 * * *')` decorator can't read `RETENTION_CRON` from
runtime config, so the job is registered dynamically inside `onModuleInit()` via
`SchedulerRegistry.addCronJob()`, guarded against double-registration so `npm run dev`'s file-watch
re-init doesn't crash on a duplicate job name.

### In-memory config overrides

`PATCH /retention/config` accepts new values for the four retention-day fields (never `cron` — that
one's rejected outright, both by the DTO not declaring the field at all and by
`updateRetentionConfig()`'s own explicit check) and holds them in a plain in-memory object that's
reset the moment the process restarts. This is a documented, not-persisted tradeoff for a learning
project with no operator-facing config UI that would need the setting to survive a redeploy — a
future phase adding real operational tooling would likely want to persist these instead.

---

## How All 4 Phases Connect

### Full system diagram

```
AppModule
│
├── OpenaiModule                          Phase 1 — chat completions, embeddings*, moderation*
│   exports: OPENAI_CLIENT, OpenaiService, AiAuditService, TokenService, ModelRegistryService
│   (*embeddings added Phase 3, moderation added Phase 4 — same service, same rules, all along)
│
├── AiChatModule                          Phase 2 — multi-turn chat, streaming, function calling
│   imports: OpenaiModule, HttpModule, ModerationModule, CostManagementModule   (last 2: Phase 4)
│   exports: ChatService
│
├── RagModule                             Phase 3 — document ingestion, semantic search, RAG Q&A
│   imports: OpenaiModule, AiChatModule, ModerationModule, CostManagementModule (last 2: Phase 4)
│   exports: (none)
│
├── ModerationModule                      Phase 4 — content moderation
│   imports: OpenaiModule
│   exports: ModerationService, ModerationGuard, OutputModerationInterceptor
│
└── CostManagementModule                  Phase 4 — budgets, analytics, retention
    imports: (none)
    exports: CostBudgetService, CostBudgetGuard
```

Every arrow points strictly downward/rightward in phase order — Phase 4 imports from Phases 1–3,
Phase 3 imports from Phases 1–2, Phase 2 imports from Phase 1, and Phase 1 imports from nothing.
Not one earlier phase has ever needed to know a later phase exists, four phases in.

### Request lifecycle with all guards and interceptors

```
POST /chat/conversations/:id/messages   (or POST /rag/ask, /rag/ask/conversation/:id)
  │
  ▼
RequestLoggerMiddleware                       (Phase 1 — requestId, method/url/duration logging)
  │
  ▼
ModerationGuard                               (Phase 4 — 422 if flagged, else continue)
  │
  ▼
CostBudgetGuard                               (Phase 4 — 429 if over budget, else continue)
  │
  ▼
ValidationPipe                                (Phase 1 — DTO shape/type validation)
  │
  ▼
ChatController.sendMessage() / RagController.ask()   (Phase 2 / Phase 3 — UNMODIFIED business logic)
  │    → ChatService/RagService → OpenaiService.chatCompletionWithMessages()
  │        → RetryService (Phase 1) → AiAuditService.log() (Phase 1) → ai_audit_logs row written
  │
  ▼
OutputModerationInterceptor                   (Phase 4 — replace content if flagged, non-streaming only)
  │
  ▼
ResponseInterceptor                           (Phase 1 — { success, data, timestamp } envelope)
  │
  ▼
HttpExceptionFilter                           (Phase 1 — catches 422/429/any other thrown exception)
  │
  ▼
Response sent to client
```

### Table: every Phase 1 service and how Phases 2–4 use it

| Phase 1 service                           | Phase 2 (Chat)                                            | Phase 3 (RAG)                                                                                      | Phase 4 (Safety)                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenaiService`                           | `chatCompletionWithMessages()` for every turn             | Same method, reused as-is for generation                                                           | `moderateText()`/`moderateBatch()` — 2 new methods, same seam                                                                                                               |
| `RetryService`                            | Inherited transitively via `OpenaiService`                | Inherited transitively via `OpenaiService`/embeddings                                              | Inherited transitively via `OpenaiService`'s moderation calls                                                                                                               |
| `AiAuditService`                          | Every chat completion logged automatically                | Every embedding + RAG generation call logged automatically                                         | Every moderation call logged automatically (`endpoint: 'moderations'`, cost `0`); `ai_audit_logs` is also `CostBudgetService`'s/`CostAnalyticsService`'s entire data source |
| `TokenService`                            | `buildContext()`'s sliding-window token counting          | Token-accurate chunk sizing for `RecursiveCharacterTextSplitter`                                   | Not used directly — Phase 4 never counts tokens itself, only reads `ai_audit_logs.estimatedCost`/`totalTokens` that `TokenService` already computed                         |
| `ModelRegistryService`                    | `contextWindow` lookup for `buildContext()`'s budget math | Same lookup, reused as-is for `queryWithConversation()`                                            | Not used — budgets/analytics operate on dollar amounts already computed by Phase 1, never on model metadata                                                                 |
| `ChatService` (Phase 2, for later phases) | —                                                         | `buildContext()`/`addUserMessage()`/`addAssistantMessage()`/`getConversationHandle()` reused as-is | Not used directly — Phase 4 never calls into chat logic, only wraps `ChatController`'s routes from the outside via guards/interceptor                                       |

The pattern across all three later phases is identical: **extend `OpenaiService` with exactly the
new SDK-calling methods a phase needs (embeddings in Phase 3, moderation in Phase 4), and let
everything downstream inherit retry, audit, and cost tracking for free.** No phase has ever needed
to reimplement resilience or observability — it's baked into the one shared seam every phase calls
through.

---

## Constants, Enums, Environment Variables

### Constants & Enums Reference

| Enum / Constant            | Values                                                                                                                                                                                               | Used for                                                                                                                             | Notes                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ModerationDirection`      | `INPUT` (`'input'`), `OUTPUT` (`'output'`)                                                                                                                                                           | `ModerationLog.direction`                                                                                                            | `as const` object, not a native `enum` — same convention every "enum" in this codebase follows since Phase 3, since `@IsIn()` (not `@IsEnum()`) validates the DTO field. |
| `ModerationAction`         | `ALLOWED`, `BLOCKED`, `REPLACED`                                                                                                                                                                     | `ModerationLog.action`                                                                                                               | `REPLACED` is only ever set by `OutputModerationInterceptor`; the guard only ever sets `BLOCKED`/`ALLOWED`.                                                              |
| `ModerationCategory`       | 11 values (`hate`, `hate/threatening`, `harassment`, `harassment/threatening`, `self-harm`, `self-harm/intent`, `self-harm/instructions`, `sexual`, `sexual/minors`, `violence`, `violence/graphic`) | Documentation/reference only — not a validated field anywhere, since the real category set comes straight from OpenAI's own response | Note the slash-bearing string values paired with plain-identifier keys — a deliberate mismatch matching OpenAI's own category naming exactly.                            |
| `BudgetPeriod`             | `DAILY` (`'daily'`), `MONTHLY` (`'monthly'`)                                                                                                                                                         | `CostBudgetService.getUserSpend()`'s period argument                                                                                 | Internal-only — never exposed on a DTO.                                                                                                                                  |
| `BudgetStatus`             | `WITHIN_BUDGET`, `APPROACHING_LIMIT`, `EXCEEDED`                                                                                                                                                     | `BudgetStatusResDto.status`                                                                                                          | Computed, never stored — derived fresh from a `BudgetCheckResult` on every `GET /cost/budgets/:userId` call.                                                             |
| `RETENTION_CONFIG`         | `auditLogRetentionDays: 90`, `moderationLogRetentionDays: 90`, `archivedConversationRetentionDays: 30`, `embeddingCacheRetentionDays: 180`, `cleanupCron: '0 2 * * *'`                               | Fallback defaults for `RetentionService`, used only when the `retention` config namespace and any in-memory override are both absent | Mirrors `CONTEXT_CONFIG`/`RAG_CONFIG`'s established role from Phases 2–3.                                                                                                |
| `SAFE_REPLACEMENT_MESSAGE` | `"I'm sorry, I can't provide that type of content."`                                                                                                                                                 | The text `OutputModerationInterceptor` substitutes for flagged output                                                                | Verbatim, spec-specified string — not configurable via env var.                                                                                                          |

### Environment Variables

| Variable                               | Required | Default         | Controls                                                                                                                                                                           |
| -------------------------------------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODERATION_ENABLED`                   | No       | `true`          | Master kill switch — `false` disables moderation entirely (zero API calls, zero log rows) for both input and output.                                                               |
| `MODERATION_INPUT_ENABLED`             | No       | `true`          | Whether `ModerationGuard` actually runs its check (still gated by `MODERATION_ENABLED` too).                                                                                       |
| `MODERATION_OUTPUT_ENABLED`            | No       | `false`         | Whether `OutputModerationInterceptor` actually runs its check — the one flag whose default polarity is inverted (opt-in, not opt-out).                                             |
| `MODERATION_BLOCK_THRESHOLD`           | No       | `0.7`           | The per-category score above which content counts as flagged, independent of OpenAI's own `flagged` boolean.                                                                       |
| `MODERATION_API_BASE_URL`              | No       | — (`undefined`) | A moderation-only override base URL, used only when `OPENAI_BASE_URL` (e.g. OpenRouter) doesn't proxy `/moderations`.                                                              |
| `MODERATION_API_KEY`                   | No       | — (`undefined`) | Auth for the moderation-only fallback client. Unset → moderation reuses the exact same primary client as chat/embeddings.                                                          |
| `MODERATION_STATIC_MODE`               | No       | `false`         | When `true`, `moderateText()`/`moderateBatch()` return a canned keyword-matched fixture instead of calling any upstream — for exercising the pipeline without billable API access. |
| `COST_BUDGET_ENABLED`                  | No       | `true`          | Master kill switch for `CostBudgetGuard` — `false` bypasses enforcement entirely, even for a user with an over-limit budget.                                                       |
| `COST_BUDGET_CACHE_TTL_MS`             | No       | `60000`         | How long a user's cached spend snapshot stays valid before the next check re-aggregates from `ai_audit_logs`.                                                                      |
| `RETENTION_AUDIT_DAYS`                 | No       | `90`            | Retention period for `ai_audit_logs` rows.                                                                                                                                         |
| `RETENTION_MODERATION_DAYS`            | No       | `90`            | Retention period for `moderation_logs` rows.                                                                                                                                       |
| `RETENTION_ARCHIVED_CONVERSATION_DAYS` | No       | `30`            | Retention period for **archived** conversations (never active ones).                                                                                                               |
| `RETENTION_EMBEDDING_CACHE_DAYS`       | No       | `180`           | Retention period for `embedding_cache` rows.                                                                                                                                       |
| `RETENTION_CRON`                       | No       | `'0 2 * * *'`   | The cron expression the daily cleanup job registers with — read once at boot, not runtime-updatable via the API.                                                                   |

All fourteen are `@IsOptional()` in `env.validation.ts` — a fresh clone with zero Phase 4 env vars
set boots cleanly and behaves identically to one with every value explicitly set to its default,
exactly the precedent every prior phase's own config additions established. Booting twice — once
with zero Phase 4 env vars, once with `MODERATION_ENABLED=false` explicitly set — both confirmed a
clean boot with no DI errors, verifying the default posture is genuinely safe to ship as-is.

---

## How to Explain This to Others

**One-liner:**

> Phase 4 puts a bouncer at the door and a spending limit on the card — every message gets checked
> before it costs anything, every user has a budget that's actually enforced, and old data cleans
> itself up on a schedule, all without touching a single line of the AI logic underneath.

**30-second version:**

> Phases 1–3 built a complete AI feature surface, but nothing stood between a user and the model —
> any input reached it, any output left it, any user could spend without limit, and every log grew
> forever. Phase 4 adds two new modules that wrap the existing routes from the outside: a
> `ModerationGuard` checks every message against OpenAI's content-policy categories _before_ the
> model ever runs, rejecting flagged input with a 422 and nothing wasted; a matching interceptor
> catches flagged _output_ and swaps it for a safe reply instead of throwing, since that cost is
> already spent. A `CostBudgetGuard` checks a user's real spend — aggregated straight from Phase 1's
> own audit log, cached for 60 seconds so it's fast — against a daily/monthly limit, returning a 429
> with the exact spend and limit when exceeded. A `RetentionService` runs nightly, deleting
> old logs and archived conversations in safe batches, while being structurally incapable of ever
> touching an active conversation. And a `CostAnalyticsService` answers "who's spending what, on
> what, and how much will this month cost" entirely by asking smarter questions of data Phase 1 was
> already collecting. The only edits to any earlier phase's code are eight decorator lines across
> two controllers — everything else is new, additive, and optional to enable.

**2-minute version:**

> Phase 4 adds two modules — `ModerationModule` and `CostManagementModule` — on top of Phase 1's
> `OpenaiModule`, Phase 2's `AiChatModule`, and Phase 3's `RagModule`, following the exact same
> one-way dependency rule every phase has followed: new modules import old ones, never the reverse.
>
> `ModerationService` is the classification-and-logging core: it calls a new `moderateText()`
> method on Phase 1's own `OpenaiService` (following the identical retry/audit/cost pattern
> Phase 3's `generateEmbedding()` set), applies a tunable score threshold to decide what counts as
> flagged, and writes exactly one log row per check — clean or flagged, fire-and-forget, so a
> logging hiccup never breaks the actual request. A moderation _API_ failure fails open (the
> request proceeds, loudly logged); a moderation _flag_ blocks. `ModerationGuard` runs before the
> handler and throws a 422 on flagged input; `OutputModerationInterceptor` runs after the handler
> and _replaces_ flagged output instead of throwing, since by then the generation cost is already
> sunk — that guard-for-input, interceptor-for-output split is the phase's central architectural
> decision.
>
> `CostBudgetService` never adds a spend-tracking table — it aggregates `SUM(estimatedCost)`
> straight from Phase 1's `ai_audit_logs`, cached per-user for 60 seconds (NFR-COST-001) so a
> budget check is a `Map` lookup on the hot path, invalidated immediately on any budget edit so
> limit changes take effect instantly. `CostBudgetGuard` resolves identity from an `x-user-id`
> header (real auth is out of scope for this phase), returns 429 with the exact spend and limit when
> exceeded, and sets a warning header when a user's getting close — never blocking early, only
> informing.
>
> `CostAnalyticsService` is entirely read-only over the same audit table — `groupBy` for by-user/
> by-model/by-feature breakdowns, and the codebase's first raw SQL (`$queryRaw` with
> `date_trunc`) for day-bucketed timelines, since Prisma's `groupBy` can't group by a date
> truncation. Live verification caught a genuine timezone bug here — a raw timestamp column was
> silently misread in the deployment's local timezone — fixed by having the SQL return
> pre-formatted date text instead, eliminating the bug class rather than patching one symptom.
>
> `RetentionService` runs four independent batched cleanups on a nightly cron (dynamically
> registered via `SchedulerRegistry`, since a static decorator can't read a runtime cron
> expression), each bounded to 1,000-row chunks so a huge backlog can't lock the database. The one
> property worth remembering above everything else in this phase: **active conversations,
> documents, and chunks are safe by omission** — no cleanup method for any of them exists at all,
> so a misconfigured retention period, however aggressive, can never destroy live data. Live
> verification proved this directly: an old-but-active conversation survived a real cleanup run
> untouched, while an equally old archived one was correctly deleted.
>
> The only edits to any pre-existing module are decorator lines on two routes each in
> `ChatController` and `RagController` — `@UseGuards(ModerationGuard, CostBudgetGuard)` (moderation
> always first, so a request moderation would reject is never charged against a budget) plus
> `@UseInterceptors(OutputModerationInterceptor)` on the non-streaming routes only, since the SSE
> streaming route bypasses Nest's interceptor-mapping model entirely and can't be output-moderated
> in this phase's design. Every one of Phase 1–3's own test suites stayed green, unmodified,
> proving all four phases' worth of prior behavior is untouched by a phase whose entire job is to
> watch it from the outside.

---

## Implementation Stats

- **Issues completed:** 20 (`AI-056` through `AI-075`), all marked `completed` — combined with
  Phase 1's 14, Phase 2's 21, and Phase 3's 20, all 75 issues across all four PRDs are now done.
  See `docs/issues/index.md`. Phase 4's PRD
  (`docs/prd/2026-07-10-safety-compliance.md`) is marked `completed`.
- **New modules:** 2 (`ModerationModule`, `CostManagementModule`), plus 1 new method-pair on Phase
  1's `OpenaiService` (`moderateText()`, `moderateBatch()`).
- **Services:** 4 new (`ModerationService`, `CostBudgetService`, `CostAnalyticsService`,
  `RetentionService`).
- **Guards & interceptors:** 3 (`ModerationGuard`, `CostBudgetGuard`, `OutputModerationInterceptor`).
- **API endpoints:** 20, across 4 groups (moderation, cost budgets, cost analytics, data
  retention) — moderation under `/api/v1/moderation`, budgets/analytics under `/api/v1/cost`,
  retention under its own `/api/v1/retention`.
- **Database tables added:** 2 (`moderation_logs`, `user_cost_budgets`), both following the
  established `BigInt`-PK + `publicId`-UUID convention; one hand-added partial index
  (`moderation_logs(isFlagged)` `WHERE "isFlagged" = true`).
- **Edits to pre-existing modules:** 2 files (`ChatController`, `RagController`), 4 decorator
  lines each — no logic in either file was touched.
- **New npm dependency:** `cron` (`4.4.0`, exact-pinned, promoted from a transitive dependency of
  `@nestjs/schedule` to an explicit direct one — the same footgun class this codebase has hit
  before with `axios`/`@langchain/core`/`@types/multer`).
- **Unit + integration tests:** 215 passing across 15 new spec files, bringing the full repo suite
  to **705 passing tests** overall, with zero changes to any Phase 1–3 spec file's assertions:

  | Spec file                                                            | Tests |
  | -------------------------------------------------------------------- | ----- |
  | `cost-budget.service.spec.ts`                                        | 35    |
  | `cost-management-dtos.spec.ts`                                       | 26    |
  | `cost-analytics.service.spec.ts`                                     | 21    |
  | `cost-management.controller.spec.ts`                                 | 21    |
  | `moderation.service.spec.ts`                                         | 23    |
  | `retention.service.spec.ts`                                          | 31    |
  | `moderation-dtos.spec.ts`                                            | 14    |
  | `output-moderation.interceptor.spec.ts`                              | 12    |
  | `moderation.guard.spec.ts`                                           | 11    |
  | `cost-budget.guard.spec.ts`                                          | 9     |
  | `moderation.controller.spec.ts`                                      | 7     |
  | `retention.controller.spec.ts`                                       | 5     |
  | `moderation-guard-integration.spec.ts` (under `ai-chat/__tests__/`)  | 4     |
  | `resolve-moderation-client.util.spec.ts` (under `openai/__tests__/`) | —     |
  | `static-moderation-fixture.util.spec.ts` (under `openai/__tests__/`) | —     |

  (The last two util spec files, plus 3 new moderation-specific cases added to the existing
  `openai.service.spec.ts`, cover the AI-059 OpenRouter-fallback/static-mode work and are counted
  in the 705 total but sit outside the 15-file, 215-test Phase 4 module count above.)

- **Live smoke-tested end to end** (`AI-059` and `AI-075`), not just unit-tested: a real
  OpenRouter-vs-OpenAI moderation-endpoint probe (decisive — OpenRouter returns a 404 HTML page for
  `/moderations`, not a JSON error), a real flagged chat message rejected with 422 and confirmed via
  `psql` to have written zero `chat_messages` rows, a real budget created and pushed over its limit
  via synthetic audit rows (confirming both the 429 block and the cache's documented staleness
  window in both directions), a real `X-Budget-Warning` header observed on an actual response, a
  real timezone bug found and fixed in the analytics timeline query, and a real retention cleanup
  that deleted exactly four deliberately back-dated rows while leaving an old-but-active
  conversation completely untouched — the single most important safety property in the whole
  phase, proven live rather than only asserted in a mocked unit test.
