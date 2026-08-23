# Issue Index

## Parent PRDs

- `docs/prd/2026-07-10-safety-compliance.md` — Phase 4
- `docs/prd/2026-07-08-vector-search-rag.md` — Phase 3
- `docs/prd/2026-07-06-chat-streaming-function-calling.md` — Phase 2
- `docs/prd/2026-06-25-openai-api-foundations.md` — Phase 1

## Issues — Phase 4: Safety & Compliance

| ID     | Title                                                                     | Type | Priority | Status    | Epic                                                   | Blocked By                             |
| ------ | ------------------------------------------------------------------------- | ---- | -------- | --------- | ------------------------------------------------------ | -------------------------------------- |
| AI-075 | Live API smoke test — moderation block, budget enforcement, retention     | HITL | P2       | completed | Epic 7 — API Layer, DTOs, Swagger & Live Verification  | AI-074, AI-059                         |
| AI-074 | Phase 4 controller tests audit + moderation integration + full regression | AFK  | P2       | completed | Epic 7 — API Layer, DTOs, Swagger & Live Verification  | AI-063, AI-066, AI-071, AI-072, AI-073 |
| AI-073 | CostManagementController — analytics + retention endpoints                | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Live Verification  | AI-068, AI-070                         |
| AI-072 | CostManagementController — budget endpoints                               | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Live Verification  | AI-065                                 |
| AI-071 | ModerationController — check, check-batch, logs & stats endpoints         | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Live Verification  | AI-060                                 |
| AI-070 | RetentionService — dynamic cron registration + runtime config             | AFK  | P1       | completed | Epic 6 — Data Retention                                | AI-069                                 |
| AI-069 | RetentionService — batched cleanup methods + RetentionReport              | AFK  | P1       | completed | Epic 6 — Data Retention                                | AI-056, AI-057                         |
| AI-068 | CostAnalyticsService — timeline, daily trend & projected monthly spend    | AFK  | P1       | completed | Epic 5 — Cost Analytics                                | AI-067                                 |
| AI-067 | CostAnalyticsService — spend by user, model & feature                     | AFK  | P1       | completed | Epic 5 — Cost Analytics                                | AI-057                                 |
| AI-066 | CostBudgetGuard — 429 enforcement + application to AI routes              | AFK  | P1       | completed | Epic 4 — Cost Budgets — Service & Guard                | AI-065, AI-063                         |
| AI-065 | CostBudgetService — spend aggregation + cached checkBudget() + alerts     | AFK  | P1       | completed | Epic 4 — Cost Budgets — Service & Guard                | AI-064                                 |
| AI-064 | CostBudgetService — budget CRUD + budget DTOs                             | AFK  | P1       | completed | Epic 4 — Cost Budgets — Service & Guard                | AI-056, AI-057                         |
| AI-063 | Apply ModerationGuard + OutputModerationInterceptor to chat & RAG routes  | AFK  | P1       | completed | Epic 3 — Moderation Core — Service, Guard, Interceptor | AI-061, AI-062                         |
| AI-062 | OutputModerationInterceptor — replace flagged AI output                   | AFK  | P1       | completed | Epic 3 — Moderation Core — Service, Guard, Interceptor | AI-060                                 |
| AI-061 | ModerationGuard — input moderation with 422 blocking                      | AFK  | P1       | completed | Epic 3 — Moderation Core — Service, Guard, Interceptor | AI-060                                 |
| AI-060 | ModerationService — classification + moderation_logs logging              | AFK  | P1       | completed | Epic 3 — Moderation Core — Service, Guard, Interceptor | AI-056, AI-057, AI-058                 |
| AI-059 | Live probe — does OpenRouter proxy /moderations? (base-URL decision)      | HITL | P1       | completed | Epic 2 — OpenaiService Moderation Extension            | AI-058                                 |
| AI-058 | OpenaiService — moderateText() + moderateBatch() SDK seam                 | AFK  | P1       | completed | Epic 2 — OpenaiService Moderation Extension            | —                                      |
| AI-057 | Config namespaces + env validation + module scaffolds                     | AFK  | P1       | completed | Epic 1 — Schema & Configuration Foundation             | AI-056                                 |
| AI-056 | Prisma schema — moderation_logs + user_cost_budgets                       | AFK  | P1       | completed | Epic 1 — Schema & Configuration Foundation             | —                                      |

## Issues — Phase 3: Vector Search & RAG

