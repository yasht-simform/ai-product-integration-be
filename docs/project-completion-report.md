# Project Completion Report: AI Product Integration

**Goal Document**: `G3_AI_Product_Integration.pdf`
**Project**: NestJS backend + React frontend implementing LLM chat, embeddings, RAG, and content
moderation via OpenAI, Pinecone, and OpenRouter.
**Status**: Complete — all 4 phases (75 issues) plus the capstone integration are done.

---

## 1. Executive Summary

This project builds a production-grade, full-stack AI integration platform from scratch across
four phases: OpenAI API foundations (retry/circuit-breaker/audit logging), multi-turn chat with
streaming and function calling, vector search & RAG with a real embedded knowledge base, and a
safety/governance layer (content moderation, per-user cost budgets, cost analytics, automated data
retention). The capstone ties all four phases together into one demoable product — App 1 from the
goal document, **Knowledge Base Q&A** — seeded with 50 real documents and 250 Q&A pairs, proven end
to end with a live evaluation run scoring **70% overall / 83% simple-question accuracy**. The key
outcome isn't just that each phase works in isolation: it's that a RAG-grounded chat turn, a
budget-enforced API call, and a moderation-checked question all flow through the exact same
audited, retried, cost-tracked pipeline — one platform, not four bolted-together demos.

## 2. Goal Alignment

| Goal Document Item                                           | Status  | Where                                                                        |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| OpenAI API Basics (chat completions, retry, circuit breaker) | ✅ Done | `OpenaiModule`, Phase 1                                                      |
| Token counting & cost tracking                               | ✅ Done | `TokenService`, `AiAuditService`                                             |
| Prompt engineering (6 techniques)                            | ✅ Done | `PromptTemplateService`, `POST /openai/prompt-test`                          |
| Model registry & multi-provider support                      | ✅ Done | `ModelRegistryService`, `OpenRouterSyncService` (340+ models, 56+ providers) |
| LLM Integration Patterns (multi-turn chat)                   | ✅ Done | `AiChatModule`, `ChatService`, Phase 2                                       |
| Streaming responses (SSE)                                    | ✅ Done | `StreamingService`                                                           |
| Function calling (3 built-in tools)                          | ✅ Done | `ToolExecutorService` — calculator, datetime, weather                        |
| Vector Search & RAG                                          | ✅ Done | `RagModule`, Phase 3 — Pinecone + `text-embedding-3-small`                   |
| Document ingestion (PDF/TXT/MD, chunking)                    | ✅ Done | `DocumentService` (LangChain `RecursiveCharacterTextSplitter`)               |
| RAG with citations                                           | ✅ Done | `RagService.query()` / `queryWithConversation()`                             |
| Mock data & evaluation pipeline                              | ✅ Done | `MockDataService` — faker-based + 50 hand-written CloudPulse docs            |
| Safety & Compliance                                          | ✅ Done | `ModerationModule` + `CostManagementModule`, Phase 4                         |
| Content moderation (input guard + output interceptor)        | ✅ Done | `ModerationGuard`, `OutputModerationInterceptor`                             |
| Per-user cost budgets with enforcement                       | ✅ Done | `CostBudgetGuard` — 429 on exceeded                                          |
| Cost analytics (by user/model/feature/timeline)              | ✅ Done | `CostAnalyticsService`                                                       |
| Automated data retention                                     | ✅ Done | `RetentionService` — dynamic cron, batched deletes                           |
| Practice App 1: Knowledge Base Q&A                           | ✅ Done | Full RAG pipeline + capstone dataset                                         |
| Practice App 2: AI Chat Assistant                            | ✅ Done | Multi-turn chat + streaming + tools                                          |
| Practice App 3: Content Moderation                           | ✅ Done | Moderation tester, logs, stats page                                          |
| Tool: OpenAI SDK                                             | ✅      | `openai` npm package                                                         |
| Tool: Pinecone                                               | ✅      | `@pinecone-database/pinecone`                                                |
| Tool: LangChain                                              | ✅      | `@langchain/textsplitters`, `@langchain/community` (PDF loading)             |
| Tool: OpenRouter                                             | ✅      | 340+ models auto-synced daily                                                |
| Key Practice: System prompts                                 | ✅      | Every chat/RAG call carries a system prompt                                  |
| Key Practice: Exponential backoff                            | ✅      | `RetryService` — backoff + jitter + circuit breaker                          |
| Key Practice: Test prompt variations                         | ✅      | `PromptTemplateService`, `POST /openai/prompt-test`                          |
| Key Practice: Log everything                                 | ✅      | `AiAuditService`, `ModerationService` — every call audited                   |
| Key Practice: Cache embeddings                               | ✅      | `EmbeddingCacheService` — SHA-256-keyed dedup cache                          |

