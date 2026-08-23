# Phase 4: Safety & Compliance — Requirement Specification

**For**: Engineering team (L&D — G3 AI Product Integration)
**Created**: 2026-07-09
**Status**: Draft
**Goal Document**: `G3_AI_Product_Integration.pdf`
**Depends On**: Phase 1 (completed), Phase 2 (completed), Phase 3 (completed)

---

## 1. Overview

Phase 4 is the safety and governance layer — content moderation, per-user cost budgets, data retention policies, and cost tracking dashboards. This is the "responsible AI" phase that ensures the AI features built in Phases 1-3 are safe to operate in a production environment. It covers the remaining items from the goal doc's "Safety & Compliance" learning area and Practice App 3 (Content Moderation).

| System                     | Purpose                                                                                                     | Consumers                                                | Storage                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **Content Moderation**     | Filters harmful/inappropriate content in user inputs and model outputs using OpenAI's moderation API        | All AI endpoints (middleware), standalone moderation API | `moderation_logs` table                               |
| **Per-User Cost Budgets**  | Tracks AI spending per user with configurable daily/monthly limits                                          | All AI calls (guard), admin dashboard                    | `user_cost_budgets` table, reads from `ai_audit_logs` |
| **Data Retention**         | Automated cleanup of old audit logs, conversations, and embeddings based on configurable retention policies | Scheduled cron jobs                                      | Existing tables (cleanup)                             |
| **Cost Dashboard Service** | Advanced cost analytics — per-user, per-model, per-feature spending trends                                  | Admin API, FE dashboard                                  | Reads from `ai_audit_logs`                            |

---

## 2. System Architecture

### 2.1 Module Structure

```
ModerationModule
├── ModerationService          ← calls OpenAI moderation API, classifies content
├── ModerationGuard            ← NestJS guard that moderates input before it reaches the handler
├── OutputModerationInterceptor ← intercepts AI responses and moderates before returning to client
├── ModerationController       ← standalone moderation endpoints + log queries
└── ModerationModule           ← exports guard and interceptor for use by other modules

CostManagementModule
├── CostBudgetService          ← per-user budget CRUD, limit enforcement
├── CostBudgetGuard            ← NestJS guard that checks budget before AI calls
├── CostAnalyticsService       ← advanced cost queries, trends, projections
├── RetentionService           ← data cleanup cron jobs
├── CostManagementController   ← budget CRUD, analytics, retention management endpoints
└── CostManagementModule       ← exports guard for use by other modules
```

### 2.2 Moderation Flow

```
User sends message
  → ModerationGuard (global or per-route)
      ├── ModerationService.moderateText(input)
      │     └── openai.moderations.create({ input })
      ├── If flagged → throw 422 with categories + scores
      ├── If clean → pass through to handler
      └── Log moderation result to moderation_logs
  → Handler processes request (chat completion, RAG query, etc.)
  → Response generated
  → OutputModerationInterceptor (optional, configurable)
      ├── ModerationService.moderateText(output)
      ├── If flagged → replace response with safe message, log violation
      └── If clean → return response as-is
```

### 2.3 Cost Budget Flow

```
User makes AI API call
  → CostBudgetGuard
      ├── CostBudgetService.checkBudget(userId)
      │     ├── Get user's budget config (daily/monthly limit)
      │     ├── Get user's current spend from ai_audit_logs aggregate
      │     ├── If over limit → throw 429 with "Budget exceeded" message
      │     └── If under limit → pass through
      └── Log budget check result
  → Handler processes request
  → AiAuditService.log() records the cost (existing Phase 1 behavior)
  → Budget is automatically reflected in next check (reads from audit logs)
```

---

## 3. Database Schema

### 3.1 `moderation_logs` Table

Records every moderation check — both clean passes and violations.

