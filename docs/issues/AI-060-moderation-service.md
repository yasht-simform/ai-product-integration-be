---
id: AI-060
title: ModerationService — classification + moderation_logs logging
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-10
completed_at: 2026-07-10
parent_epic: Epic 3 — Moderation Core — Service, Guard, Interceptor
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-056
  - AI-057
  - AI-058
---

# What to Build

Implement `ModerationService.moderateText(text, options?)` and `moderateBatch(texts)` per spec
§5.1 — the classification and logging layer sitting on AI-058's SDK seam. This service is the
_only_ reader/writer of `moderation_logs`.

`moderateText()` calls `OpenaiService.moderateText()`, then shapes the spec's `ModerationResult`:

```typescript
interface ModerationResult {
  isFlagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
  flaggedCategories: string[]; // only the ones that were true
  highestScore: { category: string; score: number };
}
```

Threshold semantics: a category counts as flagged when the API marked it `true` **or** its score
≥ `moderation.blockThreshold` (config, default 0.7) — making borderline handling tunable per
FR-MOD-005/Story 14. `isFlagged` is derived from that post-threshold set.

**Every check writes exactly one `moderation_logs` row, fire-and-forget** (the
`AiAuditService.log()` pattern: `void`ed promise, catch-and-log, never awaited into the request
path): `direction` (from `options.direction`, default `'input'`), `content` truncated to 1000
chars, `isFlagged`, both JSON columns, `action` (`'allowed'` when clean — callers that block or
replace log their own action via an options field or a follow-up call; simplest correct design:
`moderateText()` accepts the intended `action` mapping, with the guard/interceptor passing what
they did), `source` (default `'standalone'`), `userId`/`requestId` from options (requestId falls
back to the AsyncLocalStorage request context, matching the logger's convention).

**Fail-open on API errors** (PRD decision): if `OpenaiService.moderateText()` throws after
retries, log the error loudly via `AppLoggerService` and return a clean `ModerationResult`
(`isFlagged: false`, empty maps) with a `metadata: { failedOpen: true }` moderation-log row — a
free auxiliary endpoint must not take down chat/RAG.

The global `MODERATION_ENABLED=false` kill switch is honored here (return clean immediately, zero
API calls, zero log rows) so every consumer — guard, interceptor, standalone controller — inherits
it from one place.

# User Stories Covered

- Story 4 — clean text returns `isFlagged: false` with scores
- Story 5 — batch moderation in one call
- Story 6 — fail-open on moderation API outage
- Story 9 — every check logged (allowed/blocked/replaced)
- Story 10 — kill switch: zero API calls, zero log rows
- Story 14 — configurable block threshold applied to scores

# Acceptance Criteria

- [x] `moderateText()` returns the exact `ModerationResult` shape; `flaggedCategories`/`highestScore` computed correctly
- [x] Threshold: score ≥ `blockThreshold` flags a category even when the API's boolean was false
- [x] Exactly one `moderation_logs` row per check, fire-and-forget, content truncated to 1000 chars
- [x] `moderateBatch()` returns one result per input in order and logs one row per input
- [x] API failure → fail open: clean result, error logged, `failedOpen` metadata row
- [x] `MODERATION_ENABLED=false` → clean result, zero `OpenaiService` calls, zero DB writes
- [x] Unit tests cover all of the above
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-056 (`moderation_logs` table), AI-057 (config + shell), AI-058 (SDK seam)

# Testing Notes

New `moderation.service.spec.ts` with `DeepMockProxy<DatabaseService>` (plus the mandatory
`jest.mock('.../database.service', ...)` Prisma-ESM stub) and `OpenaiService` mocked as a plain
`jest.fn()` object — mock at the seam, not the SDK. Assert `dbMock.moderationLog.create` argument
shapes (truncation, direction, action, JSON columns). Fire-and-forget: make the create reject and
assert the check still resolves. Config toggles via a mocked `ConfigService.get`.

## Implementation Notes

Implemented `ModerationService.moderateText()`/`moderateBatch()`
(`src/modules/moderation/services/moderation.service.ts`), replacing the AI-057 constructor-only
shell — this service is the only reader/writer of `moderation_logs`, matching
`AiAuditService`'s exclusive-owner role for `ai_audit_logs`.

Added a new `src/modules/moderation/types/moderation.types.ts` (this module's first `types/`
file, following `ai-chat.types.ts`/`rag.types.ts`'s single-file convention) holding
`ModerationOptions` (`userId?`, `requestId?`, `direction?`, `source?`, `action?`) and
`ModerationResult` (`isFlagged`, `categories`, `categoryScores`, `flaggedCategories`,
`highestScore`) — the spec §5.1 shapes verbatim. `ModerationResult` here is intentionally a
distinct type from `OpenaiService`'s own `ModerationResult` (AI-058's raw `{ flagged, categories,
categoryScores }` seam shape) — imported under the alias `OpenAiModerationResult` at the one call
site that needs it (`buildResult()`), so there's no naming collision between the SDK-adjacent
shape and this service's classified/thresholded shape.

**Threshold logic** (private `buildResult()`): iterates `categoryScores`, marking a category
flagged when the API's own boolean was `true` **or** its score is `>=` `moderation.blockThreshold`
(config, falls back to a `DEFAULT_BLOCK_THRESHOLD = 0.7` constant matching AI-057's config
default) — the score-based OR-boolean check satisfies FR-MOD-005/Story 14's "tunable borderline
handling" requirement. `isFlagged` is `flaggedCategories.length > 0`, derived from the
already-thresholded set rather than trusting the SDK's own top-level `flagged` boolean (which
reflects the API's own untuned judgment). `highestScore` is tracked via a running max over
`categoryScores`'s entries, defaulting to `{ category: '', score: 0 }` when there are none (the
fail-open/kill-switch clean-result path).

