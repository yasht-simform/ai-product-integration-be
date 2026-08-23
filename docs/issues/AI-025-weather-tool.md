---
id: AI-025
title: Built-in tool — weather (Open-Meteo)
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

Implement the `weather` built-in tool: given a city name (and optional units), resolve it to coordinates via Open-Meteo's free geocoding endpoint, then fetch current conditions from Open-Meteo's forecast endpoint. Neither call requires an API key.

```typescript
function executeWeather(args: {
  city: string;
  units?: 'celsius' | 'fahrenheit';
}): Promise<WeatherResult>;
```

Use NestJS's `HttpModule`/`HttpService` (already imported in `OpenaiModule` for `OpenRouterSyncService` — reuse the same pattern rather than a raw `fetch`, for consistency and so the existing HTTP interceptor/error-handling conventions apply).

**Flow**:

1. Geocoding: `GET https://geocoding-api.open-meteo.com/v1/search?name=<city>&count=1` — resolve to `{ latitude, longitude }`. If zero results (ambiguous or unknown city name, e.g. "Springfield" with no country qualifier — noted as a real risk in the PRD), throw a clear catchable error (`"Could not find location: <city>"`) rather than letting a downstream `undefined` propagate into the forecast call.
2. Forecast: `GET https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=<celsius|fahrenheit>` — map the response into a result shape the model can read naturally, e.g. `{ city, temperature, units, humidity, windSpeed, conditions }` (translate Open-Meteo's numeric `weather_code` into a short human-readable string — Open-Meteo publishes a WMO code table; a small lookup map covering the common codes is sufficient, defaulting to `"Unknown"` for uncovered codes rather than throwing).

Default `units` to `'celsius'` when omitted.

# User Stories Covered

- Story 30 — weather tool answers via Open-Meteo, no API key
- Story 31 (partial — this issue is the single-tool half; multi-tool composition is proven in AI-026/AI-027)

# Acceptance Criteria

- [x] Geocoding + forecast calls both implemented via `HttpService`
- [x] Unresolvable city name throws a clear, catchable error (not an unhandled rejection or a crash on `undefined` coordinates)
- [x] Result includes temperature (in the requested unit), humidity, wind speed, and a human-readable conditions string
- [x] Both API calls are mocked in unit tests — no live network call in the automated suite
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

- AI-016 — module scaffold

# Testing Notes

**Primary seam**: unit test with `HttpService` mocked via `jest.fn()` returning `rxjs`'s `of(...)`, following `openrouter-sync.service.spec.ts`'s exact pattern for mocking `HttpService` responses (that file is the established precedent in this codebase for testing an `HttpService`-based integration without a live call).

Test cases: successful lookup returns a well-shaped result; zero geocoding results throws the expected error; a request with `units: 'fahrenheit'` passes the correct query param through to the forecast call.

A real Open-Meteo call is only exercised manually per spec SC-CH-006 — flag in the PR/issue notes that this is expected to be flakier than the mocked suite and should not gate CI, per the PRD's Further Notes.

## Implementation Notes

Implemented as `WeatherTool` (`src/modules/ai-chat/tools/weather.tool.ts`), an `@Injectable()`
NestJS class rather than a plain exported function like AI-024's `calculator`/`datetime` tools —
a deliberate deviation, documented under Assumptions below, since a real HTTP call needs the
project's shared `HttpService`/`HttpModule` conventions (matching `OpenRouterSyncService`, the
existing precedent for `HttpService`-based integrations) rather than a raw `fetch`.

`execute({ city, units })`:

1. `geocode()` — `GET https://geocoding-api.open-meteo.com/v1/search?name=<city>&count=1`. Empty
   or missing `results` both throw `Could not find location: <city>`.
2. `forecast()` — `GET https://api.open-meteo.com/v1/forecast` with the resolved
   `latitude`/`longitude`, `current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`,
   and `temperature_unit=<units>`. Maps the response to
   `{ city, temperature, units, humidity, windSpeed, conditions }`.

`WEATHER_CODE_DESCRIPTIONS` is a lookup covering Open-Meteo's full common WMO code set (clear/
cloudy/fog/drizzle/rain/snow/thunderstorm variants); an uncovered code falls back to `"Unknown"`
rather than throwing, per the issue's own guidance.

**Module wiring**: `AiChatModule` now imports `HttpModule` (`@nestjs/axios`) and registers
`WeatherTool` as a provider (not exported — same same-module-DI-only convention as
`ToolRegistryService`). `ToolExecutorService` (AI-026) will inject `WeatherTool` directly and call
`.execute()` as part of its builtin-dispatch map, alongside `executeCalculator`/`executeDatetime`.

`tools/index.ts` barrel updated to re-export `WeatherTool` and its `WeatherArgs`/`WeatherResult`
types alongside AI-024's exports.

New test file `weather.tool.spec.ts` (7 tests) mocks `HttpService` via a plain `{ get: jest.fn() }`
object returning `rxjs`'s `of(...)`, following `openrouter-sync.service.spec.ts`'s exact
established pattern — no live network call in the automated suite.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 37 warnings (35 pre-existing + 2 new `no-unsafe-assignment` warnings
  in `weather.tool.spec.ts`, from the same `jest.Mock`-typed `httpMock.get` pattern
  `openrouter-sync.service.spec.ts` already carries 3 of; consistent with existing convention, not
  a regression)
- `npm run build` — succeeds (confirms `AiChatModule`'s updated provider/import graph resolves)
- `npm run test -- ai-chat` — 82/82 pass (6 suites, including the new `weather.tool.spec.ts`)
- `npm run test` — 202/202 pass (16 suites, full regression clean)

## Assumptions Made

- **Class, not plain function**: the issue's TypeScript signature
  (`function executeWeather(args): Promise<WeatherResult>`) suggested a plain function like AI-024's
  tools, but the issue body also explicitly requires `HttpService` (not raw `fetch`) for consistency
  with existing HTTP-calling conventions. A plain module-level function can't receive
  constructor-injected `HttpService`, so `WeatherTool` is instead an `@Injectable()` class with an
  `execute()` method — `ToolExecutorService` (AI-026) will inject it and call
  `weatherTool.execute(args)` in its dispatch map, which still satisfies AI-026's stated
  `Record<string, (args) => Promise<unknown>>` dispatch shape (the map entry is a bound method, not
  a free function, but the call-site type is identical).
- **Diff/geocoding edge case**: both an empty `results: []` array and an entirely missing `results`
  key are treated identically (both throw `Could not find location: <city>`) — Open-Meteo's docs
  don't guarantee which shape a zero-match response takes, so both are handled defensively.

## Follow Ups

- `ToolExecutorService` (AI-026) is now fully unblocked on the builtin-tool side — all three
  (`calculator`, `datetime`, `weather`) exist. AI-026 remains blocked only on itself being
  implemented.