| Field            | Type                                   | Description                                                             |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `id`             | `BigInt @id @default(autoincrement())` | Internal PK                                                             |
| `publicId`       | `String @unique @default(uuid())`      | External identifier                                                     |
| `requestId`      | `String?`                              | Correlation ID from request context                                     |
| `userId`         | `String?`                              | Who triggered the content                                               |
| `direction`      | `String`                               | `'input'` (user message) or `'output'` (AI response)                    |
| `content`        | `String`                               | The text that was moderated (truncated to 1000 chars for storage)       |
| `isFlagged`      | `Boolean`                              | Whether any category was flagged                                        |
| `categories`     | `Json @db.JsonB`                       | `{ hate: false, self-harm: false, sexual: true, violence: false, ... }` |
| `categoryScores` | `Json @db.JsonB`                       | `{ hate: 0.001, self-harm: 0.0, sexual: 0.85, violence: 0.02, ... }`    |
| `action`         | `String`                               | `'allowed'`, `'blocked'`, `'replaced'`                                  |
| `source`         | `String`                               | Which endpoint triggered this: `'chat'`, `'rag'`, `'standalone'`        |
| `metadata`       | `Json? @db.JsonB`                      | Additional context                                                      |
| `createdAt`      | `DateTime @default(now())`             | Timestamp                                                               |

### 3.2 `user_cost_budgets` Table

Per-user spending limits.

| Field             | Type                                   | Description                                                   |
| ----------------- | -------------------------------------- | ------------------------------------------------------------- |
| `id`              | `BigInt @id @default(autoincrement())` | Internal PK                                                   |
| `publicId`        | `String @unique @default(uuid())`      | External identifier                                           |
| `userId`          | `String @unique`                       | User identifier (matches ai_audit_logs.userId)                |
| `dailyLimitUsd`   | `Float?`                               | Max daily spend in USD (null = unlimited)                     |
| `monthlyLimitUsd` | `Float?`                               | Max monthly spend in USD (null = unlimited)                   |
| `isActive`        | `Boolean @default(true)`               | Whether budget enforcement is active                          |
| `alertThreshold`  | `Float @default(0.8)`                  | Alert when spend reaches this percentage of limit (0.8 = 80%) |
| `metadata`        | `Json? @db.JsonB`                      | Additional config                                             |
| `createdAt`       | `DateTime @default(now())`             | Created timestamp                                             |
| `updatedAt`       | `DateTime @updatedAt`                  | Last modified                                                 |

### 3.3 Indexes

```sql
-- Moderation logs by user and time
CREATE INDEX idx_moderation_logs_user ON moderation_logs (user_id, created_at DESC);

-- Moderation logs by flagged status
CREATE INDEX idx_moderation_logs_flagged ON moderation_logs (is_flagged) WHERE is_flagged = true;

-- Budget lookup by user
CREATE UNIQUE INDEX idx_user_cost_budgets_user ON user_cost_budgets (user_id);
```

### 3.4 Table Mappings

```prisma
@@map("moderation_logs")
@@map("user_cost_budgets")
```

---

## 4. Enums and Constants

### 4.1 Moderation Categories

```typescript
export const ModerationCategory = {
  HATE: 'hate',
  HATE_THREATENING: 'hate/threatening',
  HARASSMENT: 'harassment',
  HARASSMENT_THREATENING: 'harassment/threatening',
  SELF_HARM: 'self-harm',
  SELF_HARM_INTENT: 'self-harm/intent',
  SELF_HARM_INSTRUCTIONS: 'self-harm/instructions',
  SEXUAL: 'sexual',
  SEXUAL_MINORS: 'sexual/minors',
  VIOLENCE: 'violence',
  VIOLENCE_GRAPHIC: 'violence/graphic',
} as const;
```

### 4.2 Moderation Action

```typescript
export const ModerationAction = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
  REPLACED: 'replaced',
} as const;
```

### 4.3 Moderation Direction

```typescript
export const ModerationDirection = {
  INPUT: 'input',
  OUTPUT: 'output',
} as const;
```

### 4.4 Budget Period

```typescript
export const BudgetPeriod = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
} as const;
```

### 4.5 Retention Configuration

```typescript
export const RETENTION_CONFIG = {
  auditLogRetentionDays: 90, // delete audit logs older than 90 days
  moderationLogRetentionDays: 90, // delete moderation logs older than 90 days
  archivedConversationRetentionDays: 30, // delete archived conversations after 30 days
  embeddingCacheRetentionDays: 180, // clean unused cache entries after 180 days
  cleanupCron: '0 2 * * *', // run cleanup at 2 AM daily
};
```