**Logging** (private `logModeration()`): mirrors `AiAuditService.log()`'s exact fire-and-forget
shape — an `async` method that `await`s the `moderationLog.create()` write inside its own
try/catch (logging via `AppLoggerService` on failure, never throwing), called by every public
method as `void this.logModeration(...)` so a DB failure never rejects the caller's moderation
check. `content` is truncated to 1000 characters via a private `truncateContent()` helper
(`MAX_LOG_CONTENT_LENGTH` constant) — matches the spec's `moderation_logs.content` column
description verbatim, and reuses the same 1000-char budget AI-058 already chose for the
`ai_audit_logs.userMessage` moderation-endpoint rows.

**Action resolution**: per the issue's own "simplest correct design" framing, `moderateText()`
accepts an optional `options.action` that the caller (a future guard/interceptor) can supply to
record what it actually did with a flagged result. When flagged, the logged `action` is
`options.action ?? ModerationAction.BLOCKED` (a sensible default for any caller that doesn't
override — e.g. AI-061's guard, which does block); when clean, `action` is always
`ModerationAction.ALLOWED` regardless of any `options.action` override (there's nothing to
override when nothing was flagged). AI-062's `OutputModerationInterceptor` is expected to pass
`{ action: ModerationAction.REPLACED }` when it replaces rather than blocks. `moderateBatch()`
takes no per-item options (matching its spec §5.1 signature exactly — `moderateBatch(texts:
string[])`), so every batched check logs with `direction: 'input'`, `source: 'standalone'`, no
`userId`, and the same default-BLOCKED-when-flagged action resolution.

**Fail-open** (PRD decision, both methods): a caught `OpenaiService` error is logged loudly via
`AppLoggerService.error()`, then a clean `ModerationResult` is returned and logged with
`metadata: { failedOpen: true }` and `action: ModerationAction.ALLOWED` — a moderation-API outage
degrades to "allow everything, but mark every row so the outage is visible in `moderation_logs`,"
never a hard failure that would take down chat/RAG. Applied symmetrically to `moderateBatch()`
(one clean+failedOpen row per input) even though the issue's prose only spells this out for
`moderateText()` — extending it to the batch path keeps the "every check produces a row" invariant
true regardless of which method was called or whether the underlying API call failed.

**Kill switch**: both methods check `moderation.enabled` (config, defaults `true` when the key is
absent/undefined — mirrors `moderationConfig`'s own `!== 'false'` default-on parsing from AI-057)
before anything else, returning clean result(s) with zero `OpenaiService` calls and zero DB writes
when disabled — every consumer (this standalone entry point, and AI-061/062's guard/interceptor,
which call through this same service) inherits the kill switch from this one place, per the
issue's explicit design goal.

`requestId` resolution mirrors `AppLoggerService`/`OpenaiController`'s existing convention exactly:
`options.requestId ?? requestContext.getStore()?.requestId` (falling back to the
`AsyncLocalStorage`-propagated request-scoped id when the caller didn't supply one explicitly).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 67 pre-existing-pattern warnings (all `no-unsafe-*`, downgraded
  to warnings per project convention; ran `eslint --fix` once during implementation to resolve a
  prettier formatting diff and two now-redundant `as Prisma.InputJsonValue` casts on the
  `categories`/`categoryScores` fields — `Record<string, boolean>`/`Record<string, number>` are
  directly assignable to Prisma's JSON input type without a cast, same precedent
  `EmbeddingCacheService`'s own single-cast convention already established for a plain array)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npx jest --testPathPatterns=moderation.service` — 15/15 pass (new spec file; module had no
  prior tests)
- `npm run test` (full suite) — 500/500 pass across 34 suites (up from 485/485 across 33 suites
  before this issue), zero changes to any pre-existing spec file's assertions

## Assumptions Made

- **`options.action` default-BLOCKED semantics**: the issue text describes the design goal
  ("callers that block or replace log their own action... `moderateText()` accepts the intended
  `action` mapping") without pinning down what happens when a caller omits it entirely on a
  flagged result. Chose `ModerationAction.BLOCKED` as the default (rather than, say, requiring
  every caller to always pass it) so this issue's own acceptance-criteria tests and AI-071's
  planned "standalone check, no action override" call site produce a sensible, non-empty `action`
  value without every future caller needing to remember to set it.
- **Fail-open extended to `moderateBatch()`**: the issue's prose names `moderateText()` specifically
  for the fail-open path, but the acceptance criteria and the "every check writes exactly one row"
  invariant are stated generically. Applied the identical fail-open behavior to the batch path
  (one clean result + one `failedOpen` log row per input) rather than leaving batch failures
  unhandled, since a single failing batch call is otherwise indistinguishable from N failing
  single calls from the caller's perspective.
- **`moderation.enabled` default when unset**: config mock returns `undefined` for keys not
  explicitly stubbed in a test; `?? true` makes the kill switch default to "moderation on," matching
  `moderationConfig.enabled`'s own `!== 'false'` (default-true) parsing from AI-057 — this service
  doesn't re-read the raw env var, only the already-parsed config value, with `true` as its own
  independent fallback in case `ConfigService.get()` itself returns `undefined` (e.g., if the
  `moderation` namespace weren't registered for some reason).

## Follow Ups

- AI-061 (`ModerationGuard`) and AI-062 (`OutputModerationInterceptor`) will replace their AI-057
  pass-through stubs with real calls into `moderateText()` — the guard should pass
  `{ direction: 'input', source: 'chat' | 'rag', userId }` and rely on the default BLOCKED action;
  the interceptor should pass `{ direction: 'output', action: ModerationAction.REPLACED }`.
- AI-071 will add `getModerationLogs()`/`getModerationStats()` to this same service (per spec
  §5.1's full interface) and wire the standalone `POST /moderation/check`/`check-batch` routes —
  this issue deliberately left both query methods and the controller untouched, per its own scope.
- AI-059 (HITL, still open) determines whether the configured `OPENAI_BASE_URL` actually proxies
  `/moderations` — this issue's tests mock `OpenaiService` at the seam and make no live call, so
  that question remains unresolved by this work.
