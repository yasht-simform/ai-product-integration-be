# Phase 1: OpenAI API Foundations — Complete Guide

> Reference document for `src/modules/openai/`. Written against the code as it exists on
> `feat/openai-api-setup`. If the code and this doc ever disagree, trust the code and update this
> file.

---

## What I Built (Non-Technical Summary)

Every feature we build that talks to an AI model — chat, RAG, content moderation — needs the same
plumbing: send a request, handle it when the AI service is slow or down, know how much it cost,
and keep a record of what happened. Phase 1 builds that plumbing once, as a single well-tested
module, so every future feature reuses it instead of reinventing it.

Think of it like a hotel's **switchboard operator** sitting between every guest (our app's
features) and the outside phone network (OpenAI):

- **The operator dials for you and redials if the line is busy.** If OpenAI is briefly
  overloaded (a `429` or `500`), the operator waits a bit and tries again automatically — the
  caller never has to know it happened. (This is the **Retry Engine**.)
- **The operator hangs up on obviously wrong numbers.** If you gave a bad number (an invalid
  request, or an invalid API key), retrying won't help — the operator tells you immediately
  instead of wasting time. (Also the **Retry Engine**, classifying errors.)
- **If the phone network itself goes down, the operator stops trying and says so.** After enough
  failed calls in a row, the operator assumes something is broken upstream and fails fast for a
  cooldown period instead of hammering a dead service. (The **Circuit Breaker**.)
- **The operator keeps an itemized phone bill.** Every call is logged with duration, who made it,
  and how much it cost — down to the fraction of a cent. (The **AI Audit Logger**.)
- **The operator can tell you how many words you're about to say before you say them**, so you
  know roughly what a call will cost before you place it. (The **Token Service**.)
- **The operator has a binder of pre-written scripts** for common calls (customer support,
  classification, code review) so people don't have to write a new script from scratch every time.
  (The **Prompt Template Library**.)

Nobody in the rest of the app is allowed to pick up the phone and dial OpenAI directly — every
call goes through the switchboard. That's the whole point: one place to control cost, reliability,
and visibility, no matter how many AI features we bolt on later.

---

## Architecture Overview

### Module dependency diagram

```
AppModule
└── OpenaiModule                              (src/modules/openai/openai.module.ts)
    ├── providers
    │   ├── OPENAI_CLIENT           factory — instantiates the `openai` npm SDK client
    │   ├── OpenaiService           exported — the ONLY service other modules should inject
    │   ├── TokenService            exported — tiktoken counting + cost math (pure, stateless)
    │   ├── RetryService            internal — exponential backoff + circuit breaker
    │   ├── AiAuditService          exported — writes/queries ai_audit_logs
    │   └── PromptTemplateService   internal — CRUD for prompt_templates
    └── controllers
        └── OpenaiController        13 REST endpoints; injects all 5 services directly
```

`exports: [OpenaiService, AiAuditService, TokenService]` in `openai.module.ts` is a deliberate
boundary: `RetryService` and `PromptTemplateService` are implementation details of this module and
are not meant to be injected elsewhere.

### How the 5 services connect to each other

```
OpenaiController
 ├─▶ OpenaiService          (chat, compare, prompt-test)
 ├─▶ TokenService           (prompt-test token breakdown, token-count, models/pricing)
 ├─▶ PromptTemplateService  (templates CRUD, prompt-test template lookup)
 ├─▶ RetryService           (health endpoint — reads circuit state only, never calls it)
 └─▶ AiAuditService         (audit-logs, cost-summary)

OpenaiService (the only one that talks to OpenAI itself)
 ├─▶ OPENAI_CLIENT   the raw `openai` SDK instance (injected by token, not by class)
 ├─▶ RetryService    wraps the actual SDK call in retry + circuit-breaker logic
 ├─▶ TokenService    turns the response's token usage into an estimated cost
 └─▶ AiAuditService  fire-and-forget log write — success or failure, either way
```

Notice `RetryService` and `AiAuditService` never talk to each other directly — `OpenaiService` is
the only place that orchestrates all of them together. That's intentional: each service has one
job and no knowledge of the others' internals.

### Request flow: HTTP request → OpenAI → back

Traced through `POST /api/v1/openai/chat`:

```
HTTP POST /api/v1/openai/chat  { "prompt": "...", "model": "gpt-4o" }
        │
        ▼
ValidationPipe                          (main.ts — whitelist, forbidNonWhitelisted, transform)
        │
        ▼
OpenaiController.chatCompletion(dto)    (openai.controller.ts:79)
        │  attaches requestId from AsyncLocalStorage (request-context.ts)
        ▼
OpenaiService.chatCompletion(params)    (services/openai.service.ts:46)
        │
        ├─ 1. Guard: isConfigured? (set once in onModuleInit from openai.apiKey)
        │       no  → throw ServiceUnavailableException immediately, no SDK call made
        │
        ├─ 2. RetryService.executeWithRetry(() => openaiClient.chat.completions.create(...))
        │       │
        │       ├─ circuit CLOSED  → call goes through
        │       ├─ circuit OPEN    → throw CircuitOpenException, no network call at all
        │       ├─ call fails      → classify error → retry w/ backoff, or throw immediately
        │       └─ call succeeds   → resets failure counter, returns SDK response
        │
        ├─ 3. TokenService.calculateCost(model, inputTokens, outputTokens)
        │       reads token counts from the SDK response's `usage` field (not re-counted locally)
        │
        ├─ 4. AiAuditService.log({...})     fire-and-forget — awaited via `void`, never blocks
        │
        └─ 5. return ChatCompletionResult
        │
        ▼
ResponseInterceptor                     (common/interceptors/response.interceptor.ts)
        wraps: { success: true, data: <ChatCompletionResult>, timestamp }
        │
        ▼
HTTP 201 response
```

If any step throws an unhandled error, `HttpExceptionFilter` (`common/filters/http-exception.filter.ts`)
catches it and returns the standard error envelope: `{ statusCode, message, error, timestamp, path }`.

---

## The 5 Services Explained

### 1. OpenaiService — the public API

**What it does (non-technical):** This is the front desk. It's the only service allowed to
actually place a call to OpenAI. Every other service and every future module talks to _this_, not
to the OpenAI SDK.

**What it does (technical):**

```typescript
// src/modules/openai/services/openai.service.ts
@Injectable()
export class OpenaiService implements OnModuleInit {
  private isConfigured = false;

  onModuleInit(): void {
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not configured — all API calls will fail');
      this.isConfigured = false;
    } else {
      this.isConfigured = true;
    }
  }

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('OpenAI API key is not configured');
    }
    // ... build messages, call retryService.executeWithRetry(), calculate cost, log, return
  }

  getModelPricing(): Record<string, { input: number; output: number }> {
    return this.tokenService.getModelPricing();
  }
}
```

