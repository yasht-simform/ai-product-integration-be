# Phase 1: OpenAI API Foundations — Requirement Specification

**For**: Engineering team (L&D — G3 AI Product Integration)
**Created**: 2026-06-25
**Status**: Draft
**Goal Document**: `G3_AI_Product_Integration.pdf`

---

## 1. Overview

Phase 1 establishes the foundational layer for all AI-powered features in the application. It wraps the OpenAI API in a production-grade NestJS module with cost tracking, retry logic, token management, and audit logging — so that every future phase (chat, RAG, moderation) builds on a reliable, observable, and cost-controlled base.

| System              | Purpose                                                                             | Consumers                                      | Storage                  |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------ |
| **OpenAI Service**  | Centralized SDK wrapper — all LLM calls go through one service                      | All AI feature modules (chat, RAG, moderation) | None (stateless)         |
| **Token Utility**   | Token counting and cost estimation using `tiktoken`                                 | OpenAI Service, Audit Logger, Cost Dashboard   | None (pure functions)    |
| **Retry Engine**    | Exponential backoff with jitter and circuit breaker for API resilience              | OpenAI Service (internal)                      | In-memory circuit state  |
| **Prompt Library**  | Tested prompt templates with metadata — system prompts, few-shot, structured output | Developers via API and seed files              | `prompt_templates` table |
| **AI Audit Logger** | Tamper-resistant log of every OpenAI API call with tokens, cost, latency            | Admins, cost dashboards, debugging             | `ai_audit_logs` table    |

These are **separate concerns** composed inside a single `OpenaiModule`. The service delegates to the token utility for counting, the retry engine for resilience, and the audit logger for observability. External modules never call the OpenAI SDK directly.

---

## 2. System Architecture

### 2.1 Module Dependency Graph

```
AppModule
└── OpenaiModule (global: false)
    ├── OpenaiService          ← public API (other modules inject this)
    ├── TokenService           ← token counting, cost estimation
    ├── RetryService           ← exponential backoff, circuit breaker
    ├── AiAuditService         ← writes to ai_audit_logs
    ├── PromptTemplateService  ← CRUD for prompt templates
    └── OpenaiController       ← REST endpoints for testing/comparison
```

Future modules import `OpenaiModule` and inject `OpenaiService`:

```
AiChatModule      → imports OpenaiModule → uses OpenaiService
EmbeddingsModule  → imports OpenaiModule → uses OpenaiService
RagModule         → imports OpenaiModule → uses OpenaiService
ModerationModule  → imports OpenaiModule → uses OpenaiService
```

### 2.2 Request Flow

```
Controller → OpenaiService.chatCompletion()
               ├── TokenService.countTokens(input)       [pre-call estimation]
               ├── RetryService.executeWithRetry()        [wraps SDK call]
               │     └── openai.chat.completions.create() [actual API call]
               ├── TokenService.calculateCost()           [from response usage]
               └── AiAuditService.log()                   [async, non-blocking]
```

The audit log write is fire-and-forget (`catch` logs errors but does not block the response). All other steps are synchronous in the request path.

---

## 3. Database Schema

### 3.1 `ai_audit_logs` Table

Append-only log of every OpenAI API call. No updates, no deletes (except retention cleanup).

| Field               | Type                                   | Description                                                               |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `id`                | `BigInt @id @default(autoincrement())` | Internal PK — never exposed                                               |
| `publicId`          | `String @unique @default(uuid())`      | External identifier for API responses                                     |
| `requestId`         | `String`                               | Correlation ID from request middleware (ties to HTTP request)             |
| `userId`            | `String?`                              | Identifier of the user who triggered the call (nullable for system calls) |
| `model`             | `String`                               | Model used: `gpt-4`, `gpt-4o`, `gpt-4o-mini`                              |
| `endpoint`          | `String`                               | OpenAI endpoint called: `chat.completions`, `embeddings`, `moderations`   |
| `systemPrompt`      | `String?`                              | System prompt sent (nullable — not all calls have one)                    |
| `userMessage`       | `String`                               | User/input message sent to the model                                      |
| `assistantResponse` | `String?`                              | Model response content (nullable for failed calls)                        |
| `inputTokens`       | `Int`                                  | Tokens in the request (from `usage.prompt_tokens`)                        |
| `outputTokens`      | `Int`                                  | Tokens in the response (from `usage.completion_tokens`)                   |
| `totalTokens`       | `Int`                                  | `inputTokens + outputTokens`                                              |
| `estimatedCost`     | `Float`                                | Cost in USD, calculated from token counts and model pricing               |
| `latencyMs`         | `Int`                                  | Time from request start to response complete, in milliseconds             |
| `temperature`       | `Float?`                               | Temperature parameter used                                                |
| `maxTokens`         | `Int?`                                 | Max tokens parameter used                                                 |
| `status`            | `String`                               | `SUCCESS`, `FAILED`, `RETRIED`                                            |
| `errorCode`         | `String?`                              | HTTP status code on failure (`429`, `500`, etc.)                          |
| `errorMessage`      | `String?`                              | Error message on failure                                                  |
| `retryCount`        | `Int @default(0)`                      | Number of retries before success or final failure                         |
| `metadata`          | `Json? @db.JsonB`                      | Arbitrary context — tool names used, function calling results, etc.       |
| `createdAt`         | `DateTime @default(now())`             | Immutable timestamp                                                       |

