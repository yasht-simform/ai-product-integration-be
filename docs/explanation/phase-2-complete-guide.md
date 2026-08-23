# Phase 2: Chat Completions, Streaming & Function Calling — Complete Guide

> Reference document for `src/modules/ai-chat/`, plus the one method Phase 2 added to
> `src/modules/openai/services/openai.service.ts`. Written against the code as it exists on
> `feat/openai-api-setup`. If the code and this doc ever disagree, trust the code and update this
> file. Companion to [`phase-1-complete-guide.md`](./phase-1-complete-guide.md) — read that first
> if you haven't; this phase is built entirely on top of it.

---

## What I Built (Non-Technical Summary)

Phase 1 built the switchboard — a reliable, cost-tracked, audited way to place **one call** to an
AI model and get **one answer** back. Phase 2 turns that one-off phone call into an actual
**conversation**: the model remembers what was said earlier, it can talk back to you word-by-word
as it thinks instead of going silent for three seconds and then dumping the whole answer, and — the
genuinely new capability — it can now reach out and _do things_ instead of just talking.

### Single-shot vs. multi-turn chat

Phase 1's `chatCompletion()` is like sending someone a single text message with no memory of any
text before it — every prompt starts from zero. Phase 2 gives the model a **notebook**: every
message you send and every reply it gives is written down (`chat_messages`, in order), and before
every new question the app hands the model the whole relevant notebook so far, not just your latest
line. That's what makes it feel like a conversation instead of a series of unrelated questions —
"what's the capital of France?" followed by "what's its population?" only works if the model still
remembers "it" means Paris.

### Streaming — why watching it type matters

Without streaming, asking a question means: silence... silence... silence... then the _entire_
answer appears at once. With a long answer that might be an 8-second wait staring at nothing. This
phase adds **streaming**: the answer now appears the way a person typing would produce it — word by
word, as the model generates it. Nothing about the answer's _content_ changes; the perceived speed
does. This is the single biggest, cheapest UX win in AI product design, which is why every real chat
product (ChatGPT, Claude, Copilot) does it.

### Function calling — the model can now act, not just talk

Before this phase, the model could only answer using what it already knew from training — ask it
"what's 234 times 567?" and it _guesses_ an answer from pattern-matching, which is why LLMs are
famously bad at arithmetic. **Function calling** lets the model say, mid-answer, "I need to use the
calculator tool for this" — the app actually runs a real calculator, hands the exact result back to
the model, and the model uses that real number to write its final answer. The model isn't
"pretending" to calculate anymore; it's delegating to code that actually does. The same mechanism
lets it check real-time weather (something no LLM can know from training data) or the current date
and time. This is the difference between a chatbot and an assistant that can actually get things
done — and it's the foundation every future tool (searching your database, sending an email,
querying an internal API) builds on.

---

## Architecture Overview

### Module dependency diagram

```
AppModule
├── OpenaiModule                                   (Phase 1 — unchanged except one new export)
│   └── exports: OPENAI_CLIENT, OpenaiService, TokenService,
│                AiAuditService, ModelRegistryService
│
└── AiChatModule                                   (src/modules/ai-chat/ai-chat.module.ts)
    ├── imports: OpenaiModule, HttpModule
    ├── providers
    │   ├── ChatService            exported — the only Phase-2 service other modules should inject
    │   ├── StreamingService       internal — the one place that calls OPENAI_CLIENT with stream: true
    │   ├── ToolRegistryService    internal — CRUD for chat_tools + OpenAI tool-shape conversion
    │   ├── ToolExecutorService    internal — dispatches and runs a tool call once requested
    │   └── WeatherTool            internal — HttpService-based builtin tool (the one DI exception)
    └── controllers
        └── ChatController         11 REST endpoints; injects ChatService + ToolRegistryService
```

`AiChatModule` depends on `OpenaiModule`, never the reverse — Phase 1 has no idea Phase 2 exists.
`exports: [ChatService]` mirrors Phase 1's own boundary: `StreamingService`, `ToolRegistryService`,
and `ToolExecutorService` are implementation details of _how_ `ChatService` gets its work done, not
things a future `RagModule` or `ModerationModule` should ever inject directly.

### How the 4 services connect to each other

```
ChatController
 ├─▶ ChatService              (conversation/message CRUD, sendMessage, sendMessageStream)
 └─▶ ToolRegistryService      (tools CRUD — same module, no need to route through ChatService)

ChatService (the orchestrator — never touches the OpenAI SDK)
 ├─▶ OpenaiService            chatCompletionWithMessages() — every non-streaming LLM call
 ├─▶ TokenService             counts tokens for context-window trimming + cost estimation
 ├─▶ ModelRegistryService     looks up a model's contextWindow for the sliding-window budget
 ├─▶ ToolRegistryService      getToolDefinitions() — what tools to offer the model this turn
 ├─▶ ToolExecutorService      execute() — runs a tool once the model asks for it
 ├─▶ StreamingService         streamCompletion() — only for sendMessageStream()
 └─▶ AiAuditService           logs every streamed turn itself (non-streaming turns are logged by
                              OpenaiService, since chatCompletionWithMessages() already does it)

StreamingService (the only service that calls OPENAI_CLIENT directly)
 └─▶ OPENAI_CLIENT            chat.completions.create({ stream: true }) — bypasses OpenaiService
                              entirely, since streaming needs an AsyncGenerator, not a Promise

ToolExecutorService
 ├─▶ ToolRegistryService      findActiveTool() — is this tool real and enabled?
 ├─▶ WeatherTool               the one builtin handler that's a DI-injected class, not a function
 └─▶ HttpService              only for handlerType: 'http' tools, domain-whitelisted
```

Notice `ChatService` is the only service that talks to more than one other Phase-2 service —
`StreamingService`, `ToolRegistryService`, and `ToolExecutorService` each do exactly one job and
know nothing about each other's internals, the same single-responsibility shape Phase 1 established
between `RetryService` and `AiAuditService`.

### Request flow: standard (non-streaming) chat turn

Traced through `POST /api/v1/chat/conversations/:publicId/messages`:

```
HTTP POST .../messages   { "content": "What is 234 times 567?" }
        │
        ▼
ChatController.sendMessage(publicId, dto)         (chat.controller.ts:140)
        │
        ▼
ChatService.sendMessage(publicId, dto)            (chat.service.ts:192)
        │
        ├─ 1. findConversationOrThrow(publicId)        404 if missing
        ├─ 2. reject whitespace-only content            400 (BadRequestException)
        ├─ 3. addUserMessage()                          persisted BEFORE the model call
        │
        ├─ 4. callModel(conversation, dto, model, toolsEnabled)
        │       ├─ buildContext(conversationId)          sliding-window message array (AI-021)
        │       ├─ toolRegistryService.getToolDefinitions()   only if toolsEnabled
        │       └─ openaiService.chatCompletionWithMessages({ messages, tools })
        │
        ├─ 5a. no tool_calls  → persistAssistantResponse()  → return AssistantMessageResDto
        │
        └─ 5b. tool_calls present (and toolsEnabled)  → handleToolCalls()   [see Function Calling
                                                          Deep Dive — the two-call protocol]
        │
        ▼
ResponseInterceptor                        { success: true, data: <AssistantMessageResDto>, timestamp }
```

### Request flow: streaming chat turn

Traced through `POST /api/v1/chat/conversations/:publicId/messages/stream`:

```
HTTP POST .../messages/stream   { "content": "Explain REST in 3 sentences" }
        │
        ▼
ChatController.sendMessageStream(publicId, dto, @Res() response)   (chat.controller.ts:164)
        │
        ├─ response.on('close', () => abortController.abort())    wired BEFORE anything else
        │
        ├─ const stream = chatService.sendMessageStream(publicId, dto, abortController.signal)
        ├─ const first = await stream.next()      ← priming call: validation happens here,
        │                                            uncaught → HttpExceptionFilter, normal JSON error
        │
        ├─ response.writeHead(200, { 'Content-Type': 'text/event-stream', ... })
        │
        └─ for await (event of stream) → response.write(formatSseFrame(event))
                │
                ▼
        ChatService.sendMessageStream()            (chat.service.ts:220, an async generator)
                ├─ addUserMessage()                 persisted before streaming starts
                ├─ buildContext()                   same sliding window as the sync path
                └─ for await (event of streamingService.streamCompletion(messages, { signal }))
                        yield event                 token | tool_call | error — re-yielded as-is
                │
                ├─ (generator ends: normally, aborted, or errored)
                ├─ addAssistantMessage()            accumulated content, incomplete flag if needed
                ├─ aiAuditService.log()             exactly once per turn
                └─ if not incomplete: yield a final `done` event
```

### Request flow: function-calling turn (two-call protocol)

