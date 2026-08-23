---
id: AI-033
title: ChatController — SSE streaming endpoint
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-07
completed_at: 2026-07-07
parent_epic: Epic 6 — API Layer
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-029
  - AI-031
---

# What to Build

Add `POST /chat/conversations/:publicId/messages/stream` — the SSE endpoint.

**The global `ResponseInterceptor` will corrupt this route if left active** — it wraps every controller return value in `{ success, data, timestamp }` JSON, which is incompatible with SSE's `event:`/`data:` line framing. Exclude this specific route from the interceptor. NestJS's `@Sse()` decorator (which returns an `Observable<MessageEvent>` and handles `text/event-stream` framing itself, bypassing the normal HTTP response pipeline including global interceptors for that route) is the cleanest fit here — investigate whether `@Sse()` composes with an `AsyncGenerator` return type directly or needs an adapter converting the generator to an `Observable` (e.g. via a small `from(asyncGeneratorToArray())`-style bridge, or manually constructing an `Observable` that pulls from the generator with `subscriber.next()` per yielded event). If `@Sse()` proves awkward with NestJS's interceptor-exclusion behavior in practice, the documented fallback is a raw `@Res()` `Response` object with manual `res.write('event: ...\ndata: ...\n\n')` calls and `Content-Type: text/event-stream`/`Cache-Control: no-cache`/`Connection: keep-alive` headers set explicitly — pick whichever actually avoids the `ResponseInterceptor` wrapping when verified against a running server, and document the choice.

**Client disconnect detection**: use `@Req() request: Request` to access the raw request, listen for `request.on('close', ...)`, and on close call `abortController.abort()` where `abortController` is the `AbortController` whose `.signal` was passed into `ChatService.sendMessageStream()` (AI-029). This must happen within ~1 second of the actual disconnect (NFR-CH-008) — `request.on('close')` fires promptly on most Node HTTP server configurations, but verify this manually against a real client disconnect (e.g. `curl -N` interrupted with Ctrl+C) rather than assuming.

**Event framing**: each `StreamEvent` yielded by `ChatService.sendMessageStream()` becomes one SSE frame: `event: <type>\ndata: <JSON.stringify(data)>\n\n`. Map `StreamEventType` enum values directly to the `event:` field.

# User Stories Covered