---

## 5. Service Interfaces

### 5.1 ModerationService

```typescript
moderateText(text: string, options?: ModerationOptions): Promise<ModerationResult>
moderateBatch(texts: string[]): Promise<ModerationResult[]>
getModerationLogs(query: QueryModerationLogsDto): Promise<PaginatedModerationLogsResDto>
getModerationStats(query: ModerationStatsQueryDto): Promise<ModerationStatsResDto>
```

```typescript
interface ModerationOptions {
  userId?: string;
  requestId?: string;
  direction?: 'input' | 'output';
  source?: string;
}

interface ModerationResult {
  isFlagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
  flaggedCategories: string[]; // only the ones that were true
  highestScore: { category: string; score: number };
}
```

The moderation API is FREE — `openai.moderations.create()` has no per-call cost. This works through OpenRouter too (OpenAI moderation endpoint is separate from chat completions).

### 5.2 CostBudgetService

```typescript
// Budget CRUD
createBudget(dto: CreateBudgetDto): Promise<BudgetResDto>
findAllBudgets(query: QueryBudgetsDto): Promise<PaginatedBudgetsResDto>
findBudgetByUserId(userId: string): Promise<BudgetResDto | null>
updateBudget(publicId: string, dto: UpdateBudgetDto): Promise<BudgetResDto>
deleteBudget(publicId: string): Promise<void>

// Budget checks
checkBudget(userId: string): Promise<BudgetCheckResult>
getUserSpend(userId: string, period: 'daily' | 'monthly'): Promise<number>

// Alerts
getUsersApproachingLimit(threshold?: number): Promise<BudgetAlertDto[]>
```

```typescript
interface BudgetCheckResult {
  allowed: boolean;
  dailySpend: number;
  monthlySpend: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyPercentage: number; // 0-100
  monthlyPercentage: number; // 0-100
  warning?: string; // "Approaching daily limit (85%)"
}
```

### 5.3 CostAnalyticsService

Advanced cost queries beyond Phase 1's `getCostSummary()`.

```typescript
getSpendByUser(query: SpendByUserQueryDto): Promise<SpendByUserResDto>
getSpendByModel(query: SpendByModelQueryDto): Promise<SpendByModelResDto>
getSpendTimeline(query: SpendTimelineQueryDto): Promise<SpendTimelineResDto>
getSpendByFeature(query: SpendByFeatureQueryDto): Promise<SpendByFeatureResDto>
getDailySpendTrend(days: number): Promise<DailyTrendResDto>
getProjectedMonthlySpend(): Promise<ProjectedSpendResDto>
```

All reads from `ai_audit_logs` — no new data table needed. Uses Prisma `groupBy` and `aggregate`.

### 5.4 RetentionService

Automated data cleanup via cron jobs.

```typescript
cleanupAuditLogs(retentionDays: number): Promise<{ deleted: number }>
cleanupModerationLogs(retentionDays: number): Promise<{ deleted: number }>
cleanupArchivedConversations(retentionDays: number): Promise<{ deleted: number }>
cleanupStaleEmbeddingCache(retentionDays: number): Promise<{ deleted: number }>
runFullCleanup(): Promise<RetentionReport>
getRetentionConfig(): RetentionConfig
updateRetentionConfig(config: Partial<RetentionConfig>): void
```

Uses `@nestjs/schedule` (already installed) with `@Cron('0 2 * * *')` — runs at 2 AM daily.

---

## 6. API Endpoints

### 6.1 Moderation

```
POST   /api/v1/moderation/check                 — Moderate text, returns categories + scores
POST   /api/v1/moderation/check-batch            — Moderate multiple texts
GET    /api/v1/moderation/logs                    — Query moderation logs (paginated, filterable)
GET    /api/v1/moderation/stats                   — Moderation stats: total checks, violation rate, top categories
```

**Check Request**:

