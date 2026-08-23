---
title: OpenAI API Foundations
status: ready-for-agent
created: 2026-06-25
last_updated: 2026-06-25
phase: 1
tags:
  - openai
  - ai-infrastructure
  - audit-logging
  - token-counting
  - retry-engine
  - prompt-library
authors:
  - Yash Trivedi
---

# OpenAI API Foundations

## Problem Statement

The application has no way to interact with OpenAI — no SDK wrapper, no cost tracking, no retry logic, and no observability into AI API calls. Every future phase (chat, RAG, moderation) will need reliable, observable, and cost-controlled LLM access.

From the **developer's learning perspective**, this phase teaches:

- How to design a centralized, production-grade AI service layer rather than calling the SDK directly from feature code
- How to implement exponential backoff with jitter and a circuit breaker state machine
- How to count tokens accurately with `tiktoken` and translate them into USD cost estimates
- How to structure audit logging as a fire-and-forget, append-only pattern that doesn't block API responses
- How to design prompt templates as reusable, database-backed artifacts with metadata

From the **system's technical perspective**, Phase 1 fills the following gaps:

- No `OpenaiService` — modules cannot call the OpenAI SDK safely
- No `TokenService` — token counts and cost estimates are unavailable at call time
- No `RetryService` — transient 429/500 errors cause immediate failures with no recovery
- No `AiAuditService` — there is no record of what AI calls were made, by whom, at what cost
- No `PromptTemplateService` — system prompts live in code with no CRUD, versioning, or metadata

The Prisma schema has no `ai_audit_logs` or `prompt_templates` tables. Both must be added in this phase.

---

## Solution

A single `OpenaiModule` composed of five focused services, one controller, and a complete Prisma schema extension. All OpenAI SDK calls are routed through `OpenaiService` — no other module calls the SDK directly.

**Module architecture:**

```
OpenaiModule
├── OpenaiService          ← public API for all AI feature modules
├── TokenService           ← tiktoken exact counts + cost calculation (pure, stateless)
├── RetryService           ← exponential backoff + in-memory circuit breaker (internal)
├── AiAuditService         ← append-only audit log writer + query layer
├── PromptTemplateService  ← CRUD for prompt_templates table
└── OpenaiController       ← 8 REST endpoint groups for testing/comparison
```

**Service responsibilities:**

- `OpenaiService` delegates token counting to `TokenService`, resilience to `RetryService`, and observability to `AiAuditService`. It is the only public surface.
- `RetryService` is internal to the module — it is not exported and never injected directly by feature modules.
- `TokenService` is exported so that Embeddings (Phase 3) can count tokens without going through `OpenaiService`.
- `AiAuditService` is exported so future dashboard/admin features can query logs.

**Data flow for a chat completion:**

```
OpenaiController
  → OpenaiService.chatCompletion()
      ├── TokenService.countTokens(input)          [pre-call estimation]
      ├── RetryService.executeWithRetry()           [wraps SDK call with backoff + circuit breaker]
      │     └── openai.chat.completions.create()   [actual OpenAI SDK call]
      ├── TokenService.calculateCost()              [from response.usage]
      └── AiAuditService.log()                     [fire-and-forget, non-blocking]
```

**Integration with existing modules:**

- `DatabaseModule` is global — `AiAuditService` and `PromptTemplateService` inject `DatabaseService` with no explicit import.
- `LoggerModule` is global — all services use `AppLoggerService` for structured output.
- `ConfigModule` is global — environment variables are read via `ConfigService` only; no `process.env` access.
- Future modules (`AiChatModule`, `EmbeddingsModule`, `RagModule`, `ModerationModule`) import `OpenaiModule` and inject `OpenaiService`.

---

## Epic Breakdown

### Epic 1: Database Schema Extension

**Goal**

Add `ai_audit_logs` and `prompt_templates` tables to `schema.prisma`, run a migration, and regenerate the Prisma client. This unblocks every other epic.

**Stories Included**

- Stories 1, 2, 3 (schema, migration, seed templates)

**Dependencies**

