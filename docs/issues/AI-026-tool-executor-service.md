---
id: AI-026
title: ToolExecutorService — dispatch, timeout, parallel execution, HTTP whitelist
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-07-07
completed_at: 2026-07-07
created: 2026-07-06
parent_epic: Epic 5 — Tool Registry & Built-in Tools
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-023
  - AI-024
  - AI-025
---

# What to Build

Implement `ToolExecutorService.execute(toolName, args): Promise<ToolExecutionResult>` — the single entry point that runs a tool once the model has requested it, and the guard rails around that execution.

```typescript
interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  executionMs: number;
}
```

**Dispatch**: look up the tool via `ToolRegistryService.findActiveTool(toolName)`. If it throws (unknown or inactive tool), catch it here and return `{ success: false, error: "Tool '<name>' is not available" }` rather than letting the exception propagate — per FR-CH-012/spec §8.4, a tool failure must never crash the chat request.

For `handlerType: 'builtin'`: dispatch by `name` to the corresponding function from AI-024/AI-025 (`calculator`, `weather`, `datetime`) — a small internal `Record<string, (args) => Promise<unknown>>` map keyed by tool name is the simplest dispatch mechanism.

For `handlerType: 'http'`: read `tool.handlerConfig` (`{ url, method, headers }`), validate `url`'s hostname against `chatConfig.httpToolAllowedDomains` (from AI-015) before issuing the request — reject with `{ success: false, error: "Domain not allowed: <host>" }` if the whitelist is non-empty and the host isn't in it (an empty whitelist means "allow nothing," not "allow everything" — fail closed, not open, since an empty-by-default whitelist should block all HTTP tools until explicitly configured). Issue the request via `HttpService` with `args` as the request body.

**Timeouts**: builtin tools get `chatConfig.toolTimeoutMs` (default 10s); HTTP tools get `chatConfig.httpToolTimeoutMs` (default 5s). Implement via `Promise.race()` against a timer promise, or RxJS's `timeout()` operator if the call is already `HttpService`-based (Observable). On timeout, return `{ success: false, error: 'Tool execution timed out' }` exactly as worded in spec FR-CH-012/§8.4 — don't let the underlying operation's own error surface instead.

**Parallel multi-tool execution**: this service doesn't itself decide when multiple tools run — that's `ChatService`'s job (AI-027) — but expose `execute()` as a method safe to call N times concurrently via `Promise.all()` from the caller, i.e. no shared mutable state between concurrent `execute()` calls (each call should be fully independent).

**Error isolation**: every path — unknown tool, timeout, HTTP failure, builtin function throwing — must resolve to a `ToolExecutionResult` with `success: false` and a string `error`, never a rejected promise bubbling out of `execute()`.

Track `executionMs` for every result (success or failure) — `Date.now()` before/after.

# User Stories Covered