- `chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>` — inputs:
  `prompt`, `systemPrompt?`, `model?`, `temperature?`, `maxTokens?`, `userId?`, `requestId?`.
  Output: `{ content, model, usage, estimatedCost, latencyMs }`.
- `getModelPricing()` — delegates straight to `TokenService`.

**Key design decisions and why:**

- **The API-key check runs once at boot (`onModuleInit`), not on every request.** A missing key
  is a startup condition, not a per-call condition — checking a boolean flag is free; calling
  `ConfigService.get()` on every request isn't necessary.
- **A missing key throws `ServiceUnavailableException` (503) before touching the SDK.** Per
  FR-AI-013, the failure must be a clear, typed error — not a raw exception bubbling up from the
  `openai` package with an unhelpful stack trace.
- **Errors are mapped in one place (`mapError`)** so callers always get an `HttpException` with a
  sensible status, whether the underlying failure was a `CircuitOpenException`, a `429`, or
  something unexpected (falls through to 500).
- **The audit log call is fire-and-forget** — `void this.auditService.log({...})`. Writing the
  audit log is not allowed to add latency or become a point of failure for the user-facing
  request (NFR-AI-007).

### 2. TokenService — token counting and cost math

**What it does (non-technical):** Before or after you talk to OpenAI, this counts how many
"words" (tokens) went in and out, and converts that into a dollar amount using OpenAI's published
pricing.

**What it does (technical):**

```typescript
// src/modules/openai/services/token.service.ts
@Injectable()
export class TokenService {
  countTokens(text: string, model: OpenAIModel = OpenAIModel.GPT_4O): number {
    try {
      const enc = encoding_for_model(model);
      try {
        return enc.encode(text).length;
      } finally {
        enc.free(); // WASM-backed — must be freed manually or memory leaks
      }
    } catch {
      this.logger.debug(`tiktoken does not support model: ${model}, using heuristic estimate`);
      return this.estimateTokens(text);
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4); // ~4 chars per token in English
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      this.logger.debug(`No pricing data for model: ${model}, cost set to 0`);
      return 0;
    }
    const result =
      (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    return parseFloat(result.toFixed(8));
  }

  getModelPricing(): Record<string, { input: number; output: number }> {
    return MODEL_PRICING;
  }
}
```

- `countTokens(text, model?)` — exact count via `tiktoken`. Falls back to `estimateTokens()` if
  `tiktoken` doesn't recognize the model string (this is how OpenRouter models are handled — see
  the OpenRouter section below).
- `estimateTokens(text)` — pure heuristic, no dependencies, used as the fallback and available as
  a fast convenience method.
- `calculateCost(model, inputTokens, outputTokens)` — returns `0` for unknown models instead of
  throwing (also an OpenRouter accommodation).
- `getModelPricing()` — returns the raw `MODEL_PRICING` constant.

**Key design decisions and why:**

- **Never throws.** Both `countTokens` and `calculateCost` originally threw for
  unrecognized/OpenRouter-style models, which crashed the `/prompt-test` and `/token-count`
  endpoints the moment someone passed a non-OpenAI model string. Both now degrade gracefully
  (heuristic estimate, or `$0` cost) and log a `debug` message instead.
- **The `tiktoken` encoding is always freed in a `finally` block.** It's backed by WebAssembly
  memory that Node's garbage collector doesn't manage — skipping `enc.free()` leaks memory on
  every single call (NFR-AI-002).
- **Stateless and dependency-free (besides the logger).** No database, no config. This makes it
  trivially reusable by Phase 3 (chunking text for embeddings needs the exact same token math).

### 3. RetryService — resilience engine

**What it does (non-technical):** If the call to OpenAI fails for a reason that might resolve
itself (server hiccup, rate limit), this waits a bit and tries again — a few times, with
increasing pauses. If it fails for a reason that will _never_ resolve itself (bad request, bad API
key), it gives up immediately instead of wasting time. If failures keep piling up, it stops trying
altogether for a cooldown period so we're not hammering a service that's clearly down.