- None — this is the foundation epic

**Risks**

- Prisma v7 breaking changes: generator name is `"prisma-client"`, output is `../generated/prisma`, import path is `from '../../generated/prisma/client'`
- `prisma.config.ts` must remain at the project root (datasource URL lives there, not in `schema.prisma`)

**Success Criteria**

- Migration applies cleanly via `npm run prisma:migrate`
- All 6 seed templates insert successfully via `npm run prisma:seed`
- `npx prisma validate` passes
- `npx tsc --noEmit` passes after client regeneration

---

### Epic 2: Token Service

**Goal**

Implement `TokenService` as a pure, stateless utility for exact token counting and cost calculation. No database, no HTTP calls — only `tiktoken` and `MODEL_PRICING`.

**Stories Included**

- Stories 4, 5, 6 (exact counting, heuristic estimation, cost calculation)

**Dependencies**

- Epic 1 (module scaffold requires schema to exist)
- `tiktoken` npm package must be installed

**Risks**

- `tiktoken` uses WebAssembly — the encoding object **must** be freed after each use (`enc.free()`) or memory grows unboundedly (NFR-AI-002)
- WASM initialization adds latency on first call; subsequent calls are fast

**Success Criteria**

- `countTokens("Hello world", "gpt-4o")` returns `2` (exact, not estimated)
- `estimateTokens("Hello world")` returns `3` (`Math.ceil(11/4)`)
- `calculateCost("gpt-4o", 1000, 500)` returns the correct USD value against `MODEL_PRICING`
- Unit tests pass without hitting the OpenAI API
- No memory leak when calling `countTokens` 1000 times in a loop (manual verification)

---

### Epic 3: Retry Engine and Circuit Breaker

**Goal**

Implement `RetryService` with exponential backoff with jitter and a three-state in-memory circuit breaker. This service is internal to `OpenaiModule` — it wraps OpenAI SDK calls on behalf of `OpenaiService`.

**Stories Included**

- Stories 7, 8, 9, 10 (backoff, error classification, circuit states, audit integration)

**Dependencies**

- Epic 2 (module scaffold must exist)

**Risks**

- Circuit breaker state is in-memory only — lost on restart. This is acceptable per the decisions on record (NFR-AI-008).
- Retry delays in tests must be mocked (e.g., `jest.useFakeTimers()`) to avoid slow test suites

**Success Criteria**

- On a mocked 429 followed by a 200, `retryCount` in the audit log is `1` and the delay ≥ baseDelay
- After 5 consecutive mocked 500s, the 6th call throws `CircuitOpenException` without calling the SDK
- After the circuit opens and the mocked cooldown elapses, one successful call closes the circuit
- A mocked 401 fails immediately with `retryCount = 0` (permanent error — no retry)

---

### Epic 4: OpenAI Service and Audit Logging

**Goal**

Implement `OpenaiService` (the public API) and `AiAuditService` (the append-only audit log). Every OpenAI SDK call routes through `OpenaiService`, which delegates to `RetryService` and then writes to the audit log fire-and-forget.

**Stories Included**

- Stories 11–17 (chat completion, audit log, fire-and-forget, missing API key, cost summary, audit queries)

**Dependencies**

- Epic 1 (database schema)
- Epic 2 (token counting)
- Epic 3 (retry engine)

**Risks**

- Fire-and-forget pattern: `AiAuditService.log()` must `catch` internally and never propagate exceptions to `OpenaiService`. An uncaught audit log error would cause the parent request to fail (FR-AI-008).
- Missing `OPENAI_API_KEY` must be caught at startup with a warning, not at the first API call with an unhandled SDK exception (FR-AI-013).

**Success Criteria**

- Chat completion returns `content`, `usage`, `estimatedCost`, `latencyMs`
- Audit log row is created for every call (success, failure, retry)
- An audit log DB failure does not cause the HTTP response to fail
- Calling with no API key returns a 503 with a clear message, not a raw SDK stack trace
- `getCostSummary()` aggregates correctly across 5 calls with different models

---