**100% of the goal document is covered.**

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              React Frontend (Vite)                          │
│   Dashboard · Chat · Knowledge Base · Compare · Templates · Tokens ·         │
│   Models · Pricing · Tools · Moderation · Cost Management · Retention ·      │
│   Audit Logs · Glossary                                                      │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                    │ REST (api/v1) + SSE
┌───────────────────────────────────▼───────────────────────────────────────────┐
│                            NestJS Backend                                     │
│                                                                                │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────────┐ │
│  │  OpenaiModule │◄──│ AiChatModule │◄──│  RagModule  │◄──│ CapstoneModule   │ │
│  │  (Phase 1)    │   │  (Phase 2)   │   │  (Phase 3)  │   │  (this project)  │ │
│  │               │   │              │   │             │   │                  │ │
│  │ OpenaiService │   │ ChatService  │   │ DocumentSvc │   │ CapstoneService  │ │
│  │ RetryService  │   │ StreamingSvc │   │ SearchSvc   │   │  → composes      │ │
│  │ TokenService  │   │ ToolExecutor │   │ RagService  │   │    every module   │ │
│  │ AiAuditService│   │ ToolRegistry │   │ PineconeSvc │   │    below          │ │
│  │ ModelRegistry │   │              │   │ MockDataSvc │   │                  │ │
│  └───────┬───────┘   └──────┬───────┘   └──────┬──────┘   └──────────────────┘ │
│          │                  │                  │                              │
│          │           ┌──────▼──────────────────▼──────┐                       │
│          └──────────►│      ModerationModule            │◄──────────────────┐ │
│                       │      CostManagementModule        │  (Phase 4, both)  │ │
│                       │  ModerationGuard/Interceptor      │                   │ │
│                       │  CostBudgetGuard, RetentionService│                   │ │
│                       └───────────────┬───────────────────┘                   │
│                                       │                                       │
│                       ┌───────────────▼───────────────┐                       │
│                       │        DatabaseModule (Prisma)  │                     │
│                       └───────────────┬───────────────┘                       │
└───────────────────────────────────────┼───────────────────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              PostgreSQL            Pinecone            OpenRouter/OpenAI
           (15 tables)          (vector index)        (any OpenAI-compatible
                                                            provider)
