# AI Product Integration — Hands-On Testing Scenarios

> **Purpose:** Walk through every feature yourself, observe how it works, and understand why.
> **Prerequisite:** Both servers running — BE on :3000, FE on :5173
> **Time:** 2–3 hours for all scenarios

---

## How to Use This Guide

Each scenario follows this format:

- **Do** — exact steps to perform
- **Observe** — what you should see and why
- **Learn** — what this teaches you about AI integration

Go in order — later scenarios build on earlier ones.

---

## Part 1: OpenAI API Foundations (Phase 1)

### Scenario 1.1: Your First AI Call

**Do:**

1. Open the FE at http://localhost:5173
2. Go to **Chat Playground** (`/chat`)
3. Click **"New Chat"**
4. In the model selector, pick any free model (e.g. `google/gemma-3-27b-it:free`)
5. Type: `What is a REST API? Explain in 2 sentences.`
6. Click Send (with streaming OFF first)

**Observe:**

- The response appears all at once (not word-by-word)
- Below the response bubble you see: model name, token count, cost ($0.00 for free), latency (ms)
- The conversation now has 2 messages: your question (right/blue) and the AI's answer (left/gray)

**Learn:**

- This is a **chat completion** — the most basic AI API call
- Every call returns metadata: tokens used, cost, how long it took
- Free models return `$0.00` cost because they're not in the pricing database
- The latency you see is the TOTAL time: your server → OpenRouter → AI model → back

---

### Scenario 1.2: Streaming vs Non-Streaming

**Do:**

1. In the same conversation, toggle **Streaming ON** (the switch near the input)
2. Type: `Write me a short poem about programming`
3. Watch the response appear

**Observe:**

- Words appear **one by one** in real time — like someone typing
- The response builds up gradually instead of appearing all at once
- After the last word, the usage stats (tokens, cost, latency) appear

**Learn:**

- **Streaming** uses Server-Sent Events (SSE) — the server pushes data to the client as the AI generates it
- Without streaming, you wait for the ENTIRE response before seeing anything (bad UX for long responses)
- The final text is identical whether you stream or not — streaming is a UX improvement, not a different answer
- Every real AI chat product (ChatGPT, Claude) uses streaming — this is why they feel "alive"

---

### Scenario 1.3: Temperature — Creativity Control

**Do:**

1. Create a new conversation
2. In settings (right panel), set **Temperature to 0**
3. Type: `Give me a one-word name for a coffee shop`
4. Note the answer
5. Send the **exact same message** again
6. Note the answer — it should be the same or very similar
7. Now change **Temperature to 1.5**
8. Send the same message 3 times

**Observe:**

- At temperature 0: responses are nearly identical every time (deterministic)
- At temperature 1.5: responses are different each time (creative, sometimes weird)

**Learn:**

- **Temperature** controls randomness in the AI's word selection
- 0 = always picks the most probable next word (consistent, boring)
- 1 = balanced between likely and unlikely words
- 2 = picks from improbable words too (creative but sometimes nonsensical)
- Use 0 for factual tasks (classification, extraction). Use 0.7–1.0 for creative tasks

---

### Scenario 1.4: Token Counting — Understanding Costs

**Do:**

1. Go to **Token Calculator** (`/tokens`)
2. Paste this text: `Hello world`
3. Select model: `gpt-4o`
4. Note the token count

**Observe:**

- "Hello world" = **2 tokens** (not 2 words, not 11 characters — 2 tokens)
- Character count shows 11

**Now do:** 5. Paste a long paragraph (copy any paragraph from this document) 6. Note the token count

**Observe:**

- Roughly 1 token ≈ 4 characters in English
- But it's not exact — `tiktoken` uses a specific algorithm (byte-pair encoding)

**Now do:** 7. Switch to a free model like `google/gemma-3-27b-it:free` 8. Note the token count changes (it shows a heuristic estimate instead of exact count)

**Observe:**

- For non-OpenAI models, the app falls back to `Math.ceil(characters / 4)` because `tiktoken` only knows OpenAI's tokenizer
- The count will be different (and less accurate) than the gpt-4o count

**Learn:**