### Epic 5: Prompt Template Service

**Goal**

Implement full CRUD for `PromptTemplateService` and back the `POST /api/v1/openai/prompt-test` endpoint with template loading. Templates stored in the database are the source of truth; seed data populates the 6 reference templates.

**Stories Included**

- Stories 18–22 (create, list, get, update, delete, prompt-test with template)

**Dependencies**

- Epic 1 (prompt_templates table)
- Epic 4 (OpenaiService must exist for prompt-test endpoint)

**Risks**

- `name` must be unique in the database — upsert logic in seed script must handle reruns without errors
- `templateName` lookup in the prompt-test endpoint must return a clear 404 if the template doesn't exist, not a null dereference

**Success Criteria**

- Full CRUD cycle: create → list → get → update → delete → verify removed
- Prompt-test with `templateName: "ticket-classifier"` uses the seeded template's system prompt
- Paginated list supports filtering by `technique` and `tags`

---

### Epic 6: REST Controller, Swagger, and Validation

**Goal**

Wire up `OpenaiController` with all 8 endpoint groups, add `class-validator` decorators to every DTO, and complete Swagger documentation. This is the integration epic that makes everything testable via the API.

**Stories Included**

- Stories 23–30 (all endpoint groups, DTO validation, Swagger, health endpoint)

**Dependencies**

- All prior epics

**Risks**

- Model comparison (`POST /api/v1/openai/compare`) calls multiple models in parallel — if one fails mid-comparison, the behavior must be defined (fail all vs. return partial)
- `@ApiEndpoint()` composite decorator must be used consistently (project convention)

**Success Criteria**

- All 15 test scenarios from the requirement spec pass
- `npx tsc --noEmit` exits 0
- `npm run lint` exits 0
- Swagger UI at `/api/docs` documents every endpoint with request/response examples
- SC-AI-012: empty prompt and temperature > 2 both return 400 with validation messages

---

## User Stories

### Schema and Infrastructure

1. As a developer, I want `ai_audit_logs` added to `schema.prisma`, so that every OpenAI API call can be durably logged for cost tracking and debugging.
2. As a developer, I want `prompt_templates` added to `schema.prisma`, so that system prompts can be stored, versioned, and loaded by name at runtime.
3. As a developer, I want the seed script to insert 6 reference prompt templates on `db:reset`, so that the templates are available for testing from day one without manual setup.
4. As a developer, I want the Prisma client regenerated automatically on every `npm run build`, so that schema changes are never out of sync with the type system.

### Token Counting

5. As a developer, I want `TokenService.countTokens(text, model)` to return the exact token count using `tiktoken`, so that cost estimates in audit logs reflect actual billing.
6. As a developer, I want `TokenService.estimateTokens(text)` to return a fast heuristic count (chars/4), so that UI previews can show approximate token counts without loading the WASM tokenizer.
7. As a developer, I want `TokenService.calculateCost(model, inputTokens, outputTokens)` to use `MODEL_PRICING` as the single source of truth, so that updating pricing requires only a one-line code change.
8. As a developer, I want `TokenService` to free the `tiktoken` encoding object after every use, so that memory usage stays flat under sustained load.

### Retry Engine

9. As a developer, I want `RetryService.executeWithRetry()` to implement exponential backoff with jitter on 429/500/503/529 responses, so that transient OpenAI outages are handled automatically without manual retries.
10. As a developer, I want the retry engine to skip backoff entirely on 400/401/403/404 responses, so that permanent errors fail fast and don't waste time on unrecoverable situations.
11. As a developer, I want the circuit breaker to open after 5 consecutive failures and remain open for 60 seconds, so that a degraded OpenAI API doesn't cascade into exhausting all retry budget across many requests.
12. As a developer, I want the circuit breaker to enter half-open state after the cooldown, allowing one test request through, so that recovery happens automatically without manual intervention.
13. As a developer, I want `RetryService.getCircuitState()` to return the current state (`CLOSED`, `OPEN`, `HALF_OPEN`), so that the health endpoint can surface it without exposing internal state.
14. As a developer, I want `RetryService.resetCircuit()` to exist for test isolation, so that circuit breaker tests don't bleed state across test cases.

