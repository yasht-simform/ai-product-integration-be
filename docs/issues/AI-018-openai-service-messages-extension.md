---
id: AI-018
title: OpenaiService.chatCompletionWithMessages() — multi-turn + tools support
type: AFK
status: completed
priority: P1
assigned_to: Claude
started_at: 2026-07-07
completed_at: 2026-07-07
created: 2026-07-06
parent_epic: Epic 2 — OpenaiService Extension for Multi-Turn & Tool Calls
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by: []
---

# What to Build

Add a new method to Phase 1's `OpenaiService` — `chatCompletionWithMessages()` — that accepts a full `OpenAI.Chat.ChatCompletionMessageParam[]` array and an optional `tools` parameter, instead of the single `prompt` string `chatCompletion()` takes. This is the seam `AiChatModule`'s `ChatService` and `ToolExecutorService` will call through for every multi-turn or tool-augmented LLM call — `AiChatModule` must never call the OpenAI SDK directly.

**Do not modify `chatCompletion()`'s signature or behavior.** It stays exactly as-is for Phase 1 callers. `chatCompletionWithMessages()` is additive.

**New types** (extend `openai.types.ts`):

```typescript
interface MessagesCompletionParams {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
}
```

Extend `ChatCompletionResult` (used by both methods) with an optional field carrying tool-call requests from the model:

```typescript
interface ChatCompletionResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
  toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]; // new — populated when the model requests tool calls instead of/alongside content
}
```

**`chatCompletionWithMessages(params)` flow** — mirror `chatCompletion()`'s existing structure exactly, just with `messages` passed through as-is (no system-prompt/user-prompt assembly, since the caller already built the full message array) and `tools` forwarded to the SDK call when present:

1. `isConfigured` guard — same `ServiceUnavailableException` as `chatCompletion()`
2. `RetryService.executeWithRetry()` wraps `openaiClient.chat.completions.create({ model, messages, tools, ...temperature/maxTokens })`
3. Extract `content`, `usage`, and — new — `response.choices[0]?.message.tool_calls`
4. `TokenService.calculateCost()` for `estimatedCost` — unchanged
5. `AiAuditService.log()` — same call shape as `chatCompletion()`, but note `userMessage`/`systemPrompt` fields don't map cleanly to an arbitrary message array; use the last `user`-role message's content for `userMessage` and the first `system`-role message's content for `systemPrompt` (best-effort — these fields are still useful for the audit log's readability, they just don't need to be exhaustive)
6. On error — identical `mapError()`/`AiAuditStatus.FAILED` path as `chatCompletion()`

Both `chatCompletion()` and `chatCompletionWithMessages()` should share their audit-logging and error-mapping logic rather than duplicating it — extract the shared tail (steps 3–6) into a private helper both methods call, if that doesn't overcomplicate the diff.

# User Stories Covered

- Story 46 — Phase 1 regression: existing `chatCompletion()` behavior is untouched

# Acceptance Criteria

- [x] `chatCompletionWithMessages()` added to `OpenaiService`; `chatCompletion()` is unchanged (same signature, same behavior)
- [x] `tools` param is forwarded to the SDK call only when provided (omitted from the request payload otherwise, matching the existing `temperature`/`maxTokens` optional-spread pattern)
- [x] `ChatCompletionResult.toolCalls` is populated when the mocked SDK response includes `message.tool_calls`, and is `undefined` otherwise
- [x] Both methods produce audit log calls with the same field shape (`AiAuditLogEvent`)
- [x] All existing Phase 1 `openai.service.spec.ts` tests still pass unmodified
- [x] New unit tests cover: successful multi-message call, `tools` forwarded correctly, `tool_calls` surfaced on the result, failure path logs `FAILED` with correct error info
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes

# Dependencies

None — can start immediately. Phase 1's `RetryService`, `TokenService`, `AiAuditService` are already implemented and unchanged.

# Testing Notes

**Primary seam**: extend the existing `openai.service.spec.ts` file rather than creating a new spec file, since it's testing the same class — add a new `describe('chatCompletionWithMessages')` block alongside the existing `describe('chatCompletion')` block, reusing the same mock setup (`OPENAI_CLIENT`, `RetryService`, `TokenService`, `AiAuditService` mocks already established in that file).

Mock SDK response shape for a tool-call test case:

```typescript
{
  choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2+2"}' } }] } }],
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
  model: 'gpt-4o',
}
```

**Regression risk**: run the full existing test file after the change (`npx jest --testPathPatterns=openai.service`) and confirm the pass count matches Phase 1's baseline (5 tests per AI-007's Implementation Notes) plus the new ones — a shared-helper refactor that subtly changes `chatCompletion()`'s audit payload shape would be caught here.

## Implementation Notes

- `types/openai.types.ts`: added `MessagesCompletionParams` and extended `ChatCompletionResult` with optional `toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]`.
- `services/openai.service.ts`: extracted the shared retry/audit/error-mapping tail from `chatCompletion()` into a private `executeCompletion()` helper (takes `model`, `messages`, optional `tools`, `temperature`/`maxTokens`/`userId`/`requestId`, plus `auditSystemPrompt`/`auditUserMessage` for the audit log). Added `chatCompletionWithMessages(params: MessagesCompletionParams)`, which builds the audit `systemPrompt`/`userMessage` best-effort from the message array (first `system` message, last `user` message) via a small `extractTextContent()` helper, then delegates to `executeCompletion()`. `tools` is spread into the SDK call only when defined, matching the existing `temperature`/`maxTokens` pattern. The `isConfigured` guard was factored into a private `ensureConfigured()` used by both public methods. `chatCompletion()`'s signature and behavior are unchanged — it now just calls `executeCompletion()` for its shared tail.
- `__tests__/openai.service.spec.ts`: added a `makeMessagesParams()` helper and two new `describe` blocks (`chatCompletionWithMessages() — success path` / `— failure path`) covering: message array passed through as-is, `tools` forwarded only when provided, `tool_calls` surfaced on the result, audit `systemPrompt`/`userMessage` derived from the message array, `FAILED` audit log on SDK failure, and the `ServiceUnavailableException` guard.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint` — 0 errors, 35 warnings (all pre-existing `no-unsafe-*`/`no-unsafe-return` warnings in test files and the throttler guard, downgraded to warnings per project convention; one new warning of the same pre-existing kind at `openai.service.spec.ts:197`)
- `npm run build` — succeeds (`prisma:generate` + `nest build`)
- `npx jest --testPathPatterns=openai.service` — 11/11 pass (5 pre-existing `chatCompletion()` tests unmodified + 6 new `chatCompletionWithMessages()` tests)
- `npm run test` (full suite) — 164/164 pass, 12/12 suites, no regressions

## Assumptions Made

- `extractTextContent()` only recognizes `string` message content for the audit log's `systemPrompt`/`userMessage` fields; multi-part content arrays (`ChatCompletionContentPart[]`) resolve to `undefined`/`''`. This matches the issue's explicit "best-effort... don't need to be exhaustive" framing — `AiChatModule` callers build simple string-content messages in the phases implemented so far.
- When no `user`-role message exists in the array (not expected in practice), `auditUserMessage` falls back to `''` since `AiAuditLogEvent.userMessage` is a required field.

## Follow Ups

- None — `chatCompletionWithMessages()` is now available for `ChatService.sendMessage()` (AI-022) and `ChatService`'s function-calling flow (AI-027) to call through, per the module boundary CLAUDE.md documents (`AiChatModule` must never call the OpenAI SDK directly).