**No `updatedAt`, no `deletedAt`** — append-only.

### 3.2 `prompt_templates` Table

Stores tested prompt templates with metadata for reuse across the application.

| Field                    | Type                                   | Description                                                                                                   |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                     | `BigInt @id @default(autoincrement())` | Internal PK                                                                                                   |
| `publicId`               | `String @unique @default(uuid())`      | External identifier                                                                                           |
| `name`                   | `String @unique`                       | Human-readable identifier: `'customer-support-classifier'`, `'json-extractor'`                                |
| `description`            | `String?`                              | What this template does and when to use it                                                                    |
| `systemPrompt`           | `String`                               | The system prompt text                                                                                        |
| `fewShotExamples`        | `Json? @db.JsonB`                      | Array of `{ input: string, output: string }` pairs                                                            |
| `technique`              | `String`                               | Prompt technique: `'system-prompt'`, `'few-shot'`, `'role-play'`, `'structured-output'`, `'chain-of-thought'` |
| `recommendedModel`       | `String @default("gpt-4o")`            | Suggested model for this template                                                                             |
| `recommendedTemperature` | `Float @default(0.7)`                  | Suggested temperature                                                                                         |
| `tags`                   | `String[]`                             | Categorization tags: `['classification', 'customer-support']`                                                 |
| `isActive`               | `Boolean @default(true)`               | Soft toggle for enabling/disabling templates                                                                  |
| `createdAt`              | `DateTime @default(now())`             | Created timestamp                                                                                             |
| `updatedAt`              | `DateTime @updatedAt`                  | Last modified timestamp                                                                                       |

### 3.3 Indexes

```sql
-- Primary query: audit logs by user, ordered by time
CREATE INDEX idx_ai_audit_logs_user ON ai_audit_logs (user_id, created_at DESC);

-- Filter by model for cost analysis
CREATE INDEX idx_ai_audit_logs_model ON ai_audit_logs (model, created_at DESC);

-- Filter by status for error monitoring
CREATE INDEX idx_ai_audit_logs_status ON ai_audit_logs (status) WHERE status != 'SUCCESS';

-- Prompt template lookup by name
CREATE UNIQUE INDEX idx_prompt_templates_name ON prompt_templates (name);
```

### 3.4 Table Mappings

```prisma
@@map("ai_audit_logs")
@@map("prompt_templates")
```

---

## 4. Enums and Constants

### 4.1 OpenAI Model Enum

TypeScript string enum — NOT a Prisma/database enum. The DB column stores the string value.

```typescript
export enum OpenAIModel {
  GPT_4 = 'gpt-4',
  GPT_4O = 'gpt-4o',
  GPT_4O_MINI = 'gpt-4o-mini',
}
```

### 4.2 AI Audit Status Enum

```typescript
export enum AiAuditStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  RETRIED = 'RETRIED',
}
```

### 4.3 Prompt Technique Enum

```typescript
export enum PromptTechnique {
  SYSTEM_PROMPT = 'system-prompt',
  FEW_SHOT = 'few-shot',
  ROLE_PLAY = 'role-play',
  STRUCTURED_OUTPUT = 'structured-output',
  CHAIN_OF_THOUGHT = 'chain-of-thought',
  TEMPERATURE_TUNING = 'temperature-tuning',
}
```

### 4.4 OpenAI Endpoint Enum

```typescript
export enum OpenAIEndpoint {
  CHAT_COMPLETIONS = 'chat.completions',
  EMBEDDINGS = 'embeddings',
  MODERATIONS = 'moderations',
}
```

### 4.5 Model Pricing Constant

