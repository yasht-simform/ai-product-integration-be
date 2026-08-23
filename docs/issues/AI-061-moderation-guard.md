---
id: AI-061
title: ModerationGuard — input moderation with 422 blocking
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
  - AI-060
---

# What to Build

Implement `ModerationGuard` (`CanActivate`) per spec §7.2 — the input-side enforcement point.

1. Resolve which request-body field holds the user text via decorator metadata: a small
   `@ModerateField('question')`-style route decorator (SetMetadata + `Reflector`), defaulting to
   `'content'` when absent. This is how the same guard serves chat (`dto.content`) and RAG
   (`dto.question`) routes without per-module subclasses.
2. Skip entirely (return `true`, no service call) when `moderation.enabled` or
   `moderation.inputEnabled` is false, or when the resolved field is missing/not a string —
   validation pipes own missing-field errors, not the guard.
3. Call `ModerationService.moderateText(text, { direction: 'input', source, userId, requestId })` —
   `source` from route metadata or a sensible default (`'chat'`/`'rag'` supplied at application
   time in AI-063; `'standalone'` otherwise); `userId` from the `x-user-id` header falling back to
   `body.userId` (the Phase 4 identity convention, shared with `CostBudgetGuard`).
4. Flagged → throw `UnprocessableEntityException` whose response body carries
   `flaggedCategories`, `categoryScores`, and `highestScore` — flowing through the global
   `HttpExceptionFilter` into the standard error envelope. The blocked check's log row must record
   `action: 'blocked'`.
5. Clean → return `true`; the log row records `action: 'allowed'`.

The guard does **not** get applied to any real route in this issue — application + cross-module
regression is AI-063. Export from `ModerationModule` was wired in AI-057.

# User Stories Covered

- Story 7 — flagged message → 422 with categories/scores, nothing persisted
- Story 8 — clean message passes with only the moderation call's latency
- Story 10/11 — enabled/input toggles honored with zero API calls when off
- Story 14 — threshold-driven blocking (inherited from AI-060)

# Acceptance Criteria

- [x] Guard blocks flagged input with 422; response body includes flagged categories + scores
- [x] Field resolution: decorator metadata wins, `'content'` default otherwise; non-string/missing field passes through
- [x] `action: 'blocked'` vs `'allowed'` logged correctly (asserted via the mocked `ModerationService` call args)
- [x] Both toggles bypass with zero `ModerationService` calls
- [x] `userId`/`requestId`/`source` threaded into the moderation options
- [x] Unit tests cover flagged/clean/toggles/field-resolution/identity threading
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-060 (`ModerationService`)

# Testing Notes

New `moderation.guard.spec.ts`: build a fake `ExecutionContext`
(`switchToHttp().getRequest()` returning `{ body, headers }`; `getHandler()`/`getClass()` for
`Reflector`) — no `TestingModule` HTTP transport needed. `ModerationService` is a plain
`jest.fn()` mock returning scripted `ModerationResult`s. Use `Reflector` directly with real
`SetMetadata` from the new decorator so metadata resolution is tested for real, not mocked.
Assert the thrown exception is `UnprocessableEntityException` and inspect `getResponse()` for the
category payload.

## Implementation Notes

Implemented `ModerationGuard` (`src/modules/moderation/guards/moderation.guard.ts`), replacing the
AI-057 always-`true` pass-through stub, plus a new `ModerateField` route decorator
(`src/modules/moderation/decorators/moderate-field.decorator.ts`).

**`@ModerateField(field, source?)`** is a single `SetMetadata`-based decorator carrying `{ field,
source? }` as one metadata object (rather than two separate decorators) — this covers both what
the issue's step 1 explicitly asked for (`@ModerateField('question')`-style field resolution) and
step 3's "source from route metadata" requirement without inventing an undocumented second
decorator. `ModerationGuard.canActivate()` reads it via
`reflector.getAllAndOverride(MODERATE_FIELD_KEY, [handler, class])`, falling back to `field:
'content'` / `source: 'standalone'` when a route carries no metadata at all (this issue doesn't
apply the guard to any route — AI-063 will decorate the real chat/RAG handlers with
`@ModerateField('content', 'chat')`/`@ModerateField('question', 'rag')`).