**What it does (technical):** See the full [Retry Engine Deep Dive](#retry-engine-deep-dive)
section below — this is the most involved service in the module.

```typescript
executeWithRetry<T>(operation: () => Promise<T>, retryTracker?: { retryCount: number }): Promise<T>
getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN'
resetCircuit(): void
```

**Key design decisions and why:**

- **Not exported from `OpenaiModule`.** Retry logic is an implementation detail of how
  `OpenaiService` talks to OpenAI — no other module should ever need to call
  `executeWithRetry()` directly.
- **Circuit state is in-memory (a few private fields), not Redis or a database.** Per NFR-AI-008
  and the PRD's decision record: this is a single-instance learning project, not a
  horizontally-scaled production service. Losing circuit state on restart is an acceptable
  trade-off for zero infra dependency.
- **Config comes from `ConfigService`, with `RETRY_CONFIG` constants as fallback defaults** — so
  retry behavior can be tuned per environment (aggressive in dev, conservative in prod) without a
  code change.

### 4. AiAuditService — the logbook

**What it does (non-technical):** Every single call to OpenAI — whether it succeeded, failed, or
had to be retried — gets written down: what model, how many tokens, how much it cost, how long it
took, and whether anything went wrong. This is the data behind cost dashboards and "why did this
request fail" debugging.

**What it does (technical):**

```typescript
// src/modules/openai/services/ai-audit.service.ts
async log(event: AiAuditLogEvent): Promise<void> {
  try {
    await this.db.aiAuditLog.create({ data: { ... } });
  } catch (error) {
    this.logger.error('AiAuditService: failed to write audit log', String(error));
  }
}

async findAll(query: QueryAiAuditDto): Promise<PaginatedAiAuditResult> { /* paginated + filtered */ }

async getCostSummary(query: CostSummaryQueryDto): Promise<CostSummaryResult> {
  const [aggregate, breakdown] = await Promise.all([
    this.db.aiAuditLog.aggregate({ where, _count: true, _sum: {...}, _avg: { latencyMs: true } }),
    this.db.aiAuditLog.groupBy({ by: ['model'], where, _count: { _all: true }, _sum: {...} }),
  ]);
  // ...
}
```

- `log(event)` — fire-and-forget insert. Catches its own errors so a broken audit write can never
  fail the parent request (FR-AI-008).
- `findAll(query)` — paginated (`page`/`limit`, capped at 100 per page) and filterable by
  `model`, `status`, `userId`, `startDate`/`endDate`.
- `getCostSummary(query)` — one `Promise.all` running a Prisma `aggregate` (totals + averages) and
  a `groupBy` (per-model cost breakdown) in parallel.

**Key design decisions and why:**

- **`log()` swallows its own errors.** This is the one method in the whole module explicitly
  designed to never propagate a failure — the `try/catch` is the entire point of the method.
- **Query methods (`findAll`, `getCostSummary`) intentionally do _not_ swallow errors** — a broken
  query on an admin dashboard should surface as an error, not silently return empty data.
- **`limit` is always clamped with `Math.min(limit, 100)`** before hitting the database, so a
  client can't request an unbounded page size.

### 5. PromptTemplateService — the prompt library

**What it does (non-technical):** Instead of every developer writing (and re-testing) their own
system prompt from scratch, tested prompts live in the database with a name, examples, and
metadata about when to use them. Anyone can look one up by name and use it immediately.

**What it does (technical):**

```typescript
// src/modules/openai/services/prompt-template.service.ts
async create(dto: CreatePromptTemplateDto): Promise<PromptTemplateEntity> {
  try {
    const template = await this.db.promptTemplate.create({ data: { ... } });
    return this.toEntity(template);
  } catch (error) {
    if (this.isP2002(error)) {
      throw new ConflictException(`Template with name "${dto.name}" already exists`);
    }
    throw error;
  }
}

findAll(query: QueryPromptTemplateDto): Promise<PaginatedPromptTemplateResult>
findByPublicId(publicId: string): Promise<PromptTemplateEntity>   // throws NotFoundException
findByName(name: string): Promise<PromptTemplateEntity>           // throws NotFoundException
update(publicId: string, dto: UpdatePromptTemplateDto): Promise<PromptTemplateEntity>
remove(publicId: string): Promise<void>
```

**Key design decisions and why:**

- **Prisma's `P2002` unique-constraint violation is translated into a `ConflictException` (409)**
  instead of leaking a raw database error — `name` is `@unique` in the schema, and duplicate
  template names are a client mistake, not a server error.
- **`findByName()` exists specifically for `PromptTestDto.templateName`** — the `/prompt-test`
  endpoint looks up a template's `systemPrompt` by human-readable name, not by `publicId`, because
  that's what a developer testing a prompt actually has on hand.
- **Not exported from `OpenaiModule`.** The controller lives in the same module, so there's no
  need to export this for cross-module use (unlike `AiAuditService`, which dashboards elsewhere
  might query).

---

## Database Schema

Both tables were added in `AI-001` (`docs/issues/AI-001-prisma-schema-and-env-config.md`),
alongside the pre-existing `User`, `AuditLog`, and `EmbeddingCache` models from the initial
project scaffold.

### `ai_audit_logs`

```prisma
model AiAuditLog {
  id                BigInt   @id @default(autoincrement())
  publicId          String   @unique @default(uuid())
  requestId         String
  userId            String?
  model             String
  endpoint          String
  systemPrompt      String?
  userMessage       String
  assistantResponse String?
  inputTokens       Int
  outputTokens      Int
  totalTokens       Int
  estimatedCost     Float
  latencyMs         Int
  temperature       Float?
  maxTokens         Int?
  status            String
  errorCode         String?
  errorMessage      String?
  retryCount        Int      @default(0)
  metadata          Json?    @db.JsonB
  createdAt         DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@index([model, createdAt(sort: Desc)])
  @@index([status])
  @@map("ai_audit_logs")
}
```

| Field                                                | Meaning                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                 | Internal auto-incrementing PK. Never exposed in an API response.                                                                           |
| `publicId`                                           | UUID exposed externally instead of `id`.                                                                                                   |
| `requestId`                                          | Correlation ID from `AsyncLocalStorage` request context — ties this row to one HTTP request.                                               |
| `userId`                                             | Nullable — some calls (internal/system) have no user.                                                                                      |
| `model` / `endpoint`                                 | What was called: e.g. `gpt-4o` / `chat.completions`.                                                                                       |
| `systemPrompt` / `userMessage` / `assistantResponse` | The actual conversation content — nullable where not applicable (e.g. `assistantResponse` on a failed call).                               |
| `inputTokens` / `outputTokens` / `totalTokens`       | Straight from the SDK response's `usage` field.                                                                                            |
| `estimatedCost`                                      | Computed by `TokenService.calculateCost()`.                                                                                                |
| `latencyMs`                                          | Wall-clock time for the whole `chatCompletion()` call.                                                                                     |
| `status`                                             | `SUCCESS`, `FAILED`, or `RETRIED` (string, backed by `AiAuditStatus` enum — see note in [Constants & Enums](#constants--enums-reference)). |
| `errorCode` / `errorMessage`                         | Populated only on failure.                                                                                                                 |
| `retryCount`                                         | How many retry attempts happened before the final outcome.                                                                                 |
| `metadata`                                           | Free-form JSONB — reserved for future use (e.g. tool-call results).                                                                        |

### `prompt_templates`

```prisma
model PromptTemplate {
  id                     BigInt   @id @default(autoincrement())
  publicId               String   @unique @default(uuid())
  name                   String   @unique
  description            String?
  systemPrompt           String
  fewShotExamples        Json?    @db.JsonB
  technique              String
  recommendedModel       String   @default("gpt-4o")
  recommendedTemperature Float    @default(0.7)
  tags                   String[]
  isActive               Boolean  @default(true)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@map("prompt_templates")
}
```

| Field             | Meaning                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `name`            | Unique human-readable key (`'ticket-classifier'`) — used for lookup in `/prompt-test`.                |
| `systemPrompt`    | The actual prompt text.                                                                               |
| `fewShotExamples` | `{ input, output }[]` pairs, JSONB, nullable — only populated for few-shot templates.                 |
| `technique`       | One of the 6 `PromptTechnique` values.                                                                |
| `tags`            | Free-form array, filterable via `hasSome` in `findAll()`.                                             |
| `isActive`        | Soft toggle — `findAll()` defaults to `isActive: true` so retired templates don't show up by default. |

### Why append-only for audit logs

`AiAuditLog` has no `updatedAt` and no soft-delete field. Once a row is written, it is never
touched again. This matters because the table's entire purpose is to answer "what actually
happened" for cost tracking and debugging — a log that can be quietly edited after the fact isn't
trustworthy for either purpose. If a row needs correcting, the correct move is a new row (e.g. a
retry becomes its own audit event with an incremented `retryCount`), not an update to the old one.

### Why the `publicId` pattern

Every table exposed through the API has two identifiers: an internal `BigInt` autoincrement `id`
and an external `String @unique @default(uuid())` `publicId`. The API only ever returns
`publicId` — `id` never leaves the service layer (see `toEntity()` in both services, and
`toTemplateRes()` in the controller). Two reasons:

1. **No enumeration attacks.** A sequential integer ID lets a caller guess `/templates/2` after
   seeing `/templates/1`. A UUID doesn't.
2. **Decoupling the API contract from storage.** The internal PK type/strategy can change
   (e.g. switching autoincrement strategy, sharding) without changing anything a client depends on.

---

## All 13 API Endpoints — With Usage Examples

All endpoints are mounted under `api/v1` (set via `app.setGlobalPrefix('api/v1')` in `main.ts`)
and are **unauthenticated** — Phase 1 endpoints have no guard applied (`isPublic: true` on every
`@ApiEndpoint()`), per the PRD's explicit out-of-scope decision for this learning project.

Every successful response is wrapped by the global `ResponseInterceptor`:

```json
{
  "success": true,
  "data": {
    /* endpoint-specific payload below */
  },
  "timestamp": "2026-07-03T10:15:00.000Z"
}
```

Examples below show the `data` payload only, and assume the app is running locally on port 3000
(`npm run dev`).

### Group: Chat / Completion

#### 1. `POST /api/v1/openai/chat`

Send a single prompt to a model and get back content, usage, cost, and latency.

```bash
curl -X POST http://localhost:3000/api/v1/openai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is a REST API?",
    "model": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 200
  }'
```

Response (`ChatCompletionResDto`, `201`):

```json
{
  "content": "A REST API is an architectural style for web services that uses standard HTTP methods...",
  "model": "gpt-4o",
  "usage": { "inputTokens": 14, "outputTokens": 85, "totalTokens": 99 },
  "estimatedCost": 0.000885,
  "latencyMs": 850
}
```

**When you'd use this:** the default entry point for any one-off completion — the building block
every other endpoint (`compare`, `prompt-test`) is built on top of.

#### 2. `POST /api/v1/openai/compare`

Send the same prompt to multiple models in parallel and compare results side by side.

```bash
curl -X POST http://localhost:3000/api/v1/openai/compare \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain REST APIs in 2 sentences.",
    "models": ["gpt-4o", "gpt-4o-mini"],
    "temperature": 0.5
  }'
```

Response (`ModelCompareResDto`, `201`):

```json
{
  "results": [
    {
      "model": "gpt-4o",
      "content": "REST APIs use HTTP methods...",
      "usage": { "inputTokens": 18, "outputTokens": 40, "totalTokens": 58 },
      "estimatedCost": 0.000445,
      "latencyMs": 910
    },
    {
      "model": "gpt-4o-mini",
      "content": "REST APIs let systems...",
      "usage": { "inputTokens": 18, "outputTokens": 38, "totalTokens": 56 },
      "estimatedCost": 0.0000255,
      "latencyMs": 430
    }
  ]
}
```

Defaults to `[gpt-4, gpt-4o]` if `models` is omitted (`openai.controller.ts:93`).

**When you'd use this:** evaluating which model is worth the extra cost for a given prompt before
committing to it in production code — the exact question this project exists to help you answer.

#### 3. `POST /api/v1/openai/prompt-test`

Test a prompt with full parameter control, optionally loading the system prompt from a saved
template. Returns everything `chat` returns, plus a token breakdown.

```bash
curl -X POST http://localhost:3000/api/v1/openai/prompt-test \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "My login keeps failing with a 401 error.",
    "templateName": "ticket-classifier"
  }'
```

Response:

```json
{
  "content": "BUG",
  "model": "gpt-4o",
  "usage": { "inputTokens": 210, "outputTokens": 1, "totalTokens": 211 },
  "estimatedCost": 0.000535,
  "latencyMs": 610,
  "tokenBreakdown": { "systemPromptTokens": 204, "userMessageTokens": 12 }
}
```

**When you'd use this:** iterating on a saved prompt template against real input without touching
code — exactly what `docs/issues/AI-014-live-api-smoke-test.md` exercises.

#### 4. `POST /api/v1/openai/token-count`

Count tokens for text without calling OpenAI at all — free, instant.

```bash
curl -X POST http://localhost:3000/api/v1/openai/token-count \
  -H "Content-Type: application/json" \
  -d '{ "text": "What is a REST API?", "model": "gpt-4o" }'
```

Response (`TokenCountResDto`, `201`):

```json
{
  "text": "What is a REST API?",
  "model": "gpt-4o",
  "tokenCount": 6,
  "characterCount": 20
}
```

(`tokenCount: 6` for this exact string is asserted by `token.service.spec.ts`.)

**When you'd use this:** estimating cost or checking you're under a context-window limit before
spending money on an actual API call.

### Group: Prompt Templates

#### 5. `POST /api/v1/openai/templates`

```bash
curl -X POST http://localhost:3000/api/v1/openai/templates \
  -H "Content-Type: application/json" \
  -d '{
    "name": "meeting-summarizer",
    "description": "Summarizes meeting transcripts into action items",
    "systemPrompt": "You are an assistant that extracts action items from meeting transcripts...",
    "technique": "structured-output",
    "recommendedModel": "gpt-4o",
    "recommendedTemperature": 0.2,
    "tags": ["summarization", "productivity"]
  }'
```

Response (`PromptTemplateResDto`, `201`):

```json
{
  "publicId": "3f1a9e2c-9b7d-4e2a-8c1f-2a6d5e7b9c10",
  "name": "meeting-summarizer",
  "description": "Summarizes meeting transcripts into action items",
  "systemPrompt": "You are an assistant that extracts action items from meeting transcripts...",
  "fewShotExamples": null,
  "technique": "structured-output",
  "recommendedModel": "gpt-4o",
  "recommendedTemperature": 0.2,
  "tags": ["summarization", "productivity"],
  "isActive": true,
  "createdAt": "2026-07-03T10:00:00.000Z",
  "updatedAt": "2026-07-03T10:00:00.000Z"
}
```

Duplicate `name` → `409 Conflict`.

#### 6. `GET /api/v1/openai/templates`

```bash
curl "http://localhost:3000/api/v1/openai/templates?technique=few-shot&page=1&limit=20"
```

Response (`PaginatedPromptTemplateResDto`, `200`):

```json
{ "data": [{ "publicId": "...", "name": "ticket-classifier", "...": "..." }], "total": 1 }
```

#### 7. `GET /api/v1/openai/templates/:publicId`

```bash
curl http://localhost:3000/api/v1/openai/templates/3f1a9e2c-9b7d-4e2a-8c1f-2a6d5e7b9c10
```

Returns a single `PromptTemplateResDto`, or `404` if the `publicId` doesn't exist.

#### 8. `PATCH /api/v1/openai/templates/:publicId`

```bash
curl -X PATCH http://localhost:3000/api/v1/openai/templates/3f1a9e2c-9b7d-4e2a-8c1f-2a6d5e7b9c10 \
  -H "Content-Type: application/json" \
  -d '{ "recommendedTemperature": 0.4, "isActive": false }'
```

Partial update — every field is optional (`UpdatePromptTemplateDto extends PartialType(CreatePromptTemplateDto)`).

#### 9. `DELETE /api/v1/openai/templates/:publicId`

```bash
curl -X DELETE http://localhost:3000/api/v1/openai/templates/3f1a9e2c-9b7d-4e2a-8c1f-2a6d5e7b9c10 -i
```

`204 No Content`, empty body. `404` if it doesn't exist.

**When you'd use these:** managing the prompt library as data instead of code — non-engineers or
prompt-focused contributors can create/tune templates without a deploy.

### Group: Audit Logs

#### 10. `GET /api/v1/openai/audit-logs/cost-summary`

```bash
curl "http://localhost:3000/api/v1/openai/audit-logs/cost-summary?model=gpt-4o&startDate=2026-07-01&endDate=2026-07-03"
```

Response (`CostSummaryResDto`, `200`):

```json
{
  "totalCost": 0.042,
  "totalTokens": 15230,
  "totalInputTokens": 9800,
  "totalOutputTokens": 5430,
  "callCount": 42,
  "averageLatencyMs": 780,
  "perModelBreakdown": [
    { "model": "gpt-4o", "cost": 0.038, "callCount": 39 },
    { "model": "gpt-4o-mini", "cost": 0.004, "callCount": 3 }
  ]
}
```

**When you'd use this:** a cost dashboard, or answering "how much did we spend on AI this week."

#### 11. `GET /api/v1/openai/audit-logs`

```bash
curl "http://localhost:3000/api/v1/openai/audit-logs?status=FAILED&page=1&limit=10"
```

Response (`PaginatedAiAuditResDto`, `200`):

```json
{
  "data": [
    {
      "publicId": "9c2e1b3a-...",
      "requestId": "req-8f3a...",
      "model": "gpt-4o",
      "endpoint": "chat.completions",
      "userMessage": "What is 2+2?",
      "inputTokens": 12,
      "outputTokens": 0,
      "totalTokens": 12,
      "estimatedCost": 0,
      "latencyMs": 1500,
      "status": "FAILED",
      "errorCode": "429",
      "errorMessage": "Rate limit exceeded",
      "retryCount": 5,
      "createdAt": "2026-07-03T09:58:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

**When you'd use this:** debugging a specific failed call, or auditing exactly what was sent/
received for a given user or time window.

### Group: Utilities

#### 12. `GET /api/v1/openai/models/pricing`

```bash
curl http://localhost:3000/api/v1/openai/models/pricing
```

Response (`ModelPricingResDto`, `200`) — directly reflects the `MODEL_PRICING` constant:

```json
{
  "pricing": {
    "gpt-4": { "input": 30.0, "output": 60.0 },
    "gpt-4o": { "input": 2.5, "output": 10.0 },
    "gpt-4o-mini": { "input": 0.15, "output": 0.6 }
  }
}
```

**When you'd use this:** a frontend cost calculator, or anywhere you need pricing without
hardcoding it client-side.

#### 13. `GET /api/v1/openai/health`

```bash
curl http://localhost:3000/api/v1/openai/health
```

Response (`200`):

```json
{ "circuitState": "CLOSED", "status": "ok" }
```

`circuitState` is one of `CLOSED` / `OPEN` / `HALF_OPEN`; `status` is `"degraded"` for anything
other than `CLOSED`. This route is `@SkipThrottle()`-annotated — health checks shouldn't count
against the rate limit.

**When you'd use this:** an uptime monitor or a status page widget for "is the AI integration
currently healthy."

---

## Retry Engine Deep Dive

### Exponential backoff with jitter

Formula (`retry.service.ts:computeDelay`):

```typescript
const exponential = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
const jitter = Math.random() * this.baseDelayMs * this.jitterFactor;
return exponential + jitter;
```

With the default config (`baseDelayMs: 1000`, `maxDelayMs: 32000`, `jitterFactor: 0.5`,
`maxRetries: 5`):

| Retry attempt         | Base delay (`1000 × 2^attempt`) | Actual delay range (with jitter) |
| --------------------- | ------------------------------- | -------------------------------- |
| 1st retry (attempt 0) | 1,000ms                         | 1,000 – 1,500ms                  |
| 2nd retry (attempt 1) | 2,000ms                         | 2,000 – 2,500ms                  |
| 3rd retry (attempt 2) | 4,000ms                         | 4,000 – 4,500ms                  |
| 4th retry (attempt 3) | 8,000ms                         | 8,000 – 8,500ms                  |
| 5th retry (attempt 4) | 16,000ms                        | 16,000 – 16,500ms                |

`maxRetries: 5` means up to **6 total attempts** (the original call + 5 retries) before giving up.
If a response carries a `retry-after` header (common on `429`s), that value is used verbatim
instead of the computed delay — the API is telling us exactly how long to wait, so we trust it.

### Circuit breaker state machine

```
                 ┌─────────────────────────────────────────┐
                 │                                           │
                 ▼                                           │
            ┌─────────┐   failureThreshold (5) consecutive  │
            │ CLOSED  │──────  failures across calls  ─────▶│
            └─────────┘                                      │
                 ▲                                      ┌────────┐
                 │            next request succeeds      │  OPEN  │
                 │      ┌────────────────────────────────┤        │
                 │      │                                └────────┘
            ┌─────────┐ │                                     │
            │HALF_OPEN│◀┘          cooldownMs (60s) elapses    │
            └─────────┘◀───────────────────────────────────────┘
                 │
                 └── next request fails ──▶ back to OPEN
```

- **CLOSED** — normal operation. Every failure increments a counter; every success resets it to 0.
- **OPEN** — tripped after 5 consecutive failed _attempts_ (not 5 consecutive `executeWithRetry()`
  calls — a single call that retries 5 times and still fails counts as 1 towards this counter,
  since it's incremented only after all retries within one call are exhausted). While OPEN, every
  new call throws `CircuitOpenException` immediately — **no network request is made at all**.
- **HALF_OPEN** — entered automatically the moment 60 seconds have passed since the circuit
  opened, on the _next_ incoming call. Exactly one request is allowed through
  (`maxAttempts = isHalfOpen ? 1 : this.maxRetries + 1` — no retries while probing). Success →
  CLOSED. Failure → back to OPEN, cooldown timer restarts.

### Error classification table

From `RETRY_CONFIG` (`constants/retry-config.constant.ts`):

| HTTP status                                                 | `ApiErrorType` | Action                                                                   |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `429`                                                       | `RETRYABLE`    | Retry with backoff; honor `Retry-After` header if present                |
| `500`                                                       | `RETRYABLE`    | Retry with backoff                                                       |
| `503`                                                       | `RETRYABLE`    | Retry with backoff                                                       |
| `529`                                                       | `RETRYABLE`    | Retry with backoff (Anthropic-style overload code, included defensively) |
| `400`                                                       | `PERMANENT`    | Fail immediately — malformed request, retrying won't fix it              |
| `401`                                                       | `PERMANENT`    | Fail immediately — bad API key                                           |
| `403`                                                       | `PERMANENT`    | Fail immediately — permission error                                      |
| `404`                                                       | `PERMANENT`    | Fail immediately — model/endpoint doesn't exist                          |
| no `status` on the error (network error, DNS failure, etc.) | `RETRYABLE`    | Retry — `classifyError` treats `status == null` as retryable by default  |
| any other status not listed above                           | `PERMANENT`    | Fail immediately — the fallback default in `classifyError`               |

### Tracing 429, 500, and 401 through the code

```typescript
// retry.service.ts — classifyError()
private classifyError(error: unknown): ApiErrorType {
  if (error instanceof CircuitOpenException) return ApiErrorType.CIRCUIT_OPEN;
  const { status } = error as ApiError;
  if (status == null) return ApiErrorType.RETRYABLE;
  if (RETRY_CONFIG.permanentStatusCodes.includes(status)) return ApiErrorType.PERMANENT;
  if (RETRY_CONFIG.retryableStatusCodes.includes(status)) return ApiErrorType.RETRYABLE;
  return ApiErrorType.PERMANENT;
}
```

- **`429`** → `RETRYABLE`. Not permanent, so execution falls through to the retry branch:
  `retryTracker.retryCount++`, `computeDelay()` (checking for `retry-after` first), `sleep()`,
  loop again — up to `maxRetries` times.
- **`500`** → `RETRYABLE`. Identical path to `429`, minus the `retry-after` header (OpenAI doesn't
  send one for 500s, so it falls through to the exponential formula).
- **`401`** → `PERMANENT`. `if (errorType === ApiErrorType.PERMANENT) throw error;` fires on the
  very first attempt — no delay, no retry, `retryCount` stays `0`. The error propagates straight
  up through `OpenaiService.mapError()`, which doesn't special-case `401`, so it becomes a generic
  `500 Internal Server Error` to the caller (the SDK's own message is preserved) — the only
  request-level status codes `OpenaiService` translates explicitly are circuit-open (`503`) and
  rate limit (`429`).

### Audit integration

Every outcome — success, retried-then-succeeded, or exhausted-all-retries-and-failed — results in
exactly one `AiAuditService.log()` call from `OpenaiService`, carrying the final `retryCount` and,
on failure, `errorCode`/`errorMessage`. See the honest caveat about the `RETRIED` status value in
[Constants & Enums Reference](#constants--enums-reference) — the code currently only ever writes
`SUCCESS` or `FAILED`, never `RETRIED`, even when retries happened.

---

## Token Counting & Cost Tracking

### How tiktoken works

`tiktoken` is OpenAI's own tokenizer, compiled to WebAssembly. `encoding_for_model('gpt-4o')`
loads the correct byte-pair-encoding table for that model family and returns an encoder object.
`enc.encode(text)` returns an array of integer token IDs — `.length` is the token count. Because
the encoder holds WASM-allocated memory, it must be explicitly freed with `enc.free()` after every
use; Node's garbage collector has no visibility into that memory, so skipping this leaks memory
that grows unbounded over the life of the process.

### Cost calculation formula, with real examples

```
cost = (inputTokens / 1,000,000) × pricePerMillionInput + (outputTokens / 1,000,000) × pricePerMillionOutput
```

Verified examples (from `token.service.spec.ts`):

- `gpt-4o`, 1,000,000 input tokens, 0 output tokens → `(1,000,000/1e6) × 2.50 = $2.50`
- `gpt-4o`, 0 input tokens, 1,000,000 output tokens → `(1,000,000/1e6) × 10.00 = $10.00`
- `gpt-4o-mini`, 500 input + 250 output tokens →
  `(500/1e6) × 0.15 + (250/1e6) × 0.60 = 0.000075 + 0.00015 = $0.000225`

### What happens with OpenRouter models (graceful fallback)

Both methods were originally written assuming every model string is a native OpenAI model. Once
`OPENAI_BASE_URL` made OpenRouter models like `meta-llama/llama-4-maverick:free` a normal input,
both methods needed a fallback instead of throwing:

```typescript
countTokens(text, model) {
  try {
    // tiktoken's encoding_for_model() throws for model strings it doesn't recognize
    const enc = encoding_for_model(model);
    // ...
  } catch {
    this.logger.debug(`tiktoken does not support model: ${model}, using heuristic estimate`);
    return this.estimateTokens(text);   // Math.ceil(text.length / 4)
  }
}

calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    this.logger.debug(`No pricing data for model: ${model}, cost set to 0`);
    return 0;                            // never throws — cost tracking degrades to "unknown = $0"
  }
  // ...
}
```

**Practical implication:** when you use an OpenRouter model, `/token-count` and the
`tokenBreakdown` on `/prompt-test` report a _character-based estimate_, not an exact count — and
`estimatedCost` on any endpoint will always be `$0` for that model, since `MODEL_PRICING` only has
entries for the 3 native OpenAI models. This is intentional (OpenRouter's own free-tier models are
literally free), but it means `MODEL_PRICING` would need real entries added before cost tracking
means anything for a _paid_ OpenRouter/Groq/Together model.

### `MODEL_PRICING` table

```typescript
// src/modules/openai/constants/model-pricing.constant.ts
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};
```

All values are USD per 1 million tokens. This is the single source of truth for pricing — update
it here (no migration needed) when OpenAI changes prices.

---

## OpenRouter Integration

### How the `baseURL` swap works

`OpenaiModule`'s only provider factory builds the `openai` npm SDK client:

```typescript
// openai.module.ts
{
  provide: OPENAI_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new OpenAI({
      apiKey: config.get<string>('openai.apiKey') ?? '',
      organization: config.get<string>('openai.orgId'),
      baseURL: config.get<string>('openai.baseUrl') || undefined,
      timeout: config.get<number>('openai.timeoutMs'),
    }),
}
```

When `OPENAI_BASE_URL` is unset, `baseURL` is `undefined` and the SDK falls back to its own
default (`https://api.openai.com/v1`) — zero behavior change for anyone not using it. When it's
set, every SDK call (`chat.completions.create`, and later `embeddings.create` /
`moderations.create`) is sent to that URL instead.

