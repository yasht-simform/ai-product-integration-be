---
id: AI-057
title: Config namespaces + env validation + ModerationModule/CostManagementModule scaffolds
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 1 — Schema & Configuration Foundation
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-056
---

# What to Build

The configuration surface and module skeletons for Phase 4 — mirroring how AI-016 (Phase 2) and
AI-037 (Phase 3) scaffolded their phases.

**Config** (`app.config.ts` + `env.validation.ts` + `.env.example`): new `registerAs()` namespaces
covering all eleven spec §12 env vars, every one `@IsOptional()` with the spec's default —
`moderation` (`MODERATION_ENABLED` true, `MODERATION_INPUT_ENABLED` true,
`MODERATION_OUTPUT_ENABLED` false, `MODERATION_BLOCK_THRESHOLD` 0.7), `costBudget`
(`COST_BUDGET_ENABLED` true, `COST_BUDGET_CACHE_TTL_MS` 60000), and `retention`
(`RETENTION_AUDIT_DAYS` 90, `RETENTION_MODERATION_DAYS` 90,
`RETENTION_ARCHIVED_CONVERSATION_DAYS` 30, `RETENTION_EMBEDDING_CACHE_DAYS` 180,
`RETENTION_CRON` `'0 2 * * *'`). Register all three in `ConfigModule.forRoot({ load: [...] })`.
Boolean env vars parse the same way existing ones do (string `'false'` → `false`).

**Constants**: `ModerationCategory`, `ModerationAction`, `ModerationDirection`, `BudgetPeriod`
as-const objects with derived union types (spec §4.1–§4.4 values verbatim — note the slash-bearing
category keys like `'hate/threatening'`), plus `RETENTION_CONFIG` (spec §4.5) as the hardcoded
fallback constant mirroring `CONTEXT_CONFIG`/`RAG_CONFIG`'s role. Barrel `index.ts` per module.

**Module scaffolds**: `src/modules/moderation/` (ModerationService shell, ModerationGuard shell,
OutputModerationInterceptor shell, `@ApiTags('moderation')` stub controller) and
`src/modules/cost-management/` (CostBudgetService/CostAnalyticsService/RetentionService shells,
CostBudgetGuard shell, `@ApiTags('cost-management')` stub controller). Shells are `@Injectable()`
classes with constructors only (DatabaseService/ConfigService/AppLoggerService as appropriate), no
method bodies. `ModerationModule` imports `OpenaiModule` and exports `ModerationGuard` +
`OutputModerationInterceptor`; `CostManagementModule` exports `CostBudgetGuard`. Both registered
in `AppModule.imports`; both Swagger tags added to `main.ts`'s `DocumentBuilder`.

# User Stories Covered

- Story 3 — app boots with no Phase 4 env vars set
- Story 10/11 — moderation toggles exist as config, independently settable
- Story 30 — retention periods and cron expression configurable via env

# Acceptance Criteria

- [ ] All eleven env vars validated, optional, defaulted; `.env.example` documents each
- [ ] Three new config namespaces readable via `configService.get('moderation.enabled')` etc.
- [ ] All four as-const constant objects + `RETENTION_CONFIG` match spec §4 values exactly
- [ ] Both modules boot in `AppModule` with no DI errors (`npm run dev` boot log clean)
- [ ] `ModerationModule` exports guard + interceptor; `CostManagementModule` exports guard
- [ ] Both Swagger tags registered in `main.ts`
- [ ] `npm run test`, `lint:check`, and `npx tsc --noEmit --project tsconfig.build.json` pass

# Dependencies

- AI-056 (service shells inject `DatabaseService` typed against the regenerated client)

# Testing Notes

Scaffold slice — no behavior to unit test yet. Verification is a clean boot with zero Phase 4 env
vars set (proves defaults), plus the standard type-check/lint/test gates. A quick boot with
`MODERATION_ENABLED=false` set should also succeed, proving boolean parsing doesn't crash
validation.

## Implementation Notes

**Config** (`src/config/app.config.ts` + `env.validation.ts` + `.env.example`): added three
`registerAs()` namespaces — `moderationConfig`, `costBudgetConfig`, `retentionConfig` — covering
all eleven spec §12 env vars with the spec's exact defaults, following the existing
`chatConfig`/`ragConfig` pattern (boolean toggles via `!== 'false'`/`=== 'true'` string checks,
numeric via `parseInt`/`parseFloat` with `??` fallbacks). `MODERATION_OUTPUT_ENABLED` uses
`=== 'true'` (default `false`, opt-in) — the inverse of the other three boolean toggles, matching
spec §7.4's stated default. Added corresponding `ConfigType<typeof x>` type exports
(`ModerationConfig`, `CostBudgetConfig`, `RetentionConfig`). All eleven fields added to
`EnvironmentVariables` in `env.validation.ts`, every one `@IsOptional()` (numeric fields also get
range validators matching the existing `RAG_SIMILARITY_THRESHOLD`-style `@Min`/`@Max` pattern for
`MODERATION_BLOCK_THRESHOLD`). `.env.example` gained three new sections with the spec's defaults
pre-filled, mirroring the RAG section's format.

