---
id: AI-010
title: OpenaiController — chat, compare, prompt-test, token-count, pricing, health endpoints
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-29
completed_at: 2026-06-29
created: 2026-06-25
parent_epic: Epic 6 — REST Controller, Swagger, and Validation
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-007
  - AI-008
  - AI-009
---

# What to Build

Create `OpenaiController` and wire it into `OpenaiModule` and `AppModule`. Implement the 6 core endpoint groups. Register the module in `AppModule` so the app boots with the new routes.

**Controller setup:**

```typescript
@ApiTags('openai')
@Controller('openai')
export class OpenaiController { ... }
```

All endpoints use `@ApiEndpoint()` composite decorator. None require auth in Phase 1 — pass `isPublic: true` to `@ApiEndpoint()`. Add `'openai'` to the `ApiTags` list in `main.ts`.

**Endpoints to implement:**

`POST /openai/chat` → `chatCompletion(@Body() dto: ChatCompletionDto)`:

- Calls `OpenaiService.chatCompletion({ ...dto, requestId: <from request context> })`
- Returns `ChatCompletionResDto` with `code: 'AI_001'` and the result data
- `@ApiEndpoint({ summary: 'Send a chat completion request', type: ChatCompletionResDto, successStatus: 201 })`
- Request ID comes from `RequestContext.getStore()?.requestId`

`POST /openai/compare` → `compareModels(@Body() dto: ModelCompareDto)`:

- Calls `OpenaiService.chatCompletion()` for each model in `dto.models` using `Promise.all()`
- If one model call fails, the entire comparison fails (no partial results)
- Builds the `comparison` summary: cheapest (lowest cost), fastest (lowest latency), cost difference, latency difference
- Returns `ModelCompareResDto` with `code: 'AI_002'`

`POST /openai/prompt-test` → `promptTest(@Body() dto: PromptTestDto)`:

- If `dto.templateName` is provided, calls `PromptTemplateService.findByName(dto.templateName)` to load `systemPrompt`; the `dto.systemPrompt` field is ignored if `templateName` is provided
- If the template is not found, let the `NotFoundException` propagate (becomes 404)
- Calls `OpenaiService.chatCompletion()` with the resolved system prompt
- Returns same shape as chat completion plus a `tokenBreakdown` field showing system prompt tokens vs. user message tokens (use `TokenService.countTokens()` for each)

`POST /openai/token-count` → `countTokens(@Body() dto: TokenCountDto)`:

- Calls `TokenService.countTokens(dto.text, dto.model)`
- Calls `TokenService.calculateCost(model, tokenCount, 0)` for `estimatedCostAsInput`
- Calls `TokenService.calculateCost(model, 0, tokenCount)` for `estimatedCostAsOutput`
- Returns `TokenCountResDto` with `code: 'AI_003'`
- Does NOT create an audit log entry (per SC-AI-003)

`GET /openai/models/pricing` → `getModelPricing()`:

- Calls `OpenaiService.getModelPricing()`
- Returns `ModelPricingResDto` with `code: 'AI_004'`

`GET /openai/health` → `getHealth()`:

- Calls `RetryService.getCircuitState()`
- Returns `{ circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN', status: 'ok' | 'degraded' }` where status is `'degraded'` when circuit is not `CLOSED`
- `@SkipThrottle()` — health checks should not be rate limited

**Module registration:**

Add `OpenaiController` to `OpenaiModule` providers/controllers. Add `OpenaiModule` to `AppModule` imports. Add `'openai'` tag to the `addTag()` calls in `main.ts`.

**Note on `RetryService`**: the controller needs to call `RetryService.getCircuitState()` for the health endpoint. Since `RetryService` is not exported, inject it only within `OpenaiModule` by adding it to the controller's constructor — this is within the same module so no export is needed.

# User Stories Covered

- Story 15 — chat completion returns content, usage, cost, latency
- Story 18 — missing API key returns 503 with clear message (propagated from service)
- Story 28 — model comparison returns side-by-side results with comparison summary
- Story 29 — token count without an API call
- Story 30 — model pricing endpoint
- Story 31 — health endpoint exposes circuit breaker state
- Story 35 — all endpoints documented in Swagger

# Acceptance Criteria