- AI models charge **per token**, not per word or character
- Token counting is essential for cost estimation and staying within context window limits
- Different models may tokenize differently — tiktoken is OpenAI-specific
- This is why `TokenService` has both `countTokens()` (exact) and `estimateTokens()` (heuristic)

---

### Scenario 1.5: Model Comparison — Finding the Right Model

**Do:**

1. Go to **Model Comparison** (`/compare`)
2. Enter prompt: `Explain what a database index is in 3 sentences`
3. Select 2 models: one free (e.g. `google/gemma-3-27b-it:free`) and one you know
4. Click Compare

**Observe:**

- Both models answer the same question but differently
- Compare: response quality, token count, cost, latency
- The free model costs $0.00, the paid model shows actual cost
- Latency may differ significantly

**Learn:**

- Model selection is a **quality vs cost vs speed tradeoff**
- This is exactly what the goal doc means by "Model selection (GPT-4, GPT-4o)"
- In production, you'd test your actual prompts across models before committing
- The `/compare` endpoint calls both models in parallel (`Promise.all`) for fairness

---

### Scenario 1.6: Prompt Templates — Reusable AI Instructions

**Do:**

1. Go to **Prompt Templates** (`/templates`)
2. Find the `ticket-classifier` template
3. Note its system prompt, technique (few-shot), and few-shot examples
4. Go back to Chat, create a new conversation
5. In the system prompt field, paste the ticket-classifier's system prompt
6. Type: `My login keeps failing with error code 401`
7. Note the response

**Now do:** 8. Go back to templates 9. Create a new template:

- Name: `json-responder`
- System prompt: `You are an API. Always respond with valid JSON only. No other text.`
- Technique: `structured-output`
- Temperature: `0`

10. Create a new chat with this system prompt
11. Type: `Give me info about the planet Mars`

**Observe:**

- The ticket classifier categorizes your message (probably "BUG" or "TECHNICAL")
- The JSON responder returns pure JSON (no "Sure! Here's..." preamble)
- System prompts dramatically change the model's behavior with the same user input

**Learn:**

- **System prompts** are hidden instructions that shape all model responses
- **Few-shot examples** teach the model by showing correct input/output pairs
- Templates make prompts reusable — no copy-pasting across conversations
- Temperature 0 + structured output = consistent, parseable responses (great for APIs)

---

### Scenario 1.7: Audit Logs — Seeing Everything

**Do:**

1. Go to **Audit Logs** (`/audit-logs`)
2. Look at the entries — every API call you made in previous scenarios is logged here
3. Filter by Status: `FAILED` — see any failed calls
4. Filter by a specific model — see only calls to that model
5. Click a row to expand and see the full request/response

**Observe:**

- Every single AI call is recorded — who made it, which model, tokens, cost, latency, success/failure
- Failed calls show the error code (429 = rate limited, 500 = server error, etc.)
- Retry count shows if the system retried before succeeding or giving up

**Now do:** 6. Go to the **Dashboard** (`/`) 7. Look at the stats: total calls, total cost, average latency 8. Look at the cost-by-model chart

**Learn:**

- **Audit logging** is the "Log Everything" practice from the goal doc
- This is how you answer: "How much did AI cost us this week?" or "Why did this call fail?"
- The audit log is **append-only** — entries are never edited or deleted (trustworthy history)
- The dashboard's cost summary comes from aggregating these same audit log entries

---

### Scenario 1.8: Circuit Breaker — Resilience Testing

**Do:**

1. Look at the top-right corner of the FE — you should see a green **"Operational"** badge
2. Go to Dashboard — check the System Status card shows "Circuit breaker: Operational"

**Observe:**

- This means the circuit breaker is **CLOSED** — normal operation, all calls go through
- If OpenRouter had 5 consecutive failures, this would change to **OPEN** (red)
- After 60 seconds it would change to **HALF_OPEN** (amber) — one test call allowed

**Learn:**

- The **circuit breaker** protects against cascading failures
- Without it: if OpenRouter is down, every user request would wait through 5 retry attempts before failing
- With it: after detecting the outage, all requests fail immediately (fast) until the service recovers
- This is tested automatically — `RetryService` tracks consecutive failures internally

