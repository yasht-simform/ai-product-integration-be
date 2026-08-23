# Phase 2: Chat Completions, Streaming & Function Calling — Requirement Specification

**For**: Engineering team (L&D — G3 AI Product Integration)
**Created**: 2026-07-06
**Status**: Draft
**Goal Document**: `G3_AI_Product_Integration.pdf`
**Depends On**: Phase 1 (OpenAI API Foundations — completed)

---

## 1. Overview

Phase 2 builds the interactive AI features on top of Phase 1's foundation. It adds multi-turn conversations with persistent history, real-time streaming responses (token-by-token), and function calling (the model can invoke external tools like a calculator or weather API). These are the core patterns that make AI products feel alive — not just request/response, but conversational, real-time, and capable of taking actions.

| System                | Purpose                                                         | Consumers                    | Storage                                       |
| --------------------- | --------------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| **Chat Service**      | Multi-turn conversation management with persistent history      | Chat UI (FE), API consumers  | `chat_conversations` + `chat_messages` tables |
| **Streaming Service** | Server-Sent Events (SSE) for token-by-token response streaming  | Chat UI (FE) via EventSource | None (real-time pipe)                         |
| **Tool Registry**     | Registration and execution of tools the model can invoke        | Chat Service (internal)      | `chat_tools` table                            |
| **Tool Executor**     | Executes tool calls, returns results to the model for synthesis | Chat Service (internal)      | Tool execution logged in `ai_audit_logs`      |

These systems compose together: a user sends a message → Chat Service builds the conversation context → Streaming Service streams the response token-by-token → if the model decides to call a tool, Tool Executor runs it and feeds the result back → the model synthesizes a final answer.

---

## 2. System Architecture

### 2.1 Module Structure

```
AiChatModule
├── ChatService            ← conversation CRUD, message management
├── StreamingService       ← SSE streaming wrapper around OpenAI SDK
├── ToolRegistryService    ← registers and describes available tools
├── ToolExecutorService    ← executes tool calls, returns results
├── ChatGateway            ← (optional) WebSocket gateway for real-time events
└── ChatController         ← REST + SSE endpoints
```

`AiChatModule` imports `OpenaiModule` (from Phase 1) and uses `OpenaiService` for all LLM calls. It does NOT call the OpenAI SDK directly.

### 2.2 Request Flow — Standard Chat

```
ChatController.sendMessage()
  → ChatService.addUserMessage(conversationId, message)
  → ChatService.buildContext(conversationId)        [fetches conversation history]
  → OpenaiService.chatCompletion(messages[])        [sends full context to model]
  → ChatService.addAssistantMessage(conversationId, response)
  → return response
```

### 2.3 Request Flow — Streaming Chat

```
ChatController.sendMessageStream() [SSE endpoint]
  → ChatService.addUserMessage(conversationId, message)
  → ChatService.buildContext(conversationId)
  → StreamingService.streamCompletion(messages[])
      → openai.chat.completions.create({ stream: true })
      → for each chunk: yield via SSE to client
      → collect full response
  → ChatService.addAssistantMessage(conversationId, fullResponse)
  → SSE: [DONE]
```

### 2.4 Request Flow — Function Calling

```
ChatController.sendMessage()
  → ChatService.buildContext(conversationId)
  → OpenaiService.chatCompletionWithTools(messages[], tools[])
  → Model returns: tool_calls: [{ name: "calculate", arguments: { expression: "234 * 567" } }]
  → ToolExecutorService.execute("calculate", { expression: "234 * 567" })
  → returns: { result: 132678 }
  → ChatService.addToolResult(conversationId, toolCallId, result)
  → OpenaiService.chatCompletion(messages[] + toolResult)  [second call — model synthesizes]
  → Model returns: "234 × 567 = 132,678"
  → ChatService.addAssistantMessage(conversationId, finalResponse)
  → return finalResponse
```

The function calling flow requires **two LLM calls**: one to decide which tool to use, and one to synthesize the tool's result into a natural language answer. Both calls are logged in `ai_audit_logs` via Phase 1's audit service.

---

## 3. Database Schema

