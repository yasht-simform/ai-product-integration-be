---
id: AI-003
title: OpenaiModule scaffold — enums, constants, and empty service providers
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-06-25
completed_at: 2026-06-25
created: 2026-06-25
parent_epic: Epic 2 — Token Service
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by:
  - AI-001
---

# What to Build

Create the `src/modules/openai/` directory with the module file, the constants directory with all enums and configuration constants, and empty (placeholder) class bodies for each service. This scaffold unblocks all subsequent service implementation issues.

**Constants to create** (each in its own file under `constants/`):

```typescript
// openai-model.enum.ts
export enum OpenAIModel {
  GPT_4 = 'gpt-4',
  GPT_4O = 'gpt-4o',
  GPT_4O_MINI = 'gpt-4o-mini',
}

// ai-audit-status.enum.ts
export enum AiAuditStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  RETRIED = 'RETRIED',
}

// prompt-technique.enum.ts
export enum PromptTechnique {
  SYSTEM_PROMPT = 'system-prompt',
  FEW_SHOT = 'few-shot',
  ROLE_PLAY = 'role-play',
  STRUCTURED_OUTPUT = 'structured-output',
  CHAIN_OF_THOUGHT = 'chain-of-thought',
  TEMPERATURE_TUNING = 'temperature-tuning',
}

// openai-endpoint.enum.ts
export enum OpenAIEndpoint {
  CHAT_COMPLETIONS = 'chat.completions',
  EMBEDDINGS = 'embeddings',
  MODERATIONS = 'moderations',
}

// api-error-type.enum.ts
export enum ApiErrorType {
  RETRYABLE = 'RETRYABLE',
  PERMANENT = 'PERMANENT',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  TIMEOUT = 'TIMEOUT',
}

// model-pricing.constant.ts
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

// retry-config.constant.ts
export const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 32000,
  jitterFactor: 0.5,
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  retryableStatusCodes: [429, 500, 503, 529],
  permanentStatusCodes: [400, 401, 403, 404],
};
```

Include a `constants/index.ts` barrel that re-exports everything.

**Service placeholders** — create empty `@Injectable()` classes with no methods yet:

- `services/token.service.ts` → `TokenService`
- `services/retry.service.ts` → `RetryService`
- `services/ai-audit.service.ts` → `AiAuditService`
- `services/prompt-template.service.ts` → `PromptTemplateService`
- `services/openai.service.ts` → `OpenaiService`

Each placeholder class should inject `AppLoggerService`. `AiAuditService`, `PromptTemplateService`, and `OpenaiService` should also inject `DatabaseService`.

**Module file** — `openai.module.ts`:

Register all five services as providers. Export `OpenaiService`, `AiAuditService`, and `TokenService`. Do NOT export `RetryService` — it is internal. Do not create an `OpenaiController` yet (that comes in AI-010).

```typescript
@Module({
  providers: [OpenaiService, TokenService, RetryService, AiAuditService, PromptTemplateService],
  exports: [OpenaiService, AiAuditService, TokenService],
})
export class OpenaiModule {}
```

Do NOT register `OpenaiModule` in `AppModule` yet — that happens in AI-010 when the controller and DTOs are ready.

# User Stories Covered

None directly — this is the scaffold that enables Stories 5–35.

# Acceptance Criteria

- [x] All 7 constant/enum files exist under `src/modules/openai/constants/` with exact values from the spec
- [x] `constants/index.ts` barrel re-exports all enums and constants
- [x] All 5 service placeholder classes exist under `src/modules/openai/services/`
- [x] `OpenaiModule` registers all 5 providers and exports exactly `OpenaiService`, `AiAuditService`, `TokenService`
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0
- [x] `npm run lint` exits 0 (no unused imports, no `any` types, no `console.*`)

# Dependencies

- AI-001 — Prisma client must be regenerated before `DatabaseService` can be typed correctly in service constructors

# Testing Notes

No functional tests — this is purely structural. The TypeScript compile check (`npx tsc --noEmit`) is the primary validation gate.

Note on `import type`: with `"module": "nodenext"` in tsconfig, type-only imports must use `import type` or inline `type` modifier. If any service constructor uses an interface as a parameter type (rather than a concrete class), use `import type` for it.

## Implementation Notes

**Files created:**

- `src/modules/openai/constants/openai-model.enum.ts` — `OpenAIModel` enum (3 values)
- `src/modules/openai/constants/ai-audit-status.enum.ts` — `AiAuditStatus` enum (3 values)
- `src/modules/openai/constants/prompt-technique.enum.ts` — `PromptTechnique` enum (6 values)
- `src/modules/openai/constants/openai-endpoint.enum.ts` — `OpenAIEndpoint` enum (3 values)
- `src/modules/openai/constants/api-error-type.enum.ts` — `ApiErrorType` enum (4 values)
- `src/modules/openai/constants/model-pricing.constant.ts` — `MODEL_PRICING` record with gpt-4, gpt-4o, gpt-4o-mini pricing
- `src/modules/openai/constants/retry-config.constant.ts` — `RETRY_CONFIG` with backoff, jitter, circuit breaker, and status code lists
- `src/modules/openai/constants/index.ts` — barrel re-exporting all 7 exports
- `src/modules/openai/services/token.service.ts` — empty `TokenService` with `AppLoggerService` injection
- `src/modules/openai/services/retry.service.ts` — empty `RetryService` with `AppLoggerService` injection
- `src/modules/openai/services/ai-audit.service.ts` — empty `AiAuditService` with `DatabaseService` + `AppLoggerService` injection
- `src/modules/openai/services/prompt-template.service.ts` — empty `PromptTemplateService` with `DatabaseService` + `AppLoggerService` injection
- `src/modules/openai/services/openai.service.ts` — empty `OpenaiService` with `DatabaseService` + `AppLoggerService` injection
- `src/modules/openai/openai.module.ts` — `OpenaiModule` with 5 providers, exports `OpenaiService`, `AiAuditService`, `TokenService`

**Design decisions:**

- All constructor parameters use regular imports (not `import type`) because `DatabaseService` and `AppLoggerService` are concrete classes used as DI tokens at runtime
- `OpenaiModule` is NOT registered in `AppModule` — that happens in AI-010 when the controller is ready
- `RetryService` is NOT exported from `OpenaiModule` — it is internal-only per spec

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (11 pre-existing warnings in throttler guard and e2e test)
- `npm run test` — 1/1 pass (full suite)

## Assumptions Made

None — spec was complete and unambiguous for all enum values, constants, injection requirements, and module configuration.

## Follow Ups

- `RetryService` will need `ConfigService` injection (for `openai.maxRetries`, etc.) when AI-005 implements its logic
- `OpenaiService` may not need `DatabaseService` directly once AI-007 is implemented (it may delegate all DB writes to `AiAuditService`) — revisit then