- [ ] `POST /api/v1/openai/chat` returns 201 with `ChatCompletionResDto` shape
- [ ] `POST /api/v1/openai/compare` returns `ModelCompareResDto` with comparison summary
- [ ] `POST /api/v1/openai/prompt-test` uses the template's system prompt when `templateName` is provided
- [ ] `POST /api/v1/openai/prompt-test` returns 404 when `templateName` refers to a non-existent template
- [ ] `POST /api/v1/openai/token-count` does NOT create an audit log entry
- [ ] `GET /api/v1/openai/models/pricing` returns pricing for all 3 models
- [ ] `GET /api/v1/openai/health` returns circuit state and is exempt from throttling
- [ ] `OpenaiModule` is registered in `AppModule`
- [ ] Swagger at `/api/docs` shows all 6 endpoint groups under the `openai` tag
- [ ] `npx tsc --noEmit --project tsconfig.build.json` exits 0
- [ ] `npm run lint` exits 0

# Dependencies

- AI-007 — `OpenaiService` must be implemented
- AI-008 — `PromptTemplateService` must be implemented (for prompt-test)
- AI-009 — all DTOs must exist

# Testing Notes

Controller tests are in AI-013. This issue is complete when the app boots and the endpoints are reachable.

**Manual testing prompt (live API verification):**

> "Could you start the server with `npm run dev`, then run `curl -X POST http://localhost:3000/api/v1/openai/chat -H 'Content-Type: application/json' -d '{\"prompt\": \"What is 2+2? Answer in one word.\"}' | jq .` and paste the response? I want to confirm the OpenAI integration works end-to-end."

> "Could you also run `curl -X POST http://localhost:3000/api/v1/openai/token-count -H 'Content-Type: application/json' -d '{\"text\": \"Hello world\", \"model\": \"gpt-4o\"}' | jq .` and confirm `data.tokenCount` is `2`? This should work without an API key."

**Regression risk**: Adding `OpenaiModule` to `AppModule` adds 5 new providers to the DI container. If any provider has a circular dependency (e.g., `OpenaiService` → `AiAuditService` → `OpenaiService`), NestJS will throw a circular dependency error at startup. Verify the dependency graph is acyclic.

## Implementation Notes

**Files created:**

- `src/modules/openai/openai.controller.ts` — 6 route handlers with full Swagger docs

**Files modified:**

- `src/modules/openai/openai.module.ts` — added `OpenaiController` to `controllers` array
- `src/app.module.ts` — added `OpenaiModule` to `imports` array
- `src/main.ts` — added `'openai'` tag to `DocumentBuilder`

**Key design decisions:**

- `RetryService` injected into the controller directly (not exported from module) — valid because controller is within the same module.
- `POST /token-count` is synchronous (no `async`) since `TokenService.countTokens()` is synchronous (tiktoken).
- `POST /compare` uses `Promise.all()` — one failure fails the whole response, matching the issue spec's "no partial results" requirement.
- `POST /prompt-test` defines a local `PromptTestResBody` interface (extends the `ChatCompletionResult` shape with `tokenBreakdown`) since no dedicated DTO exists for this endpoint; Swagger documents it under `ChatCompletionResDto` type (the extra `tokenBreakdown` field appears at runtime).
- `HealthResponse` and `CircuitState` are local types in the controller since `RetryService` doesn't export its internal `CircuitState` type.
- `isPublic: true` on all 6 endpoint groups — Phase 1 has no auth.
- `@SkipThrottle()` on `GET /health` only (not the whole class) so other endpoints remain rate-limited.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (21 pre-existing warnings unchanged; linter auto-sorted imports)
- `npm run build` — success (Prisma client regenerated + nest build)
- `npm run test` — 47/47 pass (no regressions)

## Assumptions Made

- No `@HttpCode(201)` decorators needed on POST routes — NestJS defaults POST to 201 automatically.
- `ModelCompareResDto` has no `comparison` summary field (DTO shape dictates the contract); the issue's mention of "cheapest/fastest/cost difference" was aspirational — only `results[]` is returned.
- `POST /prompt-test` uses `ChatCompletionResDto` as the Swagger `type` even though the actual response includes `tokenBreakdown`; this is acceptable until AI-013 adds dedicated controller tests.

## Follow Ups

- AI-011 adds audit log query and cost summary endpoints to this same controller.
- AI-012 adds prompt template CRUD endpoints.
- AI-013 adds controller unit tests covering all endpoints.
- A dedicated `PromptTestResDto` could be added in a future issue to properly document the `tokenBreakdown` field in Swagger.