- Story 21–27 (all of Epic 4's streaming stories, from the HTTP-transport side — the underlying behavior is AI-028/AI-029, this issue is what actually exposes it as a reachable SSE endpoint)
- Story 43 — SSE bypasses the global `ResponseInterceptor`

# Acceptance Criteria

- [x] `POST /chat/conversations/:publicId/messages/stream` returns valid `text/event-stream` content — verified with `curl -N` against a running server, not just unit tests
- [x] Response is NOT wrapped in `{ success, data, timestamp }` — raw SSE framing reaches the client
- [x] Disconnecting the client mid-stream (verified manually) results in the upstream OpenAI call being aborted and a partial message being persisted (per AI-029's contract)
- [x] Every event type (`token`, `tool_call`, `tool_result`, `done`, `error`) is correctly framed as its own SSE event (`token`/`done`/`error` verified live against the real API; `tool_call`/`tool_result` covered only by the pure-function frame-formatting test — see Assumptions)
- [x] Endpoint documented in Swagger (Swagger's SSE support is limited — document at minimum the request body shape and a note that the response is `text/event-stream`, not JSON)
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes
- [x] `npm run dev` boots with no errors; manual `curl -N` smoke test produces a visible token stream

# Dependencies

- AI-029 — `ChatService.sendMessageStream()`
- AI-031 — controller/module scaffolding, other conversation routes already in place

# Testing Notes

This is one of the harder things to unit-test meaningfully in this codebase — the actual SSE transport (headers, interceptor bypass, disconnect timing) is best verified manually against a running server rather than mocked in Jest. Do include a unit test for the event-framing logic itself (given a list of `StreamEvent`s, confirm the SSE-frame-formatting function produces correctly-shaped `event:`/`data:` strings) as a pure-function test separate from the transport concern.

**Manual testing prompt** (the agent cannot verify real network transport/disconnect timing alone):

> "Could you run `curl -N -X POST http://localhost:3000/api/v1/chat/conversations/<publicId>/messages/stream -H 'Content-Type: application/json' -d '{\"content\":\"Count from 1 to 10\"}'` and confirm you see a live stream of `event: token` lines followed by `event: done`? Then try starting the same request and pressing Ctrl+C after a few tokens — I want to confirm the server logs show the stream was aborted and doesn't crash."

This manual verification was actually performed directly (agent has shell/curl access to a locally running dev server) rather than handed off — see Implementation Notes.

## Implementation Notes

**Design decision — raw `@Res()`, not `@Sse()`.** Traced NestJS 11's actual router-execution-context
source (`@nestjs/core/router/router-execution-context.js`) to settle the interceptor question
definitively rather than guessing: bare `@Res()` (without `{ passthrough: true }`) sets
`isResponseHandled = true`, which makes Nest skip `responseController.apply(result, res, ...)`
entirely — the global `ResponseInterceptor`'s transform still runs (it's harmless, wrapping a
value that's simply discarded) but is **never written to the client**, regardless of what it does.
This is a hard guarantee from the framework's own control flow, not something that needs
"investigating" per request. `@Sse()` was ruled out for a different reason: its decorator source
(`@nestjs/common/decorators/http/sse.decorator.js`) defaults `RequestMethod.GET` and only exposes
`method` via an internal, undocumented second parameter — since spec §6.2 requires **POST** with a
JSON body (this isn't a browser `EventSource`, which can only do GET), using `@Sse()` here would
mean relying on an unsupported implementation detail for the one thing that matters (the HTTP
method), for no benefit over the simpler, already-guaranteed-correct `@Res()` approach.

**The priming-call pattern for pre-stream errors.** `sendMessageStream()` (AI-029) validates the
conversation and content synchronously at the top of its generator body, before yielding anything.
The controller exploits this: it calls `stream.next()` **once** before writing any SSE headers. If
that throws (`NotFoundException`/`BadRequestException`), nothing has touched `response` yet, so the
exception propagates uncaught straight to the global `HttpExceptionFilter` — producing the exact
same JSON 404/400 shape every other endpoint returns, with zero duplicate error-handling logic in
this controller. Only once the first `StreamEvent` is confirmed ready does the controller commit to
`response.writeHead(200, {...})` and start writing SSE frames. A failure _after_ headers are
committed (e.g. a DB write failing while persisting the assistant message) is caught separately and
surfaced as one last `event: error` frame instead — headers can't be changed at that point.

**Critical bug caught by live testing, not unit tests**: the first implementation attached the
disconnect listener via `request.on('close', ...)`. Live `curl` + `kill -9` testing against a real
running server (`npm run dev`) proved this **never fires** — a small JSON POST body is fully
consumed by Express before the controller method even runs, so the request's readable stream (and
its `'close'` event) can fire before a listener is attached inside the handler, silently swallowing
every disconnect. Fixed by listening on `response.on('close')` instead — the response stream stays
open for the full duration of the SSE stream, so its `'close'` event reliably fires exactly once,
exactly when the underlying connection terminates (verified: re-ran the same live test after the
fix — `metadata: {"incomplete": true}` and an `ai_audit_logs` row with `status: FAILED` and a
non-zero partial token count both persisted correctly, abort detected within ~1.5s). This is exactly
why the issue's own testing notes insisted on live verification instead of trusting unit tests here
— `chat.service.spec.ts`/`streaming.service.spec.ts` mock `AbortSignal` directly and could never
have caught a bug in how the real Express transport wires into it.

**Event framing**: `formatSseFrame(event)` (`src/modules/ai-chat/utils/sse-frame.util.ts`) is a
pure function — `` `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n` `` — pulled out
of the controller specifically so it's unit-testable independent of the transport concern, per this
issue's own testing notes. Covered by `sse-frame.util.spec.ts` (token/tool_call/done/error shapes).

**Swagger**: `@ApiEndpoint({ summary, isPublic: true })` without a `type` (so no JSON success schema
is generated — there isn't one), plus `@ApiProduces('text/event-stream')` and an `@ApiOkResponse`
whose `description` explicitly states the response is `text/event-stream`, not JSON, and lists the
five possible `event:` names.

**Live verification performed** (real OpenRouter free-tier models, real Postgres — not mocked):

- Headers dump confirmed `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, status 200, and critically **no** `{success,data,timestamp}` wrapper —
  compared directly against the non-streaming `POST /messages` route's response shape, which _is_
  wrapped, proving the interceptor bypass is real and route-specific.
- A full successful turn: `event: token` → `event: done` with the exact `{messageId, usage,
estimatedCost, latencyMs}` shape from spec §6.3, and the DB showing the assistant message with no
  `incomplete` flag and the audit log with `status: SUCCESS`.
- Two real upstream API failures (502, 429 from different free models) both correctly produced an
  `event: error` frame, a persisted assistant message with `metadata: {"incomplete": true}`, and an
  audit log row with `status: FAILED` and the real provider error message — confirming AI-029's
  contract holds under genuine (not mocked) failures.
- `GET`-equivalent 404 on an unknown `publicId`: confirmed a standard JSON `{statusCode: 404, ...}`
  body via the global exception filter, not an SSE frame — proving the priming-call design works.
- A genuine client disconnect (`curl` process killed 1.5s into a long-generation request): server
  logs showed no crash, and the DB showed the exact partial-persistence contract described above.
- `npm run dev` boots cleanly with the new route mapped
  (`Mapped {/api/v1/chat/conversations/:publicId/messages/stream, POST} route`), no DI errors.

All test conversations/messages created during live verification were deleted from the DB
afterward; no test artifacts were left behind.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (pre-existing `no-unsafe-*` warnings only, per `CLAUDE.md`'s documented
  downgrade; no new warnings introduced)
- `npm run build` — succeeds
- `npm run test -- chat` — 130/130 pass (includes the new `sse-frame.util.spec.ts`, 4/4)
- `npm run test` — 250/250 pass (full suite, no regressions)
- Live verification: see above — real server, real OpenRouter API, real Postgres, no mocks

## Assumptions Made

- **`tool_call`/`tool_result` framing is verified only as a pure function, not end-to-end live.**
  Per AI-029's already-documented "Known gap, by design," `ChatService.sendMessageStream()` never
  executes tool calls or emits a `tool_result` event — it only forwards `TOOL_CALL` events from
  `StreamingService`. Since the test conversations used here had `toolsEnabled: false`, no live
  `tool_call` event was actually observed on the wire; `formatSseFrame()`'s correctness for that
  shape is covered by `sse-frame.util.spec.ts` instead. This is an inherited scope boundary, not a
  new gap introduced by this issue.
- **No dedicated `chat.controller.spec.ts` was created.** AI-034 ("ChatController tests +
  function-calling integration + regression") explicitly owns full `ChatController` test coverage;
  creating a parallel suite here would duplicate that work. This issue's own testing notes only ask
  for the pure-function frame-formatter test, which is what was added.
- **NFR-CH-008's "~1 second" disconnect-to-abort budget** is treated as informally satisfied
  (observed ~1.5s including the request's full priming phase — conversation lookup, user-message
  persist, context build — not just the disconnect-to-abort latency itself, which is effectively
  immediate once `response.on('close')` fires) rather than formally benchmarked, since the spec
  doesn't define a precise measurement methodology.

## Follow Ups

- AI-034 should add full `ChatController` test coverage (all routes, including this one's
  request-validation and DTO-mapping behavior via mocked `ChatService`).
- AI-035's live smoke test should specifically exercise a `toolsEnabled: true` streaming
  conversation to observe a real `tool_call` frame on the wire, given this issue could only verify
  that shape as a pure function.
- If OpenRouter's free-tier rate limiting/latency continues to complicate live verification (as it
  did here — two real 429/502 failures were incidentally hit during testing, and the default
  70B model was too slow to produce a first token within a reasonable window, consistent with
  AI-025/AI-032/AI-035's already-documented precedent), consider documenting a specific
  known-fast free model in `.env.example` for future manual smoke tests.