### Why the OpenAI SDK works with other providers

OpenRouter, Groq, Together AI, and most other LLM gateways deliberately implement the same request
and response shape as OpenAI's `/v1/chat/completions` endpoint (the de facto industry standard at
this point). The `openai` npm package is just an HTTP client with types matching that shape — it
has no OpenAI-specific behavior baked in beyond the default `baseURL` and auth header format.
Point it at any URL serving that same contract, and it works unmodified.

### How to switch between OpenAI and OpenRouter

In `.env`:

```bash
# Native OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=

# OpenRouter
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

No code change, no restart-order dependency — just swap the two env vars and restart the app.

### Model string validation

Request DTOs (`ChatCompletionDto`, `ModelCompareDto`, `TokenCountDto`, and `PromptTestDto` via
inheritance) use a custom `@IsValidModel()` decorator
(`src/modules/openai/validators/is-valid-model.validator.ts`) instead of `@IsEnum(OpenAIModel)`,
so both shapes of model string pass validation:

```typescript
const PROVIDER_MODEL_PATTERN = /^[a-z0-9-]+\/[a-z0-9._-]+(:[a-z0-9-]+)?$/;

validate(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return OPENAI_MODELS.includes(value) || PROVIDER_MODEL_PATTERN.test(value);
}
```

### Which free models work

These OpenRouter free-tier models are used in the validator's own test suite and are known-good
input shapes for the `provider/model-name:variant` pattern:

- `nvidia/nemotron-3-ultra-550b-a55b:free`
- `meta-llama/llama-4-maverick:free`
- `openai/gpt-oss-120b:free`
- `deepseek/deepseek-chat-v3-0324:free`

Any model OpenRouter serves under this same naming convention will pass validation and route
correctly — this isn't an allowlist, it's a shape check. (Actually calling one still depends on
OpenRouter's own availability and rate limits for that model at request time.)

---

## How Phase 1 Is Used by Future Phases

The module dependency graph in the requirement spec sketches this explicitly:

```
AiChatModule      → imports OpenaiModule → uses OpenaiService
EmbeddingsModule  → imports OpenaiModule → uses OpenaiService
RagModule         → imports OpenaiModule → uses OpenaiService
ModerationModule  → imports OpenaiModule → uses OpenaiService
```

### Phase 2 (Chat / Streaming)

Imports `OpenaiModule`, injects `OpenaiService` for turn-based completions and `TokenService` for
counting tokens across an accumulating conversation history (context-window management). Phase 2
will likely add its own thin wrapper around the raw `OPENAI_CLIENT` (or extend `OpenaiService`) for
streaming — `chatCompletion()` today is a single non-streaming call, and streaming needs a
different SDK method (`.stream()` / async iterables) that doesn't fit today's
`Promise<ChatCompletionResult>` return shape. `RetryService` and `AiAuditService` should be
reusable mostly as-is for streaming's setup phase, even though mid-stream failures need their own
handling this module doesn't yet cover.

### Phase 3 (RAG / Embeddings)

Imports `OpenaiModule` for the same `OPENAI_CLIENT` instance — `openaiClient.embeddings.create()`
is a normal SDK call, no new provider setup needed, and it automatically inherits whatever
`OPENAI_BASE_URL` is configured. `OpenAIEndpoint.EMBEDDINGS` already exists in the enum
specifically for this — Phase 3 just needs to start passing it to `AiAuditService.log()`.
`TokenService` is directly reusable for chunk-sizing decisions before embedding. `RetryService`'s
backoff/circuit-breaker pattern is provider-agnostic and could be reused as-is for embedding calls,
though it isn't currently plumbed through a shared entry point the way `chatCompletion()` is.

### Phase 4 (Moderation / Safety)

Same story: `OpenAIEndpoint.MODERATIONS` is already reserved in the enum. Moderation calls are
cheap and low-latency compared to completions, so the retry/circuit-breaker logic matters less,
but the audit trail (what content was flagged, when, by which model) is exactly the kind of record
`AiAuditService` already exists to keep. Per-user cost budgets and semantic caching (also Phase 4,
per the spec's out-of-scope list) would build on top of the `ai_audit_logs` table this phase
already populates — `getCostSummary()`'s per-user aggregation is most of what a budget check needs.

---

## Constants & Enums Reference

| Enum / Constant   | Values                                                                                                                                                                                       | Used for                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenAIModel`     | `GPT_4`, `GPT_4O`, `GPT_4O_MINI`                                                                                                                                                             | Default model literals (`OpenAIModel.GPT_4O` is the hardcoded fallback in both the controller and `OpenaiService`); baseline accepted-value set for `@IsValidModel()` | Comment in the enum file explicitly notes it does **not** need to grow for OpenRouter models — those pass validation via the regex path instead.                                                                                                                                                                                                                                                                              |
| `AiAuditStatus`   | `SUCCESS`, `FAILED`, `RETRIED`                                                                                                                                                               | `AiAuditLog.status`                                                                                                                                                   | **`RETRIED` is defined but never actually written.** `OpenaiService` only ever logs `SUCCESS` or `FAILED` — a call that succeeded after 3 retries is still logged as `SUCCESS`, with the retry count captured separately in `retryCount`. Worth fixing if "how many calls needed retries" ever becomes a dashboard metric.                                                                                                    |
| `PromptTechnique` | `SYSTEM_PROMPT`, `FEW_SHOT`, `ROLE_PLAY`, `STRUCTURED_OUTPUT`, `CHAIN_OF_THOUGHT`, `TEMPERATURE_TUNING`                                                                                      | `PromptTemplate.technique`; validated on `CreatePromptTemplateDto`/`QueryPromptTemplateDto`                                                                           | One seed template per value (`prisma/seed.ts`).                                                                                                                                                                                                                                                                                                                                                                               |
| `OpenAIEndpoint`  | `CHAT_COMPLETIONS`, `EMBEDDINGS`, `MODERATIONS`                                                                                                                                              | `AiAuditLog.endpoint`                                                                                                                                                 | Only `CHAT_COMPLETIONS` is used today. `EMBEDDINGS`/`MODERATIONS` are reserved placeholders for Phase 3/4.                                                                                                                                                                                                                                                                                                                    |
| `ApiErrorType`    | `RETRYABLE`, `PERMANENT`, `CIRCUIT_OPEN`, `TIMEOUT`                                                                                                                                          | Internal to `RetryService.classifyError()`                                                                                                                            | **`TIMEOUT` is defined but never returned.** A connection timeout from the SDK typically arrives without a `status` field, which `classifyError` maps to `RETRYABLE` (still retried, just not labeled `TIMEOUT`). `CIRCUIT_OPEN` is also effectively dead in practice — the circuit-open check happens _before_ the retry loop even starts, so a `CircuitOpenException` is thrown directly and never reaches `classifyError`. |
| `MODEL_PRICING`   | see [table above](#model_pricing-table)                                                                                                                                                      | `TokenService.calculateCost()` / `getModelPricing()`                                                                                                                  | Code constant, not a DB table — see the Decisions on Record in the spec for why.                                                                                                                                                                                                                                                                                                                                              |
| `RETRY_CONFIG`    | `maxRetries: 5`, `baseDelayMs: 1000`, `maxDelayMs: 32000`, `jitterFactor: 0.5`, `circuitBreaker: { failureThreshold: 5, cooldownMs: 60000 }`, `retryableStatusCodes`, `permanentStatusCodes` | Fallback defaults for `RetryService`, overridden by env vars where set                                                                                                | See [Environment Variables](#environment-variables).                                                                                                                                                                                                                                                                                                                                                                          |
| `OPENAI_CLIENT`   | `'OPENAI_CLIENT'` (string)                                                                                                                                                                   | DI injection token for the raw SDK instance                                                                                                                           | Needed because you can't use a class as a token for a third-party value built by a factory.                                                                                                                                                                                                                                                                                                                                   |

---

## Environment Variables

| Variable                           | Required | Default                                               | Controls                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                   | **Yes**  | —                                                     | Auth for the OpenAI SDK client. Missing → `OpenaiService.onModuleInit()` logs a warning and every `chatCompletion()` call fails fast with `503`.                                                                                                                                                                                |
| `OPENAI_ORG_ID`                    | No       | — (`undefined`)                                       | Passed as `organization` to the SDK client — scopes calls to an OpenAI org.                                                                                                                                                                                                                                                     |
| `OPENAI_BASE_URL`                  | No       | — (`undefined` → SDK's own default, `api.openai.com`) | Swaps the SDK's target host — this is the whole OpenRouter/Groq/Together mechanism.                                                                                                                                                                                                                                             |
| `OPENAI_DEFAULT_MODEL`             | No       | `'gpt-4o'`                                            | **Defined in config but not actually read anywhere in the code today** — the real default model is the hardcoded `OpenAIModel.GPT_4O` literal in `openai.service.ts` and `openai.controller.ts`. Wiring this up is a small future cleanup, not a bug that affects behavior (`'gpt-4o'` happens to match the hardcoded default). |
| `OPENAI_MAX_RETRIES`               | No       | `5`                                                   | `RetryService.maxRetries` — number of retries after the initial attempt.                                                                                                                                                                                                                                                        |
| `OPENAI_RETRY_BASE_DELAY_MS`       | No       | `1000`                                                | `RetryService.baseDelayMs` — base for the exponential backoff formula.                                                                                                                                                                                                                                                          |
| `OPENAI_CIRCUIT_FAILURE_THRESHOLD` | No       | `5`                                                   | Consecutive failures before the circuit opens.                                                                                                                                                                                                                                                                                  |
| `OPENAI_CIRCUIT_COOLDOWN_MS`       | No       | `60000`                                               | How long the circuit stays `OPEN` before probing again (`HALF_OPEN`).                                                                                                                                                                                                                                                           |
| `OPENAI_TIMEOUT_MS`                | No       | `30000`                                               | Per-request timeout passed to the SDK client.                                                                                                                                                                                                                                                                                   |

All of these are read through `ConfigService` via the `openai` namespace
(`configService.get<string>('openai.apiKey')`, etc.) — never `process.env` directly, per
NFR-AI-006 and `env.validation.ts`'s startup validation (the app refuses to boot if
`OPENAI_API_KEY` is missing or any numeric var is malformed).

---

## How to Explain This to Others

**One-liner:**

> A NestJS module that wraps the OpenAI API with retries, cost tracking, and audit logging, so
> every future AI feature gets reliability and observability for free.

**30-second version:**

> Every AI feature we build — chat, RAG, moderation — needs to call an LLM, handle it when the
> LLM provider is flaky, know what it costs, and log what happened. Phase 1 builds that once as a
> single NestJS module with five services: one that actually talks to OpenAI, one that counts
> tokens and calculates cost, one that retries failed calls with backoff and trips a circuit
> breaker if things stay broken, one that writes an audit log of every call, and one that manages
> reusable prompt templates. It exposes 13 REST endpoints for testing and inspection, and it's
> already provider-agnostic — swapping one env var routes every call through OpenRouter instead of
> OpenAI, so we can test against free models without spending real money.

**2-minute version:**

> Phase 1 is the foundation every later AI phase (chat, embeddings/RAG, moderation) will build on.
> The core idea is that nothing in the app is allowed to call the OpenAI SDK directly — everything
> goes through `OpenaiService`, which delegates to four supporting services.
>
> `TokenService` counts tokens with OpenAI's actual tokenizer (`tiktoken`) and turns token counts
> into a dollar cost using a pricing table we control. `RetryService` implements exponential
> backoff with jitter for transient failures (rate limits, server errors), classifies errors as
> retryable vs. permanent so we don't waste time retrying a bad API key, and trips a circuit
> breaker after repeated failures so we fail fast instead of hammering a service that's down.
> `AiAuditService` writes an append-only log of every single call — success, failure, or retried —
> with full token/cost/latency detail, which is what any future cost dashboard or debugging session
> will query. `PromptTemplateService` stores tested system prompts in the database with metadata,
> so prompt iteration doesn't require a code deploy.
>
> On top of those, `OpenaiController` exposes 13 endpoints: chat completion, model comparison,
> prompt testing, token counting, full CRUD on prompt templates, audit log querying with cost
> aggregation, model pricing lookup, and a health check that reports circuit-breaker state.
>
> The last thing added was provider flexibility: setting `OPENAI_BASE_URL` reroutes every call
> through any OpenAI-compatible API — OpenRouter, Groq, Together AI — with no code changes, which
> means we can develop and test against free-tier models before ever touching a paid OpenAI key.
> Getting that working end-to-end required loosening model validation (a custom decorator instead
> of a strict enum) and making the token-counting and cost-calculation code degrade gracefully
> instead of crashing when it sees a model it doesn't recognize.

---

## Implementation Stats

- **Issues completed:** 14 (`AI-001` through `AI-014`) — 13 marked `completed`, `AI-014` (live API
  smoke test) `in-review` as of this writing. See `docs/issues/index.md`.
- **Services:** 5 (`OpenaiService`, `TokenService`, `RetryService`, `AiAuditService`,
  `PromptTemplateService`), plus 1 custom validator (`IsValidModelConstraint`).
- **API endpoints:** 13, across 4 groups (chat/completion, prompt templates, audit logs,
  utilities).
- **Database tables added:** 2 (`ai_audit_logs`, `prompt_templates`), on top of the pre-existing
  `User` / `AuditLog` / `EmbeddingCache` models from the initial project scaffold.
- **Seed data:** 6 prompt templates, one per `PromptTechnique` value.
- **Unit tests:** 84 passing, across 7 spec files in `src/modules/openai/__tests__/`:

  | Spec file                          | Tests |
  | ---------------------------------- | ----- |
  | `openai.controller.spec.ts`        | 22    |
  | `token.service.spec.ts`            | 15    |
  | `is-valid-model.validator.spec.ts` | 13    |
  | `prompt-template.service.spec.ts`  | 11    |
  | `retry.service.spec.ts`            | 10    |
  | `ai-audit.service.spec.ts`         | 8     |
  | `openai.service.spec.ts`           | 5     |

- **External dependencies added:** `openai` (SDK), `tiktoken` (tokenizer).