- Story 32 — multiple tool calls execute in parallel (enabled by this service's statelessness; proven end-to-end in AI-027)
- Story 33 — timeout returns structured error, not a hang/throw
- Story 34 — unknown/inactive tool returns structured error
- Story 40 — HTTP tool domain whitelist enforced

# Acceptance Criteria

- [x] `execute()` never rejects — every code path resolves to a `ToolExecutionResult`
- [x] Builtin dispatch correctly routes to calculator/weather/datetime by name
- [x] Unknown or inactive tool name returns `{ success: false, error: "..." }`
- [x] A builtin tool exceeding `toolTimeoutMs` returns `{ success: false, error: 'Tool execution timed out' }`
- [x] An HTTP tool exceeding `httpToolTimeoutMs` returns the same timeout error shape
- [x] An HTTP tool whose URL host isn't in `httpToolAllowedDomains` is rejected before any request is sent
- [x] `executionMs` is populated on every result
- [x] Ten concurrent `execute()` calls (mixed tools) complete correctly with no cross-call state bleed (proven by a test running several calls via `Promise.all` and asserting each result independently)
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-023 — `ToolRegistryService.findActiveTool()`
- AI-024, AI-025 — builtin tool implementations to dispatch to

# Testing Notes

**Primary seam**: `tool-executor.service.spec.ts`, mocking `ToolRegistryService` and the builtin tool functions (or importing them directly if they're plain exported functions rather than injected services — simpler to unit test that way).

Timeout tests: use `jest.useFakeTimers()` or a deliberately slow mocked function (`new Promise(resolve => setTimeout(resolve, timeoutMs + 100))`) combined with fake timers to avoid actually waiting 10 real seconds per test run.

Whitelist test: assert both the "allowed domain passes through" and "disallowed domain rejected" cases, plus the "empty whitelist blocks everything" fail-closed behavior explicitly, since that's the one behavior most likely to be implemented backwards (fail-open) by accident.

## Implementation Notes

Implemented `ToolExecutorService` (`src/modules/ai-chat/services/tool-executor.service.ts`),
replacing the AI-016 empty shell. Constructor now injects `ToolRegistryService`, `WeatherTool`,
`HttpService`, `ConfigService`, `AppLoggerService` (dropped the shell's unused `DatabaseService` —
this service never touches the DB directly, it goes through `ToolRegistryService`).

`execute(toolName, args)`:

1. `toolRegistry.findActiveTool(toolName)` — **any** error here (unknown or inactive tool) is
   caught and mapped to `{ success: false, error: "Tool '<name>' is not available" }`, matching
   the spec's exact wording without needing to special-case `NotFoundException`.
2. Branches on `tool.handlerType`: `'http'` → `executeHttp()`, everything else → `executeBuiltin()`.
3. `executeBuiltin()` dispatches through a `Record<string, (args) => Promise<unknown>>` map built
   in the constructor — `calculator`/`datetime` call AI-024's plain exported functions directly
   (wrapped in `Promise.resolve()` since they're synchronous); `weather` calls the injected
   `WeatherTool.execute()` (AI-025's one exception to "plain function"). A builtin-typed tool with
   no matching map entry falls back to the same "not available" failure shape.
4. `executeHttp()` reads `handlerConfig.url`/`method`/`headers`, resolves the hostname via `new
URL()`, and checks it against `chatConfig.httpToolAllowedDomains` **before** calling
   `HttpService.request()` — an empty/unset whitelist rejects every host (fail-closed, not
   fail-open). On failure, `httpMock.request` is never called, verified directly in tests.
5. Both paths write the result into `{ success: true, result, executionMs }` or `{ success: false,
result: null, error, executionMs }` via two small private helpers (`success()`/`failure()`) so
   every return statement is one line and the shape can't drift between call sites.

**Timeouts**: `executeBuiltin()` races the handler's promise against a `setTimeout`-based
`ToolTimeoutError` via a private `withTimeout()` helper (`Promise.race()`, per the issue's own
suggested approach) — implemented with `Promise.race([promise, timeoutPromise]).finally(() =>
clearTimeout(timer))` rather than a hand-rolled `new Promise((resolve, reject) => ...)` wrapper,
since manually calling `reject(error)` on a `catch`-bound `error: unknown` tripped
`@typescript-eslint/prefer-promise-reject-errors` (ESLint can't prove the caught value is an
`Error` even though at runtime it always is here). `executeHttp()` instead pipes RxJS's `timeout()`
operator onto the `HttpService.request()` Observable and catches the resulting `TimeoutError` (from
`'rxjs'`) — no custom timer needed since the call is already Observable-based, exactly as the
issue suggested as the alternative for HTTP. Both timeout paths converge on the identical
`'Tool execution timed out'` error string.

**Statelessness**: `builtinHandlers` is built once in the constructor and holds no per-call state;
`execute()` has no shared mutable fields written during a call. Proven by a test running 10
concurrent `calculator`/`datetime` calls via `Promise.all()` and asserting each result
independently.

New test file `tool-executor.service.spec.ts` (13 tests) covers builtin dispatch (calculator,
datetime — run for real, not mocked, since they're pure functions; weather — mocked via DI),
unknown/inactive-tool failure, a builtin-typed tool with no handler, both timeout paths (via
`jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync()`, per the issue's own suggested
approach — no real 10-second wait), the three whitelist cases (allowed/disallowed/empty-fails-closed),
a missing-`url` HTTP config, and the 10-concurrent-call statelessness proof.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 44 warnings (37 pre-existing + 7 new `no-unsafe-assignment` warnings
  in `tool-executor.service.spec.ts`, from the same `expect.objectContaining()`/`toEqual()` pattern
  already used throughout every other spec file in this codebase — not a new category of warning)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 101/101 pass (7 suites, including the new
  `tool-executor.service.spec.ts`)
- `npm run test` — 221/221 pass (17 suites, full regression clean)

## Assumptions Made

- **HTTP method default**: spec's `handlerConfig` shape (`{ url, method, headers }`) doesn't state
  a default `method` when omitted — defaulted to `'POST'` (args are sent as the request body,
  which only makes sense for a body-carrying verb; `GET` would silently drop `args`).
- **`error instanceof Error ? error.message : String(error)`** for the generic failure path —
  covers both real `Error`s thrown by builtin handlers (calculator's malformed-expression errors,
  datetime's invalid-timezone errors) and any non-`Error` rejection, without ever letting
  `execute()` itself reject.
- **No module-level shared constant for the timeout defaults** (`10_000`/`5_000`) — kept as local
  `const`s in `tool-executor.service.ts` mirroring `app.config.ts`'s own defaults, since they're
  only used as a fallback for when `ConfigService.get()` returns `undefined` (which shouldn't
  happen in a running app — `chatConfig` always supplies these) and aren't shared with any other
  service, unlike `CONTEXT_CONFIG` which `ChatService` reuses across multiple methods.

## Follow Ups

- AI-027 (`ChatService` function-calling flow) is now fully unblocked — it will call
  `ToolExecutorService.execute()` from its two-call protocol, running multiple tool calls in
  parallel via `Promise.all()` exactly as this service was designed to support.
- HTTP-handler tools have no seed data or CRUD-created example yet (`ToolRegistryService.createTool()`
  from AI-023 supports `handlerType: 'http'` already) — the whitelist/timeout logic here is
  unit-tested but has no live end-to-end HTTP tool exercised anywhere yet; that's implicitly
  covered whenever a real HTTP tool is registered via the API (AI-032) and called through AI-027.