Pricing per 1 million tokens (matches OpenAI's published pricing format). Single source of truth — all cost calculations reference this constant.

```typescript
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};
```

Update this constant when OpenAI changes pricing. No migration needed — code-only change.

### 4.6 Retry Configuration Constant

```typescript
export const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 32000,
  jitterFactor: 0.5,
  circuitBreaker: {
    failureThreshold: 5, // consecutive failures to open circuit
    cooldownMs: 60000, // 60 seconds before half-open
  },
  retryableStatusCodes: [429, 500, 503, 529],
  permanentStatusCodes: [400, 401, 403, 404],
};
```

### 4.7 Error Classification

```typescript
export enum ApiErrorType {
  RETRYABLE = 'RETRYABLE', // 429, 500, 503, 529 — retry with backoff
  PERMANENT = 'PERMANENT', // 400, 401, 403 — do not retry
  CIRCUIT_OPEN = 'CIRCUIT_OPEN', // circuit breaker tripped — fail fast
  TIMEOUT = 'TIMEOUT', // request exceeded timeout
}
```

---

## 5. Service Interfaces

### 5.1 OpenaiService (Public API)

The only service other modules interact with. Wraps all OpenAI SDK calls.

```typescript
interface ChatCompletionParams {
  prompt: string;
  systemPrompt?: string;
  model?: OpenAIModel;
  temperature?: number;
  maxTokens?: number;
  userId?: string; // for audit logging
}

interface ChatCompletionResult {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  estimatedCost: number;
  latencyMs: number;
}
```

Methods:

- `chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>` — primary completion call
- `getModelPricing(): Record<string, { input: number; output: number }>` — expose pricing data

### 5.2 TokenService

Pure utility — no database, no state.

```typescript
countTokens(text: string, model?: OpenAIModel): number
estimateTokens(text: string): number                          // fast heuristic: chars / 4
calculateCost(model: string, inputTokens: number, outputTokens: number): number
getModelPricing(): Record<string, { input: number; output: number }>
```

### 5.3 RetryService

Manages retry logic and circuit breaker state. Internal to OpenaiModule — not exported.

```typescript
executeWithRetry<T>(operation: () => Promise<T>): Promise<T>
getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN'
resetCircuit(): void
```

Circuit breaker states:

- **CLOSED** — normal operation, requests pass through
- **OPEN** — after `failureThreshold` consecutive failures, all requests fail immediately for `cooldownMs`
- **HALF_OPEN** — after cooldown, one request is allowed through. If it succeeds → CLOSED. If it fails → OPEN again.

### 5.4 AiAuditService

Writes to `ai_audit_logs`. Internal to OpenaiModule but exported for dashboard/query use.

```typescript
log(event: AiAuditLogEvent): Promise<void>                    // fire-and-forget (catches errors internally)
findAll(query: QueryAiAuditDto): Promise<PaginatedAiAuditResDto>
getCostSummary(query: CostSummaryQueryDto): Promise<CostSummaryResDto>
```

### 5.5 PromptTemplateService

CRUD for prompt templates.

```typescript
create(dto: CreatePromptTemplateDto): Promise<PromptTemplateResDto>
findAll(query: QueryPromptTemplateDto): Promise<PaginatedPromptTemplateResDto>
findByName(name: string): Promise<PromptTemplateResDto>
update(publicId: string, dto: UpdatePromptTemplateDto): Promise<PromptTemplateResDto>
delete(publicId: string): Promise<void>
```

---

## 6. API Endpoints

### 6.1 Chat Completion

```
POST /api/v1/openai/chat
```

Send a prompt to an OpenAI model. Returns the response with token usage, cost, and latency metrics.

**Request Body** (`ChatCompletionDto`):

| Field          | Type              | Required | Default  | Description                         |
| -------------- | ----------------- | -------- | -------- | ----------------------------------- |
| `prompt`       | `string`          | Yes      | —        | User message                        |
| `systemPrompt` | `string`          | No       | `null`   | System prompt for behavior guidance |
| `model`        | `OpenAIModel`     | No       | `gpt-4o` | Model to use                        |
| `temperature`  | `number (0-2)`    | No       | `0.7`    | Sampling temperature                |
| `maxTokens`    | `number (1-4096)` | No       | `1024`   | Max response tokens                 |

**Response** (`ChatCompletionResDto`):

```json
{
  "code": "AI_001",
  "message": "Chat completion successful",
  "data": {
    "content": "A REST API is...",
    "model": "gpt-4o",
    "usage": {
      "inputTokens": 45,
      "outputTokens": 120,
      "totalTokens": 165
    },
    "estimatedCost": 0.000495,
    "latencyMs": 1230
  }
}
```

### 6.2 Model Comparison

```
POST /api/v1/openai/compare
```

Send the same prompt to multiple models and compare results side by side.

**Request Body** (`ModelCompareDto`):

| Field          | Type            | Required | Default               | Description                          |
| -------------- | --------------- | -------- | --------------------- | ------------------------------------ |
| `prompt`       | `string`        | Yes      | —                     | User message                         |
| `systemPrompt` | `string`        | No       | `null`                | System prompt                        |
| `models`       | `OpenAIModel[]` | No       | `['gpt-4', 'gpt-4o']` | Models to compare                    |
| `temperature`  | `number`        | No       | `0.7`                 | Same temperature for fair comparison |

**Response** (`ModelCompareResDto`):

```json
{
  "code": "AI_002",
  "message": "Model comparison complete",
  "data": {
    "prompt": "Explain REST APIs in 2 sentences.",
    "results": [
      {
        "model": "gpt-4",
        "content": "...",
        "usage": { "inputTokens": 45, "outputTokens": 130, "totalTokens": 175 },
        "estimatedCost": 0.00915,
        "latencyMs": 2100
      },
      {
        "model": "gpt-4o",
        "content": "...",
        "usage": { "inputTokens": 45, "outputTokens": 120, "totalTokens": 165 },
        "estimatedCost": 0.001313,
        "latencyMs": 890
      }
    ],
    "comparison": {
      "cheapest": "gpt-4o",
      "fastest": "gpt-4o",
      "costDifference": "$0.007837",
      "latencyDifference": "1210ms"
    }
  }
}
```

### 6.3 Prompt Test

```
POST /api/v1/openai/prompt-test
```

Test a prompt configuration with full control over parameters. Returns response plus token stats.

**Request Body** (`PromptTestDto`):

| Field          | Type          | Required | Description                                      |
| -------------- | ------------- | -------- | ------------------------------------------------ |
| `prompt`       | `string`      | Yes      | User message to test                             |
| `systemPrompt` | `string`      | No       | System prompt                                    |
| `model`        | `OpenAIModel` | No       | Model (default: gpt-4o)                          |
| `temperature`  | `number`      | No       | Temperature (default: 0.7)                       |
| `maxTokens`    | `number`      | No       | Max tokens (default: 1024)                       |
| `templateName` | `string`      | No       | Load system prompt from a saved template instead |

**Response**: Same shape as chat completion, with added `tokenBreakdown` field showing input token split between system prompt and user message.

### 6.4 Token Count

```
POST /api/v1/openai/token-count
```

Count tokens for a given text without making an API call. Useful for cost estimation before sending.

**Request Body** (`TokenCountDto`):

| Field   | Type          | Required | Description                                     |
| ------- | ------------- | -------- | ----------------------------------------------- |
| `text`  | `string`      | Yes      | Text to tokenize                                |
| `model` | `OpenAIModel` | No       | Model for tokenizer selection (default: gpt-4o) |

**Response** (`TokenCountResDto`):

```json
{
  "code": "AI_003",
  "message": "Token count complete",
  "data": {
    "text": "What is a REST API?",
    "model": "gpt-4o",
    "tokenCount": 6,
    "estimatedCostAsInput": 0.000015,
    "estimatedCostAsOutput": 0.00006
  }
}
```

### 6.5 Model Pricing

```
GET /api/v1/openai/models/pricing
```

Returns pricing for all supported models. No request body.

**Response** (`ModelPricingResDto`):

```json
{
  "code": "AI_004",
  "message": "Model pricing retrieved",
  "data": {
    "gpt-4": { "inputPer1MTokens": 30.0, "outputPer1MTokens": 60.0 },
    "gpt-4o": { "inputPer1MTokens": 2.5, "outputPer1MTokens": 10.0 },
    "gpt-4o-mini": { "inputPer1MTokens": 0.15, "outputPer1MTokens": 0.6 }
  }
}
```

### 6.6 Prompt Templates CRUD

```
POST   /api/v1/openai/templates          — Create template
GET    /api/v1/openai/templates          — List templates (paginated, filterable by technique, tags)
GET    /api/v1/openai/templates/:publicId — Get single template
PATCH  /api/v1/openai/templates/:publicId — Update template
DELETE /api/v1/openai/templates/:publicId — Delete template
```

### 6.7 AI Audit Logs

```
GET /api/v1/openai/audit-logs
```

Paginated query of AI interaction logs. Filterable by `model`, `status`, `userId`, `startDate`, `endDate`.

```
GET /api/v1/openai/audit-logs/cost-summary
```

Aggregated cost summary. Filterable by `userId`, `model`, `startDate`, `endDate`. Returns total cost, total tokens, call count, average latency, cost per model breakdown.

### 6.8 Circuit Breaker Status

```
GET /api/v1/openai/health
```

Returns OpenAI integration health: circuit breaker state, recent error rate, average latency.

---

## 7. Retry Engine Specification

### 7.1 Exponential Backoff with Jitter

```
delay = min(baseDelay * 2^attempt, maxDelay) + random(0, baseDelay * jitterFactor)
```

Example with default config:
| Attempt | Base Delay | With Jitter (range) |
|---|---|---|
| 1 | 1,000ms | 1,000–1,500ms |
| 2 | 2,000ms | 2,000–2,500ms |
| 3 | 4,000ms | 4,000–4,500ms |
| 4 | 8,000ms | 8,000–8,500ms |
| 5 | 16,000ms | 16,000–16,500ms |

### 7.2 Error Classification

| HTTP Status | Type                | Action                                                      |
| ----------- | ------------------- | ----------------------------------------------------------- |
| 429         | Rate limited        | Retry with backoff; respect `Retry-After` header if present |
| 500         | Server error        | Retry with backoff                                          |
| 503         | Service unavailable | Retry with backoff                                          |
| 529         | Overloaded          | Retry with backoff                                          |
| 400         | Bad request         | Do NOT retry — permanent error, fix the request             |
| 401         | Unauthorized        | Do NOT retry — API key invalid                              |
| 403         | Forbidden           | Do NOT retry — permission error                             |
| 404         | Not found           | Do NOT retry — endpoint/model does not exist                |
| Timeout     | Connection timeout  | Retry with backoff                                          |

### 7.3 Circuit Breaker

State machine:

```
CLOSED ──[failureThreshold consecutive failures]──→ OPEN
OPEN ──[cooldownMs elapsed]──→ HALF_OPEN
HALF_OPEN ──[next request succeeds]──→ CLOSED
HALF_OPEN ──[next request fails]──→ OPEN
```

When circuit is OPEN:

- All requests fail immediately with `CircuitOpenException`
- No API calls are made
- The audit log records status `FAILED` with errorCode `CIRCUIT_OPEN`

### 7.4 Audit Integration

Every retry attempt updates the audit log:

- `retryCount` incremented on each attempt
- Final `status` is `SUCCESS` if eventually successful, `RETRIED` if succeeded after retries, `FAILED` if all retries exhausted
- `errorCode` and `errorMessage` capture the last error

---

## 8. Token Counting Specification

### 8.1 Exact Counting with tiktoken

Use the `tiktoken` npm package (OpenAI's official tokenizer) for exact token counts.

```typescript
import { encoding_for_model } from 'tiktoken';

function countTokens(text: string, model: OpenAIModel): number {
  const enc = encoding_for_model(model);
  const tokens = enc.encode(text);
  enc.free(); // tiktoken uses WASM — must free manually
  return tokens.length;
}
```

**Important**: `tiktoken` uses WebAssembly and allocates memory that must be freed. The encoding object must be freed after each use to prevent memory leaks.

### 8.2 Heuristic Estimation

For quick estimates without loading the tokenizer:

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // ~4 chars per token in English
}
```

### 8.3 Cost Calculation

```typescript
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return parseFloat((inputCost + outputCost).toFixed(8));
}
```

---

## 9. Prompt Engineering Specification

### 9.1 Seed Prompt Templates

The application must ship with at least 6 tested prompt templates, one per technique:

| Name                      | Technique            | Purpose                                                     |
| ------------------------- | -------------------- | ----------------------------------------------------------- |
| `technical-support-agent` | `system-prompt`      | Customer support agent with rules and guardrails            |
| `ticket-classifier`       | `few-shot`           | Classifies support tickets into categories using 3 examples |
| `code-reviewer`           | `role-play`          | Senior developer persona that reviews code snippets         |
| `json-extractor`          | `structured-output`  | Extracts structured JSON from unstructured text             |
| `step-by-step-analyzer`   | `chain-of-thought`   | Solves multi-step problems by reasoning aloud               |
| `creative-brainstormer`   | `temperature-tuning` | Creative ideation at high temperature (1.0)                 |

Each seed template includes:

- `systemPrompt` with the full prompt text
- `fewShotExamples` where applicable (2–3 examples each)
- `recommendedModel` and `recommendedTemperature`
- `description` explaining when and why to use it
- `tags` for categorization

### 9.2 Template Testing via API

The `POST /api/v1/openai/prompt-test` endpoint allows testing any template against arbitrary user input. When `templateName` is provided, the system prompt is loaded from the database. This enables iterative prompt development without code changes.

---

## 10. Functional Requirements

**FR-AI-001**: `OpenaiService.chatCompletion()` MUST return a structured result containing: content, model used, token usage (input/output/total), estimated cost in USD, and latency in milliseconds.

**FR-AI-002**: `TokenService.countTokens()` MUST use the `tiktoken` library for exact token counts. The encoding MUST be freed after each use to prevent memory leaks.

**FR-AI-003**: `TokenService.calculateCost()` MUST use the `MODEL_PRICING` constant as its single source of truth. The cost formula is: `(inputTokens / 1,000,000) × inputPrice + (outputTokens / 1,000,000) × outputPrice`.

**FR-AI-004**: `RetryService.executeWithRetry()` MUST implement exponential backoff with jitter. The delay formula is: `min(baseDelay × 2^attempt, maxDelay) + random(0, baseDelay × jitterFactor)`.

**FR-AI-005**: `RetryService` MUST classify errors as retryable or permanent based on HTTP status code. Status codes 429, 500, 503, 529 are retryable. Status codes 400, 401, 403, 404 are permanent and MUST NOT be retried.

**FR-AI-006**: `RetryService` MUST implement a circuit breaker that opens after `failureThreshold` consecutive failures and remains open for `cooldownMs` before entering half-open state.

**FR-AI-007**: `AiAuditService.log()` MUST write every OpenAI API call to the `ai_audit_logs` table, including failed calls and retried calls.

**FR-AI-008**: `AiAuditService.log()` MUST be fire-and-forget — audit log write failures MUST NOT cause the parent API call to fail. Failures MUST be logged via `LoggerService`.

**FR-AI-009**: The model comparison endpoint (`POST /api/v1/openai/compare`) MUST call each requested model with identical parameters and return results side by side with a comparison summary (cheapest, fastest, cost and latency differences).

**FR-AI-010**: The token count endpoint (`POST /api/v1/openai/token-count`) MUST return exact token counts without making an OpenAI API call.

**FR-AI-011**: Prompt templates MUST be stored in the `prompt_templates` table and be accessible via CRUD endpoints.

**FR-AI-012**: The prompt test endpoint MUST support loading system prompts from saved templates via `templateName` as an alternative to passing `systemPrompt` directly.

**FR-AI-013**: When `OPENAI_API_KEY` is not set, `OpenaiService` MUST log a warning on startup. All API calls MUST fail with a clear error message, not an unhandled SDK exception.

**FR-AI-014**: The AI audit logs endpoint MUST support pagination and filtering by `model`, `status`, `userId`, `startDate`, and `endDate`.

**FR-AI-015**: The cost summary endpoint MUST return aggregated metrics: total cost, total tokens, call count, average latency, and per-model breakdown.

---

## 11. Non-Functional Requirements

**NFR-AI-001**: `chatCompletion()` p99 latency overhead (excluding OpenAI API time) MUST be under 50ms — the wrapper should add negligible latency beyond the SDK call itself.

**NFR-AI-002**: `TokenService.countTokens()` MUST free the `tiktoken` encoding after each use. Memory usage MUST NOT grow over time.

**NFR-AI-003**: No `any` types. TypeScript strict compliance throughout all Phase 1 code.

**NFR-AI-004**: No `console.*` — use `LoggerService` for all log output.

**NFR-AI-005**: All endpoints MUST have Swagger documentation with `@ApiTags`, `@ApiOperation`, `@ApiResponse`, and DTO decorators.

**NFR-AI-006**: All environment variables MUST be read via `ConfigService` — no `process.env` access.

**NFR-AI-007**: Audit log inserts MUST NOT degrade endpoint response time. The fire-and-forget pattern must not add measurable latency to the critical path.

**NFR-AI-008**: Circuit breaker state MUST be in-memory only — no database or Redis dependency. Acceptable to lose state on restart.

---

## 12. Environment Variables

| Variable                           | Required | Default  | Description                          |
| ---------------------------------- | -------- | -------- | ------------------------------------ |
| `OPENAI_API_KEY`                   | Yes      | —        | OpenAI API key (`sk-...`)            |
| `OPENAI_ORG_ID`                    | No       | `null`   | OpenAI organization ID               |
| `OPENAI_DEFAULT_MODEL`             | No       | `gpt-4o` | Default model for completions        |
| `OPENAI_MAX_RETRIES`               | No       | `5`      | Maximum retry attempts               |
| `OPENAI_RETRY_BASE_DELAY_MS`       | No       | `1000`   | Base delay for exponential backoff   |
| `OPENAI_CIRCUIT_FAILURE_THRESHOLD` | No       | `5`      | Consecutive failures to open circuit |
| `OPENAI_CIRCUIT_COOLDOWN_MS`       | No       | `60000`  | Circuit breaker cooldown period      |
| `OPENAI_TIMEOUT_MS`                | No       | `30000`  | Request timeout in milliseconds      |

---

## 13. Test Scenarios

**SC-AI-001**: Chat completion returns valid response with metrics

> Send `POST /api/v1/openai/chat` with `{ "prompt": "What is 2+2?" }`.
> **Expected**: 200 response with `content` containing a relevant answer, `usage.totalTokens > 0`, `estimatedCost > 0`, `latencyMs > 0`.

**SC-AI-002**: Model comparison returns side-by-side results

> Send `POST /api/v1/openai/compare` with `{ "prompt": "Explain REST", "models": ["gpt-4", "gpt-4o"] }`.
> **Expected**: 200 response with 2 results. `comparison.cheapest` is `gpt-4o`. Both results have valid usage stats.

**SC-AI-003**: Token count works without API call

> Send `POST /api/v1/openai/token-count` with `{ "text": "Hello world", "model": "gpt-4o" }`.
> **Expected**: 200 response with `tokenCount: 2` (exact count). No entry in `ai_audit_logs`.

**SC-AI-004**: Retry engine handles 429 with backoff

> Mock OpenAI to return 429 twice, then 200 on third attempt.
> **Expected**: Final response is successful. `retryCount = 2` in audit log. Total delay ≥ 3000ms (1s + 2s).

**SC-AI-005**: Circuit breaker opens after consecutive failures

> Mock OpenAI to return 500 for 5 consecutive calls.
> **Expected**: 6th call fails immediately with `CircuitOpenException` without hitting OpenAI. Circuit state is `OPEN`.

**SC-AI-006**: Circuit breaker recovers after cooldown

> After SC-AI-005, wait for cooldown period. Send one request with mocked 200.
> **Expected**: Request succeeds. Circuit state returns to `CLOSED`.

**SC-AI-007**: Permanent errors are not retried

> Mock OpenAI to return 401 (invalid API key).
> **Expected**: Request fails immediately. `retryCount = 0` in audit log. No backoff delay.

**SC-AI-008**: Audit log captures every API call

> Send 3 chat completion requests (2 successful, 1 failed).
> **Expected**: `ai_audit_logs` contains 3 rows. 2 with `status: SUCCESS`, 1 with `status: FAILED`. All have correct `model`, `inputTokens`, `estimatedCost`.

**SC-AI-009**: Missing API key returns clear error

> Unset `OPENAI_API_KEY` and send a chat completion request.
> **Expected**: 503 response with message indicating API key is not configured. Not a raw SDK error.

**SC-AI-010**: Prompt template CRUD works end to end

> Create a template → List templates (verify it appears) → Get by publicId → Update name → Delete → List (verify removed).
> **Expected**: All operations succeed with correct response codes (201, 200, 200, 200, 204, 200).

**SC-AI-011**: Prompt test with template name loads from database

> Create a template with name `'test-classifier'`. Send `POST /api/v1/openai/prompt-test` with `{ "prompt": "classify this", "templateName": "test-classifier" }`.
> **Expected**: Response uses the template's system prompt. Response includes token stats.

**SC-AI-012**: Validation rejects invalid input

> Send `POST /api/v1/openai/chat` with `{ "prompt": "", "temperature": 5 }`.
> **Expected**: 400 response with validation errors for empty prompt and temperature > 2.

**SC-AI-013**: Cost summary aggregates correctly

> Send 5 chat completions with different models. Query `GET /api/v1/openai/audit-logs/cost-summary`.
> **Expected**: `totalCost` equals sum of individual costs. Per-model breakdown matches. `callCount = 5`.

**SC-AI-014**: TypeScript compiles with zero errors

> Run `npx tsc --noEmit`.
> **Expected**: Exit code 0. No TypeScript errors in any Phase 1 source file.

**SC-AI-015**: ESLint passes with zero violations

> Run `npm run lint`.
> **Expected**: Exit code 0. No `console.log`, no unused imports, no `process.env`.

---

## 14. Out of Scope

The following are explicitly excluded from Phase 1:

- **Streaming responses** — streaming completions (SSE) are Phase 2 (Chat module)
- **Function calling / Tool use** — OpenAI tool use is Phase 2 (Chat module)
- **Conversation history** — multi-turn context management is Phase 2 (Chat module)
- **Embeddings** — embedding generation and vector storage are Phase 3 (RAG module)
- **Content moderation** — OpenAI moderation API is Phase 4 (Moderation module)
- **Per-user cost budgets** — daily/monthly spending limits per user are Phase 4
- **Semantic caching** — embedding-based response caching is Phase 4
- **Response caching** — exact-match response caching deferred to Phase 4
- **Authentication/RBAC on AI endpoints** — Phase 1 endpoints are unguarded (development/learning context). Auth is added when endpoints are production-facing.
- **WebSocket streaming** — real-time token streaming to frontend is out of scope
- **Multi-provider support** — Anthropic, Cohere, or other providers are out of scope
- **Fine-tuning** — OpenAI fine-tuning API is out of scope
- **Image/audio APIs** — DALL-E, Whisper, TTS are out of scope
- **LangChain/LlamaIndex integration** — deferred to Phase 3 when RAG patterns are needed

---

## 15. Decisions on Record

| Decision                                                                        | Rationale                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All OpenAI calls go through `OpenaiService` — never direct SDK calls            | Single point for retry logic, cost tracking, audit logging, and future provider switching                                                               |
| Audit log writes are fire-and-forget                                            | Audit failures must not break user-facing API calls. Logging failures are captured via LoggerService.                                                   |
| Circuit breaker state is in-memory                                              | No Redis dependency at this stage. Acceptable to reset on restart — this is a learning project, not high-availability production.                       |
| Token counting uses `tiktoken` (not heuristic) for all logged counts            | Exact counts are necessary for accurate cost tracking. The heuristic `chars/4` is exposed only as a convenience method.                                 |
| Model pricing is a code constant, not a database table                          | Pricing changes infrequently. A code constant is simpler, faster, and avoids an unnecessary DB lookup on every API call. Update requires a code deploy. |
| Prompt templates stored in database, not JSON files                             | Templates need CRUD operations, tagging, and querying. A database table is the right abstraction. Seed data is loaded via a Prisma seed script.         |
| Retry configuration is env-configurable                                         | Different environments may need different retry behavior (aggressive in dev, conservative in production).                                               |
| Separate `TokenService` and `RetryService` instead of inline in `OpenaiService` | Single responsibility. TokenService is reusable by embeddings (Phase 3). RetryService is testable in isolation.                                         |

---

## 16. Folder Structure

```
src/modules/openai/
├── openai.module.ts                 ← exports OpenaiService, AiAuditService, TokenService
├── openai.controller.ts             ← REST endpoints
├── services/
│   ├── openai.service.ts            ← primary chat completion wrapper
│   ├── token.service.ts             ← tiktoken counting, cost calculation
│   ├── retry.service.ts             ← exponential backoff, circuit breaker
│   ├── ai-audit.service.ts          ← audit log writes and queries
│   └── prompt-template.service.ts   ← template CRUD
├── dto/
│   ├── chat-completion.dto.ts
│   ├── chat-completion-res.dto.ts
│   ├── model-compare.dto.ts
│   ├── model-compare-res.dto.ts
│   ├── prompt-test.dto.ts
│   ├── token-count.dto.ts
│   ├── token-count-res.dto.ts
│   ├── ai-audit-log-res.dto.ts
│   ├── query-ai-audit.dto.ts
│   ├── cost-summary-res.dto.ts
│   ├── prompt-template.dto.ts
│   ├── prompt-template-res.dto.ts
│   └── index.ts
├── constants/
│   ├── openai-model.enum.ts
│   ├── ai-audit-status.enum.ts
│   ├── prompt-technique.enum.ts
│   ├── model-pricing.constant.ts
│   ├── retry-config.constant.ts
│   └── index.ts
└── __tests__/
    ├── openai.service.spec.ts
    ├── token.service.spec.ts
    ├── retry.service.spec.ts
    ├── ai-audit.service.spec.ts
    ├── prompt-template.service.spec.ts
    └── openai.controller.spec.ts
```