---

## Part 2: Chat, Streaming & Function Calling (Phase 2)

### Scenario 2.1: Multi-Turn Conversation

**Do:**

1. Create a new conversation
2. Send: `My name is Yash`
3. Send: `What is my name?`

**Observe:**

- The AI remembers your name! It says "Your name is Yash"
- This is different from Phase 1's single-shot chat (which had no memory)

**Now do:** 4. Send 5-10 more messages in the same conversation 5. Click on the conversation in the left sidebar — it shows all messages in order 6. Each assistant message shows tokens, cost, latency

**Learn:**

- **Multi-turn conversation** works by sending the ENTIRE message history to the model on every turn
- The model doesn't actually "remember" — it reads all previous messages each time
- This is why conversations get more expensive over time — more tokens sent as history grows
- `ChatService.buildContext()` assembles this history from the database on every call

---

### Scenario 2.2: Context Window — What Happens When History Gets Too Long

**Do:**

1. Create a new conversation
2. Set system prompt to: `You are a helpful assistant. Always start your response with "SYSTEM PROMPT ACTIVE:"`
3. Send a long message — paste a very long text (500+ words)
4. Send 10-20 more normal messages
5. Check: does the AI still start responses with "SYSTEM PROMPT ACTIVE:"?

**Observe:**

- Even after many messages, the system prompt is preserved (AI still follows it)
- The app uses a **sliding window** — old messages are dropped but the system prompt always stays

**Learn:**

- Every AI model has a **context window** — maximum tokens it can process at once
- Our app uses 80% of the model's context window (leaving 20% for the response)
- When the conversation exceeds this, the oldest messages are removed (system prompt is never removed)
- Without this, long conversations would crash with an API error
- `ChatService.buildContext()` handles this automatically using `TokenService.countTokens()`

---

### Scenario 2.3: Function Calling — Calculator

**Do:**

1. Create a new conversation
2. Toggle **Tools: Enabled** in the conversation settings
3. Type: `What is 234 multiplied by 567?`

**Observe:**

- A **tool call card** appears: "🔧 Calculator" with input `234 * 567`
- The tool result shows: `132678`
- Then the AI's final response synthesizes: "234 × 567 = 132,678"
- The message shows higher token count than a normal response (two LLM calls happened)

**Learn:**

- **Function calling** lets the AI use tools instead of guessing
- Without the calculator tool, the AI might give a wrong answer (LLMs are bad at math)
- The process is: (1) AI decides to call a tool → (2) server executes the tool → (3) AI gets the result → (4) AI writes a natural language answer
- This is **two LLM calls** — one to decide the tool, one to synthesize. Both are in the audit log
- The calculator uses `mathjs` (safe) — never `eval()` (dangerous, could execute arbitrary code)

---

### Scenario 2.4: Function Calling — Weather

**Do:**

1. In the same tools-enabled conversation, type: `What's the weather in Ahmedabad right now?`

**Observe:**

- A tool call card appears: "🔧 Weather" with input `{ city: "Ahmedabad" }`
- The result shows temperature, humidity, wind speed from Open-Meteo
- The AI synthesizes a natural weather report

**Note:** This may time out on slow connections (10-second tool timeout). If it does, try again or try a different city. The timeout behavior is intentional — the tool returns an error to the model, which tells you it couldn't fetch the data.

**Learn:**

- The weather tool calls a real external API (Open-Meteo) — no API key needed
- This demonstrates function calling against a **live external service**
- The AI doesn't know the weather itself — it uses the tool to get real data
- Geocoding (city name → lat/lon) happens internally before the weather API call

---

### Scenario 2.5: Function Calling — Multi-Tool

**Do:**

1. Type: `What's 15% of 2499 and what's the current time in London?`

**Observe:**

- TWO tool call cards appear: Calculator AND DateTime
- Both execute (check if they appear almost simultaneously — they run in parallel)
- The AI combines both results into one coherent answer

**Learn:**

- The AI can request **multiple tools** in a single response
- Our app runs them in **parallel** (`Promise.all`) — not one after another
- This means 2 tool calls take the same time as the slowest single tool, not the sum
- Parallel execution is important for UX — sequential would feel much slower