### 3.1 `chat_conversations` Table

Stores conversation metadata. A conversation is a container for a sequence of messages.

| Field          | Type                                   | Description                                             |
| -------------- | -------------------------------------- | ------------------------------------------------------- |
| `id`           | `BigInt @id @default(autoincrement())` | Internal PK                                             |
| `publicId`     | `String @unique @default(uuid())`      | External identifier                                     |
| `title`        | `String?`                              | Auto-generated or user-set title for the conversation   |
| `systemPrompt` | `String?`                              | System prompt for this conversation (overrides default) |
| `model`        | `String`                               | Model used for this conversation                        |
| `userId`       | `String?`                              | Owner of the conversation                               |
| `toolsEnabled` | `Boolean @default(false)`              | Whether function calling is active                      |
| `metadata`     | `Json? @db.JsonB`                      | Extensible context (temperature, maxTokens, etc.)       |
| `isArchived`   | `Boolean @default(false)`              | Soft archive — hidden from list but not deleted         |
| `createdAt`    | `DateTime @default(now())`             | Created timestamp                                       |
| `updatedAt`    | `DateTime @updatedAt`                  | Last activity timestamp                                 |

### 3.2 `chat_messages` Table

Stores individual messages within a conversation. Append-only — messages are never edited.

| Field            | Type                                   | Description                                                        |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `id`             | `BigInt @id @default(autoincrement())` | Internal PK                                                        |
| `publicId`       | `String @unique @default(uuid())`      | External identifier                                                |
| `conversationId` | `BigInt`                               | FK → `chat_conversations.id`                                       |
| `role`           | `String`                               | `'user'`, `'assistant'`, `'system'`, `'tool'`                      |
| `content`        | `String?`                              | Message text (null for tool_calls-only assistant messages)         |
| `toolCalls`      | `Json? @db.JsonB`                      | Array of tool calls made by assistant: `[{ id, name, arguments }]` |
| `toolCallId`     | `String?`                              | For role=tool messages: which tool call this is responding to      |
| `toolName`       | `String?`                              | For role=tool messages: which tool was invoked                     |
| `tokenCount`     | `Int?`                                 | Tokens used by this message                                        |
| `cost`           | `Float?`                               | Cost attributed to this message                                    |
| `latencyMs`      | `Int?`                                 | Response time for assistant messages                               |
| `model`          | `String?`                              | Model that generated this message (for assistant messages)         |
| `createdAt`      | `DateTime @default(now())`             | Immutable timestamp                                                |

**No `updatedAt`, no `deletedAt`** on messages — append-only like audit logs.

### 3.3 `chat_tools` Table

Registered tools that the model can invoke via function calling.

| Field           | Type                                   | Description                                                   |
| --------------- | -------------------------------------- | ------------------------------------------------------------- |
| `id`            | `BigInt @id @default(autoincrement())` | Internal PK                                                   |
| `publicId`      | `String @unique @default(uuid())`      | External identifier                                           |
| `name`          | `String @unique`                       | Tool identifier: `'calculator'`, `'weather'`, `'datetime'`    |
| `displayName`   | `String`                               | Human-readable: `'Calculator'`, `'Weather Lookup'`            |
| `description`   | `String`                               | What the tool does (sent to the model in the tools parameter) |
| `parameters`    | `Json @db.JsonB`                       | JSON Schema for the tool's input parameters                   |
| `handlerType`   | `String`                               | `'builtin'` or `'http'` — how to execute it                   |
| `handlerConfig` | `Json? @db.JsonB`                      | For http handlers: `{ url, method, headers }`                 |
| `isActive`      | `Boolean @default(true)`               | Toggle tool on/off                                            |
| `createdAt`     | `DateTime @default(now())`             | Created timestamp                                             |
| `updatedAt`     | `DateTime @updatedAt`                  | Last modified                                                 |

### 3.4 Indexes

```sql
-- Primary query: messages by conversation, ordered chronologically
CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, created_at ASC);

-- List conversations by user, most recent first
CREATE INDEX idx_chat_conversations_user ON chat_conversations (user_id, updated_at DESC);

-- Tool lookup by name
CREATE UNIQUE INDEX idx_chat_tools_name ON chat_tools (name);
```