### OpenAI Service and Audit

15. As an API consumer, I want `POST /api/v1/openai/chat` to return `content`, `model`, token usage, `estimatedCost`, and `latencyMs`, so that I can see the full cost and quality of each completion.
16. As an API consumer, I want the audit log to record every API call including failures and retried calls, so that I have a complete history for debugging and cost attribution.
17. As an API consumer, I want audit log failures to never surface as HTTP errors, so that a DB outage doesn't break the AI API.
18. As a developer, I want the service to log a startup warning and return a 503 when `OPENAI_API_KEY` is missing, so that misconfigured environments fail with a clear diagnostic instead of a raw SDK exception.
19. As a developer, I want retry counts recorded in the audit log (`retryCount` field), so that I can identify flaky model responses and tune retry configuration.
20. As an admin, I want `GET /api/v1/openai/audit-logs` with filters for `model`, `status`, `userId`, `startDate`, and `endDate`, so that I can audit AI usage for a specific user or time window.
21. As an admin, I want `GET /api/v1/openai/audit-logs/cost-summary` to return total cost, token counts, call count, average latency, and per-model breakdown, so that I can track spending over any time range.

### Prompt Templates

22. As a developer, I want `POST /api/v1/openai/templates` to create a new prompt template with technique, recommended model, temperature, and tags, so that proven prompts are shareable artifacts rather than copy-pasted strings.
23. As a developer, I want `GET /api/v1/openai/templates` with filtering by `technique` and `tags` and pagination, so that I can browse templates without loading all records.
24. As a developer, I want `GET /api/v1/openai/templates/:publicId` to return a single template by its external ID, so that integrations can fetch a specific template without exposing the internal BigInt PK.
25. As a developer, I want `PATCH /api/v1/openai/templates/:publicId` to update template fields, so that prompts can be iterated without deleting and recreating them.
26. As a developer, I want `DELETE /api/v1/openai/templates/:publicId` to remove a template, so that deprecated prompts can be cleaned up.
27. As a developer, I want `POST /api/v1/openai/prompt-test` with an optional `templateName` field to load the system prompt from the database, so that I can iterate on a template by name without copying its content into every test request.

### Comparison and Utilities

28. As a developer, I want `POST /api/v1/openai/compare` to call multiple models with identical parameters and return side-by-side results with a comparison summary (cheapest, fastest, cost/latency differences), so that I can make informed model selection decisions.
29. As a developer, I want `POST /api/v1/openai/token-count` to return the exact token count and estimated cost without making an OpenAI API call, so that I can preview billing impact before sending a request.
30. As a developer, I want `GET /api/v1/openai/models/pricing` to return the current pricing table for all supported models, so that clients can display cost estimates without hardcoding prices.
31. As a developer, I want `GET /api/v1/openai/health` to return circuit breaker state, recent error rate, and average latency, so that I can diagnose OpenAI connectivity issues from a single endpoint.

### Validation, Quality, and Observability

32. As an API consumer, I want an empty `prompt` or a `temperature` outside 0–2 to return a 400 with field-level validation messages, so that I can fix bad requests without guessing which field is wrong.
33. As a developer, I want all Phase 1 code to pass `npx tsc --noEmit` with zero errors, so that type safety is enforced across the entire service boundary.
34. As a developer, I want `npm run lint` to exit 0 with no `console.*` calls and no `process.env` access in Phase 1 code, so that logging and config conventions are consistent with the rest of the project.
35. As a developer, I want every endpoint documented in Swagger with `@ApiTags`, `@ApiOperation`, request/response DTO examples, and error response codes, so that the API is self-documenting without reading source code.

---

## Implementation Decisions

### Module Structure

`OpenaiModule` is a non-global feature module. It exports `OpenaiService`, `AiAuditService`, and `TokenService`. It does NOT export `RetryService` — this is an internal implementation detail. Future AI feature modules import `OpenaiModule` to gain access to these three services.