---

### Scenario 2.6: Function Calling — Error Handling

**Do:**

1. Type: `What's the weather on the moon?`

**Observe:**

- The weather tool tries to geocode "moon" — Open-Meteo returns no results
- The tool result shows an error: "Could not find location"
- The AI gracefully tells you it couldn't get the weather for the moon

**Now do:** 2. Type: `Calculate the result of 1/0`

**Observe:**

- The calculator returns `Infinity` (mathjs handles division by zero)
- The AI explains the result

**Learn:**

- Tool errors don't crash the conversation — they're returned TO the model as context
- The model then explains the error in natural language to the user
- This is the "tool execution is isolated" design principle from the spec
- Every tool has a timeout (10s for builtin, 5s for HTTP) — hanging tools don't hang the conversation

---

### Scenario 2.7: Streaming + Function Calling Together

**Do:**

1. Make sure Streaming is ON and Tools are ENABLED
2. Type: `What is 100 factorial?`

**Observe:**

- In streaming mode, the tool call card appears but may stay at "Running..."
- Note: this is a known limitation — streaming mode doesn't fully execute tool calls in the current implementation
- Switch to non-streaming mode and try again — it works correctly

**Learn:**

- Streaming + function calling is complex — the stream yields tool_call events but the execution and synthesis loop needs the full response
- This is documented in AI-029's implementation notes as a known gap
- In production apps, you'd either handle this in the streaming handler or fall back to sync for tool calls

---

### Scenario 2.8: Conversation Management

**Do:**

1. Create 3-4 conversations with different topics
2. In the sidebar, observe: each conversation shows title, model, time
3. Right-click a conversation → **Rename** → give it a custom title
4. Right-click another → **Archive** — it disappears from the list
5. Right-click another → **Delete** — confirm deletion

**Observe:**

- Archived conversations are hidden (not deleted — data preserved)
- Deleted conversations are gone along with ALL their messages (cascade delete)
- Auto-generated titles come from the first message (first 50 chars + "...")

**Learn:**

- Conversations are **persistent** — stored in the database, not just browser memory
- Cascade delete means deleting a conversation removes all messages (no orphaned data)
- Archive vs Delete: archive is reversible (data stays), delete is permanent

---

### Scenario 2.9: Tool Registry — Managing AI Capabilities

**Do:**

1. Go to **Tools** (`/tools`)
2. See the 3 built-in tools: Calculator, Weather, DateTime
3. Note each has: name, description, handler type (builtin), active status
4. Toggle one tool OFF (e.g. Weather)
5. Go to Chat, create a tools-enabled conversation
6. Ask about the weather — the AI should say it can't do that (tool is disabled)
7. Go back to Tools, toggle Weather back ON

**Learn:**

- Tools are stored in the database — they can be managed without code changes
- `ToolRegistryService.getToolDefinitions()` only sends active tools to the model
- The AI adapts based on what tools are available — disable a tool and it stops trying to use it
- This is how you'd add new capabilities in production: register a tool via API, no redeploy needed

---

## Part 3: Model Registry & Pricing

### Scenario 3.1: Exploring 340+ Models

**Do:**

1. Go to **Models** (`/models`)
2. Note the sync status: "340 models from 56 providers"
3. Click the **Free** tab — see only free models
4. Click the **Paid** tab — see paid models with pricing
5. Search for "llama" — filter results
6. Filter by provider (e.g. Google, Meta)

**Learn:**

- All 340+ models are auto-synced from OpenRouter's public API (daily at 3 AM)
- Models have: tier (free/paid), pricing, context window, provider, source (synced vs manual)
- You can use ANY of these in your chat conversations by typing the model ID

---

### Scenario 3.2: Cost Calculator

**Do:**

1. Go to **Pricing** (`/pricing`)
2. In the Cost Calculator section, select `gpt-4o`
3. Enter: 10,000 input tokens, 5,000 output tokens
4. See the calculated cost
5. Now select `gpt-4o-mini` with the same tokens
6. Compare the costs
7. Try a free model — cost should be $0.00