```
sendMessage() with conversation.toolsEnabled = true, user asks "What is 234 * 567?"
        │
        ├─ CALL 1: callModel(..., withTools: true)
        │       → OpenaiService.chatCompletionWithMessages({ messages, tools: [calculator, ...] })
        │       → model responds with NO content, tool_calls: [{ function: { name: 'calculator',
        │         arguments: '{"expression":"234 * 567"}' } }]
        │       → audited as ai_audit_logs row #1
        │
        ├─ handleToolCalls()
        │       ├─ addAssistantMessage({ content: null, toolCalls })   the "tool decision" turn
        │       ├─ Promise.all(toolCalls.map execute concurrently))
        │       │       → ToolExecutorService.execute('calculator', { expression: '234 * 567' })
        │       │       → { success: true, result: { result: 132678 }, executionMs: 2 }
        │       ├─ addToolResult(toolCallId, 'calculator', executionResult)   role: "tool" message
        │       │
        │       └─ CALL 2: callModel(..., withTools: false)
        │               → OpenaiService.chatCompletionWithMessages({ messages: [...+tool result] })
        │               → model responds: "234 × 567 = 132,678."
        │               → audited as ai_audit_logs row #2
        │
        └─ persistAssistantResponse()  → return AssistantMessageResDto with the final text
```

Two independently audited LLM calls per tool-augmented turn, always — never one call pretending to
be both.

### How Phase 1's services are reused, not reinvented

Every single LLM call in Phase 2 — sync, streaming, or tool-augmented — still passes through
Phase 1's retry/circuit-breaker/audit/cost pipeline, with exactly one narrow exception
(`StreamingService`, explained below):

| Phase 1 service        | How Phase 2 uses it                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenaiService`        | Extended with `chatCompletionWithMessages()` (see next section) — every non-streaming `ChatService` call goes through it, inheriting retry/circuit-breaker/audit/cost for free.                                                                                                                                   |
| `TokenService`         | `countTokens()` drives the sliding-window trim math in `buildContext()`; `calculateCost()` prices every assistant message and every streamed turn.                                                                                                                                                                |
| `ModelRegistryService` | `findModelByModelId()` supplies a model's `contextWindow` for the sliding-window budget calculation.                                                                                                                                                                                                              |
| `AiAuditService`       | Every non-streaming call is audited automatically inside `chatCompletionWithMessages()`. Streaming calls bypass that path (`StreamingService` talks to `OPENAI_CLIENT` directly), so `ChatService.sendMessageStream()` calls `aiAuditService.log()` itself, once per turn.                                        |
| `RetryService`         | Reused unmodified for every non-streaming call, transitively through `OpenaiService`. **Not used by `StreamingService`** — an in-flight SSE stream can't be transparently retried after tokens have already reached the client, so streaming failures surface as an `error` SSE event instead of a retry attempt. |

---

## The 4 Services Explained

### 1. ChatService — the orchestrator

**What it does (non-technical):** This is the conversation manager. It's the only Phase-2 service
that knows about the full lifecycle of a chat: creating conversations, saving every message,
deciding which old messages to forget when a conversation gets too long, deciding whether the model
needs to use a tool, and running the two-call dance when it does.

**What it does (technical):**

```typescript
// src/modules/ai-chat/services/chat.service.ts
async createConversation(params: CreateConversationParams): Promise<ConversationEntity>
async findAllConversations(query: QueryConversationsDto): Promise<PaginatedConversationsResult>
async findConversation(publicId: string): Promise<ConversationWithMessages>
async updateConversation(publicId: string, params: UpdateConversationDto): Promise<ConversationEntity>
async archiveConversation(publicId: string): Promise<void>
async deleteConversation(publicId: string): Promise<void>

async addUserMessage(conversationId: bigint, content: string): Promise<ChatMessageEntity>
async addAssistantMessage(conversationId: bigint, params: AddAssistantMessageParams): Promise<ChatMessageEntity>
async addToolResult(conversationId: bigint, toolCallId: string, toolName: string, result: unknown): Promise<ChatMessageEntity>

async sendMessage(conversationPublicId: string, dto: SendMessageDto): Promise<AssistantMessageResDto>
async *sendMessageStream(conversationPublicId: string, dto: SendMessageDto, abortSignal: AbortSignal): AsyncGenerator<StreamEvent>