| Field    | Type     | Required | Description                         |
| -------- | -------- | -------- | ----------------------------------- |
| `text`   | `string` | Yes      | Text to moderate                    |
| `source` | `string` | No       | Where this check was triggered from |

**Check Response**:

```json
{
  "code": "MOD_001",
  "message": "Content moderation complete",
  "data": {
    "isFlagged": true,
    "categories": {
      "hate": false,
      "harassment": false,
      "self-harm": false,
      "sexual": true,
      "violence": false
    },
    "categoryScores": {
      "hate": 0.001,
      "harassment": 0.003,
      "self-harm": 0.0,
      "sexual": 0.85,
      "violence": 0.02
    },
    "flaggedCategories": ["sexual"],
    "highestScore": { "category": "sexual", "score": 0.85 }
  }
}
```

### 6.2 Cost Budgets

```
POST   /api/v1/cost/budgets                      — Create user budget
GET    /api/v1/cost/budgets                       — List all budgets
GET    /api/v1/cost/budgets/:userId               — Get user's budget + current spend
PATCH  /api/v1/cost/budgets/:publicId             — Update budget limits
DELETE /api/v1/cost/budgets/:publicId             — Remove budget (removes enforcement)
GET    /api/v1/cost/budgets/alerts                — Users approaching their limits
```

**Create Budget Request**:

```json
{
  "userId": "user_123",
  "dailyLimitUsd": 1.0,
  "monthlyLimitUsd": 20.0,
  "alertThreshold": 0.8
}
```

**Budget Status Response**:

```json
{
  "code": "COST_001",
  "data": {
    "userId": "user_123",
    "dailySpend": 0.45,
    "monthlySpend": 8.75,
    "dailyLimit": 1.0,
    "monthlyLimit": 20.0,
    "dailyPercentage": 45,
    "monthlyPercentage": 43.75,
    "status": "within_budget"
  }
}
```

### 6.3 Cost Analytics

```
GET    /api/v1/cost/analytics/by-user             — Spend per user (paginated, sortable)
GET    /api/v1/cost/analytics/by-model             — Spend per model
GET    /api/v1/cost/analytics/by-feature           — Spend per feature (chat, rag, embeddings)
GET    /api/v1/cost/analytics/timeline             — Daily spend over time (for charts)
GET    /api/v1/cost/analytics/projected            — Projected monthly spend based on current rate
GET    /api/v1/cost/analytics/daily-trend          — Last N days spend trend
```

### 6.4 Data Retention

```
GET    /api/v1/retention/config                   — Current retention settings
PATCH  /api/v1/retention/config                   — Update retention periods
POST   /api/v1/retention/cleanup                  — Trigger manual cleanup (returns count deleted)
GET    /api/v1/retention/stats                    — Last cleanup time, records due for cleanup
```

---

## 7. Content Moderation Specification

### 7.1 OpenAI Moderation API

The moderation endpoint is **free** — no per-call cost, no token charges. Works via OpenRouter too.

```typescript
const response = await openai.moderations.create({
  input: "text to check"
});

// response.results[0]:
{
  flagged: true,
  categories: { hate: false, sexual: true, violence: false, ... },
  category_scores: { hate: 0.001, sexual: 0.85, violence: 0.02, ... }
}
```

### 7.2 Guard Implementation

`ModerationGuard` is a NestJS `CanActivate` guard. Applied globally or per-route:

```typescript
@UseGuards(ModerationGuard)
@Post('chat')
async sendMessage(@Body() dto: SendMessageDto) { ... }
```

The guard:

1. Extracts the user's text from the request body (configurable field name)
2. Calls `ModerationService.moderateText(text)`
3. If flagged → throws `UnprocessableEntityException` (422) with details
4. If clean → returns `true` (request proceeds)
5. Always logs the result to `moderation_logs`

### 7.3 Output Moderation

`OutputModerationInterceptor` checks AI responses before returning:

```typescript
@UseInterceptors(OutputModerationInterceptor)
@Post('chat')
async sendMessage() { ... }
```

If the AI's response is flagged:

- Replace `content` with a safe message: "I'm sorry, I can't provide that type of content."
- Log the violation with the original content in `moderation_logs`
- Return the sanitized response (don't throw — the user gets a response, just a safe one)

### 7.4 Configuration

- `MODERATION_ENABLED` — global toggle (default: true)
- `MODERATION_INPUT_ENABLED` — check user inputs (default: true)
- `MODERATION_OUTPUT_ENABLED` — check AI outputs (default: false, opt-in)
- `MODERATION_BLOCK_THRESHOLD` — score threshold for blocking (default: 0.7)

---

## 8. Cost Budget Specification

### 8.1 How Budget Enforcement Works

1. Admin creates a budget for a user: daily $1, monthly $20
2. Before each AI call, `CostBudgetGuard` checks `ai_audit_logs` aggregate for that user
3. If daily spend ≥ daily limit → block with 429 "Daily budget exceeded"
4. If monthly spend ≥ monthly limit → block with 429 "Monthly budget exceeded"
5. If spend ≥ alertThreshold × limit → include warning in response header

### 8.2 Spend Calculation

Spend is calculated from `ai_audit_logs`:

```sql
SELECT SUM(estimated_cost)
FROM ai_audit_logs
WHERE user_id = :userId
AND status = 'SUCCESS'
AND created_at >= :periodStart
```

Daily period: midnight UTC to now.
Monthly period: first of current month to now.

### 8.3 Performance

Budget checks query `ai_audit_logs` on every AI call. To avoid per-request DB queries:

- Cache the current spend in memory (per-user, refresh every 60 seconds)
- Or use a Redis-like increment counter (out of scope for this phase — use in-memory cache)

---

## 9. Data Retention Specification

### 9.1 What Gets Cleaned

| Data                   | Default Retention | Cleanup Logic                                                                                           |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Audit logs             | 90 days           | Delete rows where `createdAt < now - 90 days`                                                           |
| Moderation logs        | 90 days           | Delete rows where `createdAt < now - 90 days`                                                           |
| Archived conversations | 30 days           | Delete conversations where `isArchived = true AND updatedAt < now - 30 days` (cascade deletes messages) |
| Embedding cache        | 180 days          | Delete entries where `createdAt < now - 180 days` AND not referenced by any active document chunk       |

### 9.2 Cleanup Schedule

Daily at 2 AM via `@Cron('0 2 * * *')`. Logs: "Retention cleanup: deleted X audit logs, Y moderation logs, Z conversations, W cache entries".

### 9.3 Safety

- Retention only deletes data older than the configured period — never touches recent data
- Active (non-archived) conversations are never touched
- Documents and their chunks are never auto-deleted (only manual deletion)

---

## 10. Functional Requirements

**FR-MOD-001**: `ModerationService.moderateText()` MUST call the OpenAI moderation API and return categorized results with scores.

**FR-MOD-002**: `ModerationGuard` MUST block requests with flagged input and return 422 with category details.

**FR-MOD-003**: `OutputModerationInterceptor` MUST replace flagged AI output with a safe message, not throw an error.

**FR-MOD-004**: Every moderation check (pass or fail) MUST be logged in `moderation_logs`.

**FR-MOD-005**: Moderation MUST be toggleable via environment variables without code changes.

**FR-COST-001**: `CostBudgetGuard` MUST block AI calls when the user's daily or monthly spend exceeds their limit.

**FR-COST-002**: Budget exceeded MUST return 429 (not 403) with a clear message including current spend and limit.

**FR-COST-003**: `CostAnalyticsService` MUST provide spend breakdowns by user, model, feature, and time period.

**FR-COST-004**: Projected monthly spend MUST be calculated from the current daily average × days remaining in month.

**FR-RET-001**: `RetentionService` MUST run automatically at 2 AM daily and delete data exceeding configured retention periods.

**FR-RET-002**: Retention MUST never delete active (non-archived) conversations or active documents.

**FR-RET-003**: Retention periods MUST be configurable via environment variables.

---

## 11. Non-Functional Requirements

**NFR-MOD-001**: Moderation check latency MUST be under 500ms (the moderation API is fast).

**NFR-COST-001**: Budget check MUST complete in under 100ms (use cached spend, not per-request DB query).

**NFR-RET-001**: Cleanup cron MUST complete within 5 minutes even with 100K+ rows to delete (batch delete).

**NFR-ALL-001**: No `any` types. TypeScript strict compliance.

**NFR-ALL-002**: No `console.*` — use `AppLoggerService`.

**NFR-ALL-003**: All endpoints MUST have Swagger documentation.

---

## 12. Environment Variables

| Variable                               | Required | Default     | Description                        |
| -------------------------------------- | -------- | ----------- | ---------------------------------- |
| `MODERATION_ENABLED`                   | No       | `true`      | Global moderation toggle           |
| `MODERATION_INPUT_ENABLED`             | No       | `true`      | Moderate user inputs               |
| `MODERATION_OUTPUT_ENABLED`            | No       | `false`     | Moderate AI outputs                |
| `MODERATION_BLOCK_THRESHOLD`           | No       | `0.7`       | Score threshold for blocking       |
| `COST_BUDGET_ENABLED`                  | No       | `true`      | Global budget enforcement toggle   |
| `COST_BUDGET_CACHE_TTL_MS`             | No       | `60000`     | How long to cache spend totals     |
| `RETENTION_AUDIT_DAYS`                 | No       | `90`        | Audit log retention period         |
| `RETENTION_MODERATION_DAYS`            | No       | `90`        | Moderation log retention period    |
| `RETENTION_ARCHIVED_CONVERSATION_DAYS` | No       | `30`        | Archived conversation retention    |
| `RETENTION_EMBEDDING_CACHE_DAYS`       | No       | `180`       | Stale embedding cache retention    |
| `RETENTION_CRON`                       | No       | `0 2 * * *` | Cleanup schedule (cron expression) |

---

## 13. Test Scenarios

**SC-MOD-001**: Moderate clean text

> Send "Hello, how are you?" to POST /moderation/check. Expect: `isFlagged: false`, all categories false, low scores.

**SC-MOD-002**: Moderate flagged text

> Send text containing clear policy violations. Expect: `isFlagged: true`, relevant category true, high score, logged in moderation_logs.

**SC-MOD-003**: ModerationGuard blocks input

> Send a flagged message to POST /chat/conversations/:id/messages. Expect: 422 response, message NOT sent, moderation logged.

**SC-MOD-004**: Output moderation replaces response

> Configure a system prompt that might produce flagged content. With output moderation enabled, expect: response replaced with safe message.

**SC-MOD-005**: Moderation disabled via config

> Set MODERATION_ENABLED=false. Send flagged text. Expect: request passes through, no moderation log created.

**SC-COST-001**: Budget check passes

> Create budget: daily $1. User has spent $0.50 today. Make an AI call. Expect: call succeeds.

**SC-COST-002**: Budget exceeded blocks call

> Create budget: daily $0.001. Make several AI calls until budget exceeded. Expect: 429 "Daily budget exceeded".

**SC-COST-003**: Budget alerts at threshold

> Create budget: daily $1, alert at 80%. User has spent $0.85. Expect: response includes warning header/field.

**SC-COST-004**: Analytics by user

> Make calls from different userIds. Query GET /cost/analytics/by-user. Expect: correct spend per user.

**SC-COST-005**: Projected spend

> Make 10 calls in one day. Query GET /cost/analytics/projected. Expect: projected monthly = daily average × remaining days.

**SC-RET-001**: Audit log cleanup

> Create audit logs. Set retention to 1 day. Trigger cleanup. Expect: old logs deleted, recent logs preserved.

**SC-RET-002**: Archived conversation cleanup

> Archive a conversation. Set retention to 0 days. Trigger cleanup. Expect: archived conversation + messages deleted.

**SC-RET-003**: Active conversations untouched

> Have both active and archived conversations. Trigger cleanup. Expect: only archived conversations older than retention period deleted.

---

## 14. Out of Scope

- **Real authentication/authorization** — userId is passed as a parameter, not from JWT/session
- **Email/Slack alerts for budget** — alert data is queryable via API, no push notifications
- **Real-time budget websocket** — budget status is checked per-request, no live updates
- **Custom moderation models** — uses OpenAI's built-in moderation only
- **Appeal/review workflow for moderation** — blocked content is blocked, no review queue
- **GDPR right-to-erasure** — retention cleanup is time-based, not user-request-based
- **Encryption at rest** — database-level encryption is out of scope
- **Multi-tenancy** — no organization/team-level budgets, only per-user

---

## 15. Decisions on Record

| Decision                                | Rationale                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderation API is free                  | OpenAI's moderation endpoint has no per-call cost — there's no reason NOT to moderate every input                                                                      |
| Guard for input, Interceptor for output | Guards run before the handler (block bad input). Interceptors run after (filter bad output). NestJS pattern match.                                                     |
| 422 for moderation, 429 for budget      | 422 = content unprocessable (moderation). 429 = too many requests/resource exhausted (budget). Semantically correct HTTP codes.                                        |
| Budget reads from ai_audit_logs         | No separate spend tracking table. Audit logs already have userId + cost. Aggregate on read.                                                                            |
| In-memory cache for budget checks       | Per-request DB aggregation is too expensive. 60-second cache is an acceptable tradeoff — spend might be slightly stale but never by more than 1 minute.                |
| Retention is time-based only            | Simple, predictable, automatable. Event-based or user-triggered deletion adds complexity without learning value.                                                       |
| Output moderation replaces, not blocks  | User already spent tokens generating the response. Blocking wastes that cost. Replacing preserves the UX flow while preventing harmful content from reaching the user. |

---

## 16. Dependencies on Previous Phases

| Component                      | How Phase 4 Uses It                                |
| ------------------------------ | -------------------------------------------------- |
| `OpenaiService` (Phase 1)      | Moderation calls via `openai.moderations.create()` |
| `AiAuditService` (Phase 1)     | Budget spend calculated from audit log aggregates  |
| `RetryService` (Phase 1)       | Retries on moderation API failures                 |
| `AppLoggerService` (global)    | All logging                                        |
| `ConfigService` (global)       | Moderation/budget/retention env vars               |
| `ChatService` (Phase 2)        | ModerationGuard applied to chat endpoints          |
| `RagService` (Phase 3)         | ModerationGuard applied to RAG endpoints           |
| `@nestjs/schedule` (installed) | Retention cron jobs                                |

---

## 17. Folder Structure

```
src/modules/moderation/
├── moderation.module.ts
├── moderation.controller.ts
├── services/
│   └── moderation.service.ts
├── guards/
│   └── moderation.guard.ts
├── interceptors/
│   └── output-moderation.interceptor.ts
├── dto/
│   ├── check-moderation.dto.ts
│   ├── moderation-result-res.dto.ts
│   ├── query-moderation-logs.dto.ts
│   ├── moderation-stats-res.dto.ts
│   └── index.ts
├── constants/
│   ├── moderation-category.constant.ts
│   ├── moderation-action.constant.ts
│   └── index.ts
└── __tests__/
    ├── moderation.service.spec.ts
    ├── moderation.guard.spec.ts
    └── moderation.controller.spec.ts

src/modules/cost-management/
├── cost-management.module.ts
├── cost-management.controller.ts
├── services/
│   ├── cost-budget.service.ts
│   ├── cost-analytics.service.ts
│   └── retention.service.ts
├── guards/
│   └── cost-budget.guard.ts
├── dto/
│   ├── create-budget.dto.ts
│   ├── update-budget.dto.ts
│   ├── budget-res.dto.ts
│   ├── query-budgets.dto.ts
│   ├── spend-by-user-res.dto.ts
│   ├── spend-timeline-res.dto.ts
│   ├── projected-spend-res.dto.ts
│   ├── retention-config.dto.ts
│   └── index.ts
├── constants/
│   ├── budget-period.constant.ts
│   ├── retention-config.constant.ts
│   └── index.ts
└── __tests__/
    ├── cost-budget.service.spec.ts
    ├── cost-analytics.service.spec.ts
    ├── retention.service.spec.ts
    ├── cost-budget.guard.spec.ts
    └── cost-management.controller.spec.ts
```