**Observe:**

- GPT-4o: ~$0.075 for 10K input + 5K output
- GPT-4o-mini: ~$0.0045 for the same — **16x cheaper**
- Free models: $0.00

**Learn:**

- Model pricing varies by **200x** from cheapest to most expensive
- Cost calculation: `(tokens / 1,000,000) × price_per_million`
- This is why model selection matters — the same task on different models can cost $0 or $5

---

## Part 4: Cross-Cutting Concerns

### Scenario 4.1: Audit Trail for Tool Calls

**Do:**

1. Create a tools-enabled conversation
2. Send: `What is 42 * 17?`
3. Go to **Audit Logs** (`/audit-logs`)
4. Look at the most recent entries

**Observe:**

- There are **2 audit log entries** for this one user message:
  1. First call: the model decided to use the calculator tool
  2. Second call: the model synthesized the tool result into natural language
- Both entries have their own token counts, costs, and latency

**Learn:**

- Function calling creates **2 LLM calls** — both are audited separately
- This means tool-enabled conversations cost roughly 2x per message (important for budgeting)
- The audit log gives you full transparency — no hidden costs
- This is FR-CH-010: "Every LLM call MUST be logged via Phase 1's AiAuditService"

---

### Scenario 4.2: Error Handling End-to-End

**Do:**

1. In the chat model selector, type a completely invalid model: `this/does-not-exist:free`
2. Send a message

**Observe:**

- A toast error appears with a clear error message (not a raw stack trace)
- The conversation is still usable — the error doesn't break it
- Check Audit Logs — the failed call is logged with status `FAILED` and error details

**Now do:** 3. Switch to a valid model and send a message — it works again

**Learn:**

- Errors are caught at every level: SDK → RetryService → OpenaiService → Controller → FE toast
- Failed calls are logged (debugging) but don't crash the conversation (resilience)
- The `HttpExceptionFilter` in the BE converts all errors to a consistent JSON shape

---

### Scenario 4.3: Glossary — Self-Assessment

**Do:**

1. Go to **Glossary** (`/glossary`)
2. Read through Section 1: Concepts
3. For each concept marked "Implemented" — can you explain:
   - What it is in plain English?
   - Where in YOUR codebase it's implemented?
   - Why it matters?
4. Read Section 2: Tools & Libraries
5. For each tool marked "Phase 1 ✅" or "Phase 2 ✅" — can you explain what it does and why you chose it?
6. Read Section 5: API Parameters Reference
7. For each parameter we USE — do you know what happens if you change it?

**Learn:**

- If you can explain every green-badge concept to someone else, you've internalized Phase 1 & 2
- If any concept feels unclear, go back to the explanation docs or re-run the relevant scenario above
- The "Planned" concepts are what you'll learn in Phases 3 & 4

---

## Summary Checklist

After completing all scenarios, you should be able to explain:

### Phase 1 Concepts

- [ ] What is a chat completion and how does the API call work
- [ ] What are tokens and why they matter for cost
- [ ] How temperature controls AI behavior
- [ ] What exponential backoff is and when it triggers
- [ ] What a circuit breaker does and its 3 states
- [ ] Why audit logging is fire-and-forget
- [ ] How prompt templates work and the 6 techniques
- [ ] How the OpenAI SDK works with non-OpenAI providers (baseURL)

### Phase 2 Concepts

- [ ] How multi-turn conversations work (full history sent each time)
- [ ] What streaming (SSE) is and why it matters for UX
- [ ] How function calling works (the two-call protocol)
- [ ] Why parallel tool execution matters
- [ ] How the context window sliding algorithm works
- [ ] Why messages are append-only
- [ ] How tool errors are handled without crashing

### Architecture

- [ ] Why all AI calls go through OpenaiService (never direct SDK)
- [ ] How Phase 2 reuses Phase 1's retry, audit, and token services
- [ ] Why the calculator uses mathjs instead of eval()
- [ ] What cascade delete means for conversations and messages
- [ ] How the model registry auto-syncs 340+ models from OpenRouter

---

_Once you've checked off everything above, you're ready for Phase 3: RAG with Pinecone and LangChain._