**Ordering matches spec §7.2 exactly**: both config toggles (`moderation.enabled` AND
`moderation.inputEnabled`, both default `true`) are checked first with zero side effects: → field
resolved from metadata/default → body field read and type-checked (missing/non-string → pass
through, no `ModerationService` call, since validation pipes own that error, not this guard) →
`ModerationService.moderateText()` called once → flagged result throws
`UnprocessableEntityException`, clean result returns `true`.

**Identity resolution** (private `resolveUserId()`): `x-user-id` request header first (string or
first element of a string array — Express's `IncomingHttpHeaders` type allows either), falling
back to `body.userId` when the header is absent. Per spec §14 ("Out of Scope: Real
authentication/authorization — userId is passed as a parameter, not from JWT/session"), there is
no JWT-derived identity in this phase, so this header/body convention is the only identity signal
available — establishing the pattern AI-066's `CostBudgetGuard` is expected to reuse verbatim, per
this issue's own text.

**Action resolution, made explicit rather than left to the service default**: the guard always
passes `action: ModerationAction.BLOCKED` in the `moderateText()` call options — not because it
changes anything on the clean path (`ModerationService.moderateText()` (AI-060) already always
logs `ALLOWED` when clean regardless of what's passed), but because it makes the guard's intent
self-documenting ("the guard/interceptor passing what they did", per AI-060's own phrasing) rather
than silently relying on the service's own BLOCKED-when-flagged default. AI-062's
`OutputModerationInterceptor` is expected to instead pass `action: ModerationAction.REPLACED`,
following this same explicit pattern.

**`UnprocessableEntityException` response body** carries `message`, `error`,
`flaggedCategories`, `categoryScores`, `highestScore` as a plain object passed to the exception
constructor — verified directly via `getResponse()` in the unit tests, per this issue's own
Testing Notes (which scope verification to the guard's thrown exception, not an end-to-end HTTP
round trip).

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 67 pre-existing-pattern warnings (`no-unsafe-*`, downgraded to
  warnings per project convention; none introduced by this issue's files)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npx jest --testPathPatterns=moderation.guard` — 11/11 pass (new spec file)
- `npm run test` (full suite) — 511/511 pass across 35 suites (up from 500/500 across 34 suites
  before this issue), zero changes to any pre-existing spec file's assertions

## Assumptions Made

- **`ModerateField(field, source?)` as one combined decorator** rather than two separate ones —
  the issue text only names `@ModerateField('question')`-style for field resolution but also
  requires "source from route metadata" in the same step 3; folding both into one metadata object
  keyed under a single `SetMetadata` call avoids introducing a second, unmentioned decorator while
  still satisfying both requirements.
- **`action: ModerationAction.BLOCKED` always passed, not conditionally** — since
  `ModerationService.moderateText()` only honors `options.action` when the result is flagged (and
  always logs `ALLOWED` otherwise regardless), passing it unconditionally is behaviorally
  equivalent to passing it only when about to throw, but is simpler code and matches "the
  guard... passing what they did" as a fixed, known-in-advance fact about this guard (it always
  intends to block on a flag), not something computed per-call.

## Follow Ups

- **`HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`) currently forwards only
  `message`/`error` from an `HttpException`'s response body** — it does not spread arbitrary extra
  keys like `flaggedCategories`/`categoryScores`/`highestScore` into the final `{ statusCode,
message, error, timestamp, path }` envelope returned to the client. This means that, as of this
  issue, those fields exist on the guard's own exception object (verified directly via
  `getResponse()` in the unit tests, exactly as this issue's Testing Notes scope verification) but
  will **not** currently reach an actual HTTP client until the filter is generalized to pass
  through extra body keys when present. This was deliberately left unmodified here — the filter is
  shared, cross-cutting code touching every endpoint's error responses in the app, well outside
  this issue's stated scope (which only asks for the `ModerationGuard` itself, applied to no real
  route yet). AI-063 (applying the guard to live chat/RAG routes) or a small dedicated follow-up
  should generalize `HttpExceptionFilter` to spread through any additional response-body keys
  before that issue's live verification, or the categories/scores will silently not appear in the
  actual 422 response body a real client receives.
- AI-062 (`OutputModerationInterceptor`) will follow this same guard's structure for the
  output-moderation path, passing `direction: 'output'`/`action: ModerationAction.REPLACED`.
- AI-063 will apply `@UseGuards(ModerationGuard)` + `@ModerateField(...)` to the real chat
  (`content`) and RAG (`question`) routes and perform the cross-module live regression this issue
  explicitly deferred.