| ID     | Title                                                                    | Type | Priority | Status    | Epic                                                | Blocked By                             |
| ------ | ------------------------------------------------------------------------ | ---- | -------- | --------- | --------------------------------------------------- | -------------------------------------- |
| AI-055 | Live API smoke test — ingestion, search, citations, deletion cascade     | HITL | P2       | completed | Epic 7 — API Layer, DTOs, Swagger & Tests           | AI-054                                 |
| AI-054 | RagController tests + full regression verification                       | AFK  | P2       | completed | Epic 7 — API Layer, DTOs, Swagger & Tests           | AI-051, AI-052, AI-053                 |
| AI-053 | RagController — mock data, evaluation & stats endpoints                  | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Tests           | AI-048, AI-049, AI-050, AI-040, AI-039 |
| AI-052 | RagController — search + ask endpoints                                   | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Tests           | AI-045, AI-046, AI-047                 |
| AI-051 | RagController — document endpoints                                       | AFK  | P1       | completed | Epic 7 — API Layer, DTOs, Swagger & Tests           | AI-041, AI-044, AI-037                 |
| AI-050 | RAG evaluation — score Q&A pairs by complexity tier                      | AFK  | P1       | completed | Epic 6 — Mock Data Generation & Evaluation          | AI-049, AI-046                         |
| AI-049 | MockDataService — Q&A pair generation + seedDefaultDataset()             | AFK  | P1       | completed | Epic 6 — Mock Data Generation & Evaluation          | AI-048                                 |
| AI-048 | MockDataService.generateDocuments() — faker-based document generation    | AFK  | P1       | completed | Epic 6 — Mock Data Generation & Evaluation          | AI-043, AI-037                         |
| AI-047 | RagService.queryWithConversation() — conversation-integrated RAG         | AFK  | P1       | completed | Epic 5 — Semantic Search & RAG Orchestration        | AI-046, AI-037                         |
| AI-046 | RagService.query() — RAG generation with citations                       | AFK  | P1       | completed | Epic 5 — Semantic Search & RAG Orchestration        | AI-045                                 |
| AI-045 | SearchService — semantic search                                          | AFK  | P1       | completed | Epic 5 — Semantic Search & RAG Orchestration        | AI-038, AI-040, AI-036                 |
| AI-044 | DocumentService — file upload ingestion, reindex, status & chunk queries | AFK  | P1       | completed | Epic 4 — Document Ingestion Pipeline                | AI-042, AI-043, AI-040                 |
| AI-043 | DocumentService — ingestion pipeline (embed, cache, upsert, persist)     | AFK  | P1       | completed | Epic 4 — Document Ingestion Pipeline                | AI-038, AI-039, AI-040, AI-042         |
| AI-042 | DocumentService — parse + chunk pipeline                                 | AFK  | P1       | completed | Epic 4 — Document Ingestion Pipeline                | AI-041                                 |
| AI-041 | DocumentService — CRUD + document DTOs                                   | AFK  | P1       | completed | Epic 4 — Document Ingestion Pipeline                | AI-036, AI-037, AI-040                 |
| AI-040 | PineconeService — Pinecone client wrapper                                | AFK  | P1       | completed | Epic 3 — Embedding Cache & Pinecone Client          | AI-036, AI-037                         |
| AI-039 | EmbeddingCacheService — hash-based embedding dedup                       | AFK  | P1       | completed | Epic 3 — Embedding Cache & Pinecone Client          | AI-036, AI-037                         |
| AI-038 | OpenaiService — generateEmbedding() + generateEmbeddingsBatch()          | AFK  | P1       | completed | Epic 2 — OpenaiService Embedding Extension          | AI-036                                 |
| AI-037 | RagModule scaffold — dependencies, enums, constants, service shells      | AFK  | P1       | completed | Epic 1 — Database Schema & Configuration Foundation | AI-036                                 |
| AI-036 | Prisma schema — documents, document_chunks + EmbeddingCache realignment  | AFK  | P1       | completed | Epic 1 — Database Schema & Configuration Foundation | —                                      |

## Issues — Phase 2: Chat Completions, Streaming & Function Calling