```

The dependency direction is strictly one-way: newer modules import older ones, never the reverse
(`AiChatModule → OpenaiModule`, `RagModule → AiChatModule/OpenaiModule/ModerationModule/
CostManagementModule`, `CapstoneModule → all of the above`). `CapstoneModule` adds no new
capability of its own — it is a thin composition layer over `MockDataService`, `ChatService`, and
`CostBudgetService`.

## 4. Phase Summary

| Phase                                            | What Was Built                                                                                                                                                                                                                                                                                        | Issues          | Tests         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------- |
| **Phase 1 — OpenAI API Foundations**             | Chat completions, retry engine + circuit breaker, token counting, cost calculation, prompt templates (6 techniques), dynamic model registry (OpenRouter auto-sync, 340+ models), audit logging                                                                                                        | 14 (AI-001–014) | ~90           |
| **Phase 2 — Chat, Streaming & Function Calling** | Multi-turn conversations with sliding-window context trimming, SSE streaming with abort/error handling, 3 built-in tools (calculator, datetime, weather) via a two-call function-calling protocol                                                                                                     | 21 (AI-015–035) | ~160          |
| **Phase 3 — Vector Search & RAG**                | Document ingestion (PDF/TXT/MD → chunk → embed → Pinecone upsert), embedding cache, semantic search, RAG with citations, RAG inside conversations, mock data generation + accuracy evaluation, a hand-written 10→50-document realistic dataset                                                        | 20 (AI-036–055) | ~150          |
| **Phase 4 — Safety & Compliance**                | Input/output content moderation (OpenAI moderation API + a static-fixture fallback for when the upstream doesn't proxy it), per-user cost budgets with 429 enforcement, cost analytics (by user/model/feature/timeline, projected spend), automated data retention with a dynamically-registered cron | 20 (AI-056–075) | ~215          |
| **Capstone — Cross-Phase Integration**           | 50-document realistic dataset (10 per category), 250 Q&A pairs, `CapstoneModule` (seed/reset/status/run-evaluation), 5 cross-phase integration test scenarios, demo script, this report                                                                                                               | —               | 5             |
| **Total**                                        |                                                                                                                                                                                                                                                                                                       | **75 issues**   | **710 tests** |

**Key learnings per phase**:

- **Phase 1**: A retry engine and circuit breaker only prove themselves under real failure —
  building the audit log first meant every later phase inherited cost/latency tracking for free.
- **Phase 2**: The hardest part of "multi-turn chat" wasn't the happy path — it was getting
  disconnect detection right (`response.on('close')`, not `request.on('close')`, discovered only
  via a live `curl`/`kill` test that no unit test could have caught).
- **Phase 3**: Mock content quality directly determines whether an evaluation pipeline is
  trustworthy — faker-generated `lorem.paragraph()` text produced embeddings too weak to clear a
  real similarity threshold, which is why this project moved to hand-written, coherent documents
  instead.
- **Phase 4**: A guard/interceptor referenced via `@UseGuards()`/`@UseInterceptors()` is
  constructed in the _host_ module's own injector scope, not reused from the module that defines
  it — a NestJS DI subtlety that broke the first boot attempt for both `ModerationModule` and
  `CostManagementModule` integrations.
- **Capstone**: Proving four phases work together surfaces integration bugs no single phase's
  test suite can — e.g. this project's live seed run hit a transient Pinecone connectivity error
  during evaluation that none of the 705 pre-capstone unit/integration tests could have exercised.

## 5. Technical Stats

| Metric                                      | Count                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Total endpoints (REST)                      | 85 (82 across 8 feature modules + 3 on the root app controller)                                                             |
| Controllers                                 | 9                                                                                                                           |
| Services                                    | 26                                                                                                                          |
| Guards / Interceptors                       | 5 (`ThrottlerBehindProxyGuard`, `ResponseInterceptor`, `ModerationGuard`, `OutputModerationInterceptor`, `CostBudgetGuard`) |
| Database tables (Prisma models)             | 15                                                                                                                          |
| Automated tests                             | 710, across 53 suites                                                                                                       |
| Lines of source code (non-test)             | ~13,900                                                                                                                     |
| Lines of test code                          | ~15,000                                                                                                                     |
| TypeScript files                            | 282                                                                                                                         |
| Capstone demo dataset                       | 50 documents, 250 Q&A pairs, 3 conversations, 3 budgets                                                                     |
| Live evaluation result                      | 70% overall accuracy, 83% simple-question accuracy                                                                          |
| Models available (via OpenRouter auto-sync) | 340+, from 56+ providers                                                                                                    |

## 6. Tools & Technologies Used

| Tool                                                               | From Goal Doc?   | Notes                                                                                        |
| ------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------- |
| **NestJS 11**                                                      | Framework choice | Modular DI, guards/interceptors/pipes used extensively                                       |
| **OpenAI SDK (`openai` npm package)**                              | ✅               | Wrapped by a single `OpenaiService` — no other service touches the SDK directly              |
| **Pinecone**                                                       | ✅               | Serverless index, namespace-scoped, data-plane stats for live vector counts                  |
| **LangChain** (`@langchain/textsplitters`, `@langchain/community`) | ✅               | `RecursiveCharacterTextSplitter` for token-aware chunking, `PDFParse` for PDF ingestion      |
| **OpenRouter**                                                     | ✅               | 340+ models across 56+ providers, auto-synced daily via `@nestjs/schedule`                   |
| **Prisma 7**                                                       | Extra            | ORM — required an explicit `PrismaPg` adapter and a post-generate CJS patch under this stack |
| **tiktoken**                                                       | Extra            | Real BPE token counting, cached per-model encoder (110-145ms→0.25ms per call after caching)  |
| **PostgreSQL**                                                     | Extra            | System of record — 15 tables                                                                 |
| **Sentry (`@sentry/nestjs`)**                                      | Extra            | Error tracking, scaffolded at project start                                                  |
| **class-validator / class-transformer**                            | Extra            | Every request DTO validated at the global `ValidationPipe`                                   |
| **Swagger (`@nestjs/swagger`)**                                    | Extra            | Full OpenAPI docs at `/api/docs`, one composite `@ApiEndpoint()` decorator                   |
| **@faker-js/faker**                                                | Extra            | Faker-templated mock document generation (Phase 3)                                           |
| **React + Vite + Tailwind + shadcn/ui**                            | Extra            | Frontend — 14 pages, all built against the real backend API                                  |
| **Playwright**                                                     | Extra            | UI smoke verification across all 15 pages                                                    |
| **Jest + Supertest**                                               | Extra            | 710 tests, including framework-level HTTP integration tests                                  |

## 7. Key Practices Followed

| Practice (from goal doc)          | How It Was Implemented                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use system prompts**            | Every chat/RAG completion carries an explicit system prompt — `RAG_CONFIG.systemPrompt` for RAG, a configurable `systemPrompt` field for chat conversations                  |
| **Implement exponential backoff** | `RetryService.executeWithRetry()` — backoff + jitter + a circuit breaker (`CircuitOpenException`) shared across chat/embeddings/moderation calls                             |
| **Test prompt variations**        | `PromptTemplateService` (6 seeded techniques: zero-shot, few-shot, chain-of-thought, role-based, structured-output, constraint-based) + `POST /openai/prompt-test`           |
| **Log everything**                | `AiAuditService` (every OpenAI call: chat/embeddings/moderation) and `ModerationService` (every moderation check) — nothing calls the SDK without an audit row being written |
| **Cache embeddings**              | `EmbeddingCacheService` — SHA-256(normalized text) keyed, checked before every embedding call in both document ingestion and query-time search                               |

## 8. Practice Apps

| App                           | Status                                              | Where to Find It                                                                                               |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **App 1: Knowledge Base Q&A** | ✅ Fully implemented — this is the capstone's focus | `/knowledge-base` (Documents + Q&A tabs), `/knowledge-base/evaluation`, backed by 50 real CloudPulse documents |
| **App 2: AI Chat Assistant**  | ✅ Fully implemented                                | `/chat` — multi-turn history, SSE streaming, 3 function-calling tools                                          |
| **App 3: Content Moderation** | ✅ Fully implemented                                | `/moderation` — standalone tester, moderation logs, violation stats                                            |

## 9. What I Learned

_(Personal reflection — fill in your own notes here before sharing this report.)_

- What surprised you most while building this?
- Which NestJS/Prisma/LangChain gotcha cost you the most debugging time?
- What would you do differently if starting Phase 1 again, knowing what Phase 4 needed?
- Which live-verification finding (e.g. the SSE disconnect bug, the RAG similarity-threshold
  recalibration, the OpenRouter `/moderations` 404) taught you the most about the gap between
  "the code compiles and the tests pass" and "the system actually works"?

## 10. Demo Instructions

See `docs/demo-script.md` for the full 15-20 minute walkthrough. Quick start:

```bash
# Backend
cd ai-product-integration-be
npm run dev

