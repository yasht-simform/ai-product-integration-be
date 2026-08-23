---
id: AI-009
title: DTOs — request and response classes for all 8 endpoint groups
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
  - AI-003
---

# What to Build

Create all request and response DTO classes in `src/modules/openai/dto/`. Every DTO must have `class-validator` decorators for validation and `@ApiProperty()` decorators for Swagger. Create a `dto/index.ts` barrel that exports everything.

**Request DTOs:**

`ChatCompletionDto`:

- `prompt: string` — `@IsString() @IsNotEmpty() @MinLength(1)` — required
- `systemPrompt?: string` — `@IsOptional() @IsString()`
- `model?: OpenAIModel` — `@IsOptional() @IsEnum(OpenAIModel)` — default `gpt-4o`
- `temperature?: number` — `@IsOptional() @IsNumber() @Min(0) @Max(2)` — default 0.7
- `maxTokens?: number` — `@IsOptional() @IsInt() @Min(1) @Max(4096)` — default 1024

`ModelCompareDto`:

- `prompt: string` — required
- `systemPrompt?: string` — optional
- `models?: OpenAIModel[]` — `@IsOptional() @IsArray() @IsEnum(OpenAIModel, { each: true })` — default `['gpt-4', 'gpt-4o']`
- `temperature?: number` — optional, 0–2

`PromptTestDto`:

- Same fields as `ChatCompletionDto` plus:
- `templateName?: string` — `@IsOptional() @IsString()` — load system prompt from DB when provided

`TokenCountDto`:

- `text: string` — `@IsString() @IsNotEmpty()`
- `model?: OpenAIModel` — `@IsOptional() @IsEnum(OpenAIModel)`

`QueryAiAuditDto` (query params, so use `@Type(() => ...)` for coercion):

- `model?: string` — `@IsOptional() @IsString()`
- `status?: AiAuditStatus` — `@IsOptional() @IsEnum(AiAuditStatus)`
- `userId?: string` — `@IsOptional() @IsString()`
- `startDate?: string` — `@IsOptional() @IsDateString()`
- `endDate?: string` — `@IsOptional() @IsDateString()`
- `page?: number` — `@IsOptional() @IsInt() @Min(1)` — default 1, transform via `@Type(() => Number)`
- `limit?: number` — `@IsOptional() @IsInt() @Min(1) @Max(100)` — default 20

`CostSummaryQueryDto`:

- `userId?: string`, `model?: string`, `startDate?: string`, `endDate?: string` — all optional

`CreatePromptTemplateDto`:

- `name: string` — `@IsString() @IsNotEmpty()`
- `description?: string` — `@IsOptional() @IsString()`
- `systemPrompt: string` — `@IsString() @IsNotEmpty()`
- `fewShotExamples?: Array<{ input: string; output: string }>` — `@IsOptional() @IsArray()`
- `technique: PromptTechnique` — `@IsEnum(PromptTechnique)`
- `recommendedModel?: string` — `@IsOptional() @IsString()`
- `recommendedTemperature?: number` — `@IsOptional() @IsNumber() @Min(0) @Max(2)`
- `tags?: string[]` — `@IsOptional() @IsArray() @IsString({ each: true })`
- `isActive?: boolean` — `@IsOptional() @IsBoolean()`

`UpdatePromptTemplateDto` — `PartialType(CreatePromptTemplateDto)` (all fields optional).

`QueryPromptTemplateDto`:

- `technique?: PromptTechnique` — `@IsOptional() @IsEnum(PromptTechnique)`
- `tags?: string` — `@IsOptional() @IsString()` (comma-separated, parsed in service)
- `isActive?: boolean` — `@IsOptional() @IsBoolean() @Type(() => Boolean)`
- `page?: number`, `limit?: number` — same as `QueryAiAuditDto`

**Response DTOs:**

`ChatCompletionResDto`, `ModelCompareResDto`, `TokenCountResDto`, `ModelPricingResDto`, `AiAuditLogResDto`, `CostSummaryResDto`, `PromptTemplateResDto` — each with `@ApiProperty()` on every field. Use nested classes for complex shapes (e.g., `UsageDto` with `inputTokens`, `outputTokens`, `totalTokens`).

`PaginatedAiAuditResDto` wraps `AiAuditLogResDto[]` with `total: number`, `page: number`, `limit: number`.

`PaginatedPromptTemplateResDto` wraps `PromptTemplateResDto[]` with `total: number`.

**`dto/index.ts`** — barrel re-exporting all DTO classes.

# User Stories Covered

- Story 32 — validation rejects empty prompt and temperature > 2

# Acceptance Criteria

- [x] All 8 request DTO classes exist with correct `class-validator` decorators
- [x] `@IsEnum(OpenAIModel)` on `model` fields rejects unknown model strings
- [x] `temperature` is constrained to 0–2, `maxTokens` to 1–4096 via class-validator
- [x] All response DTO classes have `@ApiProperty()` on every field
- [x] `UpdatePromptTemplateDto` uses `PartialType`
- [x] `QueryAiAuditDto` uses `@Type(() => Number)` on `page` and `limit` for query-param coercion
- [x] `dto/index.ts` barrel exports all classes
- [x] `npx tsc --noEmit --project tsconfig.build.json` exits 0
- [x] `npm run lint` exits 0

# Dependencies

- AI-003 — `OpenAIModel`, `AiAuditStatus`, `PromptTechnique` enums must exist to use in `@IsEnum()` decorators