### Service Boundaries

Each service has a single responsibility and is independently testable:

- `TokenService`: pure functions, no I/O. Can be tested without any mocks.
- `RetryService`: no database, no HTTP — only in-memory state and a wrapped async function. Tests use fake timers.
- `AiAuditService`: all database I/O is behind `DatabaseService`. Tests use `jest-mock-extended` to mock Prisma.
- `PromptTemplateService`: same as `AiAuditService`.
- `OpenaiService`: composes all the above. Tests mock `RetryService`, `TokenService`, and `AiAuditService` — none of the underlying dependencies.

### Database Schema

Both tables use `BigInt` internal PKs with `publicId` (`uuid()`) as the external identifier. This follows the existing `User` model pattern in the project. The `ai_audit_logs` table has no `updatedAt` and no `deletedAt` — it is append-only. Indexes are created for the most common query patterns: by user+time, by model+time, by non-success status, and by template name.

### API Contract

All responses follow the existing project envelope: `{ success: true, data: <payload>, timestamp: "<ISO>" }` via `ResponseInterceptor`. All error responses follow the `HttpExceptionFilter` shape. Response DTOs include a `code` field (e.g., `AI_001`) per the spec for machine-readable identification.

### Error Handling

- Permanent errors (400, 401, 403, 404): `RetryService` throws immediately, `OpenaiService` rethrows as an `HttpException` with the appropriate status code.
- Retryable errors (429, 500, 503, 529): `RetryService` retries up to `maxRetries` times, then throws the final error.
- Circuit open: throws `CircuitOpenException` (a custom `HttpException` subclass) with a 503 status.
- Missing API key: detected at startup (via `onModuleInit`); all API calls return 503 without touching the SDK.
- Audit log failure: caught inside `AiAuditService.log()`, logged via `AppLoggerService`, never propagated.

### Retry and Circuit Breaker Design

The delay formula: `min(baseDelay × 2^attempt, maxDelay) + random(0, baseDelay × jitterFactor)`. Retry configuration is fully env-configurable (see Section 12 of the spec). Circuit breaker state is pure in-memory — no persistence. The state machine has three states: `CLOSED → OPEN → HALF_OPEN → CLOSED` (or back to `OPEN`). See the requirement specification Section 7 for the full state machine diagram.

### Token Counting

`TokenService.countTokens()` uses `tiktoken` via `encoding_for_model(model)`. The encoding object is freed after each call via `enc.free()` to prevent WASM memory leaks. `estimateTokens()` uses the `chars/4` heuristic and is exposed only as a fast approximation — it is never used for audit log cost calculations. All logged costs use exact tiktoken counts.

### Audit Logging Pattern

`AiAuditService.log()` is called from `OpenaiService` with `void log(...)` (fire-and-forget). The audit service catches all internal errors and logs them via `AppLoggerService`. The audit log write uses a raw Prisma `create()` — no transactions, no optimistic locking. This keeps the write path simple and fast.

### Environment Variable Design

`OPENAI_API_KEY` is the only required variable. All others have sensible defaults. Values are read via `ConfigService` using the `openai.*` namespace (registered in `config/app.config.ts`). The `env.validation.ts` schema must be updated to include all 8 Phase 1 variables.

### Prompt Templates

Templates are stored in `prompt_templates` with CRUD endpoints. The seed script uses Prisma `upsert` on `name` to make reruns idempotent. `publicId` is used as the external identifier in all API paths — the internal `BigInt` PK is never exposed in responses.

---

## Testing Decisions

### Unit Test Approach

All service-level tests use `jest-mock-extended` for Prisma (`DatabaseService`) and the OpenAI SDK client. Each service spec creates a `Test.createTestingModule()` with mocked providers.