# Frontend (separate terminal)
cd ai-product-integration-fe
npm run dev

# Seed the demo dataset (separate terminal, takes a few minutes)
curl -X POST http://localhost:3000/api/v1/capstone/seed

# Check readiness at any time
curl http://localhost:3000/api/v1/capstone/status

# Reset when done (deletes only the demo data this seeded)
curl -X POST http://localhost:3000/api/v1/capstone/reset
```

## 11. Future Enhancements

Ideas for extending this platform beyond the goal document's scope:

- **Real authentication** — the entire project uses an `x-user-id` header / request-body
  convention for identity (explicitly out of scope per the Phase 4 spec); a real JWT/OAuth layer
  would let budgets, audit logs, and moderation checks attribute to authenticated users instead.
- **WebSocket transport** for chat streaming, as an alternative to SSE, for bidirectional
  scenarios (e.g. the client canceling generation mid-stream without closing the connection).
- **Fine-tuning support** — a `POST /openai/fine-tune` surface for uploading training data and
  kicking off a fine-tuning job against OpenAI's API, with job-status polling.
- **Multi-region / Azure OpenAI support** — the `OPENAI_CLIENT` factory already supports any
  OpenAI-compatible base URL; adding Azure's distinct auth scheme (API-key + resource + deployment
  name, rather than a bearer token) would be a natural next provider.
- **Retry-wrapping `PineconeService`** — an open Follow Up from both Phase 3 and Phase 4's live
  smoke tests: transient `PineconeConnectionError`s currently surface as uncaught 500s in
  `SearchService`/`RagService`, the same class of issue this project's live capstone seed run hit.
- **An LLM-as-judge evaluator** — the current evaluation heuristic (keyword-overlap ratio) is a
  documented, deliberate simplification; a second evaluation mode that asks a model to grade
  answer quality would catch phrasing-correct-but-factually-wrong answers the heuristic can't.
- **Streaming tool execution** — `ChatService.sendMessageStream()` currently forwards `tool_call`
  events but doesn't execute them or make a synthesis call, unlike the non-streaming path's full
  two-call protocol; extending streaming to match would close that gap.
- **Redacting moderated content at read time** — a live finding from Phase 4's smoke test:
  `OutputModerationInterceptor` redacts a flagged answer in the initial response, but a later
  `GET /chat/conversations/:publicId` still returns the original, unredacted text, since
  persistence happens before the interceptor runs.