| ID     | Title                                                                  | Type | Priority | Status    | Epic                                                         | Blocked By                     |
| ------ | ---------------------------------------------------------------------- | ---- | -------- | --------- | ------------------------------------------------------------ | ------------------------------ |
| AI-035 | Live API smoke test — streaming, function calling, weather             | HITL | P2       | completed | Epic 7 — Testing & Audit Integration Verification            | AI-033, AI-034                 |
| AI-034 | ChatController tests + function-calling integration + regression       | AFK  | P2       | completed | Epic 7 — Testing & Audit Integration Verification            | AI-032, AI-027                 |
| AI-033 | ChatController — SSE streaming endpoint                                | AFK  | P1       | completed | Epic 6 — API Layer                                           | AI-029, AI-031                 |
| AI-032 | ChatController — send-message + tools CRUD endpoints                   | AFK  | P1       | completed | Epic 6 — API Layer                                           | AI-023, AI-027, AI-030, AI-031 |
| AI-031 | ChatController — conversation CRUD endpoints + module registration     | AFK  | P1       | completed | Epic 6 — API Layer                                           | AI-019, AI-030                 |
| AI-030 | DTOs — conversation, message, tool request/response classes            | AFK  | P1       | completed | Epic 6 — API Layer                                           | AI-016                         |
| AI-029 | StreamingService — disconnect, mid-stream errors, partial persist      | AFK  | P1       | completed | Epic 4 — Streaming Service                                   | AI-028, AI-020                 |
| AI-028 | StreamingService.streamCompletion() — SSE token streaming              | AFK  | P1       | completed | Epic 4 — Streaming Service                                   | AI-016                         |
| AI-027 | ChatService — function-calling flow (two-call protocol)                | AFK  | P1       | completed | Epic 3 — Chat Service, Conversations, Messages & Context     | AI-022, AI-026                 |
| AI-026 | ToolExecutorService — dispatch, timeout, parallel, HTTP whitelist      | AFK  | P1       | completed | Epic 5 — Tool Registry & Built-in Tools                      | AI-023, AI-024, AI-025         |
| AI-025 | Built-in tool — weather (Open-Meteo)                                   | AFK  | P1       | completed | Epic 5 — Tool Registry & Built-in Tools                      | AI-016                         |
| AI-024 | Built-in tools — calculator (mathjs) + datetime (dayjs)                | AFK  | P1       | completed | Epic 5 — Tool Registry & Built-in Tools                      | AI-016                         |
| AI-023 | ToolRegistryService — CRUD + OpenAI tool-format conversion             | AFK  | P1       | completed | Epic 5 — Tool Registry & Built-in Tools                      | AI-016                         |
| AI-022 | ChatService.sendMessage() — non-tool orchestration                     | AFK  | P1       | completed | Epic 3 — Chat Service, Conversations, Messages & Context     | AI-018, AI-021                 |
| AI-021 | ChatService.buildContext() — sliding-window context management         | AFK  | P1       | completed | Epic 3 — Chat Service, Conversations, Messages & Context     | AI-020                         |
| AI-020 | ChatService — message persistence + auto-title generation              | AFK  | P1       | completed | Epic 3 — Chat Service, Conversations, Messages & Context     | AI-019                         |
| AI-019 | ChatService — conversation CRUD + cascade delete                       | AFK  | P1       | completed | Epic 3 — Chat Service, Conversations, Messages & Context     | AI-016                         |
| AI-018 | OpenaiService.chatCompletionWithMessages() — multi-turn + tools        | AFK  | P1       | completed | Epic 2 — OpenaiService Extension for Multi-Turn & Tool Calls | —                              |
| AI-017 | Seed built-in tools — calculator, weather, datetime                    | AFK  | P1       | completed | Epic 1 — Database Schema Extension                           | AI-015, AI-016                 |
| AI-016 | AiChatModule scaffold — enums, constants, empty service shells         | AFK  | P1       | completed | Epic 1 — Database Schema Extension                           | AI-015                         |
| AI-015 | Prisma schema — chat_conversations, chat_messages, chat_tools + config | AFK  | P1       | completed | Epic 1 — Database Schema Extension                           | —                              |

## Issues — Phase 1: OpenAI API Foundations

| ID     | Title                                                             | Type | Priority | Status    | Epic                               | Blocked By             |
| ------ | ----------------------------------------------------------------- | ---- | -------- | --------- | ---------------------------------- | ---------------------- |
| AI-014 | Live API smoke test — end-to-end verification                     | HITL | P2       | in-review | Epic 6 — Controller & Validation   | AI-013                 |
| AI-013 | OpenaiController unit tests + TypeScript/lint verification        | AFK  | P2       | completed | Epic 6 — Controller & Validation   | AI-010, AI-011, AI-012 |
| AI-012 | OpenaiController — prompt template CRUD endpoints                 | AFK  | P1       | completed | Epic 6 — Controller & Validation   | AI-008, AI-009, AI-010 |
| AI-011 | OpenaiController — audit log query + cost summary endpoints       | AFK  | P1       | completed | Epic 6 — Controller & Validation   | AI-006, AI-009, AI-010 |
| AI-010 | OpenaiController — core endpoints + AppModule registration        | AFK  | P1       | completed | Epic 6 — Controller & Validation   | AI-007, AI-008, AI-009 |
| AI-009 | DTOs — request and response classes for all 8 endpoint groups     | AFK  | P1       | completed | Epic 6 — Controller & Validation   | AI-003                 |
| AI-008 | PromptTemplateService — full CRUD + unit tests                    | AFK  | P1       | completed | Epic 5 — Prompt Template Service   | AI-001, AI-003         |
| AI-007 | OpenaiService — chatCompletion(), API key guard + unit tests      | AFK  | P1       | completed | Epic 4 — OpenAI Service & Audit    | AI-004, AI-005, AI-006 |
| AI-006 | AiAuditService — log write, findAll, getCostSummary + tests       | AFK  | P1       | completed | Epic 4 — OpenAI Service & Audit    | AI-001, AI-003         |
| AI-005 | RetryService — backoff, circuit breaker + unit tests              | AFK  | P1       | completed | Epic 3 — Retry Engine              | AI-003                 |
| AI-004 | TokenService — countTokens, estimateTokens, calculateCost + tests | AFK  | P1       | completed | Epic 2 — Token Service             | AI-003                 |
| AI-003 | OpenaiModule scaffold — enums, constants, empty service shells    | AFK  | P1       | completed | Epic 2 — Token Service             | AI-001                 |
| AI-002 | Seed script — 6 reference prompt templates                        | AFK  | P1       | completed | Epic 1 — Database Schema Extension | AI-001                 |
| AI-001 | Prisma schema — ai_audit_logs, prompt_templates, env config       | AFK  | P1       | completed | Epic 1 — Database Schema Extension | —                      |