- **`TokenService`**: no mocks required — pure functions. Test with known inputs and expected token counts from the tiktoken reference.
- **`RetryService`**: mock the operation callback, use `jest.useFakeTimers()` to advance through backoff delays without real waits. Test each circuit state transition explicitly.
- **`AiAuditService`**: mock `DatabaseService` via `jest-mock-extended`. Test that `log()` never throws even when the mock throws.
- **`PromptTemplateService`**: mock `DatabaseService`. Test all CRUD operations and pagination.
- **`OpenaiService`**: mock `RetryService`, `TokenService`, and `AiAuditService`. Verify that the correct methods are called with the correct arguments, and that `AiAuditService.log()` is called even when `RetryService` throws.

### Controller-Level Testing

`OpenaiController` spec uses `@nestjs/testing` with the controller and a mocked `OpenaiService`. Tests verify HTTP status codes, response shapes, and that `ValidationPipe` rejects invalid DTOs (empty prompt, temperature > 2, unknown model string).

### Mocking the OpenAI SDK

The OpenAI SDK client is injected via a provider token. In tests, replace it with a `jest.fn()` mock. The mock returns controlled responses to simulate success, 429, 500, 401, and timeout scenarios without hitting the real API.

### Testing Retry Logic

Use `jest.useFakeTimers()` and `jest.advanceTimersByTimeAsync()` to advance past backoff delays. Verify `retryCount` in the captured `AiAuditService.log()` call arguments. Test the circuit state after the threshold is exceeded using `RetryService.getCircuitState()` and `resetCircuit()` for teardown.

### Testing Token Counting

Token counting tests do not need a real API call. Use known inputs where the expected token count is verifiable: `"Hello world"` should be 2 tokens for `gpt-4o`. Do not mock `tiktoken` — test against the real library to catch WASM initialization issues early.

### Integration Testing Needs

Phase 1 has no mandatory E2E tests (test suite is `test:e2e` but is not required to pass for Phase 1 completion). The 15 test scenarios in Section 13 of the spec serve as manual integration acceptance criteria. Automated E2E against a live OpenAI key is deferred.

### Regression Risks

- `DatabaseModule` and `LoggerModule` are global — adding new services that inject them should not affect other modules. Verify that `AppModule` still boots cleanly after `OpenaiModule` is registered.
- The global `ResponseInterceptor` and `HttpExceptionFilter` already wrap all responses — do not add per-route interceptors unless specifically needed.
- `ThrottlerBehindProxyGuard` applies to all routes — Phase 1 endpoints are subject to the same rate limits as other routes. No exceptions needed.

---

## Out of Scope

The following are explicitly excluded from Phase 1 (per the requirement specification Section 14):

- Streaming responses (SSE) — Phase 2 (Chat module)
- Function calling / Tool use — Phase 2 (Chat module)
- Conversation history / multi-turn context — Phase 2 (Chat module)
- Embeddings generation and vector storage — Phase 3 (RAG module)
- Content moderation API — Phase 4 (Moderation module)
- Per-user cost budgets and spending limits — Phase 4
- Semantic caching and response caching — Phase 4
- Authentication/RBAC on AI endpoints — Phase 1 endpoints are unguarded (learning context)
- WebSocket streaming — out of scope
- Multi-provider support (Anthropic, Cohere, etc.) — out of scope
- Fine-tuning, image/audio APIs (DALL-E, Whisper, TTS) — out of scope
- LangChain/LlamaIndex integration — Phase 3

---

## Further Notes

### Assumptions About Existing Codebase

- `DatabaseModule` is global and `DatabaseService` extends `PrismaClient` — services inject it directly with no module imports.
- `LoggerModule` is global and `AppLoggerService` is the correct logger to use.
- The `openai` config namespace is already partially registered in `config/app.config.ts` — this must be extended with Phase 1 variables.
- `env.validation.ts` must be updated to declare all 8 new environment variables; the app will fail to start if required vars are missing (this is the intended behavior per FR-AI-013).
- The Prisma v7 import path is `from '../../generated/prisma/client'` — not `from '@prisma/client'` and not from a directory import. See CLAUDE.md Prisma v7 section.

### Risks Specific to OpenAI API Integration