### 3.5 Relations

```prisma
model ChatConversation {
  messages ChatMessage[]
}

model ChatMessage {
  conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}
```

Cascade delete: deleting a conversation deletes all its messages.

### 3.6 Table Mappings

```prisma
@@map("chat_conversations")
@@map("chat_messages")
@@map("chat_tools")
```

---

## 4. Enums and Constants

### 4.1 Message Role Enum

```typescript
export enum ChatMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}
```

### 4.2 Tool Handler Type Enum

```typescript
export enum ToolHandlerType {
  BUILTIN = 'builtin', // Executed locally by ToolExecutorService
  HTTP = 'http', // Calls an external HTTP endpoint
}
```

### 4.3 SSE Event Types

```typescript
export enum StreamEventType {
  TOKEN = 'token', // Individual token chunk
  TOOL_CALL = 'tool_call', // Model wants to call a tool
  TOOL_RESULT = 'tool_result', // Tool execution result
  DONE = 'done', // Stream complete
  ERROR = 'error', // Stream error
}
```

### 4.4 Conversation Status

```typescript
export enum ConversationStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}
```

---

## 5. Service Interfaces

### 5.1 ChatService

Manages conversations and messages. The orchestrator for all chat operations.

```typescript
// Conversation CRUD
createConversation(dto: CreateConversationDto): Promise<ConversationResDto>
findAllConversations(query: QueryConversationsDto): Promise<PaginatedConversationsResDto>
findConversation(publicId: string): Promise<ConversationWithMessagesResDto>
updateConversation(publicId: string, dto: UpdateConversationDto): Promise<ConversationResDto>
archiveConversation(publicId: string): Promise<void>
deleteConversation(publicId: string): Promise<void>

// Messaging
sendMessage(conversationPublicId: string, dto: SendMessageDto): Promise<AssistantMessageResDto>
sendMessageStream(conversationPublicId: string, dto: SendMessageDto): AsyncGenerator<StreamEvent>

// Context management
buildContext(conversationId: BigInt): Promise<OpenAI.Chat.ChatCompletionMessageParam[]>
```

**Context building**: `buildContext()` fetches the conversation's messages from DB, prepends the system prompt, and trims if total tokens exceed the model's context window. Older messages are dropped from the beginning (except the system prompt) to stay within limits. Token counting uses `TokenService` from Phase 1.

### 5.2 StreamingService

Wraps OpenAI's streaming API and converts it to SSE events.

```typescript
streamCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: { model?: string; temperature?: number; tools?: OpenAI.Chat.ChatCompletionTool[] }
): AsyncGenerator<StreamEvent>
```

The `StreamEvent` type:

```typescript
interface StreamEvent {
  type: StreamEventType;
  data: string | ToolCallData | { error: string };
}

interface ToolCallData {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
```

### 5.3 ToolRegistryService

Manages the catalog of available tools.

```typescript
findAllTools(): Promise<ToolResDto[]>
findActiveTool(name: string): Promise<ToolEntity>
createTool(dto: CreateToolDto): Promise<ToolResDto>
updateTool(publicId: string, dto: UpdateToolDto): Promise<ToolResDto>
deleteTool(publicId: string): Promise<void>
getToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionTool[]>  // formatted for OpenAI API
```

`getToolDefinitions()` converts the database records into the exact format OpenAI's API expects:

```json
{
  "type": "function",
  "function": {
    "name": "calculator",
    "description": "Evaluate a mathematical expression",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": { "type": "string", "description": "Math expression to evaluate" }
      },
      "required": ["expression"]
    }
  }
}
```

### 5.4 ToolExecutorService

Executes tool calls and returns results.

```typescript
execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
```

For `handlerType: 'builtin'`, the executor has hardcoded logic:

- `calculator` — evaluates math using a safe expression parser (no `eval()`)
- `weather` — calls Open-Meteo free API (no key needed)
- `datetime` — returns current date, time, timezone

