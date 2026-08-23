---
id: AI-024
title: Built-in tools — calculator (mathjs) and datetime (dayjs)
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
  - AI-016
---

# What to Build

Implement the two built-in tools that need no external HTTP call: `calculator` and `datetime`. Each is a small, independently-testable pure(ish) function/class that `ToolExecutorService` (AI-026) will dispatch to by tool name.

**Add `mathjs` as a new npm dependency** (`npm install mathjs`) — it is not currently in `package.json`.

**Calculator**:

```typescript
function executeCalculator(args: { expression: string }): { result: number };
```

Use `mathjs`'s `evaluate(expression)`. Never use `eval()` or `new Function()` — this is a hard security rule (spec FR-CH-008), not a style preference. Wrap the call so a malformed expression (syntax error, undefined variable) throws a catchable error rather than propagating a `mathjs`-internal exception type — `ToolExecutorService` expects a plain `Error` it can convert to `{ success: false, error }`.

Add a basic input guard against pathological input (e.g. reject expressions over some reasonable length, like 200 characters) — `mathjs`'s `evaluate()` not using `eval()` closes the code-execution risk, but an absurdly nested expression could still be slow; a length cap is cheap insurance against that class of issue without needing a full complexity analyzer.

**Datetime**:

```typescript
function executeDatetime(args: {
  timezone: string;
  operation?: 'now' | 'diff';
  date1?: string;
  date2?: string;
}): Record<string, unknown>;
```

Use `dayjs` (already a project dependency) with its timezone plugin (`dayjs/plugin/timezone` + `dayjs/plugin/utc` — these plugins ship with `dayjs` itself, no new package needed, just `dayjs.extend()` calls, likely once at module load in this tool's file).

- `operation: 'now'` (default when omitted) — return the current date/time in the given IANA timezone, plus the timezone name itself, in a shape useful for the model to read back (e.g. `{ datetime: '2026-07-06T14:32:00+05:30', timezone: 'Asia/Kolkata' }`)
- `operation: 'diff'` — given `date1`/`date2` (ISO 8601), return the difference (e.g. in days, or a human-readable breakdown — pick one, document the choice)

Invalid/unparseable `timezone` or `date1`/`date2` should throw a catchable error with a clear message, not silently return `Invalid Date`.

# User Stories Covered

- Story 28 — calculator answers math questions exactly
- Story 29 — calculator never uses `eval()`/`new Function()`

# Acceptance Criteria

- [x] `mathjs` added to `package.json` dependencies
- [x] Calculator uses `mathjs.evaluate()` exclusively — verifiable by grep that no `eval(` or `new Function(` appears in the tool's implementation file
- [x] Calculator correctly evaluates `234 * 567`, `sqrt(144) + pow(2, 10)`, and rejects malformed expressions with a catchable error (not an uncaught exception)
- [x] An overly long expression is rejected before being passed to `mathjs`
- [x] Datetime `operation: 'now'` returns the correct current time for a given IANA timezone
- [x] Datetime `operation: 'diff'` returns a correct difference for two given ISO dates
- [x] Invalid timezone or unparseable dates throw a clear, catchable error
- [x] Unit tests cover both tools' happy paths and error paths
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-016 — module scaffold (these tools live under the `ai-chat` module's `tools/` area)

# Testing Notes

**Primary seam**: plain unit tests on the exported functions — no NestJS DI involved, no mocking needed beyond mocking `Date`/timezone if determinism matters (prefer passing explicit ISO dates into `diff` tests rather than relying on "now" for anything assertion-critical, since `Date.now()` isn't mockable-by-convention in this codebase's test setup for other reasons documented in Workflow tooling — just use fixed input dates).

Test calculator against both the spec's example inputs (`234 * 567` → `132678`) and at least one deliberately malformed expression (e.g. `alert('x')` or an unclosed paren) to prove it fails safely rather than executing anything.

## Implementation Notes

New `src/modules/ai-chat/tools/` directory (plain exported functions, no NestJS DI — matches
AI-026's stated dispatch plan of a `Record<string, (args) => Promise<unknown>>` map keyed by tool
name, so these must be importable directly rather than injected services):

- `calculator.tool.ts` — `executeCalculator({ expression })`. Uses `mathjs`'s `evaluate()`
  exclusively (verified: `alert('x')` throws mathjs's own "Undefined function alert" — it is never
  passed to JS `eval`). Guards: empty/non-string expression, a 200-character length cap, a
  try/catch around `evaluate()` that rethrows as a plain `Error` (mathjs throws its own error
  classes internally), and a finite-number check on the result (catches `1/0` → `Infinity`).
- `datetime.tool.ts` — `executeDatetime({ timezone, operation, date1, date2 })`. Uses `dayjs` with
  the `utc`+`timezone` plugins (`dayjs.extend()` once at module load, no new package — both plugins
  ship inside `dayjs` itself). `operation: 'now'` (default) returns `{ datetime, timezone }` via
  `dayjs().tz(tz).format()`. `operation: 'diff'` returns `{ date1, date2, timezone, diffDays,
diffMs }`. An invalid IANA timezone string throws a Node `RangeError` from the underlying `Intl`
  API (verified: `dayjs().tz('Not/AZone')` → `RangeError: Invalid time zone specified`) — wrapped in
  try/catch and rethrown as a plain `Error('Invalid timezone: ...')` so callers only ever see one
  error shape.
- `index.ts` — barrel re-exporting both functions and their arg/result types.

Tests added to the module's existing flat `__tests__/` directory (matching `chat.service.spec.ts`'s
convention, not a nested `tools/__tests__/`): `calculator.tool.spec.ts` (7 tests) and
`datetime.tool.spec.ts` (11 tests).

`mathjs@^15.2.0` added to `package.json` dependencies via `npm install mathjs`.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 35 pre-existing warnings (none introduced by this change)
- `npm run build` — succeeds
- `npm run test -- ai-chat` — 75/75 pass (5 suites, including the two new tool spec files)
- `npm run test` — 195/195 pass (15 suites, full regression clean)

## Assumptions Made

- **Diff shape**: spec left the exact difference format open ("in days, or a human-readable
  breakdown — pick one, document the choice"). Chose `{ diffDays, diffMs }` — whole days (dayjs'
  default truncation-towards-zero) plus the exact millisecond delta, so the model can read back
  either a coarse or a precise answer without a second call.
- **`diff` also validates `timezone`**: the spec's `diff` example doesn't use the timezone directly
  (both dates are absolute ISO 8601 instants), but since `timezone` is the tool's one `required`
  parameter per the JSON Schema (AI-017/AI-023's seed data), an invalid timezone string is still
  rejected up front for consistency with the `now` path, rather than silently ignored.
- **Unknown `operation` value**: TypeScript's `'now' | 'diff'` union doesn't stop a live tool call
  (arguments arrive as parsed JSON from the model, not statically typed), so a runtime check throws
  `Unknown operation: <value>` for anything outside those two literals.

## Follow Ups

- `ToolExecutorService` (AI-026) is the next consumer — it will import `executeCalculator`/
  `executeDatetime` from `tools/index.ts` for its builtin-dispatch map, alongside `executeWeather`
  once AI-025 lands.
