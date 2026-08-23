---
id: AI-070
title: RetentionService — dynamic cron registration + runtime config
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 6 — Data Retention
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-069
---

# What to Build

Scheduling and config surface for retention:

**Cron registration** — a static `@Cron()` decorator can't read the `RETENTION_CRON` env var, so
register dynamically in `onModuleInit()` via `SchedulerRegistry.addCronJob()` (`@nestjs/schedule`,
installed since Phase 1; `ScheduleModule.forRoot()` already in `AppModule`): build a `CronJob`
from `retention.cron` (default `'0 2 * * *'`) whose tick calls `runFullCleanup()`, name it
distinctly (e.g. `retention-cleanup`), and **guard against double-registration** — check
`doesExist`/catch on the name — since `npm run dev`'s file-watch re-runs module init. An invalid
cron expression logs an error and skips registration rather than crashing boot. Errors thrown by
a tick are caught and logged (AI-069's per-category continuation already covers most of this).

**Runtime config** — `getRetentionConfig()` returns the effective values (env-namespaced config →
`RETENTION_CONFIG` fallbacks, plus any runtime overrides); `updateRetentionConfig(partial)`
merges validated overrides (positive integers for the day fields) held **in memory only** — reset
on restart, documented as such (PRD decision; persistence is out of scope). Retention-day
overrides take effect on the next cleanup run. Changing the cron expression at runtime is _not_
supported — `updateRetentionConfig` rejects or ignores a `cleanupCron` key (document which) —
re-registering live jobs adds complexity without learning value.

Also expose a small `getRetentionStats()` seam for AI-073's `GET /retention/stats`: last run's
`RetentionReport` (held in memory from the most recent `runFullCleanup()`, null before any run)
plus per-category counts of rows currently past their cutoff (cheap `count()` queries).

# User Stories Covered

- Story 27 — daily scheduled cleanup with report logging
- Story 30 — cron expression + periods from env
- Story 31 (service side) — config read/update + stats seams

# Acceptance Criteria

- [x] Cron job registered by name from `retention.cron` at `onModuleInit()`; double-registration guarded; invalid expression → logged skip, no boot crash
- [x] Tick invokes `runFullCleanup()`; tick errors are caught and logged
- [x] `getRetentionConfig()` reflects env values, fallbacks, and runtime overrides; `updateRetentionConfig()` validates and merges in memory; cron key not updatable
- [x] `getRetentionStats()` returns last report (null before first run) + rows-due counts
- [x] Unit tests verify registration via `SchedulerRegistry` lookup (never by waiting), the double-registration guard, config merge/validation, and stats shape
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-069 (`runFullCleanup()`)

# Testing Notes

Extend `retention.service.spec.ts`. Provide a real `SchedulerRegistry` instance (it's a plain
in-memory registry — no mocking needed) in the `TestingModule`, call `onModuleInit()` explicitly
(the documented hook gotcha), and assert `getCronJob('retention-cleanup')` exists with the
configured expression; call `onModuleInit()` twice to prove the guard. Trigger the job's tick
function directly (`job.fireOnTick()` or invoking the stored callback) with `runFullCleanup`
spied, rather than advancing time.

## Implementation Notes

`RetentionService` now `implements OnModuleInit` and gains a fourth constructor dependency,
`SchedulerRegistry` (`@nestjs/schedule`) — already globally provided by `ScheduleModule.forRoot()`
in `AppModule` (`global: true` in the module's `forRoot()` return), so no module wiring change was
needed in `CostManagementModule`.

**Cron registration** (`onModuleInit()`): checks `schedulerRegistry.doesExist('cron',
'retention-cleanup')` first — a stable, distinctly-named constant (`CRON_JOB_NAME`) — and returns
immediately (logged) if already registered, guarding `npm run dev`'s file-watch re-init from
throwing on `addCronJob()`'s duplicate-name check. Otherwise it reads the cron expression from
`getRetentionConfig().cron`, constructs `new CronJob(cronExpression, onTick)` inside a try/catch
(the `cron` package's `CronTime` parser throws synchronously on an invalid expression — caught,
logged, and registration is skipped with no boot crash), then `addCronJob()` + `job.start()`
(`CronJob`'s `start` constructor param defaults false — a constructed-but-unstarted job would never
tick). The `onTick` callback calls `this.runFullCleanup().catch(...)` — a fire-and-forget pattern
(AI-069's `runFullCleanup()` already resolves cleanly per-category, never rejects in practice, but
the `.catch()` is a defensive backstop per this issue's own AC, logging via `AppLoggerService`).

**`cron` added as an explicit direct dependency** (`package.json`, exact-pinned `4.4.0` matching the
version already resolved transitively via `@nestjs/schedule`) — importing `CronJob` from `'cron'`
directly is the same class of footgun this codebase has hit three times before (`axios`,
`@langchain/core`, `@types/multer` — see AI-037/042/044's notes): a package used only as a
transitive dependency must be promoted to direct once code imports from it, or a future
`--legacy-peer-deps` install could silently drop it. Installed with `--legacy-peer-deps` per the
same pre-existing `dotenv` peer conflict documented in AI-037 (`@langchain/community` →
`@browserbasehq/stagehand` → `dotenv@^16.4.5`); `npm ls cron` confirms one deduped resolution, no
version conflict.

**Runtime config**: `getRetentionConfig(): RetentionRuntimeConfig` returns the four day fields via
the (now three-tier) `getEffectiveConfig()` — runtime override → env-namespaced config →
`RETENTION_CONFIG` fallback — plus `cron` (config → fallback only, never overridable).
`updateRetentionConfig(partial)` throws `BadRequestException` immediately if `'cron' in partial`
(chosen over silently ignoring it — an explicit rejection surfaces the unsupported-operation to the
caller rather than silently discarding intent, satisfying the issue's "document which" instruction);
otherwise each present day field is validated (`Number.isInteger(value) && value > 0`, else
`BadRequestException`) and merged into a private in-memory `configOverrides` object — reset on
restart, no persistence (PRD decision). Since `getEffectiveConfig()` re-reads `configOverrides`
every call, an override takes effect starting with the very next `runFullCleanup()`/`getRetentionStats()`
call, with no extra wiring needed.

**`getRetentionStats()`** (AI-073's future `GET /retention/stats` seam): returns `{ lastReport,
rowsDue }`. `lastReport` is a new private field set at the end of `runFullCleanup()` (the one
addition to AI-069's method — `RetentionReport` is now also stashed on `this.lastReport` right
before it's returned), `null` until the first run. `rowsDue` runs four cheap parallel `count()`
queries (`aiAuditLog`/`moderationLog`/`chatConversation`/`embeddingCache`) against the _current_
effective cutoffs, reusing the existing private `computeCutoff()` helper — no new query patterns.

New types in `types/cost-management.types.ts`: `RetentionRuntimeConfig`, `RetentionConfigOverrides`
(`Partial<Pick<..., the four day fields>>`), `RetentionRowsDue`, `RetentionStatsResult`.

**Tests** (16 new, 27 total in `retention.service.spec.ts`): a real `SchedulerRegistry` instance
(no mock — it's a plain in-memory `Map`-backed class with no constructor deps) added to the
`TestingModule`. Cron coverage: registration + `cronTime.source`/`isActive` assertions, a second
`onModuleInit()` call proving the double-registration guard (still exactly one job, logged skip),
an invalid-expression case asserting no throw + no registration + logged error, and a tick test
that spies `runFullCleanup` (rejected), calls `job.fireOnTick()`, then flushes two microtask ticks
so the internal `.catch()` has run before asserting the logged error — chosen over advancing fake
timers, per this issue's own Testing Notes ("rather than advancing time"). Config coverage:
env-reflection, `RETENTION_CONFIG` fallback, override merge + visibility in
`getRetentionConfig()`, override-affects-next-run (asserts the `cleanupAuditLogs` cutoff shifts),
cron-key rejection (`toThrow(BadRequestException)` + unaffected `cron` value), a parametrized
non-positive-integer rejection (`0`, `-1`, `1.5`), and override accumulation across multiple calls.
Stats coverage: null-before-first-run, matches-the-just-returned-report-after-a-run, and
rows-due count-query argument shapes.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors (68 pre-existing `no-unsafe-*`/e2e warnings, all unrelated)
- `npm run build` — succeeds
- `npm run test -- cost-management` — 93/93 pass (5 suites)
- `npm run test` — 618/618 pass (full suite, +16 for this issue, zero regressions)

## Assumptions Made

- **`updateRetentionConfig()` rejects (throws) a `cleanupCron`/`cron` key** rather than silently
  ignoring it — the issue explicitly left this an open choice ("rejects or ignores... document
  which"). Rejection was chosen so a caller (eventually AI-073's `PATCH /retention/config`) gets an
  explicit 400 rather than a silently-dropped field, matching this codebase's general preference for
  explicit validation errors over silent partial application.
- **No live cron tick has been observed** (correctly deferred — the cron fires at 2 AM daily and
  this issue's own Testing Notes explicitly say "rather than advancing time"). Unit tests trigger
  the tick via `job.fireOnTick()` directly, never real timers.
- **`getRetentionConfig()`'s runtime-override tier sits _above_ env config**, not merged
  field-by-field with any different precedence — an override always wins over both env config and
  the hardcoded fallback for the fields it sets, per the issue's literal ordering
  ("env-namespaced config → RETENTION_CONFIG fallbacks, plus any runtime overrides").
- **`SchedulerRegistry` needed no module export** — it's provided `global: true` by
  `ScheduleModule.forRoot()` (already in `AppModule`), so any module's services can inject it
  without further wiring, unlike the `ModerationService`/`CostBudgetService` DI-export gotchas
  documented for AI-063/AI-066 (those were guard/interceptor host-scope issues, not global-provider
  ones).

## Follow Ups

- Epic 6 (Data Retention) is complete (AI-069 + AI-070). AI-073 (`CostManagementController`
  analytics + retention endpoints) is now fully unblocked (its other dependency, AI-068, already
  landed) — it will wire `GET /retention/config`, `PATCH /retention/config`, `POST
/retention/cleanup` (→ `runFullCleanup()`), and `GET /retention/stats` (→ `getRetentionStats()`).
- The cron's actual 2 AM UTC firing, and a real `RETENTION_CRON` override, get their first live
  observation in AI-075's smoke test — worth a quick manual `SchedulerRegistry` boot-log check
  during AI-073's live verification if a faster feedback loop is wanted sooner.
- If a future phase needs live cron-schedule changes without a restart, `updateRetentionConfig()`
  would need to `deleteCronJob()` + re-`addCronJob()` the job — deliberately out of scope here per
  the issue's own "adds complexity without learning value" framing.