# Testing Notes

No dedicated unit tests for DTOs — validation is exercised through controller tests in AI-013. However, create a quick smoke test:

```typescript
// In the relevant controller spec (AI-013), verify DTO validation:
it('rejects empty prompt', async () => {
  const dto = new ChatCompletionDto();
  dto.prompt = '';
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(0);
});
```

**Regression risk**: `@Type()` from `class-transformer` must be applied to numeric query params for the global `ValidationPipe` to coerce string query parameters to numbers. Without it, `page=1` arrives as the string `'1'` and `@IsInt()` fails. The global `ValidationPipe` in `main.ts` already has `transform: true` — confirm this before assuming coercion works.

## Implementation Notes

**Files created:**

- `src/modules/openai/dto/chat-completion.dto.ts` — `ChatCompletionDto`
- `src/modules/openai/dto/model-compare.dto.ts` — `ModelCompareDto`
- `src/modules/openai/dto/prompt-test.dto.ts` — `PromptTestDto` (extends `ChatCompletionDto`)
- `src/modules/openai/dto/token-count.dto.ts` — `TokenCountDto`
- `src/modules/openai/dto/query-ai-audit.dto.ts` — `QueryAiAuditDto` (class with decorators, distinct from the interface in `types/ai-audit.types.ts`)
- `src/modules/openai/dto/cost-summary-query.dto.ts` — `CostSummaryQueryDto` (class version)
- `src/modules/openai/dto/create-prompt-template.dto.ts` — `CreatePromptTemplateDto` + `FewShotExampleDto`
- `src/modules/openai/dto/update-prompt-template.dto.ts` — `UpdatePromptTemplateDto` (PartialType)
- `src/modules/openai/dto/query-prompt-template.dto.ts` — `QueryPromptTemplateDto`
- `src/modules/openai/dto/usage.dto.ts` — `UsageDto` (nested, shared by chat/compare responses)
- `src/modules/openai/dto/chat-completion-res.dto.ts` — `ChatCompletionResDto`
- `src/modules/openai/dto/model-compare-res.dto.ts` — `ModelCompareItemDto` + `ModelCompareResDto`
- `src/modules/openai/dto/token-count-res.dto.ts` — `TokenCountResDto`
- `src/modules/openai/dto/model-pricing-res.dto.ts` — `ModelPricingItemDto` + `ModelPricingResDto`
- `src/modules/openai/dto/ai-audit-log-res.dto.ts` — `AiAuditLogResDto`
- `src/modules/openai/dto/cost-summary-res.dto.ts` — `ModelCostBreakdownDto` + `CostSummaryResDto`
- `src/modules/openai/dto/prompt-template-res.dto.ts` — `PromptTemplateResDto`
- `src/modules/openai/dto/paginated-ai-audit-res.dto.ts` — `PaginatedAiAuditResDto`
- `src/modules/openai/dto/paginated-prompt-template-res.dto.ts` — `PaginatedPromptTemplateResDto`
- `src/modules/openai/dto/index.ts` — barrel re-exporting all classes

**Design decisions:**

- `PartialType` imported from `@nestjs/swagger` (not `@nestjs/mapped-types`) so `UpdatePromptTemplateDto` inherits both validation and Swagger metadata from `CreatePromptTemplateDto`.
- `PromptTestDto` extends `ChatCompletionDto` — avoids duplication; controller can accept either type for the prompt-test endpoint.
- `FewShotExampleDto` is a proper nested class with `@ValidateNested({ each: true })` + `@Type(() => FewShotExampleDto)` so class-validator validates the inner structure of each example.
- `@Type(() => Number)` added to `page`/`limit` query params as explicit documentation; `enableImplicitConversion: true` in the global `ValidationPipe` handles coercion automatically, but explicit `@Type` is clearer for readers.
- `QueryAiAuditDto` and `CostSummaryQueryDto` as DTO classes are distinct from the same-named interfaces in `types/ai-audit.types.ts`. The DTO classes are used at the controller layer; the interfaces are used at the service layer. Structural compatibility means the controller can pass the DTO directly to the service.
- `ModelPricingResDto` uses a `Record<string, ModelPricingItemDto>` field with Swagger `additionalProperties` metadata to document the dynamic key structure.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — 0 errors
- `npm run lint` — 0 errors (16 pre-existing warnings unchanged)
- `npm run test` — 36/36 pass (no new tests; DTOs have no unit tests per spec — validation exercised in AI-013 controller tests)

## Assumptions Made

- `QueryAiAuditDto` and `CostSummaryQueryDto` DTO classes intentionally share names with interfaces in `types/ai-audit.types.ts`. No file imports both; TypeScript structural compatibility makes the DTO passable directly to service methods.
- `ModelCompareResDto` shape (`results: ModelCompareItemDto[]`) is assumed based on the natural shape of a parallel completion response. AI-010 controller may wrap differently if needed.
- Response DTO classes have no `class-validator` decorators — they describe outgoing shapes for Swagger and are not validated.

## Follow Ups

- AI-010 (controller) imports from `dto/index.ts` to type its request body parameters and response types
- AI-013 (controller unit tests) adds DTO validation smoke tests (e.g. empty prompt, temperature > 2)
- `QueryAiAuditDto` interface in `types/ai-audit.types.ts` could be renamed to `QueryAiAuditOptions` in a future cleanup to eliminate the naming similarity with the DTO class