For `handlerType: 'http'`, the executor calls the configured URL with the arguments as the request body.

```typescript
interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  executionMs: number;
}
```

---

## 6. API Endpoints

### 6.1 Conversations

```
POST   /api/v1/chat/conversations                      — Create new conversation
GET    /api/v1/chat/conversations                      — List conversations (paginated, filterable)
GET    /api/v1/chat/conversations/:publicId             — Get conversation with all messages
PATCH  /api/v1/chat/conversations/:publicId             — Update title, system prompt, model
DELETE /api/v1/chat/conversations/:publicId             — Delete conversation + all messages
POST   /api/v1/chat/conversations/:publicId/archive     — Archive conversation
```

### 6.2 Messages

```
POST   /api/v1/chat/conversations/:publicId/messages           — Send message (non-streaming)
POST   /api/v1/chat/conversations/:publicId/messages/stream    — Send message (SSE streaming)
```

**Create Conversation Request** (`CreateConversationDto`):

| Field          | Type      | Required | Default                           | Description             |
| -------------- | --------- | -------- | --------------------------------- | ----------------------- |
| `title`        | `string`  | No       | Auto-generated from first message | Conversation title      |
| `systemPrompt` | `string`  | No       | Default from config               | System prompt           |
| `model`        | `string`  | No       | Config default (free model)       | Model to use            |
| `toolsEnabled` | `boolean` | No       | `false`                           | Enable function calling |

**Send Message Request** (`SendMessageDto`):

| Field         | Type     | Required | Description                          |
| ------------- | -------- | -------- | ------------------------------------ |
| `content`     | `string` | Yes      | User message text                    |
| `model`       | `string` | No       | Override model for this message only |
| `temperature` | `number` | No       | Override temperature                 |
| `maxTokens`   | `number` | No       | Override max tokens                  |

**Send Message Response** (`AssistantMessageResDto`):

```json
{
  "code": "CHAT_001",
  "message": "Message sent successfully",
  "data": {
    "messageId": "uuid",
    "role": "assistant",
    "content": "234 × 567 = 132,678",
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "toolCalls": null,
    "usage": { "inputTokens": 145, "outputTokens": 28, "totalTokens": 173 },
    "estimatedCost": 0,
    "latencyMs": 2300
  }
}
```

### 6.3 SSE Streaming Response Format

The SSE endpoint (`/messages/stream`) sends events in this format:

```
event: token
data: {"content": "234"}

event: token
data: {"content": " ×"}

event: token
data: {"content": " 567"}

event: tool_call
data: {"toolCallId": "call_abc123", "toolName": "calculator", "arguments": {"expression": "234 * 567"}}

event: tool_result
data: {"toolCallId": "call_abc123", "result": 132678}

event: token
data: {"content": "The answer is 132,678."}

event: done
data: {"messageId": "uuid", "usage": {"inputTokens": 145, "outputTokens": 28}, "estimatedCost": 0, "latencyMs": 2300}
```

The FE listens via `EventSource` or `fetch` with `ReadableStream` and appends each token to the display in real time.

### 6.4 Tools

```
GET    /api/v1/chat/tools               — List all registered tools
POST   /api/v1/chat/tools               — Register a new tool
PATCH  /api/v1/chat/tools/:publicId     — Update tool
DELETE /api/v1/chat/tools/:publicId     — Deactivate tool
```

**Create Tool Request** (`CreateToolDto`):

```json
{
  "name": "calculator",
  "displayName": "Calculator",
  "description": "Evaluate a mathematical expression and return the numeric result",
  "parameters": {
    "type": "object",
    "properties": {
      "expression": {
        "type": "string",
        "description": "The mathematical expression to evaluate, e.g. '234 * 567' or 'sqrt(144)'"
      }
    },
    "required": ["expression"]
  },
  "handlerType": "builtin"
}
```

---

## 7. Streaming Specification

### 7.1 Server-Sent Events (SSE)

The streaming endpoint uses the SSE protocol:

- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`

NestJS implementation uses `@Sse()` decorator or a raw `Response` with manual SSE writes.

### 7.2 OpenAI Streaming API

```typescript
const stream = await openai.chat.completions.create({
  model: "meta-llama/llama-3.3-70b-instruct:free",
  messages: [...],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.content) {
    // yield token event
  }
  if (delta?.tool_calls) {
    // yield tool_call event
  }
}
```

### 7.3 Error Handling During Stream

If an error occurs mid-stream:

1. Send an `event: error` with the error message
2. Close the SSE connection
3. The partial response is still saved as an assistant message (with a metadata flag `incomplete: true`)
4. The audit log records the call as `FAILED` with the partial token count

### 7.4 Backpressure

If the client disconnects mid-stream:

- Detect via `request.on('close')` in NestJS
- Abort the OpenAI stream (`stream.controller.abort()`)
- Save whatever was received so far as a partial message
- Log the partial call in audit

---

## 8. Function Calling Specification

### 8.1 How It Works

1. User sends a message: "What's 234 times 567?"
2. `ChatService` builds context and includes `tools` parameter from `ToolRegistryService`
3. Model responds with `tool_calls` instead of content
4. `ToolExecutorService` runs the calculator tool
5. Result is added to the conversation as a `tool` role message
6. The model is called again with the full context (including tool result)
7. Model responds with natural language: "234 × 567 = 132,678"

### 8.2 Built-in Tools

**Calculator** (`calculator`):

```json
{
  "name": "calculator",
  "description": "Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, sqrt, pow, sin, cos, tan, log, pi, e.",
  "parameters": {
    "type": "object",
    "properties": {
      "expression": {
        "type": "string",
        "description": "Math expression, e.g. '234 * 567' or 'sqrt(144) + pow(2, 10)'"
      }
    },
    "required": ["expression"]
  }
}
```

Implementation: Use `mathjs` npm package (`math.evaluate(expression)`). Never use `eval()`.

**Weather** (`weather`):

```json
{
  "name": "weather",
  "description": "Get current weather for a location including temperature, humidity, wind speed, and conditions.",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "City name, e.g. 'London' or 'Ahmedabad'" },
      "units": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"],
        "description": "Temperature unit"
      }
    },
    "required": ["city"]
  }
}
```

Implementation: Call Open-Meteo geocoding API to resolve city → lat/lon, then Open-Meteo forecast API. No API key required.

**Date/Time** (`datetime`):

```json
{
  "name": "datetime",
  "description": "Get the current date, time, and timezone information. Can also calculate date differences.",
  "parameters": {
    "type": "object",
    "properties": {
      "timezone": {
        "type": "string",
        "description": "IANA timezone, e.g. 'Asia/Kolkata' or 'UTC'"
      },
      "operation": {
        "type": "string",
        "enum": ["now", "diff"],
        "description": "Operation: 'now' for current time, 'diff' for date difference"
      },
      "date1": { "type": "string", "description": "First date for diff operation (ISO 8601)" },
      "date2": { "type": "string", "description": "Second date for diff operation (ISO 8601)" }
    },
    "required": ["timezone"]
  }
}
```

Implementation: Use `dayjs` (already installed from Phase 1 project setup).

### 8.3 Multi-Tool Calls

The model can request multiple tool calls in a single response:

```json
{
  "tool_calls": [
    { "id": "call_1", "function": { "name": "weather", "arguments": "{\"city\":\"London\"}" } },
    {
      "id": "call_2",
      "function": { "name": "datetime", "arguments": "{\"timezone\":\"Europe/London\"}" }
    }
  ]
}
```

`ToolExecutorService` runs all tool calls in parallel (`Promise.all`), then sends all results back to the model in a single request.

### 8.4 Tool Execution Safety

- **Timeout**: Each tool execution has a 10-second timeout. If exceeded, return `{ success: false, error: "Tool execution timed out" }`
- **No eval()**: The calculator uses `mathjs`, never `eval()` or `Function()`
- **HTTP tools**: External HTTP calls have a 5-second timeout and only allow whitelisted domains (configurable)
- **Error isolation**: A tool failure does not crash the chat — the error is returned to the model, which can inform the user

---

## 9. Context Window Management

### 9.1 The Problem

Conversations grow. A 50-message conversation could use 10,000+ tokens as context. If the total exceeds the model's context window, the API call fails.

### 9.2 The Solution — Sliding Window

`ChatService.buildContext()` implements a sliding window:

1. Always keep the system prompt (first message)
2. Always keep the latest N messages (configurable, default: last 20)
3. Count total tokens using `TokenService.countTokens()`
4. If total exceeds `contextWindowLimit` (80% of model's max context):
   - Remove the oldest non-system messages one by one
   - Recount after each removal
   - Stop when within the limit
5. If a single message exceeds the limit (extremely long user input), truncate it

### 9.3 Configuration

```typescript
export const CONTEXT_CONFIG = {
  maxMessages: 50, // hard limit on messages in context
  contextWindowPercentage: 0.8, // use 80% of model's max context
  defaultContextWindow: 128000, // fallback if model's window is unknown
};
```

---

## 10. Functional Requirements

**FR-CH-001**: `ChatService.createConversation()` MUST create a conversation with the specified model, system prompt, and tools-enabled flag. If no title is provided, auto-generate from the first user message (first 50 chars + "...").

**FR-CH-002**: `ChatService.sendMessage()` MUST append the user message, build context, call `OpenaiService.chatCompletion()`, and append the assistant response — all in the correct order.

**FR-CH-003**: `ChatService.buildContext()` MUST implement the sliding window algorithm that keeps context within 80% of the model's context window.

**FR-CH-004**: `StreamingService.streamCompletion()` MUST yield SSE events for each token chunk as it arrives from the OpenAI SDK streaming API.

**FR-CH-005**: The SSE endpoint MUST send `event: done` with usage stats after the stream completes, and MUST handle client disconnection gracefully by aborting the upstream stream.

**FR-CH-006**: When the model returns `tool_calls`, `ToolExecutorService` MUST execute the requested tools and return results to the model for synthesis in a second LLM call.

**FR-CH-007**: Multiple tool calls in a single response MUST be executed in parallel via `Promise.all()`.

**FR-CH-008**: The calculator tool MUST use `mathjs` for expression evaluation. Using `eval()` or `new Function()` is forbidden.

**FR-CH-009**: The weather tool MUST use the Open-Meteo free API (no API key) for geocoding and weather data.

**FR-CH-010**: Every LLM call (including the second call after tool execution) MUST be logged via Phase 1's `AiAuditService`.

**FR-CH-011**: Every LLM call MUST go through Phase 1's `RetryService` for resilience (exponential backoff, circuit breaker).

**FR-CH-012**: Tool execution MUST have a 10-second timeout. Timeout results in `{ success: false, error: "..." }` returned to the model, not an unhandled exception.

**FR-CH-013**: Deleting a conversation MUST cascade-delete all its messages.

**FR-CH-014**: `ToolRegistryService.getToolDefinitions()` MUST return tools in the exact format OpenAI's API expects (`{ type: "function", function: { name, description, parameters } }`).

**FR-CH-015**: The auto-title feature MUST generate a title from the first user message (first 50 characters + "...") when no title is provided on conversation creation.

---

## 11. Non-Functional Requirements

**NFR-CH-001**: SSE streaming latency — time from first OpenAI chunk to first SSE event sent to client MUST be under 50ms.

**NFR-CH-002**: Context building for a 50-message conversation MUST complete in under 100ms.

**NFR-CH-003**: No `any` types. TypeScript strict compliance.

**NFR-CH-004**: No `console.*` — use `AppLoggerService`.

**NFR-CH-005**: All endpoints MUST have Swagger documentation.

**NFR-CH-006**: All environment variables read via `ConfigService`.

**NFR-CH-007**: Tool execution errors MUST NOT crash the chat — errors are returned to the model as context.

**NFR-CH-008**: Client disconnection during streaming MUST be detected and the upstream OpenAI stream aborted within 1 second.

---

## 12. Environment Variables

| Variable                         | Required | Default | Description                                 |
| -------------------------------- | -------- | ------- | ------------------------------------------- |
| `CHAT_MAX_CONTEXT_MESSAGES`      | No       | `50`    | Maximum messages in context window          |
| `CHAT_CONTEXT_WINDOW_PERCENTAGE` | No       | `0.8`   | Percentage of model's context window to use |
| `CHAT_TOOL_TIMEOUT_MS`           | No       | `10000` | Tool execution timeout                      |
| `CHAT_HTTP_TOOL_TIMEOUT_MS`      | No       | `5000`  | HTTP tool call timeout                      |
| `CHAT_AUTO_TITLE`                | No       | `true`  | Auto-generate title from first message      |

---

## 13. Seed Data

### 13.1 Built-in Tools

The seed script (or module init) must register three built-in tools:

1. `calculator` — math expression evaluator
2. `weather` — Open-Meteo weather lookup
3. `datetime` — current date/time and date diff

### 13.2 Sample Conversations (Optional)

For testing, seed 2-3 sample conversations:

1. A simple Q&A conversation (3 messages: system + user + assistant)
2. A conversation with a calculator tool call (5 messages: system + user + assistant-tool-call + tool-result + assistant-synthesis)

---

## 14. Test Scenarios

**SC-CH-001**: Create conversation and send a message

> Create a conversation. Send "What is REST?". Expect: assistant response with content, usage stats, cost. Conversation now has 2 messages (user + assistant).

**SC-CH-002**: Multi-turn conversation

> Send 5 messages in a conversation. Get conversation by ID. Expect: all 10 messages (5 user + 5 assistant) in chronological order. Each assistant message has usage stats.

**SC-CH-003**: Streaming response

> Send a message to the SSE endpoint. Expect: multiple `event: token` events, final `event: done` with usage stats. Full response matches concatenation of all token events.

**SC-CH-004**: Client disconnect during stream

> Start a streaming request, disconnect after 3 tokens. Expect: stream aborted, partial message saved, no server crash.

**SC-CH-005**: Function calling — calculator

> In a tools-enabled conversation, send "What is 234 times 567?". Expect: model calls calculator tool, result 132678, final response includes "132,678".

**SC-CH-006**: Function calling — weather

> Send "What's the weather in Ahmedabad?". Expect: model calls weather tool, result includes temperature, final response includes weather info.

**SC-CH-007**: Function calling — multi-tool

> Send "What's the weather in London and what time is it there?". Expect: model calls both weather and datetime tools, final response includes both answers.

**SC-CH-008**: Context window management

> Create a conversation and send 60 messages. On the 61st, context should be trimmed. Expect: no API error, system prompt retained, oldest messages dropped.

**SC-CH-009**: Tool execution timeout

> Register a mock HTTP tool pointing to a slow endpoint. Send a message that triggers it. Expect: timeout after 10s, error returned to model, model informs user.

**SC-CH-010**: Conversation CRUD

> Create → List (appears) → Update title → Get (title updated) → Archive → List (not in active list) → Delete → Get (404).

**SC-CH-011**: Invalid tool call

> Model calls a tool that doesn't exist. Expect: error returned to model as context, model responds with "I wasn't able to use that tool".

**SC-CH-012**: Empty conversation history

> Get a just-created conversation. Expect: empty messages array, not 404.

**SC-CH-013**: Audit integration

> Send 3 messages in a conversation with tools enabled (triggering 1 tool call). Expect: `ai_audit_logs` has 4 rows (3 normal + 1 for the tool-synthesis call).

**SC-CH-014**: Validation

> Send message with empty content → 400. Create conversation with invalid model → validation error.

---

## 15. Out of Scope

- **WebSocket real-time** — SSE is sufficient for streaming; WebSocket adds complexity without benefit for this use case
- **Message editing** — messages are append-only; "edit and regenerate" is a future enhancement
- **Branching conversations** — no conversation forking or alternate timeline support
- **File attachments** — file upload in chat is Phase 3 (document context for RAG)
- **Image generation** — DALL-E / image tools are out of scope
- **Voice input/output** — Whisper / TTS are out of scope
- **Rate limiting per conversation** — use Phase 1's global throttler
- **End-to-end encryption** — messages are stored in plain text
- **Conversation sharing** — no public links or multi-user conversations
- **Custom tool marketplace** — users can register tools via API, but there's no UI for drag-and-drop tool building

---

## 16. Decisions on Record

| Decision                              | Rationale                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE over WebSocket for streaming      | SSE is simpler, HTTP-based, works through proxies, and is sufficient for server-to-client streaming. WebSocket would only be needed for bidirectional real-time communication. |
| Messages are append-only              | Conversation history is a log. Editing messages would require regeneration logic and branching, which adds complexity without learning value in this phase.                    |
| Tool results are stored as messages   | Following OpenAI's conversation format exactly — tool results are `role: "tool"` messages. This makes the conversation replayable and debuggable.                              |
| Two LLM calls for function calling    | This is how OpenAI's function calling protocol works. The first call decides which tool to use, the second synthesizes the result. Both are audited separately.                |
| `mathjs` for calculator, not `eval()` | Security. `eval()` can execute arbitrary code. `mathjs` only evaluates mathematical expressions.                                                                               |
| Open-Meteo for weather                | Free, no API key, reliable. Avoids adding another paid dependency.                                                                                                             |
| Cascade delete on conversations       | When a conversation is deleted, its messages have no meaning without the parent. Cascade prevents orphaned rows.                                                               |
| Context window at 80% capacity        | Leave 20% headroom for the model's response. If we use 100%, the response itself might push past the limit and cause an error.                                                 |
| Tool execution in parallel            | When the model requests multiple tools, running them sequentially adds unnecessary latency. `Promise.all` is safe because tools are independent.                               |

---

## 17. Folder Structure

```
src/modules/ai-chat/
├── ai-chat.module.ts                    ← imports OpenaiModule, exports ChatService
├── ai-chat.controller.ts               ← REST + SSE endpoints
├── services/
│   ├── chat.service.ts                  ← conversation + message CRUD, context building
│   ├── streaming.service.ts             ← SSE streaming wrapper
│   ├── tool-registry.service.ts         ← tool CRUD + OpenAI format conversion
│   └── tool-executor.service.ts         ← executes builtin + HTTP tools
├── tools/
│   ├── calculator.tool.ts               ← math expression evaluator
│   ├── weather.tool.ts                  ← Open-Meteo integration
│   └── datetime.tool.ts                 ← date/time utility
├── dto/
│   ├── create-conversation.dto.ts
│   ├── update-conversation.dto.ts
│   ├── send-message.dto.ts
│   ├── conversation-res.dto.ts
│   ├── message-res.dto.ts
│   ├── create-tool.dto.ts
│   ├── update-tool.dto.ts
│   ├── tool-res.dto.ts
│   ├── query-conversations.dto.ts
│   ├── stream-event.dto.ts
│   └── index.ts
├── constants/
│   ├── chat-message-role.enum.ts
│   ├── stream-event-type.enum.ts
│   ├── tool-handler-type.enum.ts
│   ├── context-config.constant.ts
│   └── index.ts
├── exceptions/
│   └── tool-execution.exception.ts
└── __tests__/
    ├── chat.service.spec.ts
    ├── streaming.service.spec.ts
    ├── tool-registry.service.spec.ts
    ├── tool-executor.service.spec.ts
    └── ai-chat.controller.spec.ts
```

---

## 18. Dependencies on Phase 1

| Phase 1 Component          | How Phase 2 Uses It                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| `OpenaiService`            | All LLM calls (chat completion, tool synthesis)                        |
| `OpenaiService` (extended) | New `chatCompletionWithTools()` method needed or pass tools via params |
| `TokenService`             | Token counting for context window management                           |
| `RetryService`             | Wraps all LLM calls (via OpenaiService)                                |
| `AiAuditService`           | Logs every LLM call including streaming and tool calls                 |
| `ModelRegistryService`     | Look up model context window for sliding window algorithm              |
| `ConfigService`            | Chat-specific env vars                                                 |
| `DatabaseService`          | All Prisma operations                                                  |
| `AppLoggerService`         | All logging                                                            |