async buildContext(conversationId: bigint): Promise<OpenAI.Chat.ChatCompletionMessageParam[]>
```

```typescript
async sendMessage(
  conversationPublicId: string,
  dto: SendMessageDto,
): Promise<AssistantMessageResDto> {
  const conversation = await this.findConversationOrThrow(conversationPublicId);

  if (!dto.content.trim()) {
    throw new BadRequestException('content must not be empty or whitespace-only');
  }

  await this.addUserMessage(conversation.id, dto.content);

  const model = dto.model ?? conversation.model;
  const result = await this.callModel(conversation, dto, model, conversation.toolsEnabled);

  if (conversation.toolsEnabled && result.toolCalls?.length) {
    return this.handleToolCalls(conversation, dto, model, result);
  }

  return this.persistAssistantResponse(conversation.id, result);
}
```

**Key design decisions and why:**

- **The user message is persisted _before_ the model is ever called.** If the LLM call crashes or
  times out, the conversation is left in a recoverable state — user message present, assistant
  reply missing — rather than silently losing what the user typed. The reverse ordering (assistant
  message existing without the user turn that prompted it) is never acceptable and never happens.
- **`dto.model`/`temperature`/`maxTokens` override the conversation's stored defaults for that one
  call only.** `sendMessage()` never calls `chatConversation.update()`, so experimenting with a
  different model mid-conversation never silently changes what every future message in that thread
  uses.
- **`deleteConversation()` is a hard delete relying on the schema's `onDelete: Cascade`**, not a
  manual "delete messages, then delete the conversation" two-step — Postgres already guarantees
  atomicity here, so re-implementing it in application code would just be duplicate, riskier logic.
- **Auto-title uses plain `.slice(0, 50)` + `"..."`**, not grapheme-safe truncation — a deliberate,
  simpler reading of the spec's literal "first 50 characters" wording, and it always appends the
  ellipsis even for a message shorter than 50 characters, since the spec never gates it on length.
- **`sendMessageStream()` is an `async *` generator**, not a `Promise` — the entire reason it exists
  separately from `sendMessage()` rather than sharing one method with a `stream: boolean` flag is
  that the two have fundamentally incompatible return shapes (`Promise<T>` vs.
  `AsyncGenerator<StreamEvent>`), and forcing them into one signature would have made both harder to
  read.

### 2. StreamingService — the SSE wrapper around OpenAI

**What it does (non-technical):** This is the only part of the app that ever asks OpenAI to "talk
as you think" instead of "think, then talk." It translates OpenAI's own streaming format into a
simpler, internal event shape (`token`, `tool_call`, `error`) that the rest of the app doesn't need
to know is SDK-specific.

**What it does (technical):**

```typescript
// src/modules/ai-chat/services/streaming.service.ts
async *streamCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: StreamCompletionOptions = {},   // { model?, temperature?, tools?, signal? }
): AsyncGenerator<StreamEvent>
```

```typescript
try {
  const stream = await this.openaiClient.chat.completions.create(
    { model, messages, ...(tools && { tools }), ...(temperature !== undefined && { temperature }), stream: true },
    { signal },
  );

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;

    if (delta?.content) {
      yield { type: StreamEventType.TOKEN, data: delta.content };
    }

    if (delta?.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        // accumulate id / function.name / function.arguments fragments by index
      }
    }

    if (choice?.finish_reason === 'tool_calls') {
      for (const accumulator of toolCallAccumulators.values()) {
        yield { type: StreamEventType.TOOL_CALL, data: this.toToolCallData(accumulator) };
      }
      toolCallAccumulators.clear();
    }
  }
} catch (error) {
  if (error instanceof APIUserAbortError || signal?.aborted) return;   // clean, silent exit
  yield { type: StreamEventType.ERROR, data: { error: this.errorMessage(error) } };
}
```

**Key design decisions and why:**

- **It's the one service that injects `OPENAI_CLIENT` directly instead of going through
  `OpenaiService`.** Streaming needs `AsyncGenerator<StreamEvent>`, and Phase 1's
  `chatCompletion()`/`chatCompletionWithMessages()` both return `Promise<ChatCompletionResult>` —
  fundamentally different shapes that can't share one method. `OpenaiModule`'s `exports` array
  gained `OPENAI_CLIENT` specifically so `AiChatModule` could inject the token without breaking
  Phase 1's "only `OpenaiService` touches the SDK" rule for every _other_ call pattern.
- **Tool-call deltas are fragmented across many chunks and must be accumulated.** OpenAI sends a
  tool call's `id` and `function.name` once, then streams `function.arguments` incrementally,
  character-by-character in the worst case — all sharing the same `tool_calls[].index`. A
  `Map<index, accumulator>` collects fragments per call, and a `TOOL_CALL` event is only emitted
  once, when `finish_reason === 'tool_calls'` confirms the call is complete — never one malformed
  partial-JSON event per chunk.
- **Creation and iteration share one `try/catch`.** The OpenAI SDK links the passed `signal` to its
  own internal `AbortController` and already swallows an abort that fires _during_ iteration (the
  `for await` loop just ends silently) — but an abort that fires _before_ `create()`'s promise even
  resolves rejects with `APIUserAbortError` instead. Both cases need identical handling ("this was
  a clean cancel, not a failure"), so one `catch` covers both code paths instead of duplicating the
  abort check.
- **A malformed accumulated `arguments` JSON string degrades to `{}` instead of throwing** — logged,
  not crashed — because one garbled tool call must never take down the whole stream for every token
  already sent.
- **No `RetryService` involvement.** Once the first token has reached a real client, silently
  retrying the whole call would mean either duplicating visible text or discarding what the user
  already saw — neither is acceptable, so a mid-stream failure becomes a visible `error` event
  instead of an invisible retry.

### 3. ToolRegistryService — the tool catalog

**What it does (non-technical):** This is the phone book of "things the model is allowed to ask
for." It stores every tool's name, description, and expected arguments as data in the database
(not hardcoded in TypeScript), so adding a new tool is a database row, not a deploy — and it's the
only place that knows how to translate that row into the exact format OpenAI's API expects.

**What it does (technical):**

```typescript
// src/modules/ai-chat/services/tool-registry.service.ts
async onModuleInit(): Promise<void>                                              // upserts BUILTIN_TOOLS every boot
async findAllTools(): Promise<ToolEntity[]>
async findActiveTool(name: string): Promise<ToolEntity>                          // 404 if missing OR inactive
async createTool(dto: CreateToolDto): Promise<ToolEntity>                        // 409 on duplicate name
async updateTool(publicId: string, dto: UpdateToolDto): Promise<ToolEntity>
async deleteTool(publicId: string): Promise<void>                                // soft delete: isActive: false
async getToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionTool[]>            // active tools only
```

```typescript
async getToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const tools = await this.db.chatTool.findMany({ where: { isActive: true } });
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}
```

**Key design decisions and why:**

- **`onModuleInit()` upserts the three built-in tools on every boot**, mirroring
  `OpenRouterSyncService`'s idempotent-seed-on-startup precedent from Phase 1 — errors are logged
  and swallowed, never rethrown, so a transient DB hiccup during boot can't crash the whole app.
  This is also what closed `AI-017` ("seed built-in tools") without a separate seed script: since
  AI-017 hadn't landed yet when this was built, its requirement was folded directly in here.
- **`findActiveTool()` treats "doesn't exist" and "exists but deactivated" identically** — both
  throw the same `NotFoundException`. `ToolExecutorService` doesn't need to distinguish the two
  cases; either way, the tool isn't callable right now.
- **Deleting a tool is a soft delete (`isActive: false`), never a hard delete.** A `chat_messages`
  row referencing a tool call from a now-deleted tool would otherwise become unreplayable — keeping
  the row lets old conversations still render correctly.
- **`getToolDefinitions()`'s output shape is load-bearing, not cosmetic.** It's forwarded directly
  into OpenAI's `tools` request parameter — any drift from `{ type: 'function', function: { name,
description, parameters } }` causes a silent `400` from OpenAI's API, not a TypeScript error, so
  its exact shape is asserted with a literal `toEqual()` in `tool-registry.service.spec.ts`.
- **Not exported from `AiChatModule`.** `ToolExecutorService` and `ChatController` are both in the
  same module and can inject it directly — no cross-module boundary to manage, same pattern as
  Phase 1's `PromptTemplateService`.

### 4. ToolExecutorService — the tool runner

**What it does (non-technical):** Once the model says "I want to use the calculator," this is what
actually runs the calculator — safely, with a time limit, and in a way that can never crash the
conversation even if the tool itself breaks.

**What it does (technical):**

```typescript
// src/modules/ai-chat/services/tool-executor.service.ts
async execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
// ToolExecutionResult = { success: boolean; result: unknown; error?: string; executionMs: number }
```

```typescript
async execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const startTime = Date.now();

  let tool: ToolEntity;
  try {
    tool = await this.toolRegistry.findActiveTool(toolName);
  } catch {
    return this.failure(`Tool '${toolName}' is not available`, startTime);
  }

  if ((tool.handlerType as ToolHandlerType) === ToolHandlerType.HTTP) {
    return this.executeHttp(tool, args, startTime);
  }
  return this.executeBuiltin(tool.name, args, startTime);
}
```

The builtin dispatch table, built once in the constructor:

```typescript
this.builtinHandlers = {
  calculator: (args) =>
    Promise.resolve(executeCalculator(args as unknown as { expression: string })),
  datetime: (args) => Promise.resolve(executeDatetime(args as unknown as { timezone: string })),
  weather: (args) => this.weatherTool.execute(args as unknown as { city: string }),
};
```

**Key design decisions and why:**

- **It never rejects.** Every path — unknown tool, inactive tool, timeout, a builtin handler
  throwing, an HTTP tool erroring — resolves to a `ToolExecutionResult`, never a thrown exception.
  A single broken tool must never crash the chat request that triggered it (spec §8.4); the model
  simply receives `{ success: false, error: "..." }` as its tool result and can tell the user it
  couldn't complete that step.
- **Builtin timeouts use `Promise.race()` against a `setTimeout`**, not a hand-rolled
  `reject(error)` — ESLint's `prefer-promise-reject-errors` can't statically prove a caught
  `unknown` is an `Error`, so a dedicated `ToolTimeoutError` class and `.finally(() =>
clearTimeout(timer))` keep the pattern lint-clean and leak-free.
- **HTTP tools use RxJS's `timeout()` operator instead of a manual timer**, since
  `HttpService.request()` already returns an Observable — piping `timeout(ms)` onto it and catching
  the resulting `TimeoutError` (from `'rxjs'`) is simpler than wrapping a Promise-based call.
- **Both timeout paths converge on the identical `'Tool execution timed out'` string** — the model
  (and any UI reading tool results) sees one consistent failure message regardless of which handler
  type was slow.
- **`weather` is the one builtin dispatched through dependency injection, not a plain function
  import** — `WeatherTool` needs `HttpService`, so it's a real `@Injectable()` class registered as
  an `AiChatModule` provider; `calculator`/`datetime` need no dependencies at all and are just
  imported functions.
- **HTTP tool domain checks fail closed.** `chat.httpToolAllowedDomains` defaults to `[]` — an
  _empty_ whitelist blocks every HTTP tool call, never "allow everything." This is what closes off
  the SSRF risk of letting a `chat_tools` row point `handlerConfig.url` at an arbitrary internal
  address.
- **`ChatService.handleToolCalls()` runs every call in one turn through `Promise.all()`**, so
  `ToolExecutorService.execute()` only had to guarantee each individual call is safe and
  independent — it doesn't decide concurrency itself, proven by a test running 10 concurrent
  `calculator`/`datetime` calls and asserting each resolves independently.

---

## OpenaiService Extension

Phase 1's `OpenaiService.chatCompletion(params: ChatCompletionParams)` only ever accepted a single
`prompt` string (plus an optional `systemPrompt`) — there was no way to hand it an existing
multi-turn history, and no way to attach a `tools` parameter. Both are hard requirements for Phase
2: `ChatService.buildContext()` produces a full `ChatCompletionMessageParam[]`, and tool-augmented
turns need to offer `tools` on the first call of the two-call protocol.

The PRD's own framing of the decision: _"Rather than have `AiChatModule` call the OpenAI SDK
directly (which would violate Phase 1's 'only `OpenaiService` touches the SDK' rule and fork the
retry/audit/cost logic), Phase 2 adds a new method to `OpenaiService`."_ Concretely:

```typescript
// src/modules/openai/services/openai.service.ts
async chatCompletionWithMessages(params: MessagesCompletionParams): Promise<ChatCompletionResult> {
  this.ensureConfigured();

  const {
    messages,
    tools,
    model = this.config.get<string>('openai.defaultModel') ?? OpenAIModel.GPT_4O,
    temperature,
    maxTokens,
    userId,
    requestId = crypto.randomUUID(),
  } = params;

  const auditSystemPrompt = this.extractTextContent(
    messages.find((message) => message.role === 'system')?.content,
  );
  const auditUserMessage =
    this.extractTextContent(
      [...messages].reverse().find((message) => message.role === 'user')?.content,
    ) ?? '';

  return this.executeCompletion({
    model, messages, tools, temperature, maxTokens, userId, requestId,
    auditSystemPrompt, auditUserMessage,
  });
}
```

**Why extended, not bypassed:** both `chatCompletion()` (Phase 1's single-`prompt` method) and
`chatCompletionWithMessages()` (Phase 2's message-array method) now share a private
`executeCompletion()` tail — the exact same retry-wrapped SDK call, `TokenService.calculateCost()`
pricing, and fire-and-forget `AiAuditService.log()` write. `chatCompletion()` just builds its
`messages` array from `prompt`/`systemPrompt` first and delegates; `chatCompletionWithMessages()`
passes its array through unchanged. Neither method's audit output differs structurally — the
"identically-shaped `ai_audit_logs` rows regardless of which method was called" success criterion
from `AI-018` holds because they're the _same_ write path, not two similar ones.

**How `tools` flows through:** `chatCompletionWithMessages()`'s `tools?: OpenAI.Chat.ChatCompletionTool[]`
parameter is spread into the SDK call only when present (`...(tools !== undefined ? { tools } : {})`
— the same optional-spread pattern Phase 1 already used for `temperature`/`maxTokens`), and
`response.choices[0]?.message.tool_calls` is read back onto a new optional field,
`ChatCompletionResult.toolCalls?`. `ChatService.callModel()` decides whether to pass `tools` at all
— empty/no tools when `withTools` is `false` (the second call of the two-call protocol), a real
array otherwise.

**Best-effort audit-field extraction:** since an arbitrary message array doesn't map cleanly onto
`ai_audit_logs`' `systemPrompt`/`userMessage` columns (which assume a single prompt/response
shape), a private `extractTextContent()` helper pulls the first `system`-role message's content and
the last `user`-role message's content — but only when that content is a plain `string`. A
multi-part `ChatCompletionContentPart[]` content (images, etc. — not used anywhere in this codebase
yet) resolves to `undefined`/`''` rather than crashing the audit write.

**Regression guarantee:** `chatCompletion()`'s signature, return shape, and behavior are completely
unchanged — Phase 1's own `openai.service.spec.ts` and `openai.controller.spec.ts` still pass
unmodified, proving this was purely additive (confirmed: the full suite went from 250 to 271
passing tests with zero changes to any Phase 1 spec file's assertions).

---

## Database Schema

Three tables were added in `AI-015` (`docs/issues/AI-015-chat-schema-and-config.md`), following the
same `BigInt` PK + `publicId` UUID pattern Phase 1 established for `AiAuditLog`/`AiModel`.

### `chat_conversations`

```prisma
model ChatConversation {
  id            BigInt        @id @default(autoincrement())
  publicId      String        @unique @default(uuid())
  title         String?
  systemPrompt  String?
  model         String
  userId        String?
  toolsEnabled  Boolean       @default(false)
  metadata      Json?         @db.JsonB
  isArchived    Boolean       @default(false)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  messages      ChatMessage[]

  @@index([userId, updatedAt(sort: Desc)])
  @@map("chat_conversations")
}
```

| Field          | Meaning                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `title`        | Nullable — auto-generated from the first user message (`maybeSetAutoTitle()`) if left unset at creation.                       |
| `systemPrompt` | Nullable — synthesized as a `{ role: 'system', ... }` message in `buildContext()`, never stored as a `ChatMessage` row itself. |
| `model`        | The conversation's default model. Individual messages can override it per-call without changing this column.                   |
| `toolsEnabled` | Fixed at creation time — immutable afterward; `UpdateConversationDto` explicitly omits it.                                     |
| `metadata`     | Free-form JSONB, reserved for future use — not populated by any Phase 2 code path today.                                       |
| `isArchived`   | Soft toggle set by `POST .../archive`; archived conversations aren't deleted, just filterable out of `findAllConversations()`. |

### `chat_messages`

```prisma
model ChatMessage {
  id             BigInt   @id @default(autoincrement())
  publicId       String   @unique @default(uuid())
  conversationId BigInt
  role           String
  content        String?
  toolCalls      Json?    @db.JsonB
  toolCallId     String?
  toolName       String?
  tokenCount     Int?
  cost           Float?
  latencyMs      Int?
  model          String?
  metadata       Json?    @db.JsonB
  createdAt      DateTime @default(now())

  conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt(sort: Asc)])
  @@map("chat_messages")
}
```

| Field                                         | Meaning                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                                        | `system` \| `user` \| `assistant` \| `tool` (backed by `ChatMessageRole`, stored as a plain string column).                                                                                                                                                                                                                                                                                    |
| `content`                                     | Nullable — `null` on an assistant message that _only_ requested tool calls with no accompanying text (a real, valid state per OpenAI's own protocol, not a bug).                                                                                                                                                                                                                               |
| `toolCalls`                                   | JSONB — populated on an assistant message when the model requested one or more tool calls this turn.                                                                                                                                                                                                                                                                                           |
| `toolCallId` / `toolName`                     | Populated only on `role: 'tool'` messages — which tool-call request this result answers.                                                                                                                                                                                                                                                                                                       |
| `tokenCount` / `cost` / `latencyMs` / `model` | Populated on assistant messages only — per-message cost auditing without re-deriving it from `ai_audit_logs`.                                                                                                                                                                                                                                                                                  |
| `metadata`                                    | Holds `{ incomplete: true }` on a streaming turn's assistant message that was cut short by a disconnect or mid-stream error — added in a follow-up migration (`20260706180939_add_chat_message_metadata`) during `AI-020`, after the original `AI-015` schema didn't anticipate it. Keeps `toolCalls` semantically pure (assistant tool-call _requests_ only, never a completion-status flag). |

**Cascade delete:** `onDelete: Cascade` on the `conversation` relation means `DELETE
/chat/conversations/:publicId` needs no manual message cleanup — Postgres removes every
`chat_messages` row for that conversation as part of the same delete. `AI-015`'s own risk callout
was explicit that this needed live verification, not just reading the schema ("Prisma's
`onDelete: Cascade` is easy to get backwards") — verified during `AI-035`'s live smoke test.

**Why append-only:** exactly Phase 1's `AiAuditLog` rationale, transplanted — no `updatedAt`, no
edit endpoint, no soft delete. A conversation is a replayable log of what actually happened; editing
history after the fact would make the transcript untrustworthy. If a message needs correcting, the
correct move is a new message, never an update to an old one.

**How tool messages fit into the sequence:** a tool-augmented turn produces messages in this exact
order — `user` (the question) → `assistant` (`content: null`, `toolCalls: [...]`) → `tool` (one per
tool call, `content` is `JSON.stringify(executionResult)`, tagged with `toolCallId`/`toolName`) →
`assistant` (the final synthesized answer, `content` populated, no `toolCalls`). This mirrors
OpenAI's own `messages` array shape exactly — `ChatService.toChatCompletionMessageParam()` maps
each stored row straight back into the SDK's expected format with no lossy transformation, which is
what makes a persisted conversation directly replayable through the API.

### `chat_tools`

```prisma
model ChatTool {
  id            BigInt   @id @default(autoincrement())
  publicId      String   @unique @default(uuid())
  name          String   @unique
  displayName   String
  description   String
  parameters    Json     @db.JsonB
  handlerType   String
  handlerConfig Json?    @db.JsonB
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("chat_tools")
}
```

| Field           | Meaning                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | Unique — this is the literal string the model uses in `tool_calls[].function.name`; must match exactly.                                 |
| `parameters`    | JSON Schema describing the tool's arguments — forwarded verbatim into OpenAI's `tools` request parameter.                               |
| `handlerType`   | `builtin` (dispatched via `ToolExecutorService`'s in-memory function map) or `http` (dispatched via an outbound whitelisted HTTP call). |
| `handlerConfig` | Only meaningful for `handlerType: 'http'` — `{ url, method?, headers? }`.                                                               |
| `isActive`      | Soft toggle — `findActiveTool()` treats `false` identically to "row doesn't exist" for calling purposes.                                |

### Indexes and why they exist

- `chat_conversations (userId, updatedAt DESC)` — supports `findAllConversations()`'s default
  `orderBy: { updatedAt: 'desc' }` filtered by `userId`, the exact "my most recently active chats
  first" query a conversation list UI needs.
- `chat_messages (conversationId, createdAt ASC)` — supports both `findConversation()`'s
  chronological transcript fetch and `buildContext()`'s `take: maxContextMessages` windowed fetch —
  the two highest-frequency queries against this table by far.
- `chat_tools.name` is `@unique` (not a separate `@@index`) — it's both the natural lookup key for
  `findActiveTool()` and the source of the `ConflictException` on duplicate registration.

---

## All 12 API Endpoints — With Usage Examples

All endpoints are mounted under `/api/v1/chat` and are **unauthenticated**, matching Phase 1's
explicit out-of-scope decision on auth for this learning project. Every successful _JSON_ response
is wrapped by the global `ResponseInterceptor` (`{ success: true, data: {...}, timestamp }`) —
examples below show the `data` payload only. The one exception is the SSE endpoint, which bypasses
the interceptor entirely (see the SSE Deep Dive).

### Group: Conversations

#### 1. `POST /api/v1/chat/conversations`

Create a new conversation.

```bash
curl -X POST http://localhost:3000/api/v1/chat/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Math help",
    "systemPrompt": "You are a helpful assistant with access to a calculator tool.",
    "toolsEnabled": true
  }'