- **API key exposure**: `OPENAI_API_KEY` must never appear in logs. `AppLoggerService` should not log config values. Verify before committing.
- **WASM memory**: tiktoken's WASM encoder must be freed after every call. A missing `enc.free()` in any code path is a memory leak.
- **Rate limit headroom**: Phase 1 includes retry logic for 429s, but the default tier 1 OpenAI rate limits are low. Development testing against real OpenAI may be constrained.
- **Cost**: Model comparison sends the same prompt to multiple models simultaneously. During development, prefer `gpt-4o-mini` for testing to minimize cost.

### Dependencies on External Services

- `OpenAI API`: required for all `openai.chat.completions.create()` calls. Token counting (`TokenService`) and prompt template CRUD (`PromptTemplateService`) work without it.
- `PostgreSQL`: required for audit logs and prompt templates. The existing database connection (used by `DatabaseService`) serves Phase 1 with no separate connection pool.

### Future Phase Considerations

- `TokenService` is exported specifically because Phase 3 (Embeddings/RAG) will need to count tokens for embedding inputs before calling the embeddings endpoint.
- `AiAuditService` exports `findAll` and `getCostSummary` with the expectation that a future admin dashboard module will consume these without duplicating query logic.
- The `metadata: Json?` field in `ai_audit_logs` is intentionally unstructured — Phase 2 will use it to record function call results and tool names without a schema change.
- The `OpenAIEndpoint` enum already includes `embeddings` and `moderations` — these will be used when Phase 3 and Phase 4 extend `OpenaiService`.

---

## Tracking

Status: ready-for-agent

Issues:

| ID     | Title                                                             | Type | Priority | Status          |
| ------ | ----------------------------------------------------------------- | ---- | -------- | --------------- |
| AI-001 | Prisma schema — ai_audit_logs, prompt_templates, env config       | AFK  | P1       | ready-for-agent |
| AI-002 | Seed script — 6 reference prompt templates                        | AFK  | P1       | ready-for-agent |
| AI-003 | OpenaiModule scaffold — enums, constants, empty service shells    | AFK  | P1       | ready-for-agent |
| AI-004 | TokenService — countTokens, estimateTokens, calculateCost + tests | AFK  | P1       | ready-for-agent |
| AI-005 | RetryService — backoff, circuit breaker + unit tests              | AFK  | P1       | ready-for-agent |
| AI-006 | AiAuditService — log write, findAll, getCostSummary + tests       | AFK  | P1       | ready-for-agent |
| AI-007 | OpenaiService — chatCompletion(), API key guard + unit tests      | AFK  | P1       | ready-for-agent |
| AI-008 | PromptTemplateService — full CRUD + unit tests                    | AFK  | P1       | ready-for-agent |
| AI-009 | DTOs — request and response classes for all 8 endpoint groups     | AFK  | P1       | ready-for-agent |
| AI-010 | OpenaiController — core endpoints + AppModule registration        | AFK  | P1       | ready-for-agent |
| AI-011 | OpenaiController — audit log query + cost summary endpoints       | AFK  | P1       | ready-for-agent |
| AI-012 | OpenaiController — prompt template CRUD endpoints                 | AFK  | P1       | ready-for-agent |
| AI-013 | OpenaiController unit tests + TypeScript/lint verification        | AFK  | P2       | ready-for-agent |
| AI-014 | Live API smoke test — end-to-end verification                     | HITL | P2       | ready-for-agent |

Dependencies:

- `DatabaseModule` (global, already exists)
- `LoggerModule` (global, already exists)
- `ConfigModule` with `openai` namespace (partially exists — must be extended in AI-001)
- `openai` npm package (SDK, must be installed)
- `tiktoken` npm package (must be installed — AI-004)

Open Questions:

- Should model comparison (`POST /compare`) run model calls in parallel (`Promise.all`) or sequentially? Resolved in AI-010: parallel, full failure if any model fails.
- Should `GET /api/v1/openai/audit-logs` require authentication in Phase 1, or is it intentionally unguarded like the other Phase 1 endpoints? Current decision: unguarded (learning context per spec Section 14).

Related PRDs:

- None yet (this is the first PRD)
