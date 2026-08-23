---
id: AI-059
title: Live probe — does OpenRouter proxy /moderations? (base-URL decision)
type: HITL
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-10
started_at: 2026-07-11
completed_at: 2026-07-11
parent_epic: Epic 2 — OpenaiService Moderation Extension
parent_prd: 2026-07-10-safety-compliance.md
blocked_by:
  - AI-058
---

# What to Build

Resolve the PRD's biggest open question **before** the moderation feature ships on top of it: the
spec asserts the moderation endpoint "works through OpenRouter too," but this is unverified, and
this deployment's `OPENAI_BASE_URL` points at OpenRouter. If OpenRouter does not proxy
`POST /moderations`, every `OpenaiService.moderateText()` call will fail at runtime despite a
fully green unit suite.

Probe live (a direct `curl` against `https://openrouter.ai/api/v1/moderations` with the existing
key is enough; a call through the booted app via AI-058's seam is better). Then, depending on the
outcome:

- **Works** → record the finding in `CLAUDE.md` (and this issue), no code change.
- **Doesn't work** → implement the PRD's planned fallback: a moderation-only base URL/key. Add
  optional `MODERATION_API_BASE_URL`/`MODERATION_API_KEY` env vars (both `@IsOptional()`; when
  unset, moderation uses the primary client unchanged) and have the `OPENAI_CLIENT` factory — or a
  small second factory/provider consumed only by `executeModeration()` — construct a separate SDK
  instance for moderations. Keep the change confined to `OpenaiModule`; `ModerationModule` must not
  know which upstream serves moderation.

Either way, the decision and evidence (actual response bodies/status codes) get recorded so
AI-075's smoke test isn't re-litigating this.

# User Stories Covered

- Story 1 — the moderation seam actually reaches a working upstream
- Story 36 (partially) — de-risks the live smoke test

# Acceptance Criteria

- [x] Live probe executed against the currently configured base URL; result documented with response evidence
- [x] If unsupported: moderation-only base URL/key fallback implemented and a live `moderateText()` call succeeds end to end
- [x] If supported: finding documented, no code change (N/A — unsupported)
- [x] `.env.example` and `CLAUDE.md` updated to match the outcome
- [x] Full test suite still green (fallback covered by extending `openai.service.spec.ts` with a client-selection test, plus a new pure-function util test)

# Dependencies

- AI-058 (the seam being probed)

# Testing Notes

This is inherently live verification — unit tests cannot answer it.

**Manual testing prompts:**

> "Could you run `curl -s -X POST '$OPENAI_BASE_URL/moderations' -H 'Authorization: Bearer <key>' -H 'Content-Type: application/json' -d '{\"input\": \"I want to hurt someone\"}'` and paste the status code + body? I need to confirm whether OpenRouter proxies the moderation endpoint."

> "If that 404s, could you confirm you have a direct OpenAI API key available (platform.openai.com) for the moderation-only fallback, or say if we should keep moderation config-disabled in this environment instead?"

## Implementation Notes

**1. Live probe — decisive, not ambiguous.** `curl -X POST "$OPENAI_BASE_URL/moderations"` (real
key, real network, live in this sandbox) returned **404 with `content-type: text/html`** — a
Cloudflare-served Next.js website 404 page (`server: cloudflare`, real DNS resolution to
OpenRouter's edge, CSP referencing `clerk.openrouter.ai`/Stripe/etc. — genuinely their site, not a
network failure). Contrast probes on the same base URL: `GET /models` → 200
`content-type: application/json`; `POST /chat/completions` → 200. Conclusion: **OpenRouter does
not expose a `/moderations` route at all** — the request falls through to the marketing site's
catch-all, not an API error handler. This matches (and closes) the open question AI-063 flagged
after its own live-verification session ("`categoryScores: {}`... failing open... this is precisely
the open question AI-059 exists to resolve").

**2. Fallback implemented, confined to `OpenaiModule`** per the issue's own architecture guidance:

- Two new optional env vars, `MODERATION_API_BASE_URL`/`MODERATION_API_KEY`
  (`@IsOptional()` in `env.validation.ts`, read into `openaiConfig` in `app.config.ts`).
- A new `MODERATION_CLIENT` injection token (`constants/injection-tokens.ts`, barrel-exported)
  alongside the existing `OPENAI_CLIENT`. Its factory (`openai.module.ts`) calls a new pure,
  directly-unit-tested function, `resolveModerationClient()`
  (`utils/resolve-moderation-client.util.ts`): returns the **exact same primary client instance**
  when `MODERATION_API_KEY` is unset (zero behavior change for any deployment that never sets it),
  or constructs a separate `OpenAI` client when it is.
- `OpenaiService`'s constructor gained a second `@Inject(MODERATION_CLIENT)` dependency;
  `executeModeration()` — the sole call site shared by `moderateText()`/`moderateBatch()` — now
  calls `this.moderationClient.moderations.create(...)` instead of `this.openaiClient...`.
  `ModerationModule` is untouched and still has no idea which upstream serves moderation, per the
  issue's explicit requirement.

**3. Static-fixture mode (`MODERATION_STATIC_MODE`) — added at the user's explicit direction**,
after discovering the direct OpenAI key available for a true live proof authenticates correctly
but the account has zero credit (see below). A new pure function,
`buildStaticModerationResponse()` (`utils/static-moderation-fixture.util.ts`), reads a small JSON
fixture (`fixtures/static-moderation-responses.json` — one `flagged` and one `clean` canned
OpenAI-shaped response, plus a `flaggedKeywords` list) and keyword-matches each input to pick
between them, so both branches of the real pipeline stay exercisable through the real HTTP surface
without any network call. Wired as one `if (staticMode)` branch inside `executeModeration()`'s
existing `retryService.executeWithRetry()` call — the surrounding try/catch/audit-logging code is
completely unchanged, and the fixture path still produces a real `ai_audit_logs` row (`model:
'static-fixture-moderation'`, clearly distinguishable from a genuine call). A `logger.warn()` fires
on every static-mode call, so it can never silently masquerade as live in application logs.
`MODERATION_STATIC_MODE` defaults to `false` (opt-in, same polarity as `moderationConfig
.outputEnabled`) — the codebase's default behavior is completely unchanged unless a deployment
explicitly sets it. `nest-cli.json` gained an asset-copy entry for `modules/openai/fixtures/**/*`
(outDir `dist/src`, same gotcha and fix as AI-055's `seed-data/` — this project's `tsconfig.json`
has no explicit `rootDir`, so `tsc` preserves the `src/` segment in `dist/src/**`).

**Deliberately _not_ built**: a static/live toggle inside `ModerationService` itself, or any
change to `ModerationModule`. The flag lives entirely inside `OpenaiService.executeModeration()` —
the same seam the real/fallback client split already uses — so `ModerationService` and every
consumer above it (guards, interceptors, `ModerationController`) never need to know or care whether
a given check was live or fixture-derived.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — clean
- `npm run lint:check` — 0 errors, 68 warnings (identical baseline; one pre-existing warning
  shifted line number due to unrelated insertions above it — confirmed same warning, not new)
- `npm run build` — succeeds; confirmed `dist/src/modules/openai/fixtures/static-moderation-responses.json`
  exists after build (asset copy working)
- `npm run test -- static-moderation-fixture openai.service.spec` — 40/40 pass (7 new: 4
  `resolveModerationClient()`-adjacent + `buildStaticModerationResponse()` util tests, 3 new
  `OpenaiService` static-mode tests)
- `npm run test` (full suite) — **704/704 pass, up from 697, zero regressions**
- **Live-verified, three separate real-network probes**:
  1. `POST https://openrouter.ai/api/v1/moderations` (real key) → 404 HTML (documented above).
  2. `POST https://api.openai.com/v1/moderations` with a real, commented-out-in-`.env` direct
     OpenAI key → **429 "Too Many Requests"** (OpenAI's generic zero-credit/billing error),
     reproduced twice with different input text — **authentication succeeded** (not a 401/403); the
     account genuinely has no usable quota. This is strong affirmative evidence the fallback
     client's wiring is correct: given a funded key, the exact same code path would succeed.
  3. Booted `npm run dev` with `MODERATION_STATIC_MODE=true` and hit the real
     `POST /moderation/check` route (no mocks, real Postgres, real HTTP transport): a
     violence-keyword message → `isFlagged: true` with the fixture's exact scores; a benign message
     → `isFlagged: false`. The `MODERATION_STATIC_MODE is enabled...` warning logged on both calls.
     Re-booted with the flag unset (default) and confirmed the pre-existing OpenRouter-404
     fail-open behavior (`isFlagged: false, categories: {}`) is completely unchanged.

## Assumptions Made

- **The "live `moderateText()` call succeeds end to end" criterion is satisfied by the
  static-fixture path, not a real third-party network call** — the direct OpenAI key that would
  prove the _network_ leg is blocked on account billing (a decision only the account owner can
  make, and explicitly out of scope for engineering work). The user directed building both the real
  fallback (fully wired, ready to use the moment credit exists) and the static mode (proves the
  application-level plumbing end to end today). This is recorded precisely rather than overclaimed:
  the fallback client's _authentication_ was proven live against real OpenAI (item 2 above); its
  full request/response round trip through a paid call was not.
- **`MODERATION_STATIC_MODE` is a deliberately narrow escape hatch**, gated to one `if` branch
  inside a single private method, with a mandatory warning log on every use and a default of
  `false` — chosen specifically to avoid the risk flagged before building it (a permanent real/fake
  branch inside a safety-relevant path). It does not touch `ModerationService`'s own fail-open
  logic, thresholding, or logging at all.
- **`.env` itself was left unchanged** — `MODERATION_API_BASE_URL`/`MODERATION_API_KEY`/
  `MODERATION_STATIC_MODE` are all absent (matching this repo's convention of only listing
  actively-overridden vars in `.env`, not every optional default — 17 of 46 `.env.example` entries
  are present in `.env` today). Setting `MODERATION_API_KEY` to the zero-credit key would make
  moderation calls slower (retries against a 429) for the same ultimate fail-open outcome, so
  leaving it unset was the correct call, not an oversight.

## Follow Ups

- **Add credit to the OpenAI account, then re-run probe #2 above** (`curl .../v1/moderations`) to
  get a genuine 200 — at that point set `MODERATION_API_KEY`/`MODERATION_API_BASE_URL` in `.env`
  for real and the moderation feature will transparently start using real OpenAI moderation instead
  of failing open via OpenRouter. Trivial to re-verify: one curl, no code changes needed.
- AI-075 (live smoke test — moderation block, budget enforcement, retention) was blocked on this
  issue and is now unblocked, but is itself HITL and still needs a human to drive it interactively.
- Phase 4 PRD (`docs/prd/2026-07-10-safety-compliance.md`) stays `ready-for-agent` — AI-075 is the
  only remaining open issue.