```

Response (`ConversationResDto`, `201`):

```json
{
  "publicId": "b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b",
  "title": "Math help",
  "systemPrompt": "You are a helpful assistant with access to a calculator tool.",
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "toolsEnabled": true,
  "isArchived": false,
  "createdAt": "2026-07-08T09:00:00.000Z",
  "updatedAt": "2026-07-08T09:00:00.000Z"
}
```

`model` fell back to `OPENAI_DEFAULT_MODEL` since it wasn't specified. **When you'd use this:**
starting any new chat thread — the `toolsEnabled` flag is the one decision that can't be changed
later.

#### 2. `GET /api/v1/chat/conversations`

```bash
curl "http://localhost:3000/api/v1/chat/conversations?isArchived=false&page=1&limit=20"
```

Response (`PaginatedConversationsResDto`, `200`):

```json
{
  "data": [{ "publicId": "b6e4c1a0-...", "title": "Math help", "...": "..." }],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

**When you'd use this:** rendering a conversation list sidebar, sorted most-recently-active first.

#### 3. `GET /api/v1/chat/conversations/:publicId`

```bash
curl http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b
```

Response (`ConversationWithMessagesResDto`, `200`) — a brand-new conversation returns `messages: []`,
not a `404`:

```json
{
  "publicId": "b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b",
  "title": "Math help",
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "toolsEnabled": true,
  "isArchived": false,
  "createdAt": "2026-07-08T09:00:00.000Z",
  "updatedAt": "2026-07-08T09:00:00.000Z",
  "messages": []
}
```

**When you'd use this:** rendering the full chat transcript when a user opens a conversation.

#### 4. `PATCH /api/v1/chat/conversations/:publicId`

```bash
curl -X PATCH http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b \
  -H "Content-Type: application/json" \
  -d '{ "title": "Math and calculator questions" }'
```

Only `title`/`systemPrompt`/`model` are patchable — `toolsEnabled` is dropped from the update DTO
entirely, not just optional. `404` if the conversation doesn't exist.

#### 5. `DELETE /api/v1/chat/conversations/:publicId`

```bash
curl -X DELETE http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b -i
```

`204 No Content`. Cascades to every message in the conversation. `404` if it doesn't exist.

#### 6. `POST /api/v1/chat/conversations/:publicId/archive`

```bash
curl -X POST http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b/archive -i
```

`204 No Content`. **When you'd use this:** hiding a finished conversation from an active list
without permanently deleting the transcript.

### Group: Messages

#### 7. `POST /api/v1/chat/conversations/:publicId/messages`

Send a message and get the full assistant response back in one call — handles tool-calling
internally if the conversation has it enabled.

```bash
curl -X POST http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b/messages \
  -H "Content-Type: application/json" \
  -d '{ "content": "What is 234 times 567?" }'
```

Response (`AssistantMessageResDto`, `201`):

```json
{
  "messageId": "9d2f1b3a-4c5e-4f6a-8b7c-1d2e3f4a5b6c",
  "role": "assistant",
  "content": "234 × 567 = 132,678.",
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "toolCalls": null,
  "usage": { "inputTokens": 145, "outputTokens": 28, "totalTokens": 173 },
  "estimatedCost": 0,
  "latencyMs": 2300
}
```

`estimatedCost: 0` is expected here — the default model is a free OpenRouter model.
`content: "   "` (whitespace-only) → `400 Bad Request`. Unknown `:publicId` → `404`. **When you'd
use this:** any client that doesn't need token-by-token rendering — background jobs, simple
integrations, or a first pass before adding streaming.

#### 8. `POST /api/v1/chat/conversations/:publicId/messages/stream`

Send a message and receive the response as Server-Sent Events instead of one JSON blob. See the
[SSE Streaming Deep Dive](#sse-streaming-deep-dive) below for the full event sequence.

```bash
curl -N -X POST http://localhost:3000/api/v1/chat/conversations/b6e4c1a0-1f3d-4a2e-9c7b-8a1d2e3f4a5b/messages/stream \
  -H "Content-Type: application/json" \
  -d '{ "content": "Explain REST APIs in one sentence." }'
```

(`-N` disables curl's output buffering so you see frames arrive live, not all at once at the end.)
Response is `text/event-stream`, not JSON — see below for a real captured frame sequence. **When
you'd use this:** any interactive chat UI, where perceived latency matters more than a single
JSON round-trip.

### Group: Tools

#### 9. `GET /api/v1/chat/tools`

```bash
curl http://localhost:3000/api/v1/chat/tools
```

Response (`ToolResDto[]`, `200`) — the three seeded built-ins plus any you've registered:

```json
[
  {
    "publicId": "1a2b3c4d-...",
    "name": "calculator",
    "displayName": "Calculator",
    "description": "Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, sqrt, pow, sin, cos, tan, log, pi, e.",
    "parameters": {
      "type": "object",
      "properties": { "expression": { "type": "string" } },
      "required": ["expression"]
    },
    "handlerType": "builtin",
    "isActive": true,
    "createdAt": "2026-07-06T00:00:00.000Z",
    "updatedAt": "2026-07-06T00:00:00.000Z"
  }
]
```

#### 10. `POST /api/v1/chat/tools`

Register a custom `http`-handler tool — extending the model's capabilities without a deploy.

```bash
curl -X POST http://localhost:3000/api/v1/chat/tools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "internal_lookup",
    "displayName": "Internal Lookup",
    "description": "Look up an internal record by ID",
    "parameters": {
      "type": "object",
      "properties": { "id": { "type": "string" } },
      "required": ["id"]
    },
    "handlerType": "http",
    "handlerConfig": { "url": "https://internal.example.com/lookup", "method": "POST" }
  }'
```

Response (`ToolResDto`, `201`). Duplicate `name` → `409 Conflict`. **Note:** this tool won't
actually be _callable_ until `internal.example.com` is added to `CHAT_TOOL_HTTP_ALLOWED_DOMAINS` —
registration and the domain whitelist are independent checks.

#### 11. `PATCH /api/v1/chat/tools/:publicId`

```bash
curl -X PATCH http://localhost:3000/api/v1/chat/tools/1a2b3c4d-... \
  -H "Content-Type: application/json" \
  -d '{ "description": "Updated description shown to the model" }'
```

#### 12. `DELETE /api/v1/chat/tools/:publicId`

```bash
curl -X DELETE http://localhost:3000/api/v1/chat/tools/1a2b3c4d-... -i
```

`204 No Content` — soft delete (`isActive: false`); confirmed via `GET /chat/tools` that the row
persists rather than disappearing. **When you'd use these:** managing the tool catalog as data,
same "no deploy needed" philosophy as Phase 1's prompt-template CRUD.

---

## SSE Streaming Deep Dive

### How Server-Sent Events work, at the protocol level

SSE is a plain-text, one-directional streaming protocol over a normal HTTP connection — no
WebSocket upgrade, no special client library required beyond `EventSource` or a `fetch` +
`ReadableStream` reader. The server sends `Content-Type: text/event-stream`, keeps the connection
open, and writes newline-delimited frames as they become available:

```
event: <type>
data: <json>

```

A blank line terminates each frame. The browser's native `EventSource` API parses this format
automatically; this project's `formatSseFrame()` util produces it directly:

```typescript
// src/modules/ai-chat/utils/sse-frame.util.ts
export function formatSseFrame(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
```

### Why raw `@Res()` instead of `@Sse()`

NestJS ships a built-in `@Sse()` decorator — it was considered and deliberately rejected. `@Sse()`
always maps its route to `RequestMethod.GET` (an internal, undocumented limitation), but spec §6.2
requires `POST` with a JSON body (`SendMessageDto`) — this endpoint isn't meant to be consumed by
the browser's native `EventSource`, which can only issue `GET` requests; the intended client is
`fetch` + a `ReadableStream` reader. The chosen approach — a raw `@Res()` `Response` parameter
(_not_ `{ passthrough: true }`) — was verified (by reading `@nestjs/core`'s
`router-execution-context.js`) to set Nest's internal `isResponseHandled` flag, which makes the
framework skip applying the global `ResponseInterceptor`'s `{ success, data, timestamp }` wrapper
entirely: the interceptor still technically runs, but its output is provably discarded, never
written to the client.

### The priming-call pattern

```typescript
const stream = this.chatService.sendMessageStream(publicId, dto, abortController.signal);

const first = await stream.next(); // runs validation synchronously, before any header is sent
if (first.done) return;

response.writeHead(HttpStatus.OK, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
});
```

Because `sendMessageStream()` validates the conversation and rejects empty content _before_ its
first `yield`, calling `stream.next()` once, before writing any headers, means a `NotFoundException`
or `BadRequestException` at that point propagates uncaught straight to the global
`HttpExceptionFilter` — producing the exact same JSON error envelope every other endpoint in the app
returns. There's no special-cased error handling duplicated in this controller for the "request
never even reached streaming" case.

### Event types

| Event         | Emitted by                           | When                                                                                                |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `token`       | `StreamingService`                   | Every chunk carrying `delta.content` — a UTF-8 fragment of the model's answer.                      |
| `tool_call`   | `StreamingService`                   | Once per accumulated tool call, when `finish_reason === 'tool_calls'`.                              |
| `tool_result` | _(reserved, never emitted today)_    | See "known gap" below.                                                                              |
| `done`        | `ChatService.sendMessageStream()`    | Once, after a clean (non-aborted, non-errored) stream finishes and the message is persisted.        |
| `error`       | `StreamingService` or the controller | A mid-stream SDK failure, or a post-header-write failure (e.g. a DB write error) in the controller. |

**Known gap, inherited from AI-029/AI-033:** `sendMessageStream()` never executes tool calls — it
only forwards `tool_call` events to the client and persists them on the assistant message, ending
the streamed turn there without a follow-up synthesis call. `tool_result` is defined in
`StreamEventType` and documented in the spec's example output, but no code path in this repository
ever emits it. A streamed tool-call turn today produces a `tool_call` event and a persisted
assistant message with unexecuted tool calls — full non-streaming two-call tool execution
(`handleToolCalls()`) is only wired into `sendMessage()`, not `sendMessageStream()`. This was a
deliberate scope boundary, not an oversight — the issue that built streaming never asked for tool
execution to be wired in, and doing so speculatively would have been unscoped work.

### Client disconnect handling — how abort actually works

The first implementation attached the abort trigger to the _request_ object — the natural first
reading of "detect disconnect." Live testing (`curl` + `kill`) against a real running server proved
this **never fires**: a small JSON POST body is fully consumed by Express before the controller
method even runs, so the request's readable stream (and its `'close'` event) can already have fired
before a listener is attached inside the handler — silently swallowing every disconnect.

The fix, and what ships today, listens on the **response** instead:

```typescript
const abortController = new AbortController();
response.on('close', () => abortController.abort());
```

The response stream stays open for the entire SSE session, so its `'close'` event reliably fires
exactly once, exactly when the underlying connection terminates — verified live: killing the client
mid-generation aborts within ~1.5s, produces a `chat_messages` row with `metadata:
{"incomplete": true}`, and an `ai_audit_logs` row with `status: FAILED` and a nonzero partial token
count. `StreamingService.streamCompletion()` passes this same `AbortSignal` straight to
`openaiClient.chat.completions.create()`'s second `RequestOptions` argument — the OpenAI SDK links
it to its own internal `AbortController`, so the abort actually cancels the upstream HTTP request
to OpenAI too, not just the local generator loop.

### Partial message persistence

Regardless of how the loop over `streamingService.streamCompletion()` ends — cleanly, aborted, or
mid-stream error — `ChatService.sendMessageStream()` always calls `addAssistantMessage()` exactly
once, with whatever content was accumulated so far:

```typescript
const incomplete = abortSignal.aborted || streamErrorMessage !== undefined;

const assistantMessage = await this.addAssistantMessage(conversation.id, {
  content: accumulatedContent || null,
  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  tokenCount: totalTokens,
  cost: estimatedCost,
  latencyMs,
  model,
  incomplete, // → { metadata: { incomplete: true } } on the stored row
});
```

The `done` event is only yielded when `!incomplete` — an aborted or errored stream ends with the
`error` event (if any) and the connection simply closing, no `done` frame follows.

### Real SSE output example

A full streamed response to `"Explain REST in one sentence."` on a tools-enabled conversation that
didn't need a tool this turn (captured shape, condensed):

```
event: token
data: "REST"

event: token
data: " is"

event: token
data: " an architectural"

event: token
data: " style for designing networked applications."

event: done
data: {"messageId":"9d2f1b3a-4c5e-4f6a-8b7c-1d2e3f4a5b6c","usage":{"inputTokens":132,"outputTokens":14,"totalTokens":146},"estimatedCost":0,"latencyMs":1180}
```

Note `data` on a `token` event is the raw JSON-encoded _string_ fragment (`"REST"`, with quotes —
`JSON.stringify(delta.content)`), not a `{"content": "..."}` wrapper object — a minor difference
from the spec document's illustrative example, reflecting `formatSseFrame()`'s actual
`JSON.stringify(event.data)` behavior against `StreamEvent.data`'s real union type
(`string | ToolCallData | StreamDoneData | { error: string }`).

---

## Function Calling Deep Dive

### The two-call protocol, step by step

Every tool-augmented turn is **exactly two** LLM calls, never more, never fewer:

1. **Decision call** — `callModel(..., withTools: true)` sends the conversation history plus
   `tools: getToolDefinitions()`. The model either answers directly (no `tool_calls`) or responds
   with `content: null` and one or more `tool_calls`.
2. If (and only if) `tool_calls` came back: **execute them** (concurrently — see below), persist
   each result as a `role: 'tool'` message, then make the **synthesis call** —
   `callModel(..., withTools: false)` — with the tool results now in the message history. This call
   never offers `tools` again; it's asking the model to _use_ the results it already has, not
   decide on more actions.

Both calls go through the identical audited seam (`OpenaiService.chatCompletionWithMessages()`),
so a tool-augmented turn always produces **two** `ai_audit_logs` rows — proven end-to-end by
`chat-function-calling.integration.spec.ts`, which wires real `ChatService`/`ToolRegistryService`/
`ToolExecutorService`/`OpenaiService`/`RetryService`/`AiAuditService`/`TokenService` through a
`TestingModule`, mocking only `DatabaseService` and the `OPENAI_CLIENT` token, and asserts
`dbMock.aiAuditLog.create` is called exactly twice per turn.

### How tool definitions are formatted for OpenAI

`ToolRegistryService.getToolDefinitions()` converts each active `chat_tools` row into the exact
shape OpenAI's `tools` request parameter expects:

```json
{
  "type": "function",
  "function": {
    "name": "calculator",
    "description": "Evaluate a mathematical expression and return the numeric result...",
    "parameters": {
      "type": "object",
      "properties": { "expression": { "type": "string", "description": "..." } },
      "required": ["expression"]
    }
  }
}
```

This is asserted with a literal `toEqual()` in `tool-registry.service.spec.ts` rather than a looser
shape check, because any drift here causes a silent `400` from OpenAI's API, not a caught
TypeScript error.

### How ToolExecutorService dispatches to the right handler

```
execute(toolName, args)
   │
   ├─ toolRegistry.findActiveTool(toolName)   — missing/inactive → { success: false, error: "Tool '...' is not available" }
   │
   ├─ handlerType === 'http'   → executeHttp()    domain whitelist check → HttpService.request() with a timeout
   │
   └─ handlerType === 'builtin' → executeBuiltin()
          │
          └─ builtinHandlers[name]?.(args)   — calculator | datetime | weather, race()'d against a timeout
```

### Multi-tool parallel execution

When the model requests more than one tool call in a single response (e.g. "what's the weather in
London and what time is it there?"), `ChatService.handleToolCalls()` runs every call concurrently:

```typescript
await Promise.all(
  toolCalls.map(async (toolCall) => {
    const args = this.parseToolArguments(toolCall.function.arguments);
    const executionResult = await this.toolExecutorService.execute(toolCall.function.name, args);
    await this.addToolResult(conversation.id, toolCall.id, toolCall.function.name, executionResult);
  }),
);
```

A multi-tool turn's wall-clock time is bounded by the _slowest single tool_, not the sum of all of
them — verified by a test asserting two simultaneous tool calls complete concurrently, not
sequentially.

### Timeout handling

Builtin tools get `chat.toolTimeoutMs` (default `10000`), raced via `Promise.race()`; HTTP tools get
the separate, shorter `chat.httpToolTimeoutMs` (default `5000`), enforced via RxJS's `timeout()`
operator. Both converge on the identical failure string, `'Tool execution timed out'`, fed back to
the model as a normal tool-result failure — never an unhandled rejection.

### Each built-in tool, explained

**Calculator (`mathjs`, never `eval()`)** — `executeCalculator({ expression })` uses `mathjs`'s
`evaluate()` exclusively. This isn't a style preference; it's a hard security boundary. Verified
directly: a malicious input like `alert('x')` throws `mathjs`'s own "Undefined function" error,
since `evaluate()` only understands `mathjs`'s own expression grammar — it has no path to arbitrary
JS execution the way `eval()`/`new Function()` would. Additional guards: 200-character expression
length cap (cheap insurance against pathologically nested input, since the code-execution risk is
already closed by using `mathjs` at all), and a finite-number check that rejects results like
`1/0 → Infinity`.

**Weather (Open-Meteo, no API key)** — `WeatherTool.execute({ city, units })` does two sequential
HTTP calls: geocode the city name to lat/lon (`geocoding-api.open-meteo.com`), then fetch current
conditions at those coordinates (`api.open-meteo.com/v1/forecast`). Neither endpoint requires
authentication — genuinely free and keyless, which is why it was chosen as the demo external-API
tool. Open-Meteo's numeric `weather_code` is translated through a hardcoded WMO lookup table,
falling back to `"Unknown"` for any code not in the table rather than throwing, since `conditions`
is a display string, not a value any caller branches on.

**DateTime (`dayjs`)** — `executeDatetime({ timezone, operation, date1?, date2? })` uses `dayjs`
with the `utc` + `timezone` plugins (already bundled inside the `dayjs` package already installed
in Phase 1, so no new dependency). `operation: 'now'` (the default) returns the current time in the
given IANA timezone; `operation: 'diff'` returns both a coarse whole-day delta and a precise
millisecond delta between two dates, since the spec left the exact diff shape open. An invalid IANA
timezone throws a Node `RangeError` from the underlying `Intl` API internally — both operations
catch this and rethrow a plain `Error('Invalid timezone: ...')`, so `ToolExecutorService` only ever
has one error shape to convert into `{ success: false, error }`.

### HTTP handler tools and domain whitelisting

A `chat_tools` row with `handlerType: 'http'` stores its target in `handlerConfig: { url, method?,
headers? }`. Before `ToolExecutorService` ever issues that request, it resolves the hostname via
`new URL(config.url).hostname` and checks it against `chat.httpToolAllowedDomains` — **fail
closed**: the default is an empty array, so with no configuration at all, _every_ HTTP tool call is
blocked, never silently allowed through. This is the concrete mitigation for the SSRF risk an
open-ended "call any URL the model or a tool registrant supplies" surface would otherwise create —
called out explicitly as a risk in the PRD's Epic 5 section and enforced, not just documented.

---

## Context Window Management Deep Dive

### The problem

Every model has a maximum context window (input + output tokens combined). A conversation that
grows indefinitely will eventually exceed it, and OpenAI's API returns a hard error rather than
silently truncating for you. `ChatService.buildContext()` (`AI-021`) exists to keep every
conversation inside that budget automatically, without ever dropping the system prompt or crashing
on a long-running thread.

### The sliding-window algorithm, step by step

```typescript
async buildContext(conversationId: bigint): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const maxMessages = configService.get('chat.maxContextMessages') ?? 50;
  const contextWindowPercentage = configService.get('chat.contextWindowPercentage') ?? 0.8;
  const defaultContextWindow = configService.get('chat.defaultContextWindow') ?? 128000;

  // 1. Fetch only the most recent `maxMessages` rows (a lighter, capped query),
  //    then reverse to oldest-first.
  const conversation = await db.chatConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: maxMessages } },
  });
  const messages = conversation.messages.slice().reverse();

  // 2. Resolve the model's real context window (falls back to 128,000 if unknown).
  const modelInfo = await modelRegistryService.findModelByModelId(conversation.model);
  const contextWindow = modelInfo?.contextWindow ?? defaultContextWindow;
  const budget = contextWindow * contextWindowPercentage;   // 80% of the window, by default

  // 3. Count the system prompt's tokens (via TokenService — cached tiktoken encoder).
  const systemTokens = conversation.systemPrompt
    ? tokenService.countTokens(conversation.systemPrompt, conversation.model)
    : 0;

  // 4. Trim from the FRONT (oldest first) while more than 1 message remains and the
  //    running total exceeds budget.
  const trimmed = trimToBudget(messages, systemTokens, budget, conversation.model);

  // 5. If even the single last remaining message alone exceeds the budget, truncate its
  //    CONTENT (shrink-by-ratio against real token counts) instead of dropping it entirely.
  // ...

  // 6. The system prompt is always synthesized as a `{ role: 'system' }` entry prepended
  //    to the mapped array — never stored as a ChatMessage row, never counted as "trimmable."
}
```

The trim loop itself:

```typescript
private trimToBudget(messages, systemTokens, budget, model): ChatMessage[] {
  const trimmed = [...messages];
  let total = systemTokens + trimmed.reduce((sum, m) => sum + this.countMessageTokens(m, model), 0);

  while (trimmed.length > 1 && total > budget) {
    const removed = trimmed.shift()!;          // drop the OLDEST remaining message
    total -= this.countMessageTokens(removed, model);
  }

  if (trimmed.length === 1) {
    const only = trimmed[0];
    const remainingBudget = budget - systemTokens;
    if (this.countMessageTokens(only, model) > remainingBudget) {
      only.content = this.truncateContentToBudget(only.content, remainingBudget, model);
    }
  }
  return trimmed;
}
```

### Why 80%, not 100%

`contextWindowPercentage` defaults to `0.8` deliberately, not `1.0` — the context window is shared
between the _input_ (everything sent) and the model's own _output_ (the response it's about to
generate). Filling 100% of the window with input leaves the model no room to answer at all, which
would surface as an API error, not a graceful degradation. Reserving 20% headroom for the response
is the entire reason this number isn't 1.

### What happens when a conversation gets too long

Oldest non-system messages are silently dropped from what's sent to the model — **not
summarized**. This is a deliberate, documented trade-off (PRD's Implementation Decisions): "Context
window management is a sliding window, not summarization... Summarizing dropped history is a
plausible future enhancement but adds an extra LLM call and is not implemented here." The dropped
messages are never deleted from the database — `GET /chat/conversations/:publicId` still returns
the _full_ transcript; only what gets sent _to the model_ on the next turn is windowed.

### How the system prompt is always preserved

The system prompt is never a candidate for trimming at all — it isn't stored as a `ChatMessage` row
in the trimmable set to begin with; it's synthesized fresh as a `{ role: 'system', content }` entry
and prepended to the final array on every single call, entirely outside the `trimToBudget()` loop.
The _only_ way the system prompt's own token cost matters is that it's subtracted from the budget
up front (`budget - systemTokens`) before deciding how many other messages fit — so a very long
system prompt does shrink how much history fits, but the prompt itself is never at risk of being
cut.

### Token counting integration with Phase 1's `TokenService`

Every token count in this algorithm — the system prompt, each candidate message, the final
single-message truncation ratio — goes through Phase 1's `TokenService.countTokens()`, which caches
one `Tiktoken` encoder per model (added specifically because of this call site: `tiktoken`'s
`encoding_for_model()` reloads its full BPE rank table from embedded data on every call, measured at
~110–145ms uncached — a 50-message `buildContext()` call took ~6.5 seconds before the cache was
added; cached `.encode()` calls average ~0.25ms). This is a direct example of Phase 1 code being
extended for a Phase 2 consumer's actual usage pattern, not just reused as-is.

---

## How Phase 1 Services Are Reused

| Phase 1 service        |  Exported from `OpenaiModule`?   | How Phase 2 uses it                                                                                                                                                                                                      |
| ---------------------- | :------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OpenaiService`        |        Yes (pre-existing)        | Extended with `chatCompletionWithMessages()`; every non-streaming `ChatService` call routes through it.                                                                                                                  |
| `TokenService`         |        Yes (pre-existing)        | `buildContext()`'s sliding-window token math; `calculateCost()` for every assistant message and streamed turn.                                                                                                           |
| `AiAuditService`       |        Yes (pre-existing)        | Automatic for non-streaming calls (inside `chatCompletionWithMessages()`); called directly, once, by `sendMessageStream()`.                                                                                              |
| `ModelRegistryService` |        Yes (pre-existing)        | `findModelByModelId()` supplies `contextWindow` for the sliding-window budget.                                                                                                                                           |
| `RetryService`         |        **No** (unchanged)        | Reused transitively through `OpenaiService` for every non-streaming call. **Never used by `StreamingService`** — a mid-stream failure surfaces as an `error` event, not a silent retry.                                  |
| `OPENAI_CLIENT`        | **New export, added in Phase 2** | Injected directly by `StreamingService` — the sole exception to "only `OpenaiService` touches the SDK," justified because streaming's `AsyncGenerator` return shape can't fit `OpenaiService`'s `Promise`-based methods. |

### The "never call the SDK directly" rule, and how it's enforced

Phase 1 established the rule; Phase 2 had one legitimate reason to bend it (streaming's return
shape) and made that exception structurally narrow and explicit rather than informal:

- `OPENAI_CLIENT` is exported from `OpenaiModule` specifically so `StreamingService` can inject it
  — nothing else in `AiChatModule` does. `ChatService`, `ToolRegistryService`, and
  `ToolExecutorService` have zero knowledge of the SDK's existence.
- Every other Phase 2 code path — the two-call function-calling flow, plain single-turn chat, model
  comparisons — goes through `OpenaiService.chatCompletionWithMessages()`, inheriting retry,
  circuit-breaker, and audit logging automatically, with no way to accidentally bypass them.
- The rule isn't enforced by a lint rule or a dependency-cruiser config today — it's enforced by
  code review and by `OpenaiModule`'s narrow `exports` array (only 5 symbols, deliberately not the
  whole module) making the "correct" import path the path of least resistance.

---

## Constants & Enums Reference

| Enum / Constant      | Values                                                                                         | Used for                                                                                                                                                                     | Notes                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatMessageRole`    | `SYSTEM`, `USER`, `ASSISTANT`, `TOOL`                                                          | `ChatMessage.role`; drives `toChatCompletionMessageParam()`'s branching when rebuilding SDK-shaped messages.                                                                 | Stored as a plain string column, not a Postgres enum — matches Phase 1's `AiAuditStatus`/`OpenAIEndpoint` convention of enum-in-code, string-in-DB.                          |
| `ToolHandlerType`    | `BUILTIN`, `HTTP`                                                                              | `ChatTool.handlerType`; `ToolExecutorService.execute()`'s top-level dispatch branch.                                                                                         | A third handler type (e.g. an internal-function-registry type distinct from the hardcoded builtin map) isn't needed yet — only these two exist.                              |
| `StreamEventType`    | `TOKEN`, `TOOL_CALL`, `TOOL_RESULT`, `DONE`, `ERROR`                                           | `StreamEvent.type`; the SSE `event:` field name via `formatSseFrame()`.                                                                                                      | **`TOOL_RESULT` is defined but never emitted** — see the SSE Deep Dive's "known gap." Reserved for when streaming gains tool execution.                                      |
| `ConversationStatus` | `ACTIVE`, `ARCHIVED`                                                                           | Documented in the constants barrel; **not actually referenced anywhere in the codebase today** — `ChatConversation.isArchived` is a plain boolean, not a status enum column. | A vestige of an earlier design; worth removing or actually wiring up if a third status is ever needed (e.g. `DELETED` for soft-delete).                                      |
| `CONTEXT_CONFIG`     | `{ maxMessages: 50, contextWindowPercentage: 0.8, defaultContextWindow: 128000 }`              | Fallback defaults for `buildContext()`, used only where `ConfigService` isn't available or a value is unset.                                                                 | `ChatService` prefers reading live `chatConfig` via `ConfigService` at call sites — this constant is the same fallback-alongside-config pattern as Phase 1's `RETRY_CONFIG`. |
| `BUILTIN_TOOLS`      | `calculator`, `weather`, `datetime` (name/displayName/description/parameters/handlerType each) | Seed data upserted by `ToolRegistryService.onModuleInit()` on every boot.                                                                                                    | JSON Schema `parameters` copied verbatim from the spec's §8.2 examples.                                                                                                      |

---

## Environment Variables

| Variable                         | Required | Default                              | Controls                                                                                                                     |
| -------------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `CHAT_MAX_CONTEXT_MESSAGES`      | No       | `50`                                 | How many of the most recent messages `buildContext()` fetches from the DB before trimming further by token budget.           |
| `CHAT_CONTEXT_WINDOW_PERCENTAGE` | No       | `0.8`                                | Fraction of the model's context window the sliding window trims down to — the rest is headroom for the model's own response. |
| `CHAT_TOOL_TIMEOUT_MS`           | No       | `10000`                              | Timeout for builtin tool execution (`calculator`, `datetime`, `weather`), raced via `Promise.race()`.                        |
| `CHAT_HTTP_TOOL_TIMEOUT_MS`      | No       | `5000`                               | Timeout for `handlerType: 'http'` tool calls, enforced via RxJS's `timeout()` operator.                                      |
| `CHAT_AUTO_TITLE`                | No       | `true`                               | Whether `addUserMessage()` auto-generates a conversation title from the first message when `title` is still `null`.          |
| `CHAT_TOOL_HTTP_ALLOWED_DOMAINS` | No       | `[]` (empty — blocks all HTTP tools) | Comma-separated hostname whitelist checked before any `handlerType: 'http'` tool call is issued. **Fails closed**, not open. |

All six are read exclusively through `ConfigService`'s `chat` namespace
(`configService.get<number>('chat.maxContextMessages')`, etc.), never `process.env` directly, and
all six are `@IsOptional()` in `env.validation.ts` since every one has a code-level default — a
fresh clone with zero `CHAT_*` variables set behaves identically to one with them explicitly set to
their defaults.

`defaultContextWindow` (`128000`) is the one exception — it's a hardcoded constant in
`CONTEXT_CONFIG`/`chatConfig`, not backed by its own env var, since it's a fallback used only when
`ModelRegistryService` doesn't know the model's real context window at all (e.g. a brand-new
OpenRouter model not yet synced).

---

## How to Explain This to Others

**One-liner:**

> Phase 2 turns Phase 1's one-shot "ask a question, get an answer" API into a real multi-turn chat
> system — with persistent conversations, live token-by-token streaming, and the ability for the
> model to call real tools (a calculator, live weather, current date/time) instead of just talking.

**30-second version:**

> Phase 1 gave us a reliable way to place one call to an LLM. Phase 2 builds an actual chat product
> on top of it: conversations and messages are persisted in Postgres, a sliding-window algorithm
> keeps long conversations inside the model's context limit without ever losing the system prompt,
> responses can stream back over Server-Sent Events instead of arriving all at once, and — the big
> new capability — the model can request real tool calls (calculator, weather, date/time, or your
> own registered HTTP endpoint), which the server executes safely with timeouts and domain
> whitelisting, feeds the real result back, and lets the model write its final answer from actual
> data instead of a guess. Every single LLM call, streaming or not, tool-augmented or not, still
> goes through Phase 1's retry, circuit-breaker, and audit-logging pipeline — nothing in this phase
> talks to OpenAI's SDK directly except the one service that has no other choice (streaming).

**2-minute version:**

> Phase 2 adds a new `AiChatModule` with four services on top of Phase 1's `OpenaiModule`.
> `ChatService` is the orchestrator: it owns conversation and message CRUD, and its `buildContext()`
> method implements a sliding-window algorithm that keeps a growing conversation inside 80% of the
> model's context window (leaving headroom for the response) by trimming the oldest messages first
> and — as a last resort — truncating a single oversized message, while the system prompt is never
> at risk since it's synthesized fresh on every call rather than stored as a trimmable message.
>
> `StreamingService` is the one place in the whole codebase that calls the OpenAI SDK with
> `stream: true` directly — it has to, because streaming returns an `AsyncGenerator`, a
> fundamentally different shape than Phase 1's `Promise`-based methods. It translates OpenAI's raw
> chunk format into simple internal events (`token`, `tool_call`, `error`), and the controller
> streams those out as Server-Sent Events. Client disconnects are detected on the _response_
> object's `close` event (not the request's — a real bug we hit and fixed after live testing showed
> the request's close event can fire before we even attach a listener), which aborts the upstream
> OpenAI call and persists whatever content had already streamed as a partial, `incomplete: true`
> message.
>
> Function calling — `ToolRegistryService` and `ToolExecutorService` — implements OpenAI's two-call
> protocol: the model first decides which tool(s) to call, the server executes them (concurrently
> if there's more than one, each with its own timeout), and a second LLM call synthesizes the tool
> results into a final natural-language answer. Every tool execution is sandboxed to never throw —
> a broken tool returns a structured failure that the model can talk around, never a crashed
> request. The three built-in tools (`mathjs`-based calculator — deliberately never `eval()`,
> Open-Meteo weather, `dayjs`-based date/time) all need zero API keys, and custom tools can be
> registered as data (a JSON Schema + either a builtin name or a whitelisted HTTP endpoint) with no
> deploy required.
>
> The one piece of Phase 1 that had to change to make any of this possible: `OpenaiService` gained
> a new method, `chatCompletionWithMessages()`, that accepts a full message array and an optional
> `tools` parameter instead of Phase 1's single `prompt` string — but it shares the exact same
> retry/audit/cost pipeline as the original `chatCompletion()`, so every guarantee Phase 1 built
> (resilience, cost tracking, observability) carries over to every Phase 2 call pattern automatically.

---

## Implementation Stats

- **Issues completed:** 21 (`AI-015` through `AI-035`), all marked `completed` — combined with
  Phase 1's 14, all 35 issues across both PRDs are now done. See `docs/issues/index.md`.
- **Services:** 4 new (`ChatService`, `StreamingService`, `ToolRegistryService`,
  `ToolExecutorService`) plus one extended (`OpenaiService.chatCompletionWithMessages()`), plus
  1 injectable tool implementation (`WeatherTool`) and 2 plain-function tools (`calculator`,
  `datetime`).
- **API endpoints:** 12, across 3 groups (conversations, messages — sync + SSE, tools) — all under
  `/api/v1/chat`.
- **Database tables added:** 3 (`chat_conversations`, `chat_messages`, `chat_tools`), on top of
  Phase 1's `ai_audit_logs`/`prompt_templates`/`ai_providers`/`ai_models`.
- **Built-in tools:** 3 (`calculator`, `weather`, `datetime`), auto-seeded on every boot via
  `ToolRegistryService.onModuleInit()`.
- **New npm dependency:** `mathjs` (calculator tool). `dayjs` was already installed from Phase 1
  but unused until this phase.
- **Unit + integration tests:** 155 passing across 11 spec files in
  `src/modules/ai-chat/__tests__/`, bringing the full repo suite from 250 (Phase 1 only) to 271
  passing tests overall, with zero changes to any Phase 1 spec file's assertions:

  | Spec file                                   | Tests |
  | ------------------------------------------- | ----- |
  | `chat.service.spec.ts`                      | 52    |
  | `tool-registry.service.spec.ts`             | 17    |
  | `chat.controller.spec.ts`                   | 19    |
  | `chat-dtos.spec.ts`                         | 13    |
  | `tool-executor.service.spec.ts`             | 13    |
  | `streaming.service.spec.ts`                 | 10    |
  | `datetime.tool.spec.ts`                     | 10    |
  | `calculator.tool.spec.ts`                   | 7     |
  | `weather.tool.spec.ts`                      | 7     |
  | `sse-frame.util.spec.ts`                    | 4     |
  | `chat-function-calling.integration.spec.ts` | 3     |

- **Live smoke-tested end to end** (`AI-035`), not just unit-tested: streaming, disconnect handling
  (`psql`-confirmed `incomplete: true` + `FAILED` audit row), calculator function-calling, and the
  full audit trail all verified against a real running server, real Postgres, and the real
  OpenRouter API — with one genuine finding (Open-Meteo's two sequential calls can exceed the
  default 10s tool timeout under adverse network conditions) logged for future tuning rather than
  treated as a blocking defect.