**Constants**: `src/modules/moderation/constants/` holds `ModerationCategory` (11 values,
slash-bearing string values like `'hate/threatening'` with plain-identifier keys),
`ModerationAction` (3 values), `ModerationDirection` (2 values) — all `as const` objects with
derived union types, per spec §4.1–§4.3, plus a barrel `index.ts`.
`src/modules/cost-management/constants/` holds `BudgetPeriod` (spec §4.4) and `RETENTION_CONFIG`
(spec §4.5, the hardcoded fallback constant mirroring `CONTEXT_CONFIG`/`RAG_CONFIG`'s role — an
inline comment documents that `RetentionService` should prefer the `retention` config namespace at
call sites), plus a barrel.

**Module scaffolds**: `src/modules/moderation/` — `ModerationService` shell (constructor only:
`DatabaseService`, `OpenaiService`, `ConfigService`, `AppLoggerService` — `OpenaiService` injected
now since `ModerationModule` imports `OpenaiModule`, ready for AI-058's `moderateText()` seam),
`ModerationController` stub (`@ApiTags('moderation') @Controller('moderation')`, no routes),
`ModerationModule` (imports `OpenaiModule`, exports `ModerationGuard` +
`OutputModerationInterceptor`). `src/modules/cost-management/` — `CostBudgetService`/
`CostAnalyticsService`/`RetentionService` shells (constructor-only,
`DatabaseService`/`ConfigService`/`AppLoggerService` as appropriate),
`CostManagementController` stub (`@ApiTags('cost-management')`, bare `@Controller()` with no
prefix since routes split across `/cost/...` and `/retention/...` is AI-072/AI-073's decision, not
this scaffold's), `CostManagementModule` (no AI-specific imports, exports `CostBudgetGuard`).

**Guards/interceptor exception to "no method bodies"**: unlike the plain service shells,
`ModerationGuard`/`CostBudgetGuard` (`implements CanActivate`) and
`OutputModerationInterceptor` (`implements NestInterceptor`) each needed one minimal stub method
(`canActivate()` returning `true`; `intercept()` returning `next.handle()` unchanged) — a class
declared to implement a NestJS interface without satisfying it doesn't compile, so a pure
pass-through stub was the smallest viable shell. Each stub carries a comment naming the issue that
replaces it (AI-061/AI-062/AI-066). Both guards/interceptor are otherwise real, exported,
injectable providers already wired into their modules — only the internal method body is a
placeholder.

Both modules registered in `AppModule.imports` (after `RagModule`); both Swagger tags
(`moderation`, `cost-management`) registered in `main.ts`'s `DocumentBuilder` — `moderation` was
already present from earlier scaffolding, only `cost-management` was newly added.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — pass
- `npm run lint` (auto-fix) — 0 errors, 59 pre-existing warnings unchanged; the 5 new errors
  ESLint flagged (inline-type-import/import-order formatting on the new guard/interceptor/module
  files) were auto-fixed by `eslint --fix`, not hand-edited
- `npm run build` — pass (Prisma client regenerated + patched as part of the build script)
- `npm run test` — 475/475 pass, 33/33 suites (zero regressions; no test files added — scaffold
  slice has no behavior to test yet, per this issue's own Testing Notes)
- Live boot via `npx nest start` with **zero Phase 4 env vars set**: `ModerationModule` and
  `CostManagementModule` both initialized with no DI errors, app reached
  `Application running on port 3000`, alongside the existing `AiChatModule`/`RagModule`/etc.
- Live boot via `npx nest start` with `MODERATION_ENABLED=false` set: `ModerationModule` and
  `CostManagementModule` both initialized cleanly again — proving the boolean-toggle env parsing
  doesn't crash `env.validation.ts`'s `validateSync()`
- Confirmed no stray server processes were left running after either test boot

## Assumptions Made

- `CostManagementController` uses a bare `@Controller()` (no path prefix) since spec §6 splits its
  eventual routes across `/cost/...` (budgets, analytics) and `/retention/...` — AI-073's own text
  already flags "prefer a second controller class" as the likely resolution, so this scaffold
  deliberately doesn't commit to a prefix that a later issue would have to undo.
- Interpreted "no method bodies" (CLAUDE.md's description of prior-phase empty shells) as applying
  to plain services; guards/interceptors implementing a NestJS interface got the smallest possible
  pass-through stub instead, since an unimplemented interface method doesn't compile. Documented
  inline on each file.
- `ModerationService`'s shell already injects `OpenaiService` (not deferred to AI-058) since
  `ModerationModule`'s import of `OpenaiModule` makes it available now and AI-058 will add the
  `moderateText()` method onto that same already-injected instance.

## Follow Ups

- None blocking. AI-058 (independent, no blockers) and AI-060/AI-064/AI-067/AI-069 (all newly
  reachable once this issue's config/scaffolds exist, pending their own direct blockers) are now
  unblocked.
