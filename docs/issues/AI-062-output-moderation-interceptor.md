---
id: AI-062
title: OutputModerationInterceptor — replace flagged AI output
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

Implement `OutputModerationInterceptor` (`NestInterceptor`) per spec §7.3 — the output-side
filter. It maps the handler's returned payload (before the global `ResponseInterceptor` envelope,
which route-level interceptors see un-wrapped) and:

1. Skips entirely (identity passthrough, no service call) when `moderation.enabled` or
   `moderation.outputEnabled` (default **false** — opt-in) is off.
2. Extracts the AI text from the payload — the `content` field for chat's
   `AssistantMessageResDto` shape, `answer` for RAG's `AskResDto` shape; resolve via the same
   decorator-metadata approach as AI-061's guard (`@ModerateOutputField('answer')`, default
   `'content'`). Payloads without the field pass through untouched.
3. Calls `ModerationService.moderateText(text, { direction: 'output', ... })` — since interceptor
   mapping is async-capable via rxjs, use `mergeMap`/`switchMap` around the promise.
4. Flagged → replace the field with the safe message (`"I'm sorry, I can't provide that type of
content."` — a constant, not inline), keep every other payload field intact, and ensure the log
   row records `action: 'replaced'` with the **original** content (truncated per AI-060). Never
   throw for flagged output — the generation cost is sunk.
5. Clean → payload passes through unchanged (`action: 'allowed'`).

A moderation API failure inherits AI-060's fail-open: the original payload is returned unmodified.
Not applied to any real route here (AI-063), and explicitly **not** applicable to the SSE
streaming route (raw `@Res()` bypasses interceptor mapping) — that's a documented Phase 4 scope
boundary, not a bug.

# User Stories Covered

- Story 12 — flagged response replaced with safe message, no error
- Story 13 — original output preserved in the moderation log
- Story 11 — output toggle independent of input, default off

# Acceptance Criteria

- [x] Flagged payload → field replaced with the safe-message constant, other fields untouched, `action: 'replaced'` with original content
- [x] Clean payload → identity passthrough, `action: 'allowed'`
- [x] Toggles off (including the default posture) → zero `ModerationService` calls
- [x] Field resolution via decorator metadata with `'content'` default; field-less payloads pass through
- [x] Interceptor never throws on flagged content; API failure returns the original payload
- [x] Unit tests cover all paths by invoking `intercept()` directly with `of(payload)`
- [x] `npx tsc --noEmit` and full suite pass

# Dependencies

- AI-060 (`ModerationService`)

# Testing Notes

New `output-moderation.interceptor.spec.ts`: call
`interceptor.intercept(fakeContext, { handle: () => of(payload) })` and collect the mapped
observable (`firstValueFrom`) — no HTTP transport. `ModerationService` as a plain `jest.fn()`
mock. Assert direction `'output'` and the action passed on the service call, and deep-equal the
replaced vs. untouched payloads. Fake context needs only `getHandler()`/`getClass()` for
`Reflector` plus `switchToHttp().getRequest()` for identity headers.

## Implementation Notes

`OutputModerationInterceptor` (`src/modules/moderation/interceptors/output-moderation.interceptor.ts`)
replaces AI-057's `next.handle()`-only stub. `intercept()` checks `moderation.enabled` AND
`moderation.outputEnabled` (default `false`, matching the guard's dual-toggle pattern) before
doing anything else — disabled short-circuits to `next.handle()` unchanged, zero
`ModerationService` calls. When enabled, resolves the field/source via a new
`@ModerateOutputField(field, source?)` decorator (`decorators/moderate-output-field.decorator.ts`,
`SetMetadata`-based, mirrors AI-061's `@ModerateField` exactly — `MODERATE_OUTPUT_FIELD_KEY`,
default `field: 'content'`/`source: 'standalone'`), then pipes `next.handle()` through
`switchMap()` (`rxjs/operators`, same import convention as `ResponseInterceptor`'s `map()`) into a
private async `moderatePayload()`.

`moderatePayload()`: a non-object payload or one missing the resolved field passes through
untouched with no service call (same guard-rail as AI-061's non-string-field check). A present
string field is sent to `ModerationService.moderateText(text, { direction: 'output', source,
userId, requestId, action: ModerationAction.REPLACED })` — `action: REPLACED` only actually
matters on the flagged branch (`ModerationService` already forces `ALLOWED` when clean,
regardless of what's passed), same self-documenting-intent convention the guard established for
`action: BLOCKED`. Flagged → returns a shallow copy of the payload with only the resolved field
replaced by a new `SAFE_REPLACEMENT_MESSAGE` constant
(`constants/moderation-messages.constant.ts`, barrel-exported); clean → returns the original
payload reference unchanged. No extra work was needed to satisfy "log row records the original
content" — `ModerationService.moderateText()` already logs the exact `text` argument it was
called with (truncated internally per AI-060), so passing the pre-replacement text through
naturally produces the correct log row.

A moderation-API failure inherits AI-060's fail-open at the source: `moderateText()` catches the
error itself and returns a clean (`isFlagged: false`) result, so `moderatePayload()`'s existing
"clean → passthrough" branch already returns the original, unmodified payload with no
interceptor-level try/catch needed.

`ModerationModule` required no changes — `OutputModerationInterceptor` was already registered as
a provider/export from AI-057's scaffold, now with `ConfigService` as an added constructor
dependency (Nest resolves it automatically, already a global provider via `ConfigModule.forRoot()`).

Not wired into any real route — per this issue's own scope, that's AI-063.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean, no errors
- `npm run lint:check` — 0 errors in changed files (pre-existing warnings elsewhere unrelated)
- `npm run build` — succeeds
- `npm run test -- moderation` — 38/38 pass (guard + service + new interceptor spec)
- `npm run test` — 541/541 pass (full suite, no regressions)

## Assumptions Made

- `@ModerateOutputField` mirrors `@ModerateField`'s `(field, source?)` shape exactly (the issue
  text's own example only shows a single-argument `@ModerateOutputField('answer')`, but AI-063
  will need to tag chat vs. RAG routes with a `source` for the moderation log, same as the input
  guard already does) — kept for parity rather than inventing a second metadata shape.
- The replaced payload is a shallow copy (`{ ...record, [field]: SAFE_REPLACEMENT_MESSAGE }`), not
  a deep clone — every existing response shape this will apply to (`AssistantMessageResDto`,
  `AskResDto`) has no nested object under the replaced field itself, so shallow copy is sufficient
  and avoids an unnecessary deep-clone dependency.

## Follow Ups

- AI-063 will apply `@UseInterceptors(OutputModerationInterceptor)` +
  `@ModerateOutputField('content', 'chat')` / `@ModerateOutputField('answer', 'rag')` to the real
  chat/RAG routes, and `@UseGuards(ModerationGuard)` + `@ModerateField(...)` alongside it.
- The SSE streaming route (`ChatController`'s raw `@Res()` handler) is confirmed out of scope for
  this interceptor — bare `@Res()` bypasses NestJS interceptor mapping entirely, a documented
  Phase 4 scope boundary, not a gap to close later.
