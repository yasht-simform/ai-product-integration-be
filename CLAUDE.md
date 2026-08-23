# AI Product Integration — Claude Context

## Project Purpose

NestJS backend for learning AI product integration: LLM chat, embeddings, RAG, and content
moderation via OpenAI and Pinecone. This is a learning/reference project, not production
infrastructure, but it is built to production-grade standards so the patterns are transferable.

## Stack

| Layer          | Technology     | Version                            |
| -------------- | -------------- | ---------------------------------- |
| Framework      | NestJS         | 11                                 |
| ORM            | Prisma         | 7.8 (breaking changes — see below) |
| Database       | PostgreSQL     | —                                  |
| AI             | OpenAI SDK     | 6.x                                |
| Vector DB      | Pinecone       | via `openai` + REST                |
| Auth           | Passport + JWT | —                                  |
| Observability  | Sentry         | 10.x                               |
| Token counting | tiktoken       | —                                  |

## Commands

```bash
npm run dev              # start with file watch (alias: start:dev)
npm run build            # prisma:generate + nest build (client always fresh)
npm run start:prod       # run compiled output

npm run lint             # eslint --fix
npm run lint:check       # eslint read-only (CI)
npm run format           # prettier --write
npm run format:check     # prettier --check (CI)

npm run test             # jest unit tests
npm run test:cov         # with coverage report
npm run test:e2e         # e2e suite
npm run test:debug       # jest with --inspect-brk for debugger attach

npm run prisma:generate        # regenerate Prisma client after schema changes
npm run prisma:migrate         # create + apply migration (dev)
npm run prisma:migrate:deploy  # apply pending migrations (production / CI)
npm run prisma:migrate:status  # show applied vs. pending migrations
npm run prisma:studio          # open Prisma Studio GUI
npm run prisma:validate        # validate schema.prisma
npm run prisma:format          # format schema.prisma
npm run prisma:seed            # run prisma/seed.ts via ts-node

npm run db:push          # push schema without migration (prototyping)
npm run db:pull          # introspect existing DB → update schema.prisma
npm run db:reset         # drop + recreate + reseed (--force, no prompt)
npm run db:seed          # alias for prisma:seed
```

## Source Tree

```
src/
  app.module.ts          # root module — ConfigModule, ThrottlerModule, LoggerModule, DatabaseModule
  main.ts                # bootstrap — helmet, CORS, ValidationPipe, Swagger, prefix api/v1
  config/
    app.config.ts        # 7 registerAs() factories: app, database, jwt, openai, pinecone, throttle, chat
    env.validation.ts    # class-validator schema — app fails to start on missing/invalid env vars
    index.ts             # barrel
  database/
    database.module.ts   # @Global() Prisma module
    database.service.ts  # extends PrismaClient, onModuleInit/Destroy
  common/
    decorators/
      api-response.decorator.ts   # @ApiEndpoint() — composite Swagger decorator
    filters/
      http-exception.filter.ts    # @Catch() all — consistent { statusCode, message, error, timestamp, path }
    guards/
      throttler-behind-proxy.guard.ts  # reads X-Forwarded-For for real client IP
    interceptors/
      response.interceptor.ts     # wraps all success responses in { success: true, data, timestamp }
    logger/
      app-logger.service.ts       # ConsoleLogger extension — JSON in prod, colored in dev
      logger.module.ts            # @Global()
      request-context.ts          # AsyncLocalStorage singleton for requestId propagation
    middleware/
      request-logger.middleware.ts  # attaches requestId, logs method/url/status/duration
  modules/
    openai/
      openai.module.ts   # imports HttpModule; 8 providers (OPENAI_CLIENT factory + 7 services); exports OpenaiService, AiAuditService, TokenService, ModelRegistryService — registered in AppModule
      constants/
        index.ts                    # barrel — re-exports all enums, constants, and injection tokens
        injection-tokens.ts         # OPENAI_CLIENT = 'OPENAI_CLIENT' — DI token for the OpenAI SDK instance
        openai-model.enum.ts        # OpenAIModel: GPT_4, GPT_4O, GPT_4O_MINI
        ai-audit-status.enum.ts     # AiAuditStatus: SUCCESS, FAILED, RETRIED
        prompt-technique.enum.ts    # PromptTechnique: 6 values
        openai-endpoint.enum.ts     # OpenAIEndpoint: CHAT_COMPLETIONS, EMBEDDINGS, MODERATIONS
        api-error-type.enum.ts      # ApiErrorType: RETRYABLE, PERMANENT, CIRCUIT_OPEN, TIMEOUT
        model-tier.enum.ts          # ModelTier: FREE, PAID
        model-source.enum.ts        # ModelSource: OPENROUTER_SYNC, MANUAL — tracks provenance of an ai_models row
        model-pricing.constant.ts   # MODEL_PRICING — hardcoded fallback per-1M-token prices (gpt-4/4o/4o-mini only)
        retry-config.constant.ts    # RETRY_CONFIG — backoff, jitter, circuit breaker, status code lists
      exceptions/
        circuit-open.exception.ts   # CircuitOpenException — HttpException 503, thrown when circuit is OPEN
      validators/
        is-valid-model.validator.ts # @IsValidModel() — accepts OpenAIModel enum values or provider/model:variant strings
      __tests__/
        token.service.spec.ts             # TokenService (real tiktoken WASM; ModelRegistryService mocked for pricing chain)
        retry.service.spec.ts             # RetryService (fake timers, mocked operation callback)
        ai-audit.service.spec.ts          # AiAuditService (jest-mock-extended DeepMockProxy<DatabaseService>)
        openai.service.spec.ts            # OpenaiService (mocked OPENAI_CLIENT, RetryService, TokenService, AiAuditService)
        prompt-template.service.spec.ts   # PromptTemplateService (jest-mock-extended DeepMockProxy<DatabaseService>)
        model-registry.service.spec.ts    # ModelRegistryService — CRUD, pricing fallback chain (DB → MODEL_PRICING → 0), soft-delete
        openrouter-sync.service.spec.ts   # OpenRouterSyncService — mocked HttpService (rxjs `of()`), upsert logic, manual-model protection
        openai.controller.spec.ts         # OpenaiController (jest.fn() mocks for all services; DTO validation via class-validator validate())
        is-valid-model.validator.spec.ts  # unit tests for @IsValidModel() constraint — enum values, provider/model:variant strings, rejections
      dto/
        index.ts                         # barrel — re-exports all request and response DTO classes
        chat-completion.dto.ts           # ChatCompletionDto — prompt, systemPrompt, model, temperature, maxTokens
        model-compare.dto.ts             # ModelCompareDto — prompt, models[], temperature
        prompt-test.dto.ts               # PromptTestDto — extends ChatCompletionDto + templateName
        token-count.dto.ts               # TokenCountDto — text, model
        query-ai-audit.dto.ts            # QueryAiAuditDto (class) — model, status, userId, startDate, endDate, page, limit; @Type(() => Number) on page/limit
        cost-summary-query.dto.ts        # CostSummaryQueryDto (class) — userId, model, startDate, endDate
        create-prompt-template.dto.ts    # CreatePromptTemplateDto + FewShotExampleDto — full template creation
        update-prompt-template.dto.ts    # UpdatePromptTemplateDto — PartialType(CreatePromptTemplateDto)
        query-prompt-template.dto.ts     # QueryPromptTemplateDto — technique, tags (comma-sep), isActive, page, limit
        create-provider.dto.ts           # CreateProviderDto — name, slug, baseUrl, description, isActive
        update-provider.dto.ts           # UpdateProviderDto — PartialType(CreateProviderDto)
        create-model.dto.ts              # CreateModelDto — providerId (publicId), name, modelId, tier, pricing, contextWindow
        update-model.dto.ts              # UpdateModelDto — PartialType(CreateModelDto)
        query-models.dto.ts              # QueryModelsDto — tier, providerId, search, source, isActive, page, limit
        pricing-calculate.dto.ts         # PricingCalculateDto — modelId, inputTokens, outputTokens
        usage.dto.ts                     # UsageDto — inputTokens, outputTokens, totalTokens (nested response type)
        chat-completion-res.dto.ts       # ChatCompletionResDto — content, model, usage, estimatedCost, latencyMs
        model-compare-res.dto.ts         # ModelCompareItemDto + ModelCompareResDto — results[]
        token-count-res.dto.ts           # TokenCountResDto — text, model, tokenCount, characterCount
        model-pricing-res.dto.ts         # ModelPricingItemDto + ModelPricingResDto — pricing Record<model, {input, output}> (hardcoded MODEL_PRICING only)
        ai-audit-log-res.dto.ts          # AiAuditLogResDto — all audit log fields (publicId, not id)
        cost-summary-res.dto.ts          # ModelCostBreakdownDto + CostSummaryResDto — aggregated cost stats
        prompt-template-res.dto.ts       # PromptTemplateResDto — full template fields (publicId, not id)
        paginated-ai-audit-res.dto.ts    # PaginatedAiAuditResDto — data[], total, page, limit
        paginated-prompt-template-res.dto.ts  # PaginatedPromptTemplateResDto — data[], total
        provider-res.dto.ts              # ProviderResDto — provider fields + modelCount
        model-res.dto.ts                 # ModelResDto — full ai_models row (publicId, not id), providerPublicId/providerName flattened in
        paginated-model-res.dto.ts       # PaginatedModelResDto — data[], total, page, limit
        pricing-calculate-res.dto.ts     # PricingCalculateResDto — model, provider, tier, inputCost, outputCost, totalCost, note
        pricing-table-res.dto.ts         # PricingTableResDto — providers[] each with models[] (for a pricing page)
        sync-result-res.dto.ts           # SyncResultResDto — providersCreated, modelsCreated, modelsUpdated
        sync-status-res.dto.ts           # SyncStatusResDto — lastSyncedAt, modelsCount, providersCount
      types/
        ai-audit.types.ts           # AiAuditLogEvent, QueryAiAuditDto (interface), PaginatedAiAuditResult, CostSummaryQueryDto (interface), CostSummaryResult, ModelCostBreakdown
        openai.types.ts             # ChatCompletionParams, ChatCompletionResult
        prompt-template.types.ts    # PromptTemplateEntity (all fields except BigInt id), PaginatedPromptTemplateResult
        model-registry.types.ts     # AiProviderEntity/AiProviderWithCount, AiModelEntity, QueryModelsParams, PaginatedModelsResult, ModelPricingResult, PricingTableResult, SyncResult, SyncStatusResult
        openrouter.types.ts         # OpenRouterModel, OpenRouterModelsResponse — shape of https://openrouter.ai/api/v1/models
      openai.controller.ts   # OpenaiController — endpoints across: chat, compare, prompt-test, token-count, templates (POST/GET/GET:id/PATCH/DELETE), audit-logs, audit-logs/cost-summary, providers (GET/POST/PATCH/DELETE), models (GET/free/paid/POST/PATCH/DELETE), pricing (table + calculate), sync (openrouter + status), models/pricing (legacy hardcoded table), health
      services/
        token.service.ts            # TokenService — countTokens (tiktoken, model: string, one cached Tiktoken encoder per model — see below), estimateTokens (chars/4), calculateCost (async: DB via ModelRegistryService → MODEL_PRICING → 0, 5-min in-memory cache), getModelPricing (hardcoded MODEL_PRICING only, legacy); implements OnModuleDestroy to free cached encoders
        retry.service.ts            # RetryService — executeWithRetry (backoff+jitter, optional retryTracker), getCircuitState, resetCircuit; internal only, NOT exported
        ai-audit.service.ts         # AiAuditService — log (fire-and-forget DB write), findAll (paginated+filtered), getCostSummary (aggregate+groupBy); exported
        prompt-template.service.ts  # PromptTemplateService — create (P2002→ConflictException), findAll (pagination+filters), findByPublicId, findByName, update (partial), remove; provider-only (not exported — controller is in same module)
        openai.service.ts           # OpenaiService — chatCompletion() + chatCompletionWithMessages() (retry+audit+cost, share a private executeCompletion() tail), getModelPricing(); onModuleInit() API key guard; model defaults read from `openai.defaultModel` config, not a hardcoded enum; exported
        model-registry.service.ts   # ModelRegistryService — CRUD for ai_providers/ai_models (soft-delete via isActive), pricing lookup chain, pricing table, counts; exported
        openrouter-sync.service.ts  # OpenRouterSyncService — fetches https://openrouter.ai/api/v1/models (no auth), upserts providers/models, skips ModelSource.MANUAL rows; runs onModuleInit + daily @Cron('0 3 * * *'); not exported
    ai-chat/
      ai-chat.module.ts    # AiChatModule — imports OpenaiModule + HttpModule; ChatController; 5 providers (ChatService, StreamingService, ToolRegistryService, ToolExecutorService, WeatherTool); exports only ChatService — registered in AppModule
      chat.controller.ts   # ChatController — conversation CRUD (POST/GET/GET:id/PATCH/DELETE/:id/archive) (AI-031) + send-message (POST :id/messages, delegates to ChatService.sendMessage()) + tools CRUD (GET/POST/PATCH/DELETE, delegates to ToolRegistryService) (AI-032) + SSE streaming (POST :id/messages/stream, raw @Res(), delegates to ChatService.sendMessageStream()) (AI-033); @ApiTags('ai-chat')
      constants/
        index.ts                       # barrel — re-exports all enums + CONTEXT_CONFIG + BUILTIN_TOOLS
        chat-message-role.enum.ts       # ChatMessageRole: SYSTEM, USER, ASSISTANT, TOOL
        tool-handler-type.enum.ts       # ToolHandlerType: BUILTIN, HTTP
        stream-event-type.enum.ts       # StreamEventType: TOKEN, TOOL_CALL, TOOL_RESULT, DONE, ERROR
        conversation-status.enum.ts     # ConversationStatus: ACTIVE, ARCHIVED
        context-config.constant.ts      # CONTEXT_CONFIG — fallback defaults (maxMessages, contextWindowPercentage, defaultContextWindow); real values come from `chatConfig` at call sites
        builtin-tools.constant.ts       # BUILTIN_TOOLS — calculator/weather/datetime seed definitions (name, displayName, description, JSON Schema parameters, handlerType), spec §8.2 verbatim
      types/
        ai-chat.types.ts     # ConversationEntity, ChatMessageEntity (incl. metadata), ToolEntity (DB-row shapes), ToolCallData, StreamEvent, ToolExecutionResult, CreateConversationParams (extends CreateConversationDto + userId/metadata), PaginatedConversationsResult, ConversationWithMessages, AddAssistantMessageParams
      dto/
        index.ts                              # barrel — re-exports all request and response DTO classes
        create-conversation.dto.ts            # CreateConversationDto — title?, systemPrompt?, model? (@IsValidModel), toolsEnabled?
        update-conversation.dto.ts            # UpdateConversationDto — PartialType(OmitType(CreateConversationDto, ['toolsEnabled'])) — toolsEnabled is immutable after creation
        query-conversations.dto.ts            # QueryConversationsDto — userId?, isArchived?, page?, limit? (@Type(() => Number)/@Type(() => Boolean))
        send-message.dto.ts                   # SendMessageDto — content (@IsNotEmpty), model?, temperature?, maxTokens?
        create-tool.dto.ts                    # CreateToolDto — name, displayName, description, parameters (JSON Schema, @IsObject), handlerType (@IsEnum(ToolHandlerType)), handlerConfig?
        update-tool.dto.ts                    # UpdateToolDto — PartialType(CreateToolDto)
        conversation-res.dto.ts               # ConversationResDto — publicId, title, systemPrompt, model, toolsEnabled, isArchived, createdAt, updatedAt
        message-res.dto.ts                    # MessageResDto — publicId, role, content, toolCalls, toolCallId, toolName, tokenCount, cost, latencyMs, model, createdAt
        conversation-with-messages-res.dto.ts # ConversationWithMessagesResDto — ConversationResDto + messages: MessageResDto[]
        assistant-message-res.dto.ts          # AssistantMessageResDto — messageId, role, content, model, toolCalls, usage: UsageDto (reused from openai/dto), estimatedCost, latencyMs
        tool-res.dto.ts                       # ToolResDto — publicId, name, displayName, description, parameters, handlerType, isActive, createdAt, updatedAt
        paginated-conversations-res.dto.ts     # PaginatedConversationsResDto — data: ConversationResDto[], total, page, limit
      services/
        chat.service.ts           # ChatService — conversation CRUD (AI-019) + message persistence/auto-title (AI-020) + buildContext() sliding-window trimming (AI-021) + sendMessage() non-tool orchestration (AI-022) + two-call tool-calling flow (AI-027) + sendMessageStream() streaming orchestration + audit logging (AI-029) implemented; getConversationHandle(publicId) — resolves { id: bigint, model } for cross-module callers (RagService, AI-047) that can't otherwise reach a conversation's internal row id; exported
        streaming.service.ts      # StreamingService — streamCompletion() SSE token/tool-call generator over OPENAI_CLIENT directly (AI-028), abort-signal + mid-stream error handling (AI-029); not exported
        tool-registry.service.ts  # ToolRegistryService — CRUD (findAllTools/findActiveTool/createTool/updateTool/deleteTool) + getToolDefinitions() OpenAI-format conversion + onModuleInit() built-in tool upsert (AI-023, also satisfies AI-017); not exported (same-module DI only)
        tool-executor.service.ts  # ToolExecutorService — execute(toolName, args) dispatch (builtin map + HTTP whitelist/timeout), never rejects (AI-026); not exported
      tools/
        index.ts               # barrel — re-exports executeCalculator/executeDatetime/WeatherTool + their arg/result types
        calculator.tool.ts      # executeCalculator({ expression }) — mathjs evaluate() only, 200-char length cap, finite-number check (AI-024)
        datetime.tool.ts        # executeDatetime({ timezone, operation?, date1?, date2? }) — dayjs + utc/timezone plugins; operation 'now' (default) or 'diff' (AI-024)
        weather.tool.ts         # WeatherTool (@Injectable, HttpService-based) — execute({ city, units? }) geocodes via Open-Meteo then fetches current conditions; WMO weather_code → human-readable string, "Unknown" for uncovered codes (AI-025)
      utils/
        sse-frame.util.ts       # formatSseFrame(event) — pure function, `event: <type>\ndata: <json>\n\n` (AI-033); pulled out of ChatController so it's unit-testable independent of the SSE transport
      __tests__/
        chat.service.spec.ts        # ChatService unit tests — DeepMockProxy<DatabaseService>, conversation CRUD + message persistence/auto-title + buildContext() + sendMessage() orchestration order/overrides/response-shape + tool-calling two-call protocol/concurrency/invalid-tool/tools-disabled + sendMessageStream() event re-yielding/normal-completion/abort/mid-stream-error/audit-log-count + getConversationHandle() id/model resolution + not-found guard (AI-047) (54 tests)
        chat-dtos.spec.ts           # class-validator validate() smoke tests for all 6 request DTOs — one invalid + one valid payload each (22 tests)
        chat.controller.spec.ts    # ChatController unit tests (AI-034) — TestingModule + jest.fn() mocks for ChatService/ToolRegistryService (openai.controller.spec.ts's pattern); all 11 routes' delegation + entity→ResDto mapping + NotFoundException propagation, plus 4 sendMessageStream() tests against a hand-built fake Express Response (priming-call header timing, pre-stream error before any write, response.on('close') → AbortSignal wiring regression test, mid-stream error frame after headers committed) (17 tests)
        chat-function-calling.integration.spec.ts  # Full two-call tool-calling integration test (AI-034) — real ChatService/ToolRegistryService/ToolExecutorService/OpenaiService/RetryService/AiAuditService/TokenService wired via TestingModule; only DatabaseService (DeepMockProxy) and the OPENAI_CLIENT token are mocked (mocked at the SDK boundary, not by stubbing OpenaiService — per this issue's own Testing Notes). Real mathjs evaluates 234*567 via the real calculator tool; asserts final content contains "132,678", the synthesis call omits tools, dbMock.aiAuditLog.create (AiAuditService's real write point) is called exactly twice, and dbMock.chatMessage.create is called 4 times. A second test proves a malformed calculator expression degrades to a failed tool result without crashing the turn (2 tests)
        tool-registry.service.spec.ts  # ToolRegistryService unit tests — DeepMockProxy<DatabaseService>, all six methods + onModuleInit() seeding + duplicate-name/inactive-tool edge cases + literal toEqual() on getToolDefinitions() output shape (14 tests)
        calculator.tool.spec.ts    # executeCalculator() unit tests — happy paths, malformed expressions, length cap, non-finite results (7 tests)
        datetime.tool.spec.ts      # executeDatetime() unit tests — now/diff happy paths, invalid timezone, unparseable dates, unknown operation (11 tests)
        weather.tool.spec.ts       # WeatherTool unit tests — HttpService mocked via jest.fn() + rxjs of(...) (openrouter-sync.service.spec.ts's pattern); happy path, unresolvable city, units passthrough, unknown weather code (7 tests)
        tool-executor.service.spec.ts  # ToolExecutorService unit tests — builtin dispatch (calculator/datetime run for real, weather mocked), unknown/inactive tool, both timeout paths via jest.useFakeTimers()/advanceTimersByTimeAsync(), HTTP whitelist (allowed/disallowed/empty-fails-closed), 10 concurrent calls (13 tests)
        streaming.service.spec.ts  # StreamingService unit tests — OPENAI_CLIENT.chat.completions.create() mocked to return a hand-built async-iterable of chunk objects (no real transport); token-per-chunk, multi-chunk tool-call-argument accumulation, concurrent multi-tool-call, malformed-JSON fallback, model/tools/temperature/signal passthrough, default-model fallback, clean exit on pre-resolve abort, error event on non-abort mid-stream failure (10 tests)
        sse-frame.util.spec.ts     # formatSseFrame() pure-function unit tests — token/tool_call/done/error event shapes (AI-033) (4 tests)
    rag/
      rag.module.ts           # RagModule — imports OpenaiModule + AiChatModule; RagController; 7 providers (EmbeddingService, EmbeddingCacheService, DocumentService, PineconeService, SearchService, RagService, MockDataService); no exports yet — registered in AppModule (AI-037)
      rag.controller.ts       # RagController — @ApiTags('rag') stub, no routes yet (AI-037; routes land AI-051 onward)
      constants/
        index.ts                        # barrel — re-exports all constants
        document-source-type.constant.ts  # DocumentSourceType: PDF/TXT/MD/GENERATED (as-const object + derived union type)
        embedding-status.constant.ts      # EmbeddingStatus: PENDING/PROCESSING/COMPLETED/FAILED
        document-category.constant.ts     # DocumentCategory: GUIDE/FAQ/DOCS/TUTORIAL/CHANGELOG
        qa-complexity.constant.ts         # QaComplexity: SIMPLE/MULTI_STEP/EDGE_CASE (AI-049)
        chunking-config.constant.ts       # CHUNKING_CONFIG — chunkSize/chunkOverlap/minChunkSize/separators hardcoded defaults
        rag-config.constant.ts            # RAG_CONFIG — topK/similarityThreshold/maxContextTokens/systemPrompt/noInfoSentinel (AI-049: extracted from systemPrompt into its own field, shared verbatim with generateQAPairs()'s edge-case expectedAnswer)
        embedding-config.constant.ts      # EMBEDDING_CONFIG — model/dimensions/batchSize/maxRetries hardcoded defaults
        pinecone-config.constant.ts       # PINECONE_CONFIG — namespace/metric hardcoded defaults
      types/
        rag.types.ts                # DocumentEntity, DocumentChunkEntity, DocumentWithChunks, PaginatedDocumentsResult (AI-041); ChunkDescriptor (AI-042); IngestionStatusResult, PaginatedChunksResult (AI-044); SearchOptions, SearchResult (AI-045); RagOptions, RagSource, RagResult (AI-046); MockOptions (AI-048); QaPairEntity (AI-049); EvaluationClassification, EvaluationComplexityBreakdown, EvaluationResult (AI-050)
      dto/
        index.ts                          # barrel — re-exports all request and response DTO classes
        create-document.dto.ts            # CreateDocumentDto — title?, description?, sourceType (@IsIn DocumentSourceType), category?, tags?
        create-document-text.dto.ts       # CreateDocumentTextDto — OmitType(CreateDocumentDto, ['sourceType']) + required content: string (AI-043)
        update-document.dto.ts            # UpdateDocumentDto — PartialType(OmitType(CreateDocumentDto, ['sourceType']))
        query-documents.dto.ts            # QueryDocumentsDto — category?, status?, tags? (comma-sep), search?, page?, limit?
        query-chunks.dto.ts               # QueryChunksDto — PickType(QueryDocumentsDto, ['page', 'limit']) (AI-044)
        document-res.dto.ts               # DocumentResDto — full Document row fields (publicId, not id)
        document-chunk-res.dto.ts         # DocumentChunkResDto — publicId, chunkIndex, content, tokenCount, startChar, endChar, embeddingStatus, createdAt
        document-with-chunks-res.dto.ts   # DocumentWithChunksResDto — DocumentResDto + chunks: DocumentChunkResDto[]
        paginated-documents-res.dto.ts    # PaginatedDocumentsResDto — data[], total, page, limit
      services/
        embedding.service.ts        # EmbeddingService — still an empty shell (AI-037); embeddings are generated via OpenaiService.generateEmbedding()/generateEmbeddingsBatch() (AI-038) called directly by DocumentService/SearchService, not through this wrapper — see AI-038's Follow Ups
        embedding-cache.service.ts  # EmbeddingCacheService — get/set/invalidate/getCacheStats, SHA-256-normalized-text hash key, in-memory hit/miss counters (AI-039)
        pinecone.service.ts         # PineconeService — upsert/query/deleteByIds/deleteByFilter/describeIndex, constructs Pinecone client directly (no DI token), namespace-scoped, not-configured guard (AI-040)
        document.service.ts         # DocumentService — CRUD subset (create/findAll/findOne/update/delete), metadata lifecycle only, two-step delete cascades to Pinecone via deleteByFilter (AI-041); parseSource()/chunkText() — PDF via pdf-parse, TXT/MD direct UTF-8 decode, RecursiveCharacterTextSplitter with a TokenService.countTokens()-backed lengthFunction, startChar/endChar via indexOf, trailing sub-minChunkSize chunk merge (AI-042); createFromText()/private ingestDocument()/embedChunks() — cache-checked, batched embedding + Pinecone upsert + DocumentChunk persistence + embeddingStatus pending→processing→completed/failed (AI-043); ingestFromFile()/reindexDocument()/getIngestionStatus()/getChunks() — file-extension-derived sourceType validation, offset-based text reconstruction for reindexing, paginated chunk reads (AI-044)
        search.service.ts           # SearchService — search()/searchWithScores() semantic search: cache-aware query embedding (EmbeddingCacheService → OpenaiService.generateEmbedding() on miss), Pinecone query with topK + categoryFilter/documentIds metadata filter, similarityThreshold pre-filter, results resolved to full chunk text + document title via a single documentChunk.findMany({ pineconeId: { in } , include: { document: true } }) join, re-ordered to match Pinecone's own ranking (AI-045)
        rag.service.ts               # RagService — query() implemented: SearchService.search() retrieval + augmented-prompt generation via OpenaiService.chatCompletionWithMessages(), sources built from actual search results (not parsed from model output), independent search/generation latency (AI-046); queryWithConversation() — splices retrieved chunks into ChatService.buildContext()'s last (just-persisted) user message content only, never a new message role, persists via addUserMessage()/addAssistantMessage() so storage is indistinguishable from a normal Phase 2 turn, drops lowest-ranked chunks first if the spliced content would exceed chatConfig's context-window budget (AI-047)
        mock-data.service.ts        # MockDataService — generateDocuments(count, options?) implemented: 5 category-specific template builders (guide/faq/docs/tutorial/changelog) injecting faker-generated names/dates/versions into structural elements (headings, numbered steps, dated version blocks — not filler text), round-robin category distribution, word-count-bounded section assembly, each document created+ingested via DocumentService.createFromText() (AI-048); generateQAPairs(count, documentIds?)/seedDefaultDataset() implemented: direct document+chunks read via DatabaseService, 60/25/15 simple/multi-step/edge-case split (rounding remainder absorbed into edge-case), simple expectedAnswer is exactly one chunk's content, multi-step compares two documents (or two chunks of one, as a fallback), edge-case cycles a hardcoded scenario pool paired with RAG_CONFIG.noInfoSentinel, bulk-persisted via qaPair.createMany() (AI-049); evaluate(sampleSize?) implemented: bounded (default 50, hard-capped 200) sequential RagService.query() runs over persisted QaPair rows, edge-case classified appropriateIDK/incorrect via IDK-phrase matching (never content similarity), simple/multi-step classified correct/partiallyCorrect/incorrect via a keyword-overlap-ratio heuristic, aggregated into the spec §6.5 shape with tier-dependent byComplexity.correct semantics (AI-050)
      __tests__/
        embedding-cache.service.spec.ts  # EmbeddingCacheService unit tests — DeepMockProxy<DatabaseService>, hit/miss/normalization/invalidate/getCacheStats (9 tests)
        pinecone.service.spec.ts         # PineconeService unit tests — @pinecone-database/pinecone mocked entirely via jest.mock(), all five methods' argument shapes + not-configured guard (11 tests)
        document.service.spec.ts         # DocumentService unit tests — DeepMockProxy<DatabaseService>, PineconeService mocked as a plain jest.fn() object; create/findAll (filters+pagination)/findOne (incl. empty-chunks)/update/two-step delete + not-found guards (13 tests)
        document-dtos.spec.ts            # class-validator validate() smoke tests for CreateDocumentDto/UpdateDocumentDto/QueryDocumentsDto (8 tests)
        document-parse-chunk.service.spec.ts  # DocumentService.parseSource()/chunkText() unit tests — pdf-parse mocked at the module level (real PDFParse can't run under Jest's CJS transform, see AI-042's CLAUDE.md section), TokenService.countTokens() stubbed with a word-count fake tokenizer; TXT/MD decode, PDF extraction/textless/invalid-buffer, overlap verification, startChar/endChar accuracy, token-aware sizing, trailing-chunk merge + no-merge (10 tests)
        document-ingestion.service.spec.ts  # DocumentService.createFromText()/ingestDocument()/embedChunks() unit tests — chunkText() stubbed via jest.spyOn to isolate pipeline sequencing; full call-order assertion (status→cache-check→embed→cache-set→upsert→persist→status), vector id/metadata shape, DocumentChunk row shape, totalChunks/totalTokens accuracy, all-cache-hit skips embedding entirely, mixed hit/miss preserves original chunk order, batch-size grouping, mid-pipeline failure resolves (not throws) with embeddingStatus 'failed' (10 tests)
        document-upload-reindex.service.spec.ts  # DocumentService.ingestFromFile()/reindexDocument()/getIngestionStatus()/getChunks() unit tests — parseSource()/chunkText() stubbed via jest.spyOn; unsupported/missing-extension rejection before parseSource() is called, sourceType/originalFilename/fileSize population from a hand-built Express.Multer.File fixture, offset-based text reconstruction correctness across overlapping chunk rows, prior chunks/vectors deleted before re-ingestion, ingestion status read, paginated chunk listing + not-found guards (13 tests)
        search.service.spec.ts           # SearchService unit tests — DeepMockProxy<DatabaseService>, OpenaiService/EmbeddingCacheService/PineconeService mocked as plain jest.fn() objects; cache-hit-skips-embed and cache-miss-embeds-and-caches, relevant result ranks first (re-ordered to Pinecone's ranking, not DB order), below-threshold exclusion, categoryFilter/documentIds/combined filter shapes, custom topK, empty-match-array and orphaned-vector-row edge cases, searchWithScores() delegation (11 tests)
        rag.service.spec.ts              # RagService unit tests — SearchService/OpenaiService/ChatService/TokenService/ModelRegistryService mocked as plain jest.fn() objects, ChatService's module mocked at the DatabaseService level (transitive Prisma-client-load gotcha). query(): system-message-verbatim, numbered/tagged context block includes every chunk, temperature default+override, topK/categoryFilter passthrough, sources built from SearchService not model output, zero-results-still-generates, usage/cost/model from generation call, independently-measured latency fields, model passthrough (10 tests). queryWithConversation(): getConversationHandle()+buildContext() call assertions, addUserMessage()/addAssistantMessage() persistence shape, chunks spliced into the last message only (no new role introduced), deterministic-fake-tokenizer-driven budget test proving chunk-count reduction rather than history trimming, options.model-falls-back-to-conversation-model, whitespace-only-question rejection, zero-results path (7 tests)
        mock-data.service.spec.ts        # MockDataService unit tests — DocumentService.createFromText() mocked as a plain jest.fn(), @faker-js/faker mocked at the module level (ESM-only package, same class of Jest/CJS-transform gotcha as pdf-parse — see AI-042) with deterministic fixed-length paragraph/sentence output, DeepMockProxy<DatabaseService> for QaPair persistence, RagService.query() mocked as a plain jest.fn(). generateDocuments(): call-count-matches-requested-count, round-robin category distribution + options.categories narrowing, word-count-bounds (default and narrow custom ranges), tags every document 'mock-data', one structural-marker test per category, embeddingStatus pass-through never 'pending' (12 tests). generateQAPairs() (AI-049): exact 60/25/15 split, where-clause narrowing via documentIds, simple expectedAnswer equals one real chunk, edge-case expectedAnswer equals RAG_CONFIG.noInfoSentinel + question unrelated to any chunk, multi-step cross-document vs. single-document fallback, empty-chunk documents skipped, BadRequestException on an empty usable pool, qaPair.createMany() persisted with the internal BigInt id (9 tests). seedDefaultDataset(): generateDocuments()/generateQAPairs() stubbed via jest.spyOn to isolate orchestration — call arguments and returned counts (1 test). evaluate() (AI-050): default/clamped sample size against qaPair.findMany()'s take argument, edge-case IDK-phrase detection both ways (declines correctly vs. confidently-wrong-but-keyword-adjacent), simple-tier correct/partiallyCorrect/incorrect keyword-overlap-ratio buckets, fixture-driven aggregate math (totals/accuracy/avgLatencyMs/avgTokens), byComplexity.edge-case's "declined correctly" semantics, empty-pool zeroed result with zero RagService.query() calls (10 tests) (32 tests total)
prisma/
  schema.prisma          # User, AuditLog, EmbeddingCache, AiAuditLog, AiProvider, AiModel, PromptTemplate, ChatConversation, ChatMessage, ChatTool, Document, DocumentChunk, QaPair models
  seed.ts                # idempotent seed — 6 AI providers + 3 manual OpenAI models (source="manual") + 6 prompt templates, all via upsert; BROKEN under Prisma v7 (see Known gap below) — templates were seeded via POST /openai/templates instead
scripts/
  patch-prisma-client.cjs  # post-generate patch — replaces import.meta.url with __dirname; auto-run by prisma:generate
prisma.config.ts         # Prisma v7 config — datasource URL lives here, not in schema.prisma
generated/prisma/        # gitignored — regenerated by prisma:generate (always use npm run prisma:generate, not prisma generate directly)
```

**Known gap**: `npm run prisma:seed` is broken under Prisma v7, with no working invocation path:

- Plain `ts-node` fails with `Cannot find module './internal/class.js'` — Prisma v7's generated
  `client.ts` uses ESM-style relative imports with explicit `.js` extensions that only resolve
  through NestJS's own build/watch toolchain, not raw `ts-node -r tsconfig-paths/register`.
  (`npm run dev` is unaffected.)
- ~~Running the compiled `dist/prisma/seed.js` instead~~ — verified broken too (2026-07-10):
  Prisma v7's runtime requires an explicit adapter, so `seed.ts`'s bare `new PrismaClient()`
  (behind its `@ts-expect-error`) throws `PrismaClientInitializationError` at construction,
  regardless of how the file is compiled or invoked. Fixing the script for real means
  constructing it with `new PrismaPg({ connectionString: process.env['DATABASE_URL'] })`, the
  same way `DatabaseService` does.

In practice neither half of the seed blocks anything: `ai_providers`/`ai_models` are populated by
`OpenRouterSyncService.onModuleInit()` from the live OpenRouter API on every app startup
(verified: 340 models across 56 providers on a fresh DB), and the 6 prompt templates were seeded
into the dev database via the app's own `POST /openai/templates` API (2026-07-10, during the FE
browser-verification session) — the definitions in `prisma/seed.ts` match
`CreatePromptTemplateDto` field-for-field, so they can be re-seeded the same way against a fresh
DB with a small script that extracts the `templates` array and POSTs each entry.

## Prisma v7 Breaking Changes

Prisma 7 changed the architecture significantly. These differ from every pre-v7 tutorial:

- **Generator name**: `"prisma-client"` not `"prisma-client-js"`
- **Output location**: `../generated/prisma` (outside `node_modules`)
- **Import path**: `from '../../generated/prisma/client'` — no `index.ts`, entry point is `client.ts`
- **Datasource URL**: moved from `schema.prisma` to `prisma.config.ts` at the project root
- **Config file**: `prisma.config.ts` is created by `prisma init` and must stay at the root

When importing the Prisma client:

```typescript
import { PrismaClient } from '../../generated/prisma'; // wrong — no index.ts
import { PrismaClient } from '../../generated/prisma/client'; // correct
```

**Adapter required at runtime**: Prisma v7 no longer reads `DATABASE_URL` from the environment
automatically. The runtime requires an explicit database adapter. Install `@prisma/adapter-pg`
and pass it in `DatabaseService`:

```typescript
import { PrismaPg } from '@prisma/adapter-pg';

export class DatabaseService extends PrismaClient {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }) });
  }
}
```

`process.env['DATABASE_URL']` is safe here because `ConfigModule.forRoot()` (which calls
`dotenv.config()`) initialises before `DatabaseModule` in `AppModule.imports`, and
`env.validation.ts` has already validated that `DATABASE_URL` is non-empty.

**Standalone scripts** (`prisma/seed.ts`) are also subject to the adapter requirement. The
script's current bare construction —

```typescript
// @ts-expect-error: seed scripts run via `prisma:seed` where the CLI handles the connection
const prisma = new PrismaClient();
```

— was assumed to work because the Prisma CLI reads the datasource from `prisma.config.ts`, but
this is **verified false at runtime** (2026-07-10): the constructor throws
`PrismaClientInitializationError` with no adapter, even when run as compiled
`dist/prisma/seed.js`. A standalone script that actually needs the client must construct it with
the `PrismaPg` adapter exactly like `DatabaseService` does (see the seed Known gap above for the
API-based workaround used instead).

**Node.js 20.19+ ESM/CJS conflict (auto-patched)**: The generated `client.ts` contains
`import.meta.url` (ESM-only syntax). Node.js 20.19+ detects `import.meta` as ESM and loads the
file via the ESM module loader — where `exports` is undefined — breaking NestJS's CJS output.

The fix is applied automatically by `npm run prisma:generate` via `scripts/patch-prisma-client.cjs`,
which replaces `import.meta.url` with the CJS-native `__dirname`:

```typescript
// Prisma generates (ESM — breaks Node.js 20.19+ in CJS mode):
globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url));

// Patched to (CJS-native):
globalThis['__dirname'] = __dirname;
```

Do NOT run `prisma generate` directly — always use `npm run prisma:generate` so the patch is
re-applied.

**Jest / ESM incompatibility**: The generated client uses `import.meta.url` (ESM-only). Jest runs
in CommonJS mode and cannot execute this. Any test file that imports `DatabaseService` (which
imports `PrismaClient`) must mock the service module to avoid loading the generated client:

```typescript
// Then import normally — TypeScript still sees the real type for mockDeep<>
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import { DatabaseService } from '../../../database/database.service';

// At the top of the spec file (Jest hoists jest.mock() before imports)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const dbMock: DeepMockProxy<DatabaseService> = mockDeep<DatabaseService>();
```

`import type` imports from the generated client are safe — they are stripped before execution.

**`onModuleInit()` in tests**: `TestingModule.compile()` does NOT automatically call
`onModuleInit()` on individually provided services (that hook runs on a full `NestApplication`
via `app.init()`). Call it explicitly after getting the service:

```typescript
const module = await Test.createTestingModule({ ... }).compile();
const service = module.get<MyService>(MyService);
service.onModuleInit(); // required for services that implement OnModuleInit
```

## TypeScript Config Gotchas

`tsconfig.json` has `"module": "nodenext"` and `"isolatedModules": true`. This means:

- **`import type` is required for type-only imports** — the `consistent-type-imports` ESLint rule
  enforces this automatically. Interfaces used in decorated constructor parameters must use
  `import type` (or inline `type` modifier) — otherwise tsc errors with TS1272.
- **Inline type syntax** (preferred by the formatter): `import { Foo, type Bar } from 'pkg'`
- **Directory imports without index.ts fail** — always import the specific file.

## Architectural Decisions

### Global providers (registered via token in AppModule)

- `APP_GUARD` → `ThrottlerBehindProxyGuard` — rate limiting on every route
- `APP_FILTER` → `HttpExceptionFilter` — consistent error shape on every route
- `APP_INTERCEPTOR` → `ResponseInterceptor` — wraps every success response

### Response envelope

All success responses are wrapped automatically:

```json
{ "success": true, "data": <controller return value>, "timestamp": "<ISO>" }
```

All error responses follow:

```json
{ "statusCode": 4xx/5xx, "message": "...", "error": "...", "timestamp": "<ISO>", "path": "/..." }
```

### Request correlation

Every request gets a `requestId` (via `crypto.randomUUID()`) attached to `X-Request-Id` response
header and propagated through the entire async call chain via `AsyncLocalStorage`. The logger
reads it automatically — no need to pass it through function signatures.

### Rate limiting

`@nestjs/throttler` v6 — TTL is in **milliseconds** in the module config, but `THROTTLE_TTL` env
var is stored in **seconds** (the conversion `* 1000` happens in `ThrottlerModule.forRootAsync`).
Throttler is named `'default'` — `@Throttle()` calls must use `{ default: { ttl, limit } }`.

### Config namespaces

Access config values via:

```typescript
configService.get<number>('app.port');
configService.get<string>('openai.apiKey');
// namespaces: app, database, jwt, openai, pinecone, throttle, chat
```

### Chat config namespace (Phase 2 foundation)

`chatConfig` (`src/config/app.config.ts`, namespace `'chat'`) backs the upcoming chat/streaming/
function-calling module (Phase 2): `maxContextMessages` (`CHAT_MAX_CONTEXT_MESSAGES`, default
`50`), `contextWindowPercentage` (`CHAT_CONTEXT_WINDOW_PERCENTAGE`, default `0.8`), `toolTimeoutMs`
(`CHAT_TOOL_TIMEOUT_MS`, default `10000`), `httpToolTimeoutMs` (`CHAT_HTTP_TOOL_TIMEOUT_MS`,
default `5000`), `autoTitle` (`CHAT_AUTO_TITLE`, default `true`), `httpToolAllowedDomains`
(`CHAT_TOOL_HTTP_ALLOWED_DOMAINS`, comma-separated, default `[]`), and a hardcoded
`defaultContextWindow` of `128000`. All six env vars are `@IsOptional()` in `env.validation.ts`
since every one has a default.

The `chat_conversations` / `chat_messages` / `chat_tools` tables follow the same `BigInt` PK +
`publicId` UUID pattern as Phase 1's `AiAuditLog`/`AiModel`. `ChatMessage.conversation` uses
`onDelete: Cascade` — deleting a conversation deletes all its messages. `ChatMessage` has no
`updatedAt` (append-only, like `AiAuditLog`). `ChatMessage` also has a `metadata Json? @db.JsonB`
column (added in a follow-up migration during AI-020, `20260706180939_add_chat_message_metadata`)
— not in the original AI-015 spec table, added specifically to hold `{ incomplete: true }` for
partial assistant messages saved on a stream error/disconnect (spec §7.3), keeping `toolCalls`
semantically pure (assistant tool-call requests only).

### OpenaiService.chatCompletionWithMessages() (AI-018)

Additive to Phase 1's `chatCompletion()` (single `prompt` string) — `chatCompletionWithMessages()`
accepts a full `OpenAI.Chat.ChatCompletionMessageParam[]` array plus an optional
`tools?: OpenAI.Chat.ChatCompletionTool[]`, for multi-turn conversations and function-calling. This
is the seam `AiChatModule` calls through for every LLM call; `AiChatModule` must never call the
OpenAI SDK directly. `tools` is spread into the SDK request only when provided (same
optional-spread pattern as `temperature`/`maxTokens`). `ChatCompletionResult` gained an optional
`toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[]`, populated from
`response.choices[0]?.message.tool_calls` when the model requests tool calls.

Both methods share their retry/audit/error-mapping tail via a private `executeCompletion()`
helper — `chatCompletion()` builds its `messages` array from `prompt`/`systemPrompt` as before and
delegates; `chatCompletionWithMessages()` passes its `messages` through as-is. Since an arbitrary
message array doesn't map cleanly to the audit log's `systemPrompt`/`userMessage` fields, they're
derived best-effort (not exhaustively) via a private `extractTextContent()` helper: the first
`system`-role message's `content` and the last `user`-role message's `content`, each only if the
content is a plain `string` (multi-part `ChatCompletionContentPart[]` content resolves to
`undefined`/`''`).

### AiChatModule scaffold (Phase 2 foundation)

`src/modules/ai-chat/` is registered in `AppModule.imports` next to `OpenaiModule`. It imports
`OpenaiModule` (for `OpenaiService`/`TokenService`/`ModelRegistryService`) and exports only
`ChatService` — matching `OpenaiModule`'s "only export what's needed externally" convention. The
dependency direction is one-way: `AiChatModule` → `OpenaiModule`, never the reverse.

Four services are registered as providers — `ChatService`, `StreamingService`,
`ToolRegistryService`, `ToolExecutorService`. As of AI-016, `StreamingService`,
`ToolRegistryService`, `ToolExecutorService` remain **empty shells**: a `@Injectable()` class with
only a constructor (`DatabaseService`/`AppLoggerService`/`ConfigService`), no method bodies — they
will gain their real dependencies (e.g. `HttpModule` for `ToolExecutorService`'s `'http'`-handler
tools) as their method bodies land in AI-023 through AI-029. No `ChatController` exists yet —
that's AI-031.

`ChatService` (`services/chat.service.ts`) has its conversation-lifecycle methods (AI-019),
message-append methods (AI-020), and `buildContext()` (AI-021) implemented: `createConversation`/
`findAllConversations`/`findConversation`/`updateConversation`/`archiveConversation`/
`deleteConversation`/`addUserMessage`/`addAssistantMessage`/`addToolResult`/`buildContext`. It also
carries the cross-service deps (`OpenaiService`, `TokenService`, `ModelRegistryService`) —
`buildContext()` is the first method to actually use `TokenService`/`ModelRegistryService`.
`sendMessage`/`sendMessageStream` still don't exist (AI-022/AI-027/AI-028). `deleteConversation()`
is a hard delete relying on the schema's `onDelete: Cascade` (AI-015) rather than manually deleting
messages first. `createConversation()`'s `model` fallback chain mirrors
`OpenaiService.chatCompletion()`'s exactly: `params.model ?? config.get('openai.defaultModel') ??
OpenAIModel.GPT_4O`.

**Auto-title** (`ChatService.maybeSetAutoTitle()`, private): triggered from `addUserMessage()`,
gated on `chatConfig.autoTitle` (checked first, before any DB read) and on the conversation's
`title` still being `null` — never overwrites a user-set or already-generated title. Title format
is `` `${content.slice(0, 50)}...` `` (plain `.slice()`, not grapheme-safe — a deliberate, simpler
reading of spec FR-CH-015's literal "first 50 characters" wording; always appends `"..."` even for
short messages, since the spec doesn't gate the ellipsis on length).

**`buildContext(conversationId)`** (AI-021): implements spec §9's sliding window. Fetches the
conversation with `messages: { orderBy: { createdAt: 'desc' }, take: chatConfig.maxContextMessages
}` (a lighter, capped query — not `findConversation()`'s unbounded one), reverses to oldest-first,
then trims from the front while more than one message remains and the running token total (system
prompt + all messages, via the now-cached `TokenService.countTokens()`) exceeds `contextWindow *
chatConfig.contextWindowPercentage`. `contextWindow` comes from
`ModelRegistryService.findModelByModelId(conversation.model)?.contextWindow`, falling back to
`chatConfig.defaultContextWindow`. If a single remaining message alone still exceeds the budget,
its `content` is truncated (shrink-by-ratio against real token counts) rather than dropped — the
system prompt itself is always synthesized as `{ role: 'system', content }` and is never dropped or
counted as a stored `ChatMessage` row. Mapped `ChatCompletionMessageParam` entries carry
`tool_call_id` for `role: 'tool'` rows and `tool_calls` for assistant rows that have them.

`constants/` holds `ChatMessageRole`, `ToolHandlerType`, `StreamEventType`, `ConversationStatus`
(one enum per file) and `CONTEXT_CONFIG` (a fallback constant for context-window defaults —
`ChatService` should prefer reading `chatConfig` via `ConfigService` at call sites, falling back to
this constant only where config isn't injected, mirroring how `RetryService` uses `RETRY_CONFIG`
alongside `openai.*` config reads). `types/ai-chat.types.ts` holds the DB-row entity shapes
(`ConversationEntity`, `ChatMessageEntity`, `ToolEntity`) plus the streaming/tool-execution
interfaces (`StreamEvent`, `ToolCallData`, `ToolExecutionResult`) per spec §5.2/§5.4, plus
`PaginatedConversationsResult`/`ConversationWithMessages`/`AddAssistantMessageParams` (the latter
stands in for a request DTO since it represents `ChatService`'s internal write of an OpenAI
response, not a client-supplied payload).

### ai-chat DTOs (AI-030)

`src/modules/ai-chat/dto/` mirrors `openai/dto/`'s conventions exactly (barrel `index.ts`,
`PartialType()`/`OmitType()` for update DTOs, `@ApiProperty()` on every response field, reuses
Phase 1's `@IsValidModel()` decorator and `UsageDto`). `model` fields on `CreateConversationDto`
and `SendMessageDto` are typed `OpenAIModel` for editor autocomplete even though `@IsValidModel()`
also accepts OpenRouter-style `provider/model:variant` strings — same convention as
`ChatCompletionDto`/`TokenCountDto`.

**`UpdateConversationDto`** = `PartialType(OmitType(CreateConversationDto, ['toolsEnabled']))` —
per spec §6.1, `PATCH /conversations/:publicId` only updates title/systemPrompt/model;
`toolsEnabled` is fixed at creation time and dropped from the update surface entirely (not just
optional).

**`ChatService` signatures now use the real DTOs** where they match field-for-field:
`findAllConversations(query: QueryConversationsDto)` and
`updateConversation(publicId, params: UpdateConversationDto)`. `createConversation()` keeps the
`CreateConversationParams` interface (now `extends CreateConversationDto`) because it also needs
`userId`/`metadata` — request-context fields the controller (AI-031) will supply alongside the
DTO, not part of the client-facing payload.

Response DTOs (`ConversationResDto`, `MessageResDto`, `ConversationWithMessagesResDto`,
`AssistantMessageResDto`, `ToolResDto`, `PaginatedConversationsResDto`) are Swagger-annotated
shapes only — matching Phase 1's `openai.controller.ts` pattern where services return entity
objects typed as the ResDto for documentation purposes, with no explicit runtime mapping step. No
controller consumes them yet (AI-031/032/033).

**Known gap**: a real `DatabaseService` cannot be instantiated inside a Jest unit test in this
repo — `Cannot find module './internal/class.js'` — because the generated Prisma client's
`.js`-extension relative imports only resolve through NestJS's own build/watch pipeline, not
ts-jest (same root cause as the `prisma:seed` gap documented above). This means Postgres's real
`ON DELETE CASCADE` behavior (verified directly in AI-015's migration SQL) can't be proven by a
`DeepMockProxy<DatabaseService>`-based unit test — `chat.service.spec.ts`'s `deleteConversation()`
tests only assert the right `publicId` is targeted, with the limitation documented inline.

The rest of Phase 2's module/service logic is still pending (see
`docs/prd/2026-07-06-chat-streaming-function-calling.md` and `docs/issues/AI-017` onward).

### ChatService.sendMessage() — orchestration + two-call tool-calling protocol (AI-022/AI-027)

`sendMessage(conversationPublicId, dto): Promise<AssistantMessageResDto>` drives a full request
through the chat pipeline (spec §2.2): look up the conversation (`NotFoundException` if missing) →
reject whitespace-only `content` (`BadRequestException` — `SendMessageDto`'s `@IsNotEmpty()` alone
doesn't catch `"   "`) → `addUserMessage()` (persisted **before** the model call, so a mid-request
crash leaves a recoverable state) → `callModel()` (builds context via `buildContext()`, AI-021,
and conditionally attaches tool definitions) → branches on the result.

`dto.model`/`temperature`/`maxTokens` override the conversation's stored defaults **for this call
only** — `sendMessage()` never calls `chatConversation.update()`, so `conversation.model` in the
DB is unchanged afterward.

**Non-tool path** (`conversation.toolsEnabled: false`, or the model didn't request a tool):
`persistAssistantResponse()` persists the assistant message and returns the plain-object
`AssistantMessageResDto` shape (`messageId`, `role: 'assistant'`, `content`, `model`, `toolCalls`,
`usage`, `estimatedCost`, `latencyMs`) — same convention as the rest of the codebase (services
return plain objects typed as the ResDto shape, no runtime class instantiation).

**Tool-calling path** (AI-027, spec §2.4/§8.1 two-call protocol — only reachable when
`conversation.toolsEnabled` is true **and** the first call returns non-empty `toolCalls`):
`handleToolCalls()` persists the tool-decision assistant message (`content: null` when the model
returned no text, not `''` — the spec's stated nullable-content invariant for tool-calls-only
messages), narrows `toolCalls` to `ChatCompletionMessageFunctionToolCall` (the installed `openai`
SDK's `ChatCompletionMessageToolCall` is a union with `ChatCompletionMessageCustomToolCall`, which
this app never produces since `ToolRegistryService.getToolDefinitions()` only emits `type:
'function'`), runs every tool call concurrently via `Promise.all(...)` →
`toolExecutorService.execute()` (AI-026, never rejects) → `addToolResult()` per call, then calls
`callModel()` a **second** time with `withTools: false` (the model synthesizes an answer from the
tool results now in context, it isn't offered tools again) and persists that as the final
response. Both LLM calls go through the same audited `OpenaiService.chatCompletionWithMessages()`
seam (AI-018) — the "two independently audited calls per tool-augmented turn" invariant (FR-CH-010)
holds structurally, since the second call is a fresh `callModel()` invocation, never a reuse of the
first result.

An unparseable tool-call `arguments` JSON string falls back to `{}` rather than crashing the turn
— `ToolExecutorService`'s existing missing-arg validation degrades that gracefully on its own.

**Resolved by AI-034**: the SC-CH-013 "1 tool-triggering turn → 2 `ai_audit_logs` rows" assertion —
deferred here since at `chat.service.spec.ts`'s test seam `OpenaiService` is mocked wholesale, so
`AiAuditService.log()` never actually runs — is proven by
`chat-function-calling.integration.spec.ts`, which wires the real `OpenaiService`/`RetryService`/
`AiAuditService`/`ToolExecutorService`/`ToolRegistryService` through a `TestingModule` and mocks
only `DatabaseService` and the `OPENAI_CLIENT` token, asserting `dbMock.aiAuditLog.create` is
called exactly twice for the turn.

### ChatController — conversation CRUD endpoints (AI-031)

`ChatController` (`src/modules/ai-chat/chat.controller.ts`) is `AiChatModule`'s first controller
— registered in the module's `controllers: []` array (previously absent) and mounted at
`/api/v1/chat` (spec §6.1). Six routes, each a thin delegate to `ChatService` (AI-019) with no
business logic in the controller, following `openai.controller.ts`'s exact conventions
(`@ApiTags('ai-chat')`, `@ApiEndpoint({...})` per route, `@ApiNoContentResponse` +
`@HttpCode(HttpStatus.NO_CONTENT)` on the two 204 routes):

- `POST /chat/conversations` → `createConversation()`
- `GET /chat/conversations` → `findAllConversations()`
- `GET /chat/conversations/:publicId` → `findConversation()`
- `PATCH /chat/conversations/:publicId` → `updateConversation()`
- `DELETE /chat/conversations/:publicId` → `deleteConversation()` — 204, cascades to messages
- `POST /chat/conversations/:publicId/archive` → `archiveConversation()` — 204

Three private mappers (`toConversationRes`, `toMessageRes`, `toConversationWithMessagesRes`)
convert `ChatService`'s entity types to the AI-030 response DTOs — `?? undefined` on nullable
entity fields (`title`, `systemPrompt`, message fields), since the DTOs use
`@ApiPropertyOptional()` semantics.

Both things this issue's spec text asked to "double-check" were already in place from AI-016: the
`'ai-chat'` Swagger tag in `main.ts`'s `DocumentBuilder`, and `AiChatModule` in
`AppModule.imports`. The only actual wiring change was adding `ChatController` to the module.

**Verified live** (not just unit-tested): booted `npm run dev` against a real Postgres instance,
confirmed all six routes in the boot log with no DI errors, then exercised every route with
`curl` — including the `messages: []` guarantee on a fresh conversation, 404 on a deleted
conversation, 400 on an invalid `model` string via the global validation pipe, and the `ai-chat`
Swagger tag on every operation via `/api/docs-json`. No automated controller tests yet — deferred
to AI-034 by this issue's own design (`class-validator` `validate()` pattern, matching
`openai.controller.spec.ts`, not a full `TestingModule`).

### ChatController — send-message + tools CRUD endpoints (AI-032)

Extends `ChatController` (same file as AI-031) with the message and tools surface:

- `POST /chat/conversations/:publicId/messages` — a pure one-line delegate to
  `ChatService.sendMessage()` (AI-022/AI-027). No response mapping needed — `sendMessage()`
  already returns a plain object shaped exactly as `AssistantMessageResDto`. `successStatus: 201`,
  matching `openai.controller.ts`'s precedent for LLM-call-triggering POST routes.
- `GET /chat/tools`, `POST /chat/tools`, `PATCH /chat/tools/:publicId`,
  `DELETE /chat/tools/:publicId` — thin delegates to `ToolRegistryService` (AI-023), injected
  into `ChatController` alongside `ChatService` (no module change — already a provider in
  `AiChatModule`). New private mapper `toToolRes()` casts `ToolEntity.handlerType` (`string`) to
  `ToolHandlerType` at the mapping boundary, same pattern as `ModelRegistryService`'s DB-sourced
  enum-like columns.

**Verified live**: tools CRUD fully exercised end to end (create → update → deactivate → confirmed
via `GET /chat/tools` that the row persists with `isActive: false` rather than disappearing) and
the messages route's validation/error paths (empty/missing `content` → 400, unknown conversation → 404) — all instant, no LLM call needed. **Known gap**: the full "send a calculator-triggering
message, get back the numeric answer" live smoke test could not complete — the configured free
OpenRouter model (`meta-llama/llama-3.3-70b-instruct:free`) was too slow to respond within
`RetryService`'s backoff window across several minutes of retries. The HTTP-layer wiring up to and
including the actual model call was confirmed correct (DTO validation, conversation lookup,
context building, tool-definition fetching, and retry backoff all engaged as designed); only the
third-party model's response time was the blocker — exactly the flakiness this codebase's own docs
already anticipate for live free-tier calls (see AI-025's and AI-035's notes). AI-034 should retry
this with a faster model or a longer time budget.

### ToolRegistryService (AI-023)

`ToolRegistryService` (`src/modules/ai-chat/services/tool-registry.service.ts`) is the single
source of truth for what tools exist and are active, and the only service that knows how to
convert a `chat_tools` row into the exact shape OpenAI's `tools` API parameter expects. Six
methods: `findAllTools`, `findActiveTool` (throws `NotFoundException` for a missing **or**
inactive tool — `ToolExecutorService`, AI-026, will catch this), `createTool` (throws
`ConflictException` on a duplicate `name`, P2002, via the same `isP2002()` helper pattern as
`ModelRegistryService.createModel()`), `updateTool`, `deleteTool` (soft delete —
`isActive: false`, never hard-deleted), and `getToolDefinitions()` (active tools only, mapped to
`{ type: 'function', function: { name, description, parameters } }` — spec §5.3's exact shape,
since this payload is forwarded directly to OpenAI's API and any shape drift causes a silent
400 downstream).

**`onModuleInit()`** upserts the three `BUILTIN_TOOLS` (`constants/builtin-tools.constant.ts` —
`calculator`/`weather`/`datetime`, JSON Schema `parameters` copied verbatim from spec §8.2) by
`name` on every boot, mirroring `OpenRouterSyncService`'s idempotent-upsert-on-startup precedent
(errors are logged and swallowed, not rethrown, so a transient DB issue during seeding can't crash
app boot). This is also what AI-017 ("seed built-in tools") asked for — since AI-017 hadn't been
implemented yet when this landed, its seeding requirement was folded directly into this service
rather than migrated from a placeholder, and AI-017 should be closed as satisfied-by-AI-023 rather
than re-implemented.

`parameters`/`handlerConfig` are Prisma `Json`/`JsonB` columns — writes are cast through
`Prisma.InputJsonValue` (same pattern `ChatService` already uses for `metadata`/`toolCalls`), since
a plain `Record<string, unknown>` doesn't structurally satisfy Prisma's generated JSON input type.

Not exported from `AiChatModule` — like `ChatService`'s other same-module collaborators,
`ToolExecutorService` (AI-026) will inject it directly without needing a module export.

### Built-in tools — calculator & datetime (AI-024)

`src/modules/ai-chat/tools/` holds the built-in tool implementations. Calculator and datetime are
**plain exported functions, not NestJS services** — `ToolExecutorService` (AI-026) dispatches to
them via a `Record<string, (args) => Promise<unknown>>` map keyed by tool name, so they need to be
directly importable rather than injected. (Weather, AI-025, is the one exception — see below.)

`calculator.tool.ts` exports `executeCalculator({ expression })`, using `mathjs`'s `evaluate()`
exclusively — verified that `mathjs` never falls through to JS `eval`/`new Function` (a malicious
input like `alert('x')` throws mathjs's own "Undefined function" error, since `evaluate()` only
understands mathjs's expression grammar, not arbitrary JS). Guards: rejects empty/non-string
expressions, caps expression length at 200 characters (cheap insurance against pathologically
nested input, since `mathjs` itself already removes the code-execution risk), wraps `evaluate()`
in a try/catch that rethrows as a plain `Error` (mathjs throws its own error classes), and rejects
non-finite results (e.g. `1/0` → `Infinity`).

`datetime.tool.ts` exports `executeDatetime({ timezone, operation?, date1?, date2? })`, using
`dayjs` with the `utc`+`timezone` plugins (`dayjs.extend()` once at module load — both plugins ship
inside the already-installed `dayjs` package, no new dependency). `operation: 'now'` (default)
returns `{ datetime, timezone }` via `dayjs().tz(tz).format()`. `operation: 'diff'` returns
`{ date1, date2, timezone, diffDays, diffMs }` — spec left the exact diff shape open, so both a
coarse (whole days) and precise (milliseconds) delta are returned together. An invalid IANA
timezone throws a Node `RangeError` from the underlying `Intl` API — both tool paths wrap this in
try/catch and rethrow as a plain `Error('Invalid timezone: ...')` so `ToolExecutorService` only
ever sees one error shape to convert to `{ success: false, error }`.

`mathjs` was added as a new dependency for this issue (`dayjs` was already present from Phase 1
setup but unused until now).

### Built-in tool — weather (AI-025)

`weather.tool.ts` exports `WeatherTool`, an `@Injectable()` NestJS class — not a plain function
like calculator/datetime — because it needs the project's shared `HttpService`/`HttpModule`
conventions (the same pattern `OpenRouterSyncService` established for `HttpService`-based
integrations) rather than a raw `fetch`. `AiChatModule` now imports `HttpModule` and registers
`WeatherTool` as a provider (not exported — same-module DI only, matching `ToolRegistryService`).
`ToolExecutorService` (AI-026) will inject it and call `weatherTool.execute(args)` from its
builtin-dispatch map — a bound method works identically to a free function at that call site.

`execute({ city, units = 'celsius' })`:

1. Geocodes via `GET https://geocoding-api.open-meteo.com/v1/search?name=<city>&count=1`. An empty
   or missing `results` array throws `Could not find location: <city>`.
2. Fetches current conditions via `GET https://api.open-meteo.com/v1/forecast` with the resolved
   coordinates, `current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`, and
   `temperature_unit=<units>`.
3. Maps the response to `{ city, temperature, units, humidity, windSpeed, conditions }` —
   `conditions` is Open-Meteo's numeric `weather_code` translated via a hardcoded WMO-code lookup
   table (`WEATHER_CODE_DESCRIPTIONS`), covering the common codes and falling back to `"Unknown"`
   for the rest rather than throwing.

Neither Open-Meteo endpoint requires an API key. Both calls are mocked in
`weather.tool.spec.ts` via `HttpService` returning `rxjs`'s `of(...)` — no live network call in the
automated suite; a real end-to-end call is exercised manually only, per spec SC-CH-006.

### ToolExecutorService (AI-026)

`ToolExecutorService.execute(toolName, args): Promise<ToolExecutionResult>` is the single entry
point that runs a tool once the model has requested it — the guard-rail layer between "the model
asked for `calculator`" and any of AI-024/AI-025's actual implementations. **It never rejects**:
every path (unknown tool, timeout, HTTP failure, a builtin handler throwing) resolves to `{
success, result, error?, executionMs }`, since a tool failure must never crash the chat request
(spec §8.4).

1. `toolRegistry.findActiveTool(toolName)` — any error here (missing or inactive) is caught and
   mapped to `"Tool '<name>' is not available"`, no need to special-case `NotFoundException`.
2. `handlerType: 'builtin'` dispatches through a `Record<string, (args) => Promise<unknown>>` map
   built once in the constructor: `calculator`/`datetime` call AI-024's plain functions directly;
   `weather` calls the injected `WeatherTool.execute()` (its one DI-based exception). A
   builtin-typed tool with no matching map entry gets the same "not available" failure.
3. `handlerType: 'http'` reads `handlerConfig.url`/`method`/`headers`, resolves the hostname via
   `new URL()`, and checks it against `chatConfig.httpToolAllowedDomains` **before** calling
   `HttpService.request()` — **fail-closed**: an empty/unset whitelist blocks every HTTP tool,
   never "allow everything." Only after that check passes does it issue the request with `args` as
   the body (default method `POST`, since `args` needs a body-carrying verb).

**Timeouts**: builtin tools race the handler's promise against a `setTimeout`-based
`ToolTimeoutError` via a private `withTimeout()` (`Promise.race([promise, timeoutPromise])
.finally(() => clearTimeout(timer))` — not a hand-rolled `reject(error)` wrapper, since ESLint's
`prefer-promise-reject-errors` can't prove a caught `unknown` is an `Error`). HTTP tools pipe
RxJS's `timeout()` operator directly onto the `HttpService.request()` Observable and catch the
resulting `TimeoutError` (from `'rxjs'`) — no custom timer needed since the call is already
Observable-based. Both paths converge on the identical `'Tool execution timed out'` string.
Defaults (`toolTimeoutMs` 10s, `httpToolTimeoutMs` 5s) come from `chatConfig`, with local
fallback constants matching `app.config.ts`'s own defaults.

**Statelessness**: `builtinHandlers` is built once and holds no per-call state, so `execute()` is
safe to call N times concurrently via `Promise.all()` — proven by a test running 10 concurrent
`calculator`/`datetime` calls and asserting each result independently. `ChatService` (AI-027) is
the caller that will actually decide _when_ to run multiple tools in parallel; this service just
guarantees each call is independent.

### StreamingService.streamCompletion() (AI-028)

`StreamingService` (`src/modules/ai-chat/services/streaming.service.ts`) is the one place in the
codebase that calls the OpenAI SDK with `stream: true` — it injects `OPENAI_CLIENT` directly
rather than going through `OpenaiService`, since Phase 1's service has no streaming support.
`OpenaiModule`'s `exports` array now includes `OPENAI_CLIENT` (previously only
`OpenaiService`/`AiAuditService`/`TokenService`/`ModelRegistryService` were exported) so
`AiChatModule` can inject the token.

```typescript
streamCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: StreamCompletionOptions,
): AsyncGenerator<StreamEvent>
```

It's a pure async generator — `for await (const chunk of stream)` — yielding a `TOKEN` event per
`delta.content` fragment, with no DB writes and no `AiAuditService` calls (those stay with the
caller, matching how `OpenaiService`/`ChatService` split responsibilities elsewhere). Tool-call
deltas arrive fragmented across chunks (OpenAI sends `id`/`function.name` once and
`function.arguments` incrementally, all sharing the same `tool_calls[].index`), so fragments are
accumulated in a `Map<index, {id, name, arguments}>` and a `TOOL_CALL` event is emitted per
accumulated call only when `choice.finish_reason === 'tool_calls'` — never one malformed
partial-JSON event per chunk. Multiple concurrent tool calls (distinct `index` values) each get
their own accumulator and their own `TOOL_CALL` event, mirroring `ChatService`'s existing
`Promise.all()`-based concurrent tool execution (AI-027). If a fully-accumulated `arguments`
string still isn't valid JSON, the error is logged and `{}` is yielded instead of throwing — a
single malformed tool call must not crash the whole stream.

Default model resolution mirrors `ChatService.createConversation()`'s existing fallback chain:
`options.model ?? config.get('openai.defaultModel') ?? OpenAIModel.GPT_4O`. The
`StreamCompletionOptions` type (`{ model?, temperature?, tools?, signal? }`) lives in
`types/ai-chat.types.ts` alongside `StreamEvent`/`ToolCallData`.

**Scope boundary**: no `DONE` `StreamEventType` is ever yielded here — per spec §2.3, `[DONE]`
belongs to the orchestration layer (`ChatService.sendMessageStream()`, AI-029) after the assistant
message is persisted. `ERROR` events, abort handling, and `sendMessageStream()` itself were added
in AI-029 (see below) — this section describes `streamCompletion()`'s original AI-028 shape.

### StreamingService abort/error handling + ChatService.sendMessageStream() (AI-029)

`streamCompletion()` gained a `signal?: AbortSignal` option, passed as the second (`RequestOptions`)
argument to `openaiClient.chat.completions.create()`. Creation and iteration now share one
`try/catch` around the whole generator body: the OpenAI SDK links the passed `signal` to its own
internal `AbortController` and already swallows an abort that fires _during_ iteration (its
`Stream` class catches it internally and the `for await` loop just ends, no exception) — but an
abort firing _before_ `create()`'s promise resolves rejects with `APIUserAbortError`, which the
`catch` block checks for (`error instanceof APIUserAbortError || signal?.aborted`) and handles by
simply returning (clean end, no event). Any other caught error yields a `StreamEventType.ERROR`
event with the message, then ends the generator — this is the distinction spec §7.4 (client
disconnect, silent) draws against §7.3 (mid-stream SDK error, `error` event).

`ChatService.sendMessageStream(conversationPublicId, dto, abortSignal): AsyncGenerator<StreamEvent>`
mirrors `sendMessage()`'s shape (look up conversation → reject whitespace-only content →
`addUserMessage()` → `buildContext()`) but then `for await`s `streamingService.streamCompletion()`,
re-yielding every event to the caller while accumulating `TOKEN` data into a content string,
`TOOL_CALL` data into an array, and the last `ERROR` event's message. Once the loop ends —
normally, aborted, or errored — it computes `incomplete = abortSignal.aborted || streamErrorMessage
!== undefined`, persists exactly one `addAssistantMessage()` call (accumulated content,
`incomplete` flag), calls `AiAuditService.log()` exactly once (`SUCCESS`/`FAILED` keyed off
`incomplete`), and — only on a clean completion — yields a final `StreamEventType.DONE` event with
`{ messageId, usage, estimatedCost, latencyMs }` (the new `StreamDoneData` type, added to
`StreamEvent.data`'s union). This streaming call bypasses `OpenaiService.chatCompletionWithMessages()`
entirely (AI-028 talks to `OPENAI_CLIENT` directly), so audit logging here is
`ChatService`'s own responsibility rather than inherited for free.

Since streaming without `stream_options: { include_usage: true }` returns no per-request `usage`
object, `inputTokens`/`outputTokens` are estimated via `TokenService.countTokens()` (a new private
`countMessagesTokens()` helper sums it over the built context's string message content; output is
counted directly on the accumulated stream content) rather than SDK-reported — `estimatedCost`
still goes through the same `TokenService.calculateCost()` DB→`MODEL_PRICING`→`0` chain the
non-streaming path uses.

`ChatService` gained two new constructor dependencies: `StreamingService` (same-module DI, no
export needed) and `AiAuditService` (already exported from `OpenaiModule`, already imported by
`AiChatModule` — no module wiring change required here, unlike AI-028's `OPENAI_CLIENT` export).

**Known gap, by design**: `sendMessageStream()` does not execute tool calls or make a second
synthesis request — it only forwards `TOOL_CALL` events to the client and persists them on the
assistant message, ending the streamed turn there. The issue's own scope never mentioned wiring
`ToolExecutorService` into the streaming path (unlike AI-027's non-streaming two-call protocol), so
implementing it here would have been a speculative scope addition. A streamed tool-call turn today
produces `TOOL_CALL` events and a persisted assistant message with unexecuted tool calls, but no
tool result and no follow-up model response — AI-035's live smoke test should surface whether this
matters before a future issue builds it out. Note also that the streaming path's persisted
`toolCalls` shape (`ToolCallData[]`, i.e. `{toolCallId, toolName, arguments}`) differs from the
non-streaming path's (`ChatCompletionMessageFunctionToolCall[]`, i.e. `{id, type, function}`) —
both are opaque JSON today with no other reader, so this has no functional impact, but AI-033/034
shouldn't assume a single shape.

### ChatController — SSE streaming endpoint (AI-033)

`POST /chat/conversations/:publicId/messages/stream` uses a raw `@Res()` `Response` parameter
(not `{ passthrough: true }`) rather than `@Sse()`. This was a deliberate, verified choice, not a
default: bare `@Res()` sets NestJS's internal `isResponseHandled` flag, which makes the framework
skip applying the global `ResponseInterceptor`'s `{ success, data, timestamp }` transform to the
response entirely (confirmed by reading `@nestjs/core`'s `router-execution-context.js` — the
interceptor still runs, but its output is provably discarded, never written to the client).
`@Sse()` was ruled out because its decorator defaults every route to `RequestMethod.GET` and only
exposes the HTTP method via an internal, undocumented parameter — incompatible with spec §6.2's
POST + JSON-body requirement (this endpoint isn't consumed by the browser's `EventSource`, which
can only do GET; the client is expected to use `fetch` + `ReadableStream`, per spec §6.3).

The handler calls `ChatService.sendMessageStream()` (AI-029) via a **priming-call pattern**:
`await stream.next()` once, before writing any SSE headers. Since `sendMessageStream()` validates
the conversation/content synchronously before its first `yield`, a `NotFoundException` or
`BadRequestException` at that point propagates uncaught straight to the global
`HttpExceptionFilter` — producing the same JSON error shape every other endpoint returns, with no
duplicate error handling in this controller. Only once the first `StreamEvent` is confirmed ready
does it call `response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control':
'no-cache', Connection: 'keep-alive' })` and start writing frames via `formatSseFrame()`
(`utils/sse-frame.util.ts`, a pure function: `` `event: ${type}\ndata: ${JSON.stringify(data)}\n\n` ``,
unit-tested independent of the transport). A failure _after_ headers are committed (e.g. a DB write
error) is caught separately and surfaced as one last `event: error` frame instead, since the status
code can no longer change at that point.

**Disconnect detection uses `response.on('close')`, not `request.on('close')`.** The first
implementation attached the `AbortController` trigger to the request object, matching a natural
first reading of "detect disconnect" — live `curl`/`kill` testing against a real running server
proved this **never fires**: a small JSON POST body is fully consumed by Express before the
controller method runs, so the request's readable stream (and its `'close'` event) can already have
fired before a listener is attached inside the handler, silently swallowing every disconnect. The
response stream, by contrast, stays open for the entire SSE stream, so its `'close'` event reliably
fires exactly once, exactly when the underlying connection terminates (client disconnect or normal
end) — verified live: killing the client mid-generation now correctly aborts within ~1.5s, produces
a `chat_messages` row with `metadata: {"incomplete": true}`, and an `ai_audit_logs` row with
`status: FAILED` and a nonzero partial token count. This bug could not have been caught by
`chat.service.spec.ts`/`streaming.service.spec.ts`'s unit tests, since they exercise `AbortSignal`
directly and never touch a real Express request/response — it's the reason this issue's own testing
notes required live verification instead of unit tests for the transport piece specifically.

**Known gap, inherited from AI-029**: no live `tool_call`/`tool_result` frame has been observed on
the wire (test conversations used `toolsEnabled: false`) — `sendMessageStream()` doesn't execute
tool calls at all (see AI-029's section above), so `tool_result` is never emitted by this codebase
today. `formatSseFrame()`'s handling of both shapes is covered by its unit test only.

### ChatController tests + function-calling integration + Phase 1 regression (AI-034)

This issue's own acceptance criterion for deliverable #1 ("DTO validation tests cover all request
DTOs not already covered in AI-030") turned out to already be fully satisfied —
`chat-dtos.spec.ts` covers every request DTO. The actual gap was that `ChatController` was the only
controller in the codebase with no dedicated spec file at all, so `chat.controller.spec.ts` was
added, mirroring `openai.controller.spec.ts`'s `TestingModule` + `jest.fn()`-mock delegation-test
pattern rather than adding more DTO tests. Its `sendMessageStream()` block is the first automated
regression test for AI-033's `response.on('close')` disconnect fix — it captures the `AbortSignal`
passed into the mocked `ChatService.sendMessageStream()` call and asserts a fake `Response`'s
`'close'` listener flips it to `aborted: true` (a real HTTP transport still can't be exercised
inside a `TestingModule`, so this is a proxy for the live-only verification AI-033 relied on, not a
replacement for it).

`chat-function-calling.integration.spec.ts` implements the issue's second deliverable exactly per
its Testing Notes: rather than mocking `OpenaiService` (as `chat.service.spec.ts` already does at
the unit level), it mocks only `DatabaseService` (`DeepMockProxy`) and the `OPENAI_CLIENT`
injection token, wiring the _real_ `ChatService`, `ToolRegistryService`, `ToolExecutorService`,
`OpenaiService`, `RetryService`, `AiAuditService`, and `TokenService` through a `TestingModule` —
mocking any higher in the stack would have made this indistinguishable from the existing unit
tests. `OpenaiService.onModuleInit()` is called explicitly post-`compile()` (this repo's documented
`TestingModule` hook gotcha) so `ensureConfigured()` doesn't reject every call. The real
`mathjs`-backed calculator genuinely evaluates `234*567`; the two `OPENAI_CLIENT.chat.completions
.create()` calls are scripted via `mockResolvedValueOnce()` (first requests the tool, second
returns a canned final answer). This is also what finally closes AI-027's own documented gap (see
above): `dbMock.aiAuditLog.create` — `AiAuditService.log()`'s real write point — is asserted to be
called exactly twice for the turn, proving SC-CH-013's per-turn audit count against real audit-log
code instead of a mocked proxy.

Phase 1 regression check: `npm run test` (full suite) went from 250 to 271 passing tests with zero
changes to any Phase 1 spec file's assertions — `openai.service.spec.ts` (extended in AI-018 for
`chatCompletionWithMessages()`) is unchanged and still green, confirming that method was purely
additive. No production code changes were needed for this issue.

### Live API smoke test — streaming, function calling, weather (AI-035)

Phase 2's closing HITL issue — driven interactively against a real `npm run dev` server, real
Postgres, the real OpenRouter API, and the real Open-Meteo API (no mocks), verified via `curl` plus
direct `psql` reads of `chat_messages`/`ai_audit_logs` rather than trusting server logs alone.

**Streaming, disconnect handling, calculator function-calling, multi-tool synthesis, and the audit
trail** all verified working exactly as designed — including a `psql`-confirmed disconnect: killing
a streaming client 3 seconds in correctly persists `metadata: {"incomplete": true}` and an
`ai_audit_logs` row with `status: FAILED, latencyMs: ~3000` and no `errorMessage` (the designed
silent-disconnect-vs-loud-SDK-error distinction from AI-029), with zero unhandled exceptions in the
server log and the process still alive afterward.

**Weather tool timed out — root-caused to environment network latency, not a defect.** The model
correctly requested the tool, `ToolExecutorService` correctly enforced its 10-second
`chat.toolTimeoutMs` budget and returned a graceful failure, and the model correctly told the user
it couldn't get the weather — the full designed degradation path worked. Curling Open-Meteo's two
endpoints directly from the same sandbox measured 6.6s (geocoding) + 8.8s (forecast) — both
succeeded, but sequentially they exceed the 10s default. This is a genuine finding worth
re-measuring in the actual target deployment (this sandbox's egress path may not be representative)
before considering a larger `httpToolTimeoutMs`/tool-specific budget for `weather`'s two-hop call.

**`OPENAI_DEFAULT_MODEL` (`meta-llama/llama-3.3-70b-instruct:free`) is functionally correct**
(supports both `tools` and `stream: true`) but was slow/rate-limited during this session (one call
took 28–43s, another returned a 429) — consistent with the free-tier flakiness already documented
across AI-025/032/033. Demonstrations in this issue used an explicit per-request `model` override
(`tencent/hy3:free`, discovered live via `GET /openai/models/free`) rather than editing `.env`,
since the default model itself isn't broken, just currently slow. `.env`/`OPENAI_DEFAULT_MODEL`
were left unchanged; swap to `tencent/hy3:free` (or re-check `GET /openai/models/free`) only if
this recurs.

Both test conversations created during this issue were deleted via `DELETE
/chat/conversations/:publicId` once verification completed, and the dev server was stopped
afterward — no residual state left in the dev database.

**All 35 issues across both Phase 1 and Phase 2 PRDs are now `completed`.**

## Phase 3 — Vector Search & RAG (in progress)

Phase 3 (`docs/prd/2026-07-08-vector-search-rag.md`, issues `AI-036`–`AI-055`) adds document
ingestion, embeddings, Pinecone-backed semantic search, and RAG orchestration on top of Phase 1's
`OpenaiModule` and Phase 2's `AiChatModule`. See `docs/specs/Phase_3_Vector_Search_RAG_Requirement_Specification.md`
for the full spec.

### Schema and config foundation (AI-036)

Added `Document` (`@@map("documents")`) and `DocumentChunk` (`@@map("document_chunks")`) models to
`schema.prisma`, following the same `BigInt` PK + `publicId` UUID pattern as every other table in
this schema. `DocumentChunk.document` uses `onDelete: Cascade`. Indexes: `documents(category)`,
`documents(embeddingStatus)`, `document_chunks(documentId, chunkIndex)`.

**`EmbeddingCache` realigned**: this model existed from the original Phase 1 scaffold but predated
the `BigInt`+`publicId` convention (`id String @default(cuid())`, no `publicId`). Since no service
had ever read or written it, it was corrected in place — `id BigInt @id @default(autoincrement())`,
added `publicId String @unique @default(uuid())`, added `tokenCount Int?` — rather than carrying the
inconsistent shape forward into the phase that finally uses it.

**Pinecone config is now optional at boot.** `pineconeConfig.apiKey`/`pineconeConfig.index` were
previously `!`-asserted required env vars that blocked app startup even though nothing consumed
them yet. `PINECONE_API_KEY`/`PINECONE_INDEX` are now `@IsOptional()` in `env.validation.ts`, and
`pineconeConfig` reads them as plain `string | undefined` — the app boots cleanly with neither set;
Pinecone-dependent services (from AI-040 onward) are expected to fail clearly at call time instead.
`pineconeConfig` also gained `namespace` (`PINECONE_NAMESPACE`, default `'documents'`).

**New `rag` config namespace** (`ragConfig`, `src/config/app.config.ts`) holds the phase's
env-tunable values: `embeddingModel` (`EMBEDDING_MODEL`, default `'text-embedding-3-small'`),
`embeddingDimensions` (`EMBEDDING_DIMENSIONS`, default `1536`), `embeddingBatchSize`
(`EMBEDDING_BATCH_SIZE`, default `20`), `topK` (`RAG_TOP_K`, default `5`), `similarityThreshold`
(`RAG_SIMILARITY_THRESHOLD`, default `0.7`), `maxContextTokens` (`RAG_MAX_CONTEXT_TOKENS`, default
`4000`), `chunkSize` (`CHUNK_SIZE`, default `500`), `chunkOverlap` (`CHUNK_OVERLAP`, default `50`).
All eight are `@IsOptional()` in `env.validation.ts` with the same defaults, and registered in
`AppModule`'s `ConfigModule.forRoot({ load: [...] })` array alongside the other seven namespaces.

**`prisma migrate dev` does not work in this environment** — it refuses to run non-interactively
(`Prisma Migrate has detected that the environment is non-interactive, which is not supported`),
even with `--create-only`. The workaround used here, and expected to be reused by every later
schema-touching issue in this phase: generate the SQL via
`npx prisma migrate diff --from-config-datasource ./prisma.config.ts --to-schema ./prisma/schema.prisma --script`
(diffs the live database against the target `schema.prisma`), hand-create a
`prisma/migrations/<timestamp>_<name>/migration.sql` file with that output, then apply it with
`npm run prisma:migrate:deploy` (non-interactive). This produces an identical committed migration
history to what `prisma migrate dev` would have generated.

### RagModule scaffold (AI-037)

`src/modules/rag/` is registered in `AppModule.imports` after `AiChatModule`. It imports
`OpenaiModule` (for `OpenaiService`/`TokenService`) and `AiChatModule` (for `ChatService`, used only
by `RagService.queryWithConversation()`) — the same "only export what's needed externally"
convention as `AiChatModule`; `RagModule` currently exports nothing, since no other module needs a
RAG service yet.

Seven services are registered as providers, all still **empty shells** as of this issue — a
`@Injectable()` class with only a constructor (no method bodies), gaining real implementations
across AI-038 through AI-050: `EmbeddingService` (→ `OpenaiService`), `EmbeddingCacheService` (→
`DatabaseService`), `PineconeService` (→ `ConfigService`/`AppLoggerService` only — no DI token for
the Pinecone client itself, unlike `OPENAI_CLIENT`, since `PineconeService` is this module's sole
consumer of that SDK), `DocumentService` (→ `TokenService`, `EmbeddingService`,
`EmbeddingCacheService`, `PineconeService`), `SearchService` (→ `EmbeddingService`,
`EmbeddingCacheService`, `PineconeService`), `RagService` (→ `SearchService`, `OpenaiService`,
`ChatService`), `MockDataService` (→ `DocumentService`, `RagService`). `RagController` is a bare
`@ApiTags('rag')` stub with no routes yet — that's Epic 7 (AI-051 onward). The `'rag'` Swagger tag
in `main.ts` already existed from Phase 2's scaffolding.

`src/modules/rag/constants/` holds `DocumentSourceType`/`EmbeddingStatus`/`DocumentCategory` (`as
const` objects per spec §4.1–§4.3, each with a derived union type export) and the four
hardcoded-default constants `CHUNKING_CONFIG`/`RAG_CONFIG`/`EMBEDDING_CONFIG`/`PINECONE_CONFIG`
(spec §4.4–§4.7) — mirroring `CONTEXT_CONFIG`'s role from Phase 2: services should prefer reading
tunable values (`chunkSize`, `topK`, etc.) from the `rag` config namespace (AI-036) at call sites,
falling back to these constants only for values with no corresponding env var (e.g.
`RAG_CONFIG.systemPrompt`, `PINECONE_CONFIG.metric`).

**New dependencies**: `@pinecone-database/pinecone`, `langchain`, `@langchain/openai`,
`@langchain/community`, `pdf-parse`, `@faker-js/faker`, plus `axios` as an explicit direct
dependency (see below). `pdf-parse@2.4.5` ships its own types — no `@types/pdf-parse` needed.
`@langchain/community@1.1.29` logs a deprecation notice on install (see
`langchain-ai/langchainjs-community` issue #61) but is still the package the spec names for
`PDFLoader` — worth re-checking for a replacement when AI-042 actually implements PDF parsing.

**`npm install` for this phase's dependencies requires `--legacy-peer-deps`** —
`@langchain/community` pulls in `@browserbasehq/stagehand` (an optional peer, for a browser tool
loader this project never uses) which wants `dotenv@^16.4.5`, conflicting with the project's
`dotenv@^17.4.2`.

**Known footgun**: installing packages with `--legacy-peer-deps` can silently drop packages that
were previously only present as _hoisted transitive_ dependencies rather than direct
`package.json` entries — `axios` disappeared from `node_modules` entirely after this install (it
had never been a direct dependency; `@nestjs/axios`'s `HttpModule`/`HttpService`, used by
`WeatherTool` and `OpenRouterSyncService`, declare it as a _peer_ dependency, which npm does not
auto-install). This would have been a silent runtime break despite `tsc`/`build` succeeding — it
surfaced first as a spike in ESLint's `no-unsafe-*` warning count across unrelated files, since
TypeScript could no longer resolve `axios`'s types. Fixed by adding `axios` as an explicit direct
dependency. Run `npm ls axios` (or similar) as a sanity check after any future `--legacy-peer-deps`
install in this phase.

**Same footgun hit again in AI-042**: `@langchain/core` (a required peer of
`@langchain/textsplitters`, needed for `RecursiveCharacterTextSplitter`) was completely absent from
`node_modules` — unlike `axios`, this wasn't even resolvable at runtime (`Cannot find module
'@langchain/core/documents'`), not just untyped. Fixed by installing `@langchain/core` explicitly,
plus adding `@langchain/textsplitters` itself as a direct dependency (it was only ever a transitive
dependency of `langchain`/`@langchain/community` even though `DocumentService` now `import`s it
directly). Whenever a future issue imports directly from a package that's currently only transitive
in `package.json`, add it as a direct dependency at the same time — don't rely on hoisting to keep
providing it.

### OpenaiService.generateEmbedding() / generateEmbeddingsBatch() (AI-038)

Additive to Phase 1/2's `chatCompletion()`/`chatCompletionWithMessages()` — `generateEmbedding(text,
model?)` and `generateEmbeddingsBatch(texts, model?)` are the seam `RagModule`'s embedding-consuming
services call through; per Phase 1's "only `OpenaiService` touches the SDK" rule, no RAG service
calls `openaiClient.embeddings.create()` directly. Both wrap `openaiClient.embeddings.create({
model, input })` via a private `executeEmbedding()` helper — structurally parallel to
`executeCompletion()` (same `RetryService.executeWithRetry()` → cost → `AiAuditService.log()` →
`mapError()` shape) but kept as a separate helper rather than merged, since the embeddings response
shape (`{ data: Embedding[] }`) doesn't share anything with chat completions' `{ choices }`.
`generateEmbedding()` returns `response.data[0]?.embedding ?? []`; `generateEmbeddingsBatch()` maps
the full `data[]` array to `number[][]`, trusting the OpenAI API's documented input-order-preserving
behavior rather than sorting by each item's `index` field.

Cost reuses `TokenService.calculateCost(model, inputTokens, 0)` — embeddings have no output tokens,
so `0` is passed rather than adding a second cost-calculation path; `TokenService`'s existing DB →
`MODEL_PRICING` → `0` fallback chain applies unchanged. Every embedding call is logged in
`ai_audit_logs` with `endpoint: 'embeddings'` (`OpenAIEndpoint.EMBEDDINGS`, defined but unused since
Phase 1) — for a batch call, `userMessage` on the audit row is the first input text only, not a
reconstruction of the whole batch. `model` defaults through
`model ?? config.get('rag.embeddingModel') ?? 'text-embedding-3-small'` (a new private
`resolveEmbeddingModel()` helper) — the same three-tier fallback pattern
`chatCompletion()`/`chatCompletionWithMessages()` already use for `openai.defaultModel`.

Neither method exposes `userId`/`requestId` parameters (unlike `chatCompletion()`) — `requestId` is
generated internally via `crypto.randomUUID()` on every call, and `userId` is always `undefined` in
the audit row. `mapError()` is reused as-is, so a `CircuitOpenException` from `RetryService` (e.g.
the embeddings endpoint tripping the same circuit breaker chat completions share) passes through
`generateEmbedding()`/`generateEmbeddingsBatch()` unchanged, identically to how chat completions
handle it.

### EmbeddingCacheService (AI-039)

`EmbeddingCacheService` (`src/modules/rag/services/embedding-cache.service.ts`) is the single
source of truth for the hash-based embedding dedup layer described in spec §9 — the only service
that reads or writes the `embedding_cache` table. `get(text)`/`set(text, embedding, model)` are
keyed on `SHA-256(text.trim().toLowerCase())`, computed by a private `hash()` helper using Node's
`crypto.createHash()` (imported from `'crypto'`, matching `request-logger.middleware.ts`'s existing
convention over the `'node:crypto'` prefix). `set()` uses `embeddingCache.upsert()` keyed on
`textHash` — idempotent by construction, no `P2002`/conflict handling needed. `invalidate(textHash)`
uses `deleteMany()` rather than `delete()`, so invalidating an already-absent hash resolves silently
instead of throwing Prisma's P2025.

Cache hit/miss counts are tracked via a private in-memory counter on the service instance (no schema
field for this — resets on app restart, an accepted tradeoff per this issue's own framing, not a
gap). `getCacheStats()` combines that in-memory counter with a real `embeddingCache.count()` for
`totalCached`. The `embedding: Json` column is written by casting a plain `number[]` through
`Prisma.InputJsonValue` — a single `as` cast (not the `as unknown as` double-cast some other
services need), since a numeric array is directly assignable to Prisma's JSON input type. The
schema's `tokenCount Int?` column is never written by this service — the spec's `set()` signature
takes no `tokenCount` parameter.

### PineconeService (AI-040)

`PineconeService` (`src/modules/rag/services/pinecone.service.ts`) is the single boundary to
`@pinecone-database/pinecone` in this codebase — no other service imports the Pinecone SDK
directly. Unlike `OPENAI_CLIENT`, there is no DI factory-provider token for the Pinecone client:
`PineconeService` constructs `new Pinecone({ apiKey })` directly in its own constructor from
`ConfigService`, since it is the SDK's only consumer in the app (a token would be indirection with
no second caller to justify it). `client` is typed `Pinecone | null` — `null` whenever
`pinecone.apiKey`/`pinecone.index` are unset (both optional since AI-036), with a one-time
`logger.warn()` at construction so an unconfigured deployment shows up in boot logs.

Every public method (`upsert`/`query`/`deleteByIds`/`deleteByFilter`/`describeIndex`) routes
through a private `getIndex()` choke point that throws `ServiceUnavailableException('Pinecone is
not configured')` before any SDK call if the client or index name is missing — mirroring
`OpenaiService`'s `ensureConfigured()` guard — and otherwise returns `client.index({ name:
indexName }).namespace(pinecone.namespace)`, so every operation is automatically scoped to the
configured namespace (default `'documents'`) without each method having to repeat that call.

`describeIndex()` maps to `PineconeIndexStats` (`{ totalRecordCount, dimension? }`) via the SDK's
**data-plane** `index.describeIndexStats()` — not the control-plane `Pinecone.describeIndex(name)`
— since only the former reports live per-namespace vector counts. `query()`'s `filter` uses the
same optional-conditional-spread pattern (`...(filter !== undefined ? { filter } : {})`) as
`chatCompletion()`'s `temperature`/`maxTokens`, so an omitted filter is never sent as an explicit
`undefined` in the request payload. Metadata going _into_ Pinecone needs an `as unknown as
RecordMetadata` cast (the SDK's metadata value union is narrower than `Record<string, unknown>`);
metadata coming _out_ needs no cast at all, since `RecordMetadata`'s narrower union is structurally
assignable to `unknown`.

### DocumentService — CRUD + document DTOs (AI-041)

`DocumentService` (`src/modules/rag/services/document.service.ts`) gained its metadata-lifecycle
subset per spec §5.3 — `create`/`findAll`/`findOne`/`update`/`delete`. Ingestion
(`ingestDocument`/`ingestFromFile`/`reindexDocument`/`getIngestionStatus`/`getChunks`) is deliberately
out of scope here, landing across AI-042 through AI-044.

`create()` writes `embeddingStatus: 'pending'`, `totalChunks: 0`, `totalTokens: 0` — no chunking or
embedding happens in this call. Since `documents.embeddingModel` is a non-nullable schema column but
`CreateDocumentDto` has no `embeddingModel` field, it's resolved via
`configService.get('rag.embeddingModel')` (falling back to the same `'text-embedding-3-small'`
literal `ragConfig`'s own factory uses) — the model that will actually run once ingestion happens,
recorded at creation time rather than left as a placeholder.

`findAll()` mirrors `ModelRegistryService.findAllModels()`'s filter-building shape exactly: `category`
and `status` (mapped to the `embeddingStatus` column) as equality filters, a comma-separated `tags`
query param split/trimmed into a `hasSome` array filter (same pattern as
`PromptTemplateService.findAll()`'s `tags` handling), and `search` spread across `title`/`description`
via a case-insensitive `OR`.

`findOne()` includes `chunks: { orderBy: { chunkIndex: 'asc' } }` and returns `chunks: []` for a
document with none yet — not an error — matching Phase 2's `ChatService.findConversation()`
zero-messages precedent, since every document is in exactly this state immediately after `create()`.

`update()` only ever writes `title`/`description`/`category`/`tags`. `UpdateDocumentDto` is
`PartialType(OmitType(CreateDocumentDto, ['sourceType']))` — `sourceType` is structurally absent from
the update surface (not just optional), the same pattern `UpdateConversationDto` uses to drop
`toolsEnabled`. `originalFilename`/`fileSize`/`embeddingStatus` were never part of `CreateDocumentDto`
to begin with, so there was nothing further to omit for those three.

`delete()` is a two-step operation, unconditional and sequential: `databaseService.document.delete()`
(Postgres `onDelete: Cascade` on `DocumentChunk.document` handles the relational side, mirroring
`ChatService.deleteConversation()`'s AI-019 precedent) followed by
`pineconeService.deleteByFilter({ documentId: publicId })` — Pinecone has no foreign-key relationship
to Postgres, so this explicit second call is the only way to prevent orphaned vectors accumulating
for a deleted document (FR-RAG-009). Both `update()` and `delete()` share a private
`findDocumentOrThrow()` guard, throwing `NotFoundException` before any mutation.

Six DTOs were added under `src/modules/rag/dto/` (`CreateDocumentDto`, `UpdateDocumentDto`,
`QueryDocumentsDto`, `DocumentResDto`, `DocumentChunkResDto`, `DocumentWithChunksResDto`,
`PaginatedDocumentsResDto`) — this issue's own "What to Build" text lists all of these explicitly,
even though its Acceptance Criteria checkbox says "five"; `DocumentChunkResDto` was added because
`DocumentWithChunksResDto` needs a typed chunk shape and none existed yet. `sourceType`/`category`/
`status` fields use `@IsIn(Object.values(...))` against the existing `as-const` constants rather than
`@IsEnum()`, since `DocumentSourceType`/`DocumentCategory`/`EmbeddingStatus` are `as const` objects
with derived union types, not native TypeScript `enum`s. `src/modules/rag/types/rag.types.ts` (this
module's first `types/` file) holds `DocumentEntity`/`DocumentChunkEntity`/`DocumentWithChunks`/
`PaginatedDocumentsResult`, following `ai-chat.types.ts`'s naming convention.

`create()`'s `title` defaults to the literal `'Untitled Document'` when omitted (the DTO field is
optional but the schema column is non-nullable) — not derived from `originalFilename` (also absent
from this DTO), since file-upload title defaulting is explicitly AI-044's concern
(`ingestFromFile()`), not this metadata-only `create()`.

### DocumentService — parse + chunk pipeline (AI-042)

`DocumentService` gained `parseSource(buffer, sourceType)` and `chunkText(text, model?)` — spec
§5.3's ingestion steps 1–2, kept as pure functions (`Buffer`/`string` in, data out) with no DB/
embedding/Pinecone calls, per this issue's own "keep this step directly unit-testable" requirement.
`ingestDocument()` (which will call both in sequence) is still AI-043's concern.

**`parseSource()`** dispatches on `sourceType`: `DocumentSourceType.PDF` goes through a private
`parsePdf()`; everything else (`txt`/`md`/`generated`) is a direct `buffer.toString('utf-8')`.
`parsePdf()` uses `pdf-parse@2.4.5`'s class-based API — `new PDFParse({ data: buffer })` →
`await parser.getText({ pageJoiner: '' })` → `.text` — verified live against the installed version,
since this is a materially different surface from the function-style `pdf-parse@1.x` API most
online examples show. `pageJoiner: ''` suppresses the library's default page-boundary markers.
`pdf-parse` does **not** throw for an image-only/textless PDF — verified live, it just returns
blank text — so `parsePdf()` explicitly checks `.trim() === ''` and throws its own `'No extractable
text found in PDF...'` error; any other thrown error (verified live: a garbage buffer throws
`Invalid PDF structure.`) is rewrapped as `'Failed to parse PDF: <message>'`, giving the ingestion
pipeline (AI-043/044) one consistent error shape regardless of failure cause. `parser.destroy()`
runs in a `finally` block.

**`chunkText()`** configures `RecursiveCharacterTextSplitter` (`@langchain/textsplitters`) with
`chunkSize`/`chunkOverlap` from `ragConfig` (falling back to `CHUNKING_CONFIG`'s hardcoded
defaults) and a `lengthFunction` that calls `TokenService.countTokens()` synchronously (verified
`countTokens()`'s real signature is sync — no `Promise` wrapping needed) — making chunk sizing
genuinely token-based rather than an approximated character count (FR-RAG-004). The token-counting
`model` defaults through `model ?? ragConfig.embeddingModel ?? EMBEDDING_CONFIG.model`, since chunk
sizing should reflect the tokenizer of whichever model will actually embed the chunk.

Offsets are computed by locating each raw chunk string via `text.indexOf(content, searchFrom)` —
verified live that `RecursiveCharacterTextSplitter` always returns exact substrings of the source
— with `searchFrom` advanced to `startChar + 1` (not `endChar`) after each match, since overlapping
chunks start _before_ the previous chunk ends and a `endChar`-based cursor would skip past them. A
trailing chunk under the hardcoded `CHUNKING_CONFIG.minChunkSize` (100 — no corresponding env var,
so read directly rather than through `ragConfig`, per this codebase's established fallback
convention) is merged into the previous chunk by re-slicing `[previous.startChar, last.endChar]`
from the source text (not string-concatenation, so the shared overlap isn't duplicated) with a
freshly recomputed `tokenCount`.

**Dependency footgun** (see the "Known footgun" note above, in AI-037's section): installing this
issue's actual code surfaced that `@langchain/core` — a required peer of `@langchain/textsplitters`
— was entirely missing from `node_modules`, blocking `RecursiveCharacterTextSplitter` from loading
at all (`Cannot find module '@langchain/core/documents'`). Fixed by installing it explicitly and
promoting `@langchain/textsplitters` itself from transitive to a direct dependency.

**Testing**: real `pdf-parse` calls fail under Jest specifically — its `PDFParse` sets up a `pdf.js`
worker via a dynamic `import()` that Jest's default CJS transform rejects
(`"A dynamic import callback was invoked without --experimental-vm-modules"`), reproducible
regardless of PDF content (verified live, both with a hand-built minimal PDF and a garbage buffer).
Since fixing this project-wide would mean adding an experimental Node flag to the whole test suite's
invocation, `__tests__/document-parse-chunk.service.spec.ts` mocks `pdf-parse`'s module export
directly for all three PDF-path tests instead, per this issue's own Testing Notes fallback guidance.
`chunkText()` tests use a word-count-based fake tokenizer (deterministic, easy to reason about) and
were written against the real `RecursiveCharacterTextSplitter`/`indexOf` implementation's actual
observed behavior rather than hand-derived expectations.

### DocumentService — ingestion pipeline (AI-043)

`DocumentService` gained a private `ingestDocument(document: Document, text: string):
Promise<DocumentEntity>` — the core embed → cache → upsert → persist pipeline spec §5.3 describes,
composing AI-042's `chunkText()` with AI-039's `EmbeddingCacheService`, AI-038's
`OpenaiService.generateEmbeddingsBatch()`, and AI-040's `PineconeService.upsert()`. It's kept
private rather than exported on the class's public surface: AI-044's `ingestFromFile()` and
`reindexDocument()` are expected to call it from within the same `DocumentService` class (per that
issue's own text), so no public seam is needed yet.

Flow: set `embeddingStatus: 'processing'` immediately → chunk the text → resolve embeddings via a
new private `embedChunks()` helper (cache-checks every chunk via `EmbeddingCacheService.get()`
first, batches only the cache misses into groups of `ragConfig.embeddingBatchSize` — falling back
to `EMBEDDING_CONFIG.batchSize` — for `generateEmbeddingsBatch()` calls, caching each resolved
embedding via `EmbeddingCacheService.set()` before the next batch) → upsert one Pinecone vector per
chunk (`id: chunk_<documentPublicId>_<chunkIndex>`, metadata `{ documentId, documentTitle,
chunkIndex, tokenCount, category? }` per spec §7.2 — `category` is spread in only when non-null,
since Pinecone's `RecordMetadata` type rejects `null`) → bulk-persist `DocumentChunk` rows via
`createMany()` (each with its `pineconeId`) → update the document to `embeddingStatus: 'completed'`
with the real `totalChunks`/`totalTokens`. A `try/catch` around the whole body sets
`embeddingStatus: 'failed'` and **returns** the failed entity rather than rethrowing, on any step's
error — matching this issue's own Testing Notes ("rather than throwing an unhandled rejection out
of the request") and the codebase's established degrade-gracefully convention
(`ToolExecutorService.execute()` never rejects; `StreamingService`'s mid-stream errors become
events, not throws).

`embedChunks()`'s cache-check loop is deliberately sequential (not `Promise.all()`'d) so the
acceptance criteria's own required call-order test (chunk → cache-check → embed-on-miss →
cache-set → upsert → persist → status-update) has a deterministic sequence to assert against.
Embeddings are written into a pre-sized array at each chunk's own index (not concatenated
hits-then-misses), so the final vector list always matches the chunks' original order regardless
of which were cache hits vs. misses.

**`createFromText(dto: CreateDocumentTextDto)`** is the "create-and-ingest-from-text" entry point
this issue asked for, wiring the pipeline into the simplest ingestion path (`POST
/rag/documents/text` per spec §6.1 — the controller route itself is AI-051's job). `create()`
(AI-041) was refactored to extract a private `createDocumentRow()` helper returning the raw Prisma
`Document` row (not the mapped `DocumentEntity`), so both `create()`'s unchanged public behavior and
`createFromText()` can create a row without duplicating the write. `createFromText()` forces
`sourceType: DocumentSourceType.TXT` (there's no uploaded file to derive a format from) and calls
`ingestDocument()` with `dto.content` immediately — no re-fetch needed. `CreateDocumentTextDto`
(`dto/create-document-text.dto.ts`) is `OmitType(CreateDocumentDto, ['sourceType'])` plus a
required `content: string`, the same `OmitType` pattern `UpdateDocumentDto` already uses.

`DocumentService` gained a new constructor dependency, `OpenaiService` — injected directly rather
than through the still-empty-shell `EmbeddingService`, per AI-038's own documented Follow Up.
`RagModule` needed no wiring change since it already imports `OpenaiModule`, which exports
`OpenaiService`.

### DocumentService — file upload ingestion, reindex, status & chunk queries (AI-044)

Closes out Epic 4 — Document Ingestion Pipeline (AI-041 through AI-044 are all now `completed`).
Four more methods land on `DocumentService`, all composing with AI-042's `parseSource()`/
`chunkText()` and AI-043's private `ingestDocument()` — no new services were needed.

**`ingestFromFile(file: Express.Multer.File)`**: a new private `resolveSourceTypeFromFilename()`
derives the source type from the file's **extension**, not its `mimetype` (MIME detection for
`.md` is inconsistent across upload clients — some send `text/markdown`, others `text/plain`),
checked against a `SUPPORTED_FILE_SOURCE_TYPES` allowlist (`pdf`/`txt`/`md`; `generated` excluded,
since that source type only exists for `MockDataService`-authored rows). An unsupported or missing
extension throws `BadRequestException` before `parseSource()` is ever called. On success,
`createDocumentRow()` (AI-043's helper, now widened to accept optional `originalFilename`/
`fileSize`) creates the row with those fields populated from the Multer file and `title` defaulting
to `file.originalname` (per spec §6.1: "Override title (default: filename)"), then
`ingestDocument()` runs **awaited**, not fire-and-forget — this codebase has no job queue, so a
file upload blocks the request until ingestion completes. Documented as a scalability tradeoff for
this phase, not a bug, mirroring how `AiAuditService.log()`'s fire-and-forget pattern is
deliberately the exception rather than the rule elsewhere in this codebase.

**`reindexDocument(publicId)`**: fetches the document with its chunks (ordered by `chunkIndex`) and
reconstructs the original source text via a new private `reconstructText()` — since each
`DocumentChunk.content` **is** `sourceText.slice(startChar, endChar)` by construction (AI-042), the
non-overlapping unique span of every chunk except the last is
`chunk.content.slice(0, nextChunk.startChar - chunk.startChar)`, and the last chunk contributes its
full `content`; concatenating these spans in `chunkIndex` order reconstructs the exact original
text with no separate raw-text storage column needed. Deletes the prior `DocumentChunk` rows
(`deleteMany` by `documentId`) and the matching Pinecone vectors (`PineconeService.deleteByFilter({
documentId })`) **before** re-running `ingestDocument()` against the reconstructed text — both
deletions happen unconditionally ahead of re-ingestion, so old and new vectors never coexist under
the same `documentId` filter.

**`getIngestionStatus(publicId)`**/**`getChunks(documentPublicId, query: QueryChunksDto)`**: thin
reads following `findOne()`/`findAll()`'s existing conventions — `getChunks()` mirrors `findAll()`'s
pagination shape exactly (`Math.min(limit, 100)`, parallel `findMany`/`count`). A new
`QueryChunksDto` (`dto/query-chunks.dto.ts`) is `PickType(QueryDocumentsDto, ['page', 'limit'])` —
chunk listing has no filter dimensions beyond pagination. Two new plain interfaces landed in
`types/rag.types.ts` (`IngestionStatusResult`, `PaginatedChunksResult`) rather than Swagger response
DTOs, since no controller exists yet to document against (deferred to AI-051).

**Dependency footgun** (third occurrence of the `--legacy-peer-deps` pattern first documented in
AI-037/AI-042): `Express.Multer.File` doesn't resolve without `@types/multer` — `multer` itself
sits in `node_modules` only as an undeclared transitive/peer dependency of
`@nestjs/platform-express` and ships no bundled `.d.ts`. Installed `@types/multer` as an explicit
dev dependency; also needed by AI-051's controller (`@UploadedFile() file: Express.Multer.File`),
so installing it now avoids re-discovering the same gap there.

### SearchService — semantic search (AI-045)

`SearchService` (`src/modules/rag/services/search.service.ts`), previously an empty shell from
AI-037, now implements `search(query, options?)`/`searchWithScores(query, options?)` per spec
§5.5. `searchWithScores()` is a one-line delegate to `search()` — `SearchResult` already carries
`score`, so there's no shape difference to justify separate retrieval logic.

`search()`'s pipeline: resolve `topK`/`similarityThreshold` from `options` → `ragConfig` →
`RAG_CONFIG`'s hardcoded fallback (the same three-tier chain `DocumentService.chunkText()` uses) →
resolve the query embedding via a private `resolveQueryEmbedding()` (cache-aware:
`EmbeddingCacheService.get()` first, `OpenaiService.generateEmbedding()` — injected directly, same
convention as `DocumentService` — only on a miss, then cached via `EmbeddingCacheService.set()`) →
build a Pinecone metadata filter via a private `buildFilter()` (`categoryFilter` → `{ category }`,
`documentIds` → `{ documentId: { $in: [...] } }`, `undefined` when neither is set) →
`PineconeService.query(embedding, topK, filter)` → drop any match below `similarityThreshold`
(FR-RAG-006) **before** touching Postgres → resolve surviving matches to full chunk text + document
title via a single `documentChunk.findMany({ where: { pineconeId: { in: [...] } }, include: {
document: true } } })` join (chunk rows already carry their `pineconeId` from AI-043's ingestion, so
this is a direct reverse lookup, no id-parsing needed) → re-order results to match Pinecone's own
ranking (`findMany`'s return order is not guaranteed to match) → silently drop any match with no
corresponding row (a stale/orphaned vector) rather than throwing.

Two new interfaces landed in `types/rag.types.ts` — `SearchOptions`
(`topK?`/`similarityThreshold?`/`categoryFilter?`/`documentIds?`) and `SearchResult`
(`chunkPublicId`/`documentPublicId`/`documentTitle`/`content`/`chunkIndex`/`score`/`category`) —
matching spec §5.5's interfaces verbatim. No DTOs yet, since no controller consumes this service
until AI-052.

### RagService.query() — RAG generation with citations (AI-046)

`RagService` (`src/modules/rag/services/rag.service.ts`), previously an empty shell from AI-037,
now implements `query(question, options?)` per spec §5.6/§2.2 — the orchestrator combining
AI-045's `SearchService.search()` with Phase 2's `OpenaiService.chatCompletionWithMessages()`
extension point.

Flow: `search(question, { topK: options.topK, categoryFilter: options.categoryFilter })` →
build an augmented message array via private `buildAugmentedMessages()`/`buildContextBlock()` —
`system` content is `RAG_CONFIG.systemPrompt` **verbatim**, `user` content is a numbered,
title-tagged context block (`[N] (Source: "<title>")\n<content>` per chunk) plus the question.
A zero-results question renders `"Context: No relevant documents were found for this question."`
instead of skipping generation — the "I don't have enough information" behavior is left entirely
to the prompt/model, never a code branch that short-circuits. → `chatCompletionWithMessages()` with
`temperature: options.temperature ?? 0.3` (RAG's low-temperature default) and `model:
options.model` passed through as-is (that method already has its own `openai.defaultModel`
fallback chain, so `RagService` doesn't duplicate it).

`RagResult.sources` is mapped directly from `SearchService`'s returned `SearchResult[]` — **never**
parsed from the model's answer text, since the retrieved data is already structured and
authoritative. `searchLatencyMs`/`generationLatencyMs` are independently measured around each call;
`latencyMs` is a separately-measured wall-clock span across the whole method (not a literal sum of
the two), so it naturally includes the small orchestration overhead of building messages and
mapping sources. `usage`/`estimatedCost`/`model` on the result come straight from the generation
call's `ChatCompletionResult` — embedding cost from the search step is separately audited via
AI-038's own embedding audit path.

Three new interfaces landed in `types/rag.types.ts` — `RagOptions`
(`topK?`/`model?`/`temperature?`/`categoryFilter?`/`includeSourceChunks?`), `RagSource`
(`documentTitle`/`documentPublicId`/`chunkContent`/`chunkIndex`/`similarityScore`), and `RagResult`
— matching spec §5.6's interfaces verbatim. `includeSourceChunks` is accepted on the type but not
yet branched on by `query()` (`sources` is always populated); likely a controller-level
response-shaping decision for AI-052 rather than something this service needs to gate, per this
issue's own Assumptions Made.

**Testing gotcha**: `rag.service.spec.ts` had to add the now-familiar
`jest.mock('.../database.service', ...)` guard even though this issue never touches `ChatService`'s
behavior — `RagService`'s constructor (from AI-037's scaffold) already injects `ChatService` for
AI-047's `queryWithConversation()`, and merely _importing_ `ChatService`'s module transitively loads
`DatabaseService` → the Prisma-generated ESM client, which fails under Jest. No production code
needed changing; purely a test-file wiring requirement, the same class of gotcha this section of
`CLAUDE.md` documents for every other spec file that touches `DatabaseService` transitively.

### RagService.queryWithConversation() — conversation-integrated RAG (AI-047)

Closes out Epic 5 — Semantic Search & RAG Orchestration (AI-045 through AI-047 are all now
`completed`). `queryWithConversation(conversationPublicId, question, options?)` reuses AI-046's
`buildContextBlock()`/`DEFAULT_RAG_TEMPERATURE` rather than duplicating citation-formatting logic,
integrating with Phase 2's `ChatService`.

**New `ChatService` seam** (`getConversationHandle(publicId): Promise<{ id: bigint; model: string
}>`): a small additive public method — `ConversationEntity` deliberately never exposes the internal
`bigint` row id that `buildContext()`/`addUserMessage()`/`addAssistantMessage()` all require, and
`RagService` only ever has a `publicId`. Thin wrapper around the already-existing private
`findConversationOrThrow()`; returns `model` too so the RAG-augmented turn respects the same
per-conversation model a normal turn would (mirrors `sendMessage()`'s own `dto.model ??
conversation.model` fallback). Pure addition — no existing method's signature/behavior changed.

**Flow**: resolve `{ id, model }` → reject a whitespace-only `question` (`BadRequestException`,
mirroring `sendMessage()`) → `addUserMessage(id, question)` persists the **plain** question
**before** retrieval/generation (same crash-resilience ordering as `sendMessage()`) →
`SearchService.search()` → a new private `spliceRetrievedChunks()` calls
`ChatService.buildContext(id)` (which already ends with the just-persisted plain-text question as
its last entry) and replaces **only that last entry's `content`** with the chunk-augmented `` `${contextBlock}\n\nQuestion: ${question}` `` string — a purely in-memory substitution on the array
sent to the model; the **persisted** `chat_messages` row is untouched, so `GET
/chat/conversations/:publicId` shows the plain question like any other turn (the "indistinguishable
in storage" requirement) → `chatCompletionWithMessages()` → `addAssistantMessage()` persists the
answer with no RAG-specific metadata, exactly like any other turn's assistant message.

**Budget enforcement**: `spliceRetrievedChunks()` sums the token cost of every history message
_except_ the last (fixed regardless of chunk count) once, then loops — measuring the spliced last
message's token cost and dropping the lowest-ranked chunk (`SearchService`'s results are already
score-descending, so `.slice(0, -1)` drops the weakest match) — until the combined total fits
`contextWindow * contextWindowPercentage` or no chunks remain. `contextWindow` comes from
`ModelRegistryService.findModelByModelId()`, falling back to `chatConfig.defaultContextWindow`;
`contextWindowPercentage` from `chatConfig.contextWindowPercentage` — both read directly via
`ConfigService` with literal fallbacks matching `chatConfig`'s own factory defaults (no cross-module
import of `ai-chat`'s `CONTEXT_CONFIG` constant needed). Conversation history itself is never
touched by this loop — `buildContext()` runs exactly once per turn, so its own trimming decision is
never revisited. `RagResult.sources`/`chunksRetrieved` reflect the post-reduction `chunksUsed` set
actually sent to the model, not the full `SearchService` result set.

### MockDataService.generateDocuments() — faker-based document generation (AI-048)

`MockDataService` (`src/modules/rag/services/mock-data.service.ts`), previously an empty shell from
AI-037, implements `generateDocuments(count, options?)` per spec §5.7/§10.1. `options.categories`
(or all five `DocumentCategory` values by default) are distributed round-robin
(`categories[i % categories.length]`) — deterministic, guarantees even coverage, no need for
randomized category selection.

**Five category-specific template builders** (`buildGuideTemplate`/`buildFaqTemplate`/
`buildDocsTemplate`/`buildTutorialTemplate`/`buildChangelogTemplate`), each returning `{ title,
header, nextSection: (index) => string }`: guides get prerequisites → numbered CLI install steps →
a fenced config block → troubleshooting sections; FAQs rotate through 6 question headings paired
with generated answers; docs get a features list, two API-reference entries
(`` `GET/POST /api/<noun>` ``), and an architecture section; tutorials get **unbounded**, strictly
incrementing `### Step <n>:` headings; changelogs get **unbounded** `## [<semver>] - <date>` version
headers with `### Added`/`### Fixed` subsections. `faker.commerce.productName()`/
`faker.hacker.noun()`/`faker.system.semver()`/`faker.date.past()`/etc. are injected into the
structural elements themselves (headings, CLI commands, version numbers) — `faker.lorem.*` fills
prose body text only. This is the FR-RAG-010 "structured, realistic documents" requirement made
concrete: the shape is deterministic per category, not lorem-ipsum-under-a-random-heading.

**Word-count control** (private `assembleContent()`): appends `nextSection()` blocks to the header
until the running word count reaches `minWords` (default 200, capped at a 200-iteration safety net),
then falls back to a word-level truncation if the last section pushed past `maxWords` (default 2000) — in practice this truncation path rarely engages, since stopping the instant `minWords` is
reached keeps documents comfortably inside the generous default range.

**Ingestion**: every document is created via `DocumentService.createFromText({ title, category,
tags: ['mock-data'], content })` (AI-043) — sequential `await`s in a `for` loop, not `Promise.all()`
— so generated documents are immediately searchable rather than inert metadata, and the `'mock-data'`
tag makes them identifiable/filterable later (AI-049/053, or manual cleanup).

**Dependency footgun, fourth occurrence** (same class as `axios`/`@langchain/core`/`@types/multer`
from AI-037/042/044, but a different _kind_ — this one isn't "missing from `node_modules`"):
`@faker-js/faker@10` ships pure ESM, which Jest's default CJS transform cannot parse
(`SyntaxError: Cannot use import statement outside a module`) — the _same_ Jest/ESM-only-package
incompatibility already documented for `pdf-parse`'s dynamic-import worker (AI-042), not a new
failure mode. Fixed identically: `jest.mock('@faker-js/faker', ...)` in the spec file with a small
deterministic fake, rather than a global Jest config change. Verified separately that the real
package works correctly outside Jest — this project's `"type": "module"` + `nodenext` compiles to
`require("@faker-js/faker")` in the CJS build output, which only works because this environment's
Node (20.19+) has `require(esm)` support enabled by default; confirmed live via `node -e
"require('@faker-js/faker')"` succeeding with no error. Worth re-checking if this project's Node
version baseline ever changes, or if any future issue imports another ESM-only package.

### MockDataService.generateQAPairs() + seedDefaultDataset() — Q&A pair generation (AI-049)

Adds a new `QaPair` Prisma model (`BigInt` id + `publicId` UUID, `question`, `expectedAnswer`,
`sourceDocumentId BigInt` FK → `documents.id` with `onDelete: Cascade`, `complexity String`,
`createdAt`) and a back-relation `Document.qaPairs QaPair[]` — migrated via this phase's
non-interactive `prisma migrate diff` → hand-written `migration.sql` → `prisma migrate deploy`
workaround (see AI-036's section above), same as every other schema change in this phase.

**`RAG_CONFIG.noInfoSentinel`**: the literal "I don't have enough information..." phrase that used
to live only inline inside `RAG_CONFIG.systemPrompt` (AI-037) was extracted into its own
`rag-config.constant.ts` field, with `systemPrompt` now built from it via template literal
(byte-identical output — `rag.service.spec.ts`'s existing systemPrompt-verbatim assertion still
passes unchanged). This gives the real RAG pipeline's refusal phrasing and this issue's edge-case
`expectedAnswer` one shared source of truth, which AI-050's evaluation will also read.

**`generateQAPairs(count, documentIds?)`**: reads `documents` + their `chunks` directly via
`DatabaseService` (`publicId: { in: documentIds }` when provided, otherwise all documents) — the
same direct-table-access convention `SearchService` (AI-045) already established for `document`/
`documentChunk`, rather than going through `DocumentService`. Documents with zero chunks are
dropped from the usable pool; an empty pool throws `BadRequestException`. Counts are split
`Math.round(count * 0.6)` / `Math.round(count * 0.25)` / remainder-into-edge-case, so the three
tiers' lengths always sum to exactly `count` regardless of rounding drift.

- **Simple** (round-robins documents × their chunks): `expectedAnswer` is exactly one chunk's own
  trimmed content — by construction, answerable from that single chunk. The question text extracts
  the chunk's leading markdown heading (private `extractTopic()`) as the topic.
- **Multi-step**: pairs two different documents' chunks when ≥2 usable documents exist (`Compare
"A" and "B": ...`, `expectedAnswer` concatenating both chunks prefixed by their titles) — matches
  the spec's own "compare X and Y" example; falls back to comparing two chunks within the same
  document when only one is available.
- **Edge-case**: cycles a hardcoded pool of eight scenario questions (`EDGE_CASE_QUESTIONS` —
  solar eclipses, time machines, leap seconds) deliberately disjoint from
  `generateDocuments()`'s own faker vocabulary, so an edge-case question can never coincidentally
  match real generated content. `expectedAnswer` is always `RAG_CONFIG.noInfoSentinel` verbatim.

All drafts are persisted in one `qaPair.createMany()` call, with `publicId`/`createdAt` generated
client-side (`randomUUID()`/`new Date()`) at draft-build time — `createMany()` doesn't return
created rows, and the method needs to return the full `QaPairEntity[]` (including `publicId`)
without a second round-trip query.

**`seedDefaultDataset()`**: `generateDocuments(5 categories × 10)` →
`generateQAPairs(documents.length × 10, documents.map(d => d.publicId))`, returning `{ documents,
qaPairs }` counts. The explicit `documentIds` restricts Q&A generation to exactly the documents
this call just created, so re-seeding a database that already has other documents in it never pulls
unrelated pre-existing content into the "default dataset."

### MockDataService.evaluate() — RAG accuracy scoring by complexity tier (AI-050)

Closes out Epic 6 — Mock Data Generation & Evaluation (AI-048 through AI-050 are all now
`completed`). `evaluate(sampleSize?)` runs a bounded set of persisted `QaPair` rows (AI-049)
through the real `RagService.query()` pipeline (AI-046) and scores each answer with a documented
heuristic — added to `MockDataService` rather than a new service, since this issue's own scope
text said it already owns the `QaPair` concept.

**Bounded by construction, not just by default**: `take = Math.min(sampleSize ??
DEFAULT_EVAL_SAMPLE_SIZE(50), MAX_EVAL_SAMPLE_SIZE(200))` — a caller requesting more than 200 is
silently clamped, never run unbounded, since every evaluated question is a live embedding +
Pinecone + generation call and this phase's target Q&A volume (10K+) makes "evaluate everything"
a real cost/rate-limit hazard. Pairs are read via `qaPair.findMany({ take, orderBy: { id: 'asc' }
})` (deterministic, reproducible ordering) and run through `RagService.query()` **sequentially**,
not `Promise.all()`'d — same rate-limit-conscious, deterministically-ordered convention
`DocumentService.embedChunks()`'s cache-check loop already established.

**Classification** (private `classifyAnswer()`) is explicitly a heuristic, not a ground-truth
grader (a full LLM-as-judge approach was out of scope — a third per-question LLM call this
codebase doesn't budget for):

- **Edge-case pairs** are scored on whether the answer _declines_ to answer, never on content
  similarity to `expectedAnswer` — `appropriateIDK` if the answer contains any of a hardcoded
  `IDK_PHRASES` list of "I don't have enough information" paraphrase variants (covering
  `RAG_CONFIG.noInfoSentinel`'s core substring plus common alternate phrasings), otherwise
  `incorrect`. A confidently-wrong answer that happens to share vocabulary with the sentinel (e.g.
  the word "information") is still `incorrect` — proven by its own test.
- **Simple/multi-step pairs** use a keyword-overlap ratio (`keywordOverlapRatio()` — the fraction
  of `expectedAnswer`'s significant keywords, length ≥ 4 with common stopwords filtered, that also
  appear in the generated answer) bucketed into `correct` (≥ 0.5), `partiallyCorrect` (≥ 0.2), or
  `incorrect` — a cheap proxy for correctness given LLM phrasing variance makes exact-string
  matching unreliable.

**Aggregation** (private `aggregateEvaluations()`) matches spec §6.5's response shape exactly:
global `correct`/`partiallyCorrect`/`incorrect`/`appropriateIDK` are raw classification-bucket
counts; overall `accuracy` is `correct / totalQuestions` (matching the spec example's own
arithmetic — `appropriateIDK` and `partiallyCorrect` don't count toward the numerator).
`byComplexity` always includes all three `QaComplexity` tiers, and each tier's own `correct` field
has **tier-dependent meaning** — "declined correctly" (counts `appropriateIDK`) for `edge-case`,
"answered correctly" (counts `correct`) for `simple`/`multi-step` — both using the same `correct /
total` accuracy formula underneath, just a different numerator per tier. This is the aggregate-level
resolution of the same "score edge-case on declining, not similarity" requirement the per-answer
classifier applies. `avgLatencyMs`/`avgTokens` average `RagResult.latencyMs`/
`RagResult.usage.totalTokens` across all evaluated pairs; all aggregates resolve to `0` (not
`NaN`) when zero pairs are evaluated.

**Known gap, by design**: no `POST /rag/evaluate` controller route exists yet — that's AI-053's
job, wiring `sampleSize` from the request into this method plus a Swagger response DTO. Real-world
judgment quality of the heuristic (vs. actual LLM answer phrasing) is explicitly a live/manual
concern for AI-055, not something these fixture-driven unit tests claim to validate.

### RagController — document endpoints (AI-051)

`RagController` (AI-037's `@ApiTags('rag')` stub) gains its first eight routes — spec §6.1's full
document surface — each a thin delegate to `DocumentService` (AI-041/AI-044) with no business
logic in the controller, following `ChatController`'s established conventions exactly
(`@ApiEndpoint()` per route, `@ApiNoContentResponse` + `@HttpCode(HttpStatus.NO_CONTENT)` on
delete, private `to*Res()` mappers converting entity → ResDto with `?? undefined` on nullable
fields):

- `POST /rag/documents` — multipart upload via `@nestjs/platform-express`'s
  `FileInterceptor('file')` and `@UploadedFile()`, metadata fields via
  `@Body() dto: UploadDocumentDto`
- `POST /rag/documents/text` → `DocumentService.createFromText()`
- `GET /rag/documents` → `findAll()`, `GET /rag/documents/:publicId` → `findOne()` (chunks +
  count + status all come from the same call), `GET /rag/documents/:publicId/chunks` →
  `getChunks()`, `PATCH /rag/documents/:publicId` → `update()`, `DELETE /rag/documents/:publicId`
  → `delete()` (204), `POST /rag/documents/:publicId/reindex` → `reindexDocument()`

No dedicated ingestion-status route exists — spec §6.1 only lists the eight routes above, and
`findOne()`'s response already carries `totalChunks`/`embeddingStatus`, making AI-044's
`getIngestionStatus()` method reachable only internally for now (unused by any route, same as
before this issue).

**`DocumentService.ingestFromFile()` signature extended** (the one production-code change outside
`RagController` itself): gained an optional second parameter,
`overrides?: Partial<Pick<CreateDocumentDto, 'title' | 'description' | 'category' | 'tags'>>`,
completing spec §6.1's "Upload Document Request" table (`title`/`description`/`category`/`tags`
form fields override the file-derived defaults) — AI-044 had only ever wired the `title`-defaults-
to-filename half of this, since no controller existed yet to supply the other fields. Purely
additive and backward-compatible: every existing call site (and `document-upload-reindex.service
.spec.ts`'s tests) invokes it with just `file`, which still resolves to the original filename-only
behavior via `overrides?.title ?? file.originalname`.

**`UploadDocumentDto`** (`dto/upload-document.dto.ts`) is the "multipart-aware DTO" the issue asked
for — `title?`/`description?`/`category?` mirror `CreateDocumentDto`, plus a `tags?: string`
**comma-separated string** (not `string[]` — multipart form fields are always strings, matching
`QueryDocumentsDto.tags`'s existing convention), parsed into `string[]` by a new private
`RagController.parseTags()` helper before being passed to `ingestFromFile()`'s overrides. A missing
file throws `BadRequestException('file is required')` in the controller before `DocumentService`
is ever called (`FileInterceptor` doesn't reject a fileless request on its own).

**Live-verified bug, fixed before landing**: the first draft declared a `file: unknown` property
directly on `UploadDocumentDto` (the textbook NestJS Swagger file-upload pattern) so
`@ApiBody({ type: UploadDocumentDto })` could render the binary field. A live `npm run dev` +
`curl -F` smoke test caught that this 500s/400s on every request — this project's `tsconfig.json`
targets `ES2023`, so TC39 class-fields semantics mean an undecorated class field like `file: unknown;`
becomes a real own-property (`undefined`) on _every_ instantiated object, not just ones where the
plain payload actually had that key. `main.ts`'s global `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true })` then rejects it with `"property file should not exist"`, since the
property carries no `class-validator` decorator. Fixed by removing `file` from the DTO class
entirely and declaring the binary field directly in an inline `@ApiBody({ schema: {...} })` in the
controller instead of `type: UploadDocumentDto` — Swagger still renders the full multipart schema
correctly, but the field never touches `@Body()`/`class-validator` at all. Worth remembering for
any future DTO in this codebase that needs a property present in Swagger docs but absent from
runtime validation: don't declare it as a plain class field, even one with no validator decorators.

A new `PaginatedDocumentChunksResDto` (`data: DocumentChunkResDto[]`, `total`, `page`, `limit`) was
added for the chunks-listing route — `PaginatedDocumentsResDto` already existed but is
document-shaped, not chunk-shaped.

**Testing**: `rag.controller.spec.ts` follows `chat.controller.spec.ts`'s exact pattern —
`TestingModule` + a `jest.fn()`-mocked `DocumentService` (with the now-standard
`jest.mock('.../database.service', ...)` guard, since `RagController` transitively imports
`DocumentService` → `DatabaseService` → the Prisma ESM client) covering all eight routes'
delegation/mapping, plus `class-validator` `validate()` smoke tests for the new
`UploadDocumentDto`. Per this issue's own Testing Notes, real `curl -F` multipart-transport wiring
is deliberately left to AI-055's live smoke test — these are DTO/delegation tests only, not a
transport-level proof.

### RagController — search + ask endpoints (AI-052)

Extends `RagController` (AI-051) with spec §6.2/§6.3's 3 remaining query routes — `SearchService`
and `RagService` are now also injected into the controller (alongside AI-051's `DocumentService`),
each route a thin delegate with no business logic:

- `POST /rag/search` → `SearchService.search()` (AI-045) — the controller measures
  `searchLatencyMs` itself around the call (`SearchService.search()` doesn't return a latency
  field), then wraps the results in `{ results, totalResults, searchLatencyMs }` per spec §6.2's
  response shape
- `POST /rag/ask` → `RagService.query()` (AI-046)
- `POST /rag/ask/conversation/:publicId` → `RagService.queryWithConversation()` (AI-047), with the
  route's `:publicId` passed as the first positional argument

**`AskDto` is shared by both ask routes** — spec §6.3 documents one request field table for both,
and `RagOptions` (the shared type both `RagService` methods accept) has an identical shape either
way (`topK?`/`model?`/`temperature?`/`category?`/`includeSourceChunks?`, with `category` mapped to
`RagOptions.categoryFilter` at the call site, same rename `SearchDto.category` → `SearchOptions
.categoryFilter` uses).

**`includeSourceChunks` response-shaping decision** (AI-046 explicitly deferred this to AI-052's
controller — see that section's own "Known gap, by design" note): `RagService.query()`/
`queryWithConversation()` always populate `RagResult.sources` regardless of the option; this
controller's private `toAskRes()` strips `sources` to `[]` when `dto.includeSourceChunks === false`
and keeps them for every other case (`true` or omitted) — matching spec §6.3's example response,
which always shows populated `sources`, and reading `includeSourceChunks`'s implicit default as
`true`.

Both new response DTOs (`SearchResDto`/`AskResDto`) plus their nested item DTOs
(`SearchResultResDto`/`RagSourceResDto`) mirror spec §6.2/§6.3's example JSON field-for-field.
`AskResDto.usage` reuses Phase 1/2's `UsageDto` (`openai/dto/usage.dto.ts`) — same cross-module
import pattern `AssistantMessageResDto` already established for ai-chat.

**Live-verified**: booted `npm run dev` against real Postgres and exercised all 3 routes with
`curl` — 400 on missing `query`/`question` and on an invalid `category` enum value, 404 on
`POST /rag/ask/conversation/:publicId` for an unknown conversation (propagated from
`ChatService.getConversationHandle()` through `RagService.queryWithConversation()` uncaught, same
as every other `NotFoundException`-based route in this codebase), and all 3 routes present in
`/api/docs-json` under the `rag` tag. `POST /rag/search`/`POST /rag/ask` both return 500 in this
sandbox specifically — root-caused via server logs to `PineconeConnectionError: Request failed to
reach Pinecone` (this environment has no network egress to Pinecone's control plane, a pre-existing
environment limitation already flagged as a Follow Up in AI-051, not a defect introduced here); DTO
validation, routing, and error-propagation all confirmed correct up to that boundary.

### RagController — mock data, evaluation & stats endpoints (AI-053)

Closes out Epic 7 — API Layer, DTOs, Swagger & Tests' AFK issues (AI-051/052/053 all now
`completed`; AI-054/055 remain). Extends `RagController` with spec §6.4/§6.5/§6.6's final 6 routes
— `MockDataService`, `PineconeService`, `EmbeddingCacheService`, `ConfigService`, and
`AppLoggerService` are now also injected into the controller (alongside AI-051/052's
`DocumentService`/`SearchService`/`RagService`):

- `POST /rag/mock/generate-documents` → `MockDataService.generateDocuments()` (AI-048), response
  is `DocumentResDto[]` (reuses AI-051's mapper)
- `POST /rag/mock/generate-qa` → `MockDataService.generateQAPairs()` (AI-049)
- `POST /rag/mock/seed` → `MockDataService.seedDefaultDataset()` (AI-049), no request body
- `GET /rag/mock/qa-pairs` → a **new** `MockDataService.findAllQaPairs()` method (see below)
- `POST /rag/evaluate` → `MockDataService.evaluate()` (AI-050)
- `GET /rag/stats` → aggregates `DocumentService.getStats()` (new), `PineconeService
.describeIndex()` (AI-040), `EmbeddingCacheService.getCacheStats()` (AI-039), and `ConfigService`
  directly — the one route in this module that legitimately touches more than one service, per
  this issue's own explicit scope carve-out

**Two small additive service methods, both minimal and backward-compatible**, since neither
existed before this issue needed a listing/aggregation seam:

- `DocumentService.getStats(): Promise<{ totalDocuments: number; totalChunks: number }>` — two
  parallel `count()` queries, mirroring `SearchService`/AI-045's precedent of direct
  `document`/`documentChunk` table access for read-only aggregates.
- `MockDataService.findAllQaPairs(query: QueryQaPairsDto): Promise<PaginatedQaPairsResult>` —
  follows `DocumentService.findAll()`'s exact pagination shape (`Math.min(limit, 100)`, parallel
  `findMany`/`count`). `documentId` (a publicId) is resolved to the internal FK id before
  filtering; an unresolvable `documentId` returns an empty page rather than 404ing, since this is
  a listing filter, not a single-resource lookup (same convention as `ChatService
.findAllConversations()`'s `userId` filter).

**`GET /rag/stats` degrades gracefully when Pinecone is unreachable**: `pineconeService
.describeIndex()` is wrapped in its own try/catch — a failure there logs a warning and falls back
to `totalVectors: 0`/`indexDimensions: undefined`, but never fails the whole response, since
document/chunk/cache stats are independently useful even when Pinecone is down. This was a
deliberate design choice, not incidental — proven immediately useful in this exact sandbox, whose
Pinecone connectivity has been broken since AI-051's live verification (see that section's Follow
Up). `cacheHitRate` is `hits / (hits + misses)`, `0` when there have been no lookups yet.

**`/rag/evaluate`'s bounded sample size is enforced twice**: `EvaluateDto.sampleSize` has its own
`@Max(200)` validator (belt-and-suspenders alongside `MockDataService.evaluate()`'s internal
`Math.min(sampleSize, MAX_EVAL_SAMPLE_SIZE)` clamp from AI-050) — a request for `sampleSize: 500`
is rejected with a 400 at the DTO layer before the service is ever called, satisfying this issue's
own explicit acceptance criterion more strictly than the service alone would have.

**`includeSourceChunks`-style response-shaping decision, this time for mock generation**: no
analogous flag exists here — `generateDocuments()`/`generateQAPairs()` always return their full
result arrays, matching spec §6.4's plain route list (no request/response field table was given
for these four routes, unlike §6.2/§6.3's `search`/`ask`).

**Live-verified**: booted `npm run dev` against real Postgres, exercised all 6 routes with `curl`.
`GET /rag/stats` returned 200 with `totalVectors: 0`/`indexDimensions` omitted and a logged
`Could not fetch Pinecone index stats: ...` warning — the graceful-degradation path working exactly
as designed against this sandbox's real broken Pinecone connectivity, not a simulated test case.
`POST /rag/evaluate` correctly 400'd at `sampleSize: 500`. `POST /rag/mock/generate-documents`
with `count: 2` created two real faker-generated documents end to end (title generation, category
tagging, response mapping) — `embeddingStatus: 'failed'` on both, same pre-existing Pinecone
connectivity limitation, not a defect. `POST /rag/mock/generate-qa` against a zero-chunk document
pool correctly propagated `MockDataService`'s `BadRequestException` ("No documents with embedded
chunks are available..."). All 6 routes confirmed present in `/api/docs-json` under the `rag` tag.
Test documents created during verification were deleted afterward (Postgres rows removed
successfully despite the same pre-existing Pinecone-`deleteByFilter` 500 documented in AI-051).

**Testing gotcha, third occurrence**: `rag.controller.spec.ts` needed a new
`jest.mock('@faker-js/faker', () => ({ faker: {} }))` stub — `RagController` now imports
`MockDataService` (even though it's provided via `useValue` in the `TestingModule` and never
actually instantiated), and merely importing that module transitively loads the ESM-only
`@faker-js/faker` package at module-evaluation time, which Jest's CJS transform can't parse. Same
root cause as `pdf-parse` (AI-042) and the direct `mock-data.service.spec.ts` fixture (AI-048) —
this is the first time the issue has surfaced transitively through a controller spec rather than a
service spec directly under test.

### RagController tests + full regression verification (AI-054)

Closes out Epic 7 — API Layer, DTOs, Swagger & Tests' AFK issues (AI-051 through AI-054 all now
`completed`; AI-055, HITL, is the only remaining Phase 3 issue). Verification-only, matching
AI-013/AI-034's role in Phase 1/2 — **no production code changed**, only test files.

**Coverage audit**: `RagController` has 17 routes (not the 14 the issue text estimated — a stale
count from when the issue was written, before AI-051/052/053's exact route lists were finalized).
All 17 already had delegation tests from AI-051/052/053. Two request DTOs turned out to have no
`class-validator` `validate()` smoke test anywhere in the suite — `CreateDocumentTextDto` (used by
`POST /rag/documents/text`) and `QueryChunksDto` (used by `GET /rag/documents/:publicId/chunks`) —
both closed by adding tests to `document-dtos.spec.ts` (the existing home for document-DTO
validation tests, alongside `CreateDocumentDto`/`UpdateDocumentDto`/`QueryDocumentsDto`) rather than
`rag.controller.spec.ts`, keeping DTO tests grouped by concern. All 12 of the module's request DTOs
now have validation coverage.

**FR-RAG-009 delete-cascade, structurally verified through `RagController` itself**: a new
`rag-controller-delete-cascade.integration.spec.ts` follows `chat-function-calling.integration
.spec.ts`'s (AI-034) "mock only the real external boundaries" convention — wires the actual
`RagController` + actual `DocumentService` through a `TestingModule`, mocking only
`DatabaseService` (`DeepMockProxy`) and `PineconeService` (plain `jest.fn()` object, since it
constructs the real Pinecone SDK client in its constructor). Every other `RagController` dependency
(`SearchService`/`RagService`/`MockDataService`/`TokenService`/`OpenaiService`/`EmbeddingService`/
`EmbeddingCacheService`) is stubbed as `{}`, since `deleteDocument()` never touches them. Proves,
from the actual controller method call: `dbMock.document.delete` and `pineconeServiceMock
.deleteByFilter` are both called with the right arguments, in the right order (Postgres delete
before the Pinecone cleanup), and that a missing document short-circuits before either is called.
The equivalent proof already existed at the `DocumentService`-unit level
(`document.service.spec.ts`'s `delete()` tests, from AI-041) — this closes the gap of that proof
never having been exercised starting from `RagController`'s own route entrypoint, which is what
this issue's acceptance criterion specifically asked for ("structurally verified — not just
documented").

**Testing gotcha, fourth occurrence**: the new integration spec file needed both of the by-now
established stubs — `jest.mock('.../database.service', ...)` (Prisma ESM) and
`jest.mock('@faker-js/faker', () => ({ faker: {} }))` (AI-053's freshly-documented gotcha) — since
it imports `RagController` directly, which transitively imports both `DocumentService` →
`DatabaseService` and `MockDataService` → `@faker-js/faker`.

**Full regression**: `npm run test` went from 465 to 474 passing tests (9 new: 4
`CreateDocumentTextDto` + 3 `QueryChunksDto` + 2 delete-cascade), with zero changes to any Phase
1/2 spec file's assertions. `npx tsc --noEmit --project tsconfig.build.json`, `npm run lint:check`
(0 errors), and `npm run build` all pass clean.

### Live API smoke test — real Pinecone, real embeddings (AI-055)

Phase 3's closing HITL issue. A real Pinecone index (`ai-product-integration-dev`, serverless,
AWS `us-east-1`, dimension 1536, metric cosine — spec §7.1) was created for this session, and
`PINECONE_API_KEY` was set to a real key. **Status: `in-review`, not `completed`** — one
acceptance criterion was genuinely not met and needs a product decision, documented in full in
AI-055's own issue file rather than repeated here.

**What worked end to end against real infrastructure**: document ingestion (`embeddingStatus:
'completed'`, real chunk + real Pinecone vector confirmed), semantic search (correct chunk ranked
top with score 0.814, comfortably above the 0.7 threshold), RAG answer + citation for an answerable
question, the "I don't have enough information" fallback for an unrelated question, and the
FR-RAG-009 delete cascade (Postgres rows gone via direct `psql` check, Pinecone vector confirmed
gone via a direct data-plane vector `fetch` — `GET /rag/stats`'s vector count lagged briefly after
delete, which is Pinecone serverless's own known eventual-consistency behavior for
`describeIndexStats`, not an app-level bug).

**`OPENAI_DEFAULT_MODEL` changed permanently** from `meta-llama/llama-3.3-70b-instruct:free` to
`tencent/hy3:free` — the old default 429'd on both `/rag/ask` and `/rag/evaluate` in this session.
Unlike `/rag/ask` (which accepts a per-request `model` override), `MockDataService.evaluate()`
calls `RagService.query(pair.question)` with no model override at all, so there was no way to route
around the rate limit for evaluation without changing the default. This is the exact contingency
AI-035 flagged ("swap ... only if this recurs") — it recurred, so the swap is now permanent in
`.env` rather than reverted.

**Real finding, not a defect**: `POST /rag/evaluate` against `MockDataService`-seeded data produced
the _opposite_ of the expected accuracy ordering (`simple`/`multi-step`: 0%, `edge-case`: 100%),
reproduced across two independent runs with different mock-document sizes. Root-caused by direct
inspection (not guesswork): a `simple`-tier search query that names a real heading verbatim scored
only 0.33 against its target chunk (best chunk in the whole index: 0.53) — both well under the 0.7
threshold — because `MockDataService`'s body text is `faker.lorem.paragraph()`/`.sentence()`
(meaningless Latin placeholder words), which produces a diffuse, low-signal chunk embedding no
matter how coherent the surrounding real structure (headings, endpoint paths) is. This is a
consequence of `MockDataService`'s own deliberate design tradeoff (§16: "faker for structure, not
LLM-generated content... reproducible, fast, free") intersecting with real embedding-based
retrieval for the first time — the entire unit-test suite mocks `RagService.query()` outright, so
this was structurally invisible before a live run against real embeddings. Independently confirmed
the retrieval/generation pipeline itself is not at fault: the same pipeline, same threshold, same
model scored 0.814 and answered/cited correctly against real natural-language content earlier in
the same session. Resolving this requires a design choice (coherent-filler mock content, a
lower/separate `evaluate()` similarity threshold, or an LLM-judge grader instead of keyword
overlap) — deliberately left as a Follow Up rather than fixed inline, since this is a
verification-only issue.

**Secondary finding**: `SearchService.search()`/`RagService.query()` don't catch Pinecone
timeouts the way `DocumentService.ingestDocument()` deliberately does (AI-043) — a transient
`PineconeConnectionError` mid-`/rag/evaluate`-batch surfaced as an uncaught 500, aborting the whole
batch rather than just the one question. The app itself never crashed; retrying the whole call
succeeded. Worth wrapping `PineconeService` calls in `RetryService` as a Follow Up, matching the
retry pattern already applied to OpenAI calls.

**Phase 3 PRD status at this point**: stayed `ready-for-agent`, not `completed` — AI-055 was
`in-review` rather than `completed` pending a human decision on the mock-data-evaluation finding
above. **Resolved in a later follow-up** — see the "Similarity threshold recalibration" section
below, after which AI-055 and the Phase 3 PRD were both marked `completed`.

### Realistic seed dataset + inline-qaPairs evaluation (AI-055 follow-up)

A direct follow-up to AI-055's open finding above, requested outside the numbered issue tracker.
Built a second, static Q&A dataset to test whether AI-055's "faker.lorem content embeds poorly"
hypothesis was actually the root cause, or just one symptom of something broader — see the
refined finding below, which shows it was the latter.

**`src/modules/rag/seed-data/`** holds 10 hand-written, coherent Markdown documents (~700–1,000
words each) about a fictional CloudPulse SaaS product (return policy, getting-started guide, API
reference, pricing, troubleshooting FAQ, security practices, deployment guide, team management,
a versioned changelog, and an integrations guide) plus `qa-pairs.json` — 50 Q&A pairs (5 per
document: 3 simple, 1 multi-step, 1 edge-case), each carrying `sourceDocument` (matched by
filename) and `complexity`. Unlike `generateDocuments()`'s faker-templated content, every fact,
number, and heading in these documents is real and internally consistent, so questions can be
answered from a single real sentence rather than a randomly-assembled paragraph.

**`nest-cli.json` gained a `compilerOptions.assets` entry** — `tsc` only compiles `.ts` files, so
without this the `seed-data/*.md`/`.json` files never reached `dist/`. Nest's asset copier resolves
`include` paths relative to `sourceRoot` ("src") and by default copies into the build's root
`outDir` ("dist") — but this project's `tsconfig.json` has no explicit `rootDir`, so `tsc` infers
one from the union of compiled entry points (`src/**` and `prisma/seed.ts`) and preserves the
`src/` segment in `dist/src/**`. That mismatch meant assets landed at `dist/modules/rag/seed-data`
while `mock-data.service.js`'s `__dirname`-relative lookup expected `dist/src/modules/rag/seed-data`
— a `ENOENT` on `seedRealisticDataset()`'s first live call, fixed by setting the asset's own
`"outDir": "dist/src"` override (each asset entry can override the default outDir independently).
Worth remembering for any future non-`.ts` asset added under `src/`.

**`MockDataService.seedRealisticDataset(): Promise<{ documents: number; qaPairs: number }>`**
reads every `seed-data/*.md` file and ingests it through the real
`DocumentService.ingestFromFile()` pipeline (chunk + embed + Pinecone upsert) via a
hand-constructed `Express.Multer.File` object (same `makeFile()`-style shape
`document-upload-reindex.service.spec.ts` already uses for tests, now also used in production
code) — sequential `await`s, not `Promise.all()`'d, matching every other bulk-ingestion loop in
this module. It then reads `qa-pairs.json`, resolves each `sourceDocument` filename to the
just-ingested document's internal id (one `document.findMany()` keyed by `originalFilename`), and
persists all 50 as real `QaPair` rows via `qaPair.createMany()` — so they're immediately visible
through the existing `GET /rag/mock/qa-pairs` and the default DB-backed `POST /rag/evaluate` path,
exactly like `generateQAPairs()`'s rows. Tagged `'realistic-seed'` (not `'mock-data'`) so the two
datasets stay independently filterable. New route: `POST /rag/mock/seed-realistic`.

**`EvaluateDto` gained an optional `qaPairs?: EvaluateQaPairDto[]`** (`{ question, expectedAnswer,
complexity }`, `@ValidateNested` + `@Type(() => EvaluateQaPairDto)`), and
`MockDataService.evaluate(sampleSize?, qaPairs?)` uses the supplied array directly instead of
reading the `qaPair` table when one is provided (still bounded by the same `sampleSize`/
`MAX_EVAL_SAMPLE_SIZE` clamp) — lets a caller evaluate an ad hoc pair list without persisting
anything first. Purely additive; every existing call site that only passes `sampleSize` is
unaffected. A shared `EvaluateQaPairInput` interface (`rag.types.ts`) is the minimal shape both a
Prisma `QaPair` row and a request-supplied pair satisfy, so `evaluate()`'s loop body doesn't care
which source it came from.

**Refined finding — the AI-055 mock-eval accuracy-ordering problem is not primarily a
faker-content issue.** Ran the full live flow against the real Pinecone index used in AI-055:
`POST /rag/mock/seed-realistic` (10/10 documents ingested, `embeddingStatus: 'completed'`, 21
chunks/21 vectors), then `POST /rag/evaluate` against all 50 real Q&A pairs. Result:
`simple` 3% (1/30), `multi-step` 0% (0/10), `edge-case` 100% (10/10) — the same qualitative
failure pattern AI-055 originally saw with faker content, this time against hand-written,
internally-consistent, keyword-rich English prose. Directly measured why: `POST /rag/search` with
`similarityThreshold: 0` against five different simple-tier questions returned top scores of
0.45–0.59 — and even a query that near-verbatim copies a chunk's own sentence
("Verified nonprofits and educational institutions receive 50% off Pro and Enterprise plans")
only scored 0.57 against that exact chunk. None of these clear the default `RAG_SIMILARITY_THRESHOLD`
of `0.7`, so most `simple`/`multi-step` questions retrieve zero chunks and the model correctly (and
uselessly, for scoring purposes) answers "I don't have enough information" — which the classifier
correctly marks incorrect for `simple`/`multi-step` tiers but which happens to be exactly the
right answer for `edge-case` questions, producing the inverted-looking accuracy split. AI-055's
single 0.814 example was evidently an easier, narrower case, not representative of this pipeline's
typical chunk-vs-question cosine similarity with `text-embedding-3-small`.

**Practical implication**: `RAG_CONFIG.similarityThreshold` (0.7 default) appears miscalibrated
for this pipeline's chunking strategy (multi-paragraph, multi-topic ~500-token chunks) against
short factual questions, regardless of content quality — a broader and more actionable finding
than AI-055's original "generate better mock content" framing. This was deliberately left
unchanged here (a production threshold change is a product decision, not implied by "build a
realistic seed dataset"): candidate follow-ups are lowering the default threshold, using a
smaller/more targeted chunk size, or introducing an `evaluate()`-specific threshold distinct from
production `/rag/search`'s.

**Cleanup**: all 10 realistic documents (and their cascade-deleted QA pairs and chunks) were
deleted via `DELETE /rag/documents/:publicId` after verification — `GET /rag/stats` confirmed
`totalDocuments: 0`, `totalChunks: 0` afterward (`totalVectors` briefly still showed the
pre-delete count, the same Pinecone `describeIndexStats()` eventual-consistency lag AI-055 already
documented). The dev server was stopped and port 3000 confirmed free. The seed-data files and
`seedRealisticDataset()`/`POST /rag/mock/seed-realistic` themselves are permanent, reusable
additions — re-running the endpoint regenerates the same dataset in ~2–3 minutes.

### Similarity threshold recalibration — AI-055 resolved (second follow-up)

The practical implication flagged directly above ("`RAG_CONFIG.similarityThreshold` (0.7 default)
appears miscalibrated ... regardless of content quality") was acted on: `RAG_CONFIG
.similarityThreshold` (`src/modules/rag/constants/rag-config.constant.ts`) and the
`RAG_SIMILARITY_THRESHOLD` env fallback (`ragConfig.similarityThreshold` in `src/config
/app.config.ts`, plus `.env.example`'s documented default) were both changed from `0.7` to `0.3`,
with an inline comment recording the measured score distribution (0.4–0.6 for genuinely relevant
matches against `text-embedding-3-small` with ~500-token multi-topic chunks) as the reasoning, so
a future reader doesn't have to re-derive it from this section. Chunking strategy and embedding
model were deliberately left untouched, per this follow-up's own explicit scope — this is a
threshold-only fix.

**Re-verified against the same live pipeline** (real Pinecone index, real embeddings): re-ran
`POST /rag/mock/seed-realistic` (10 documents, 21 chunks/vectors, 50 Q&A pairs — identical to the
prior run, embedding-cache hit rate 1.0 since content was unchanged) followed by `POST
/rag/evaluate` with `sampleSize: 50`. Result — a complete reversal of the pre-fix numbers:
`simple` 90% (27/30), `multi-step` 100% (10/10), `edge-case` 80% (8/10), overall accuracy 74%
(37/50 correct, 0 partial, 5 incorrect, 8 appropriateIDK). This directly confirms the diagnosis:
lowering the floor from 0.7 to 0.3 let genuinely relevant chunks (previously filtered out at
0.4–0.6 similarity) through to generation, without materially harming edge-case rejection (80% of
edge-case questions still correctly triggered the "I don't have enough information" refusal).

**Two of three live `POST /rag/evaluate` attempts failed transiently mid-batch** with
`PineconeConnectionError: Request failed to reach Pinecone` (first attempt: ~25.6 min elapsed
before failing; second: ~2 min) — this is exactly the "secondary finding" AI-055 already
documented ("`SearchService.search()`/`RagService.query()` don't catch Pinecone timeouts... a
transient error mid-`/rag/evaluate`-batch surfaced as an uncaught 500, aborting the whole batch").
A direct `POST /rag/search` call in between attempts confirmed Pinecone connectivity itself was
fine (13s round-trip, real ranked results) — the failures were transient network blips in this
sandbox, not a threshold-change regression or a newly introduced defect. The third attempt
succeeded end to end in ~24.5 min. Wrapping `PineconeService` calls in `RetryService` remains an
open Follow Up (unchanged from AI-055), now with two more reproductions as evidence it's worth
prioritizing.

**AI-055 is now fully resolved** — see that issue file's own updated status/Implementation Notes.
Phase 3 PRD (`docs/prd/2026-07-08-vector-search-rag.md`) is marked `completed`, and
`docs/prd/index.md` reflects the same.

## Phase 4 — Safety & Compliance (in progress)

Phase 4 (`docs/prd/2026-07-10-safety-compliance.md`, issues `AI-056`–`AI-075`) is the governance
layer: content moderation (guard for input, interceptor for output), per-user cost budgets
enforced from `ai_audit_logs`, advanced cost analytics, and time-based data retention. See
`docs/specs/Phase_4_Safety_Compliance_Requirement_Specification.md` for the full spec. Two new
modules (`ModerationModule`, `CostManagementModule`) following the one-way dependency direction
(new module → `OpenaiModule`, never the reverse).

### Schema foundation (AI-056)

Added two models to `schema.prisma`, both with the standard `BigInt` PK + `publicId` UUID
convention:

- **`ModerationLog`** (`@@map("moderation_logs")`) — one row per moderation check (clean or
  flagged, input or output). Append-only (no `updatedAt`, like `AiAuditLog`/`ChatMessage`).
  `direction`/`action`/`source` are plain strings (enum-like, validated at the service layer, not
  DB constraints — same convention as `sourceType`/`embeddingStatus` on `Document`).
  `categories`/`categoryScores` are non-nullable `Json @db.JsonB`; `content` is stored truncated to
  1000 chars by the writing service, not by a DB constraint. Indexes: `(userId, createdAt DESC)`
  and a **partial** `(isFlagged) WHERE isFlagged = true`.
- **`UserCostBudget`** (`@@map("user_cost_budgets")`) — one budget row per user (`userId String
@unique`), `dailyLimitUsd?`/`monthlyLimitUsd?` (null = unlimited), `isActive` (default `true`),
  `alertThreshold` (default `0.8`). Has `updatedAt` (mutable, unlike the log tables).

The **partial index** on `moderation_logs(isFlagged)` reuses the exact precedent from
`20260625055424_fix_status_partial_index`: Prisma's schema DSL can't express partial indexes, so
`@@index([isFlagged])` is declared plain in the schema (with an inline comment), and the migration
SQL was hand-edited to append `WHERE "isFlagged" = true`. Migrated via the phase-3 non-interactive
workaround (`prisma migrate diff` → hand-edit `migration.sql` → `prisma:migrate:deploy`), migration
`20260710000000_add_moderation_logs_and_user_cost_budgets`. Both the partial index and the
`user_cost_budgets(userId)` unique constraint were verified live via `psql`.

### Config foundation + module scaffolds (AI-057)

Three new config namespaces in `app.config.ts` (`registerAs()`), all eleven env vars
`@IsOptional()` in `env.validation.ts` with the spec §12 defaults:

- **`moderationConfig`** (`'moderation'`) — `enabled`/`inputEnabled` default `true`
  (`MODERATION_ENABLED`/`MODERATION_INPUT_ENABLED`, parsed as `!== 'false'`); `outputEnabled`
  defaults `false`, opt-in (`MODERATION_OUTPUT_ENABLED`, parsed as `=== 'true'` — the inverse
  check from the other two, since its default polarity is reversed); `blockThreshold`
  (`MODERATION_BLOCK_THRESHOLD`, default `0.7`).
- **`costBudgetConfig`** (`'costBudget'`) — `enabled` (`COST_BUDGET_ENABLED`, default `true`),
  `cacheTtlMs` (`COST_BUDGET_CACHE_TTL_MS`, default `60000`).
- **`retentionConfig`** (`'retention'`) — `auditDays`/`moderationDays`/
  `archivedConversationDays`/`embeddingCacheDays` (defaults `90`/`90`/`30`/`180`) and `cron`
  (`RETENTION_CRON`, default `'0 2 * * *'`).

Two new modules registered in `AppModule.imports`, both still **empty shells** as of this issue —
mirroring AI-016/AI-037's scaffolding precedent — gaining real implementations across AI-058
through AI-075:

- **`ModerationModule`** (imports `OpenaiModule`) — `ModerationService` (constructor-only shell:
  `DatabaseService`, `OpenaiService`, `ConfigService`, `AppLoggerService` — `OpenaiService` is
  already injected here, ready for AI-058's `moderateText()` seam), `ModerationController`
  (`@ApiTags('moderation')` stub, no routes yet), and two exported providers whose interfaces
  forced a minimal pass-through implementation rather than a true empty shell: `ModerationGuard`
  (`implements CanActivate`, `canActivate()` returns `true` unconditionally) and
  `OutputModerationInterceptor` (`implements NestInterceptor`, `intercept()` returns
  `next.handle()` unchanged). A guard/interceptor declared to implement a NestJS interface without
  satisfying it doesn't compile, so these two get the smallest viable stub body instead of zero
  method bodies — each carries a comment naming the issue that replaces it (AI-061/AI-062).
- **`CostManagementModule`** (no AI-specific imports — reads `ai_audit_logs` directly once
  implemented) — `CostBudgetService`/`CostAnalyticsService`/`RetentionService` (constructor-only
  shells) and `CostBudgetGuard` (same pass-through-stub exception as above, replaced in AI-066).
  `CostManagementController` (`@ApiTags('cost-management')`) is declared with a bare
  `@Controller()` and no path prefix — spec §6 splits its eventual routes across `/cost/...`
  (budgets, analytics) and `/retention/...`, and AI-073 is expected to resolve that with a second
  controller class, so this scaffold doesn't commit to a prefix a later issue would have to undo.

`src/modules/moderation/constants/` holds `ModerationCategory` (11 values, spec §4.1 — note the
slash-bearing string values like `'hate/threatening'` paired with plain-identifier keys),
`ModerationAction`, `ModerationDirection` (spec §4.2–§4.3), each an `as const` object with a
derived union type, one per file, barrel-exported. `src/modules/cost-management/constants/` holds
`BudgetPeriod` (spec §4.4) and `RETENTION_CONFIG` (spec §4.5 — the hardcoded fallback constant
mirroring `CONTEXT_CONFIG`/`RAG_CONFIG`'s role: `RetentionService` should prefer the `retention`
config namespace at call sites, falling back to this constant only where config isn't injected).

Both Swagger tags are registered in `main.ts`'s `DocumentBuilder` — `moderation` already existed
from earlier scaffolding; `cost-management` was added by this issue.

**Verified live**: booted the app twice via `nest start` — once with zero Phase 4 env vars set,
once with `MODERATION_ENABLED=false` — both times `ModerationModule`/`CostManagementModule`
initialized with no DI errors and the app reached `Application running on port 3000`, confirming
the default posture boots clean and the boolean-toggle parsing doesn't crash `env.validation.ts`.

### OpenaiService — moderateText() + moderateBatch() (AI-058)

Additive to Phase 1/3's `chatCompletion()`/`generateEmbedding()` — `moderateText(input: string)`
and `moderateBatch(inputs: string[])` are the seam `ModerationModule` (AI-060 onward) calls
through; per the established "only `OpenaiService` touches the SDK" rule, no moderation service
calls `openaiClient.moderations` directly. Both wrap `openaiClient.moderations.create({ input })`
via a private `executeModeration()` helper — structurally parallel to `executeCompletion()`/
`executeEmbedding()` (same `RetryService.executeWithRetry()` → `AiAuditService.log()` →
`mapError()` shape) but kept as its own helper rather than merged, since
`ModerationCreateResponse`'s shape (`{ results: Moderation[] }`) shares nothing with chat/embedding
responses. `moderateText()` returns the first result mapped to camelCase; `moderateBatch()` sends
the whole array as a single `input` (the endpoint natively accepts arrays) and maps every result,
trusting the SDK's documented input-order-preserving behavior — same convention
`generateEmbeddingsBatch()` already established for embeddings.

A new `ModerationResult` type (`{ flagged: boolean; categories: Record<string, boolean>;
categoryScores: Record<string, number> }`, `types/openai.types.ts`) is the camelCase shape callers
see — the SDK's snake_case `category_scores` is converted at this seam only, so no caller
downstream (`ModerationService`, AI-060) ever touches snake_case.

Cost is always `0` — `estimatedCost: 0` on every audit row, hardcoded rather than routed through
`TokenService.calculateCost()`, since OpenAI's moderation endpoint is free and analytics must
never attribute cost to it. Every call is logged via `endpoint: OpenAIEndpoint.MODERATIONS`
(defined since Phase 1, unused until now) with `inputTokens`/`outputTokens`/`totalTokens: 0` (the
endpoint reports no usage). `userMessage` on the audit row is the input text (first item for a
batch, matching `generateEmbeddingsBatch()`'s own batch-audit convention) truncated to 1000
characters via a private `truncateForAudit()` helper — the audit log's `userMessage` column has no
DB-level length constraint, but an unbounded moderation-check payload isn't worth storing in full
for a free, potentially high-volume endpoint. `mapError()` is reused unchanged, so a
`CircuitOpenException` from `RetryService` (the same circuit chat/embeddings/moderations calls all
share) passes through `moderateText()`/`moderateBatch()` identically to the other two seams.

Neither method takes a `model` parameter — the SDK defaults the moderation model server-side. On
the success path the audit row's `model` is `response.model` (whatever the SDK actually ran); on
the failure path (no response to read from) a `DEFAULT_MODERATION_MODEL` constant
(`'omni-moderation-latest'`) is logged purely to satisfy the audit row's non-nullable `model`
column — it has no effect on which model the SDK invokes.

**Scope boundary, deliberately excluded here**: no config toggles, thresholds, or
`moderation_logs` writes — this seam is a pure, always-on SDK wrapper. `ModerationService` (AI-060)
owns policy (thresholds, enable/disable) and persistence; this issue only makes the SDK call
reachable through the existing retry/audit pipeline. Whether the currently configured
`OPENAI_BASE_URL` (if pointed at OpenRouter) actually proxies `/moderations`, or whether moderation
calls need to bypass it and hit the real OpenAI endpoint directly, is untested here — that's
AI-059's live probe, not this issue's concern.

### ModerationService — classification + moderation_logs logging (AI-060)

`ModerationService` (`src/modules/moderation/services/moderation.service.ts`) replaces AI-057's
constructor-only shell with `moderateText(text, options?)`/`moderateBatch(texts)` — the
classification and logging layer sitting on AI-058's `OpenaiService.moderateText()`/
`moderateBatch()` SDK seam. This service is the _only_ reader/writer of `moderation_logs`, the
same exclusive-owner role `AiAuditService` has for `ai_audit_logs`.

**Threshold-based classification** (private `buildResult()`): a category counts as flagged when
the API's own boolean was `true` **or** its score is `>= moderation.blockThreshold` (config,
default `0.7`) — this OR-check is what makes borderline handling tunable (FR-MOD-005). `isFlagged`
is derived from the resulting flagged-category set, not the SDK's own untuned top-level `flagged`
boolean. `highestScore` tracks the single highest-scoring category across the response.

A new `src/modules/moderation/types/moderation.types.ts` holds `ModerationOptions` (`userId?`,
`requestId?`, `direction?`, `source?`, `action?`) and this module's own `ModerationResult`
(`isFlagged`, `categories`, `categoryScores`, `flaggedCategories`, `highestScore`) — deliberately a
different shape from (and imported under an alias from) `OpenaiService`'s `ModerationResult`
(AI-058's raw `{ flagged, categories, categoryScores }` SDK-seam shape).

**Logging is fire-and-forget**, mirroring `AiAuditService.log()`'s exact pattern: a private
`logModeration()` `await`s the `moderationLog.create()` write inside its own try/catch (logging
failures via `AppLoggerService`, never throwing), and every public method calls it as `void
this.logModeration(...)` so a DB failure never rejects the caller's moderation check. `content` is
truncated to 1000 characters before being stored (`MAX_LOG_CONTENT_LENGTH`), matching the spec's
`moderation_logs.content` column description and AI-058's own audit-row truncation budget.

**Action resolution**: `moderateText()`'s `options.action` lets a caller record what it actually
did with a flagged result. When flagged: `options.action ?? ModerationAction.BLOCKED` (a sensible
default for a caller that doesn't override, e.g. AI-061's guard). When clean: always
`ModerationAction.ALLOWED`, regardless of any `options.action`. AI-062's
`OutputModerationInterceptor` is expected to pass `{ action: ModerationAction.REPLACED }`.
`moderateBatch()` takes no per-item options (matching spec §5.1's signature exactly) — every
batched check logs with `direction: 'input'`, `source: 'standalone'`, no `userId`, same
default-BLOCKED-when-flagged resolution.

**Fail-open** (PRD decision, both methods): a caught `OpenaiService` error is logged loudly, then a
clean `ModerationResult` is returned and logged with `metadata: { failedOpen: true }` and `action:
ModerationAction.ALLOWED` — a moderation-API outage degrades to "allow everything, but make the
outage visible in `moderation_logs`," never a hard failure that takes down chat/RAG. Applied
symmetrically to `moderateBatch()` (one clean+failedOpen row per input), keeping the "every check
produces a row" invariant true regardless of which method was called or whether the API failed.

**Kill switch**: both methods check `moderation.enabled` (default `true`) before anything else,
short-circuiting to clean result(s) with zero `OpenaiService` calls and zero DB writes when
disabled — every future consumer (this standalone entry point, plus AI-061/062's guard/interceptor)
inherits the kill switch from this one place. `requestId` resolution mirrors
`AppLoggerService`/`OpenaiController`'s existing convention: `options.requestId ??
requestContext.getStore()?.requestId`.

**Scope boundary, deliberately excluded here**: `getModerationLogs()`/`getModerationStats()` (spec
§5.1's remaining two interface methods) and the `ModerationController` routes are AI-071's job —
this issue only builds the classify-and-log core.

### ModerationGuard — input moderation with 422 blocking (AI-061)

`ModerationGuard` (`src/modules/moderation/guards/moderation.guard.ts`) replaces the AI-057
always-`true` pass-through stub with the real spec §7.2 input-side enforcement point, sitting on
AI-060's `ModerationService`. Order of operations: both config toggles checked first
(`moderation.enabled` AND `moderation.inputEnabled`, both default `true` — either `false` bypasses
with zero side effects) → the body field to check is resolved from route metadata or defaults →
the field is read and type-checked (missing/non-string → pass through, no `ModerationService`
call — validation pipes own that error, not this guard) → `ModerationService.moderateText()`
called once → flagged throws `UnprocessableEntityException`, clean returns `true`.

A new `@ModerateField(field, source?)` decorator (`src/modules/moderation/decorators/
moderate-field.decorator.ts`, `SetMetadata`-based) lets a route declare which body field holds the
user's text and which `source` string to log (e.g. `@ModerateField('content', 'chat')` vs.
`@ModerateField('question', 'rag')`) — one combined metadata object rather than two decorators,
since both were needed by the same guard call. `ModerationGuard` reads it via
`reflector.getAllAndOverride(MODERATE_FIELD_KEY, [handler, class])`, falling back to `field:
'content'` / `source: 'standalone'` when a route carries no metadata — this issue doesn't apply
the guard to any route yet (that's AI-063).

**Identity resolution** (private `resolveUserId()`): `x-user-id` request header first, falling
back to `body.userId`. Per spec §14 ("real auth is out of scope — userId is passed as a
parameter"), there's no JWT-derived identity in this phase, so this header/body convention is the
only signal available — AI-066's `CostBudgetGuard` is expected to reuse it verbatim.

**Action resolution**: the guard always passes `action: ModerationAction.BLOCKED` to
`moderateText()` — behaviorally only matters on the flagged path (`ModerationService` always logs
`ALLOWED` when clean, regardless of what's passed), but makes the guard's fixed intent
self-documenting rather than silently relying on the service's own BLOCKED-when-flagged default.
AI-062's `OutputModerationInterceptor` is expected to instead pass
`action: ModerationAction.REPLACED`, following this same explicit pattern.

**Known gap, flagged for AI-063**: `HttpExceptionFilter` (`src/common/filters/
http-exception.filter.ts`) currently forwards only `message`/`error` from an `HttpException`'s
response body into the final `{ statusCode, message, error, timestamp, path }` client envelope —
it does not spread through extra keys like this guard's `flaggedCategories`/`categoryScores`/
`highestScore`. Those fields exist on the guard's own exception object (verified via
`getResponse()` in this issue's unit tests) but will not reach an actual HTTP client until the
filter is generalized to pass through additional body keys when present — deliberately left
unmodified here since it's shared, cross-cutting code touching every endpoint's error responses,
outside this issue's stated scope. Needs resolving before or during AI-063's live verification.

### OutputModerationInterceptor — replace flagged AI output (AI-062)

`OutputModerationInterceptor` (`src/modules/moderation/interceptors/output-moderation.interceptor.ts`)
replaces the AI-057 always-passthrough stub with the real spec §7.3 output-side check, sitting on
AI-060's `ModerationService` exactly like AI-061's guard does for input. Both config toggles are
checked first — `moderation.enabled` AND `moderation.outputEnabled` (default **`false`**, opt-in,
the one polarity flip vs. the guard's default-`true` toggles) — either `false` short-circuits to
`next.handle()` unchanged with zero `ModerationService` calls.

A new `@ModerateOutputField(field, source?)` decorator
(`decorators/moderate-output-field.decorator.ts`, `MODERATE_OUTPUT_FIELD_KEY`) mirrors AI-061's
`@ModerateField` exactly — same `SetMetadata` shape, same `reflector.getAllAndOverride()` lookup,
falling back to `field: 'content'`/`source: 'standalone'` when a route carries no metadata (no
route applies it yet — that's AI-063). Since interceptor mapping needs to be async-capable,
`next.handle()` is piped through rxjs `switchMap()` (`rxjs/operators`, same import convention as
`ResponseInterceptor`'s `map()`) into a private async `moderatePayload()`.

A non-object payload or one missing the resolved field passes through untouched with no service
call — the field-less-payload guard-rail AI-061's guard already established for a missing/non-string
body field. A present string field is sent to `ModerationService.moderateText(text, { direction:
'output', source, userId, requestId, action: ModerationAction.REPLACED })` — `action: REPLACED`
mirrors the guard's `action: BLOCKED` self-documenting-intent convention (it only actually changes
behavior on the flagged branch, since the service always logs `ALLOWED` when clean regardless of
what's passed). Flagged → a shallow copy of the payload with only the resolved field replaced by a
new `SAFE_REPLACEMENT_MESSAGE` constant (`constants/moderation-messages.constant.ts`, barrel-exported,
`"I'm sorry, I can't provide that type of content."` verbatim per spec §7.3); clean → the original
payload reference, unchanged.

**No extra plumbing was needed for "the log preserves the original content"** —
`ModerationService.moderateText()` already logs the exact `text` string it was called with
(truncated internally per AI-060), so calling it with the pre-replacement text before swapping the
field in the _returned_ payload naturally produces a correct `moderation_logs` row with no
interceptor-side duplication of that logic. Likewise, **no interceptor-level try/catch was needed
for the fail-open case** — a moderation-API failure is caught inside `moderateText()` itself, which
returns a clean (`isFlagged: false`) result, so the interceptor's existing clean→passthrough branch
already returns the original payload unmodified.

`ModerationModule`'s provider/export list needed no change — `OutputModerationInterceptor` was
already registered from AI-057's scaffold; it just gained `ConfigService` as a third constructor
dependency (already a global provider, resolved automatically). Not applied to any real route
here — that's AI-063 — and, per this issue's own explicit scope boundary, never applicable to the
SSE streaming route (`ChatController`'s raw `@Res()` handler bypasses NestJS interceptor mapping
entirely, so a streamed response can't be moderated this way even after AI-063 lands).

### Applying ModerationGuard + OutputModerationInterceptor to chat & RAG routes (AI-063)

The only edits Phase 4 makes to pre-existing modules, and they're decorator-only:
`ChatController` gets `@UseGuards(ModerationGuard)` + `@ModerateField('content', 'chat')` on both
`POST .../messages` and `POST .../messages/stream`, plus
`@UseInterceptors(OutputModerationInterceptor)` + `@ModerateOutputField('content', 'chat')` on the
non-streaming route only (SSE bypasses interceptor mapping — AI-062's own scope boundary).
`RagController` gets the guard + `@ModerateField('question', 'rag')` on both `POST /rag/ask` and
`POST /rag/ask/conversation/:publicId`, plus the output interceptor +
`@ModerateOutputField('answer', 'rag')` on `POST /rag/ask` only. `AiChatModule`/`RagModule` both
added `ModerationModule` to their `imports`.

**`ModerationModule` now exports `ModerationService` too, not just the guard/interceptor** — a
required fix this issue surfaced, not anticipated by its own spec text. NestJS resolves a class
referenced via `@UseGuards()`/`@UseInterceptors()` by constructing it fresh within the _host_
module's own injector scope (`AiChatModule`/`RagModule`), not by reusing the singleton already
built inside `ModerationModule` — so `ModerationService` (the guard's own first constructor
dependency) has to be visible to that host scope too, or the real app throws
`UnknownDependenciesException` on boot. `AI-057`'s original `exports: [ModerationGuard,
OutputModerationInterceptor]` was insufficient; `ModerationService` was added alongside them.

**This issue's own predicted regression posture was wrong, and that's worth remembering for any
future guard/interceptor wiring in this codebase**: it assumed a bare `TestingModule` (no
`imports`, just `controllers`/`providers`) would never instantiate a decorator-referenced
guard/interceptor, since no HTTP request pipeline runs in a delegation-style spec. In practice,
Nest's `DependenciesScanner` registers classes referenced by `@UseGuards`/`@UseInterceptors` as
injectables of the controller's host module at `compile()` time, unconditionally — three existing
specs (`chat.controller.spec.ts`, `rag.controller.spec.ts`,
`rag-controller-delete-cascade.integration.spec.ts`) failed to compile until each added
`.overrideGuard(ModerationGuard).useValue({ canActivate: () => true })` and
`.overrideInterceptor(OutputModerationInterceptor).useValue({ intercept: (_, next) =>
next.handle() })` to their `TestingModule` builders — no assertions changed, per this issue's own
documented fallback for exactly this scenario.

**Live-verified** (real Postgres, real OpenRouter-backed `OpenaiService`): clean messages/asks on
all four routes produce `moderation_logs` rows with the correct `source` (`chat` vs `rag`); the
streaming route runs the guard only (no interceptor, as designed); `MODERATION_ENABLED=false`
bypasses with zero log rows. **The flagged-422 path could not be demonstrated live** — a clearly
violent-threat message returned 201, and its `moderation_logs` row had `categoryScores: {}`, the
exact shape `ModerationService`'s fail-open path produces (AI-060), meaning the underlying
`OpenaiService.moderateText()` call is failing silently through this project's
`OPENAI_BASE_URL=https://openrouter.ai/api/v1` proxy. This is precisely the open question AI-059
("Live probe — does OpenRouter proxy /moderations?") already exists to resolve — not a defect in
this issue's route wiring, which is independently proven correct by AI-061/AI-062's unit tests.
AI-059 remains `ready-for-agent`.

### CostBudgetService — budget CRUD (AI-064)

`CostBudgetService` (`src/modules/cost-management/services/cost-budget.service.ts`) replaces the
AI-057 constructor-only shell with the budget-row lifecycle per spec §5.2: `createBudget`/
`findAllBudgets`/`findBudgetByUserId`/`updateBudget`/`deleteBudget` — the CRUD subset only; spend
aggregation and `checkBudget()` land in AI-065. Follows `PromptTemplateService`/
`ModelRegistryService`'s established shapes exactly: P2002 on duplicate `userId` →
`ConflictException` via the same `isP2002()` helper pattern; `updateBudget`/`deleteBudget` share a
private `findBudgetOrThrow()` guard; `findAllBudgets` uses `Math.min(limit, 100)` + parallel
`findMany`/`count`.

`findAllBudgets()`'s `isActive` filter follows `ModelRegistryService.findAllModels()`'s
filter-only-when-provided convention (`isActive !== undefined`), not `PromptTemplateService`'s
default-active-only one — an admin listing budgets should see both active and inactive rows unless
it explicitly asks to narrow. `findBudgetByUserId()` returns `null` for a missing budget (never
throws) — per spec, "no budget row" means unlimited spend, which the future `CostBudgetGuard`
(AI-066) needs to distinguish from an actual error. `deleteBudget()` is a genuine hard delete
(`db.userCostBudget.delete()`), deliberately **not** `ModelRegistryService`'s soft-delete
(`isActive: false`) convention — an inactive-but-present budget already has a first-class
representation via `isActive: false`, so removing the row entirely is the only way to fully drop
enforcement (spec §6.2).

Five DTOs under `src/modules/cost-management/dto/` (`CreateBudgetDto`, `UpdateBudgetDto`,
`QueryBudgetsDto`, `BudgetResDto`, `PaginatedBudgetsResDto`) plus a barrel `index.ts`, mirroring
`openai/dto`'s conventions. `UpdateBudgetDto = PartialType(OmitType(CreateBudgetDto, ['userId']))`
— a budget never moves between users, the same immutable-identity-field pattern as
`UpdateConversationDto`'s `toolsEnabled` omission. `src/modules/cost-management/types/
cost-management.types.ts` (this module's first `types/` file) holds `BudgetEntity`,
`PaginatedBudgetsResult`, and `QueryBudgetsParams` — the service-facing param shape, kept separate
from the DTO since the DTO carries `class-validator` decorators the service layer doesn't need.

No `CostManagementController` routes consume this service yet — that's AI-072.

### CostBudgetService — spend aggregation + cached checkBudget() + alerts (AI-065)

`CostBudgetService` gains the enforcement math per spec §5.2/§8: `getUserSpend(userId, period)`,
`checkBudget(userId)`, and `getUsersApproachingLimit(threshold?)`.

`getUserSpend()` is one `aiAuditLog.aggregate({ where: { userId, status: 'SUCCESS', createdAt: {
gte: periodStart } }, _sum: { estimatedCost: true } })` call — `periodStart` comes from a private
`getPeriodStart()` built entirely from `Date.UTC()` + `getUTCFullYear()/getUTCMonth()/
getUTCDate()`, never a local-time method, so the daily-midnight/first-of-month boundary is correct
regardless of server timezone. `AiAuditStatus` is imported directly from `openai/constants/
ai-audit-status.enum` as a plain value import — no NestJS DI coupling, the same cross-module
enum-import convention `ChatService` already uses; `CostManagementModule` still imports nothing
from `OpenaiModule`, per its own AI-057 scaffold design.

`checkBudget()` checks `costBudget.enabled` first (zero DB calls at all when disabled), then reads
the budget row directly via `findUnique` (not through `findBudgetByUserId()`'s entity mapper, since
the raw `alertThreshold`/limit fields are needed as-is). No row or `isActive: false` → the same
`unrestrictedResult()` (`allowed: true`, both limits `null`, both percentages `0`, no `warning`
key) with zero `ai_audit_logs` aggregate queries — only the expensive aggregate is what "zero
aggregate queries" refers to, not the cheap budget lookup. Otherwise pulls both spend figures from
the cache, computes `allowed`/percentages, and — **only on the still-allowed path** — sets
`warning` when either dimension crosses `alertThreshold × limit`; a blocked result never also
carries a warning.

**Spend cache** (NFR-COST-001): a single `Map<string, { entry: { dailySpend, monthlySpend };
expiresAt }>` keyed by `userId`, TTL from `costBudget.cacheTtlMs` (default `60000`) — deliberately
a per-key-TTL map, not `TokenService`'s single-shared-expiry pricing-cache pattern (that pattern
refreshes the _whole_ cache on one timer; here each user's entry must expire independently based
on when _that user_ was last checked). A miss fetches both periods via one `Promise.all()`.
`createBudget()`/`updateBudget()`/`deleteBudget()` (AI-064) each now call a private
`invalidateSpendCache(userId)` right after their write — `updateBudget()`/`deleteBudget()` get the
`userId` for free from the row `findBudgetOrThrow()` already fetched, no extra query needed — so a
limit change or budget removal takes effect on the very next `checkBudget()` call, not after the
TTL expires.

`getUsersApproachingLimit(threshold?)` reads active budgets with at least one non-null limit
(`findMany({ where: { isActive: true, OR: [{ dailyLimitUsd: { not: null } }, { monthlyLimitUsd: {
not: null } }] } })`), then computes each budget's alert via a private `buildAlertIfApproaching()`
in parallel (`Promise.all(budgets.map(...))`, filtering out `null`s) — deliberately **bypasses**
the spend cache (calls `getUserSpend()` directly), per this issue's own "uncached is acceptable —
admin query, not a hot path" framing. `triggeredBy: 'daily' | 'monthly' | 'both'` records which
dimension(s) actually crossed `threshold ?? budget.alertThreshold`.

Two new plain interfaces landed in `types/cost-management.types.ts` — `BudgetCheckResult` and
`BudgetAlertDto` — not Swagger-decorated classes, since no controller exists yet to document
against (same convention RAG's `RagOptions`/`RagResult` established ahead of `AskResDto`). No
controller consumes either type yet — `CostBudgetGuard` (AI-066) and `CostManagementController`'s
analytics/alerts routes (AI-073) are the expected first callers.

### CostBudgetGuard — 429 enforcement + application to AI routes (AI-066)

`CostBudgetGuard` (`src/modules/cost-management/guards/cost-budget.guard.ts`) replaces AI-057's
always-`true` stub, mirroring `ModerationGuard`'s structure: `costBudget.enabled` checked first
(zero calls of any kind when disabled) → resolve `userId` → `CostBudgetService.checkBudget(userId)`
→ not-allowed throws `HttpException(message, HttpStatus.TOO_MANY_REQUESTS)` — **429, never 403**
— → allowed-with-`warning` sets an `X-Budget-Warning` response header via
`switchToHttp().getResponse()` and returns `true`.

**Shared identity-resolution util** — the `x-user-id`-header-then-`body.userId` convention,
previously duplicated as `ModerationGuard`'s private `resolveUserId()` method, was extracted to
`src/common/utils/resolve-user-id.util.ts` (a plain function) per this issue's own instruction.
`ModerationGuard` was refactored to call it too (behavior unchanged, its own tests still pass
unmodified) — `CostBudgetGuard` is the second consumer.

`buildExceededMessage()` checks the daily dimension first (`` `Daily budget exceeded ($${spend} of

$$
{limit})` ``, `.toFixed(2)`), falling back to monthly — safe because `checkBudget()`'s own
`allowed = !dailyExceeded && !monthlyExceeded` guarantees at least one is true whenever this is
reached. The thrown plain-string `HttpException` flows through the existing global
`HttpExceptionFilter` unmodified (already handles a string exception body).

**Same production DI fix as AI-063, applied proactively**: `CostManagementModule` now exports
`CostBudgetService` alongside `CostBudgetGuard` — a class referenced via `@UseGuards()` is
constructed within the _host_ module's own injector scope (`AiChatModule`/`RagModule`), so its own
first dependency must be visible there too, or the real app throws `UnknownDependenciesException`
on boot. Applying this fix before the first live boot attempt meant the app booted clean on the
very first try, unlike AI-063 which needed a failed boot to discover the gap.

**Application**: both `ChatController` message routes and both `RagController` ask routes changed
`@UseGuards(ModerationGuard)` → `@UseGuards(ModerationGuard, CostBudgetGuard)` — a single decorator
call listing both guards in order (moderation first, so a request the moderation guard rejects is
never charged against the budget), avoiding any ambiguity about how Nest merges metadata across
multiple `@UseGuards()` calls on the same handler. `AiChatModule`/`RagModule` both added
`CostManagementModule` to their `imports` (no cycle — it imports nothing itself). A `guard order
(AI-066)` test in both `chat.controller.spec.ts` and `rag.controller.spec.ts` asserts
`Reflect.getMetadata('__guards__', Controller.prototype.method)` equals
`[ModerationGuard, CostBudgetGuard]` on all four routes — a structural regression test against
accidental reordering.

**The AI-063 regression-posture lesson recurred exactly as expected**: the same three specs that
construct `RagController`/`ChatController` through a bare `TestingModule`
(`chat.controller.spec.ts`, `rag.controller.spec.ts`,
`rag-controller-delete-cascade.integration.spec.ts`) needed an added
`.overrideGuard(CostBudgetGuard).useValue({ canActivate: () => true })` alongside their existing
overrides — no assertions changed.

**Live-verified** (real Postgres, real OpenRouter-backed `OpenaiService`): since the configured
OpenRouter free model reports `estimatedCost: 0` on every real call, real spend can never exceed a
budget on its own — a synthetic `ai_audit_logs` row (`estimatedCost: 0.01`) was inserted directly
via `psql` to exercise the over-limit path. A chat message with `x-user-id` set then returned
**429** (`"Daily budget exceeded ($0.01 of $0.00)"` — the `$0.00` is a `$0.001` test limit rounded
by `.toFixed(2)`, a cosmetic quirk for sub-cent limits only) with **no `chat_messages` row created**
for the blocked request (guard runs before the handler). Raising the limit so spend sat at 83% of
it produced a 201 with `X-Budget-Warning: Approaching daily limit (83%)`. Booting with
`COST_BUDGET_ENABLED=false` bypassed a still-exceeded budget entirely. `POST /rag/ask` with no
`x-user-id` header passed (the guard's "no resolvable userId → pass" boundary). All test rows and
the test conversation were cleaned up afterward.

### CostAnalyticsService — spend by user, model & feature (AI-067)

`CostAnalyticsService` (`src/modules/cost-management/services/cost-analytics.service.ts`) replaces
AI-057's constructor-only shell with three read-only dimension-grouped aggregates over
`ai_audit_logs` (spec §5.3), all via Prisma `groupBy`. No new table — this reads Phase 1's audit
table, the same source `CostBudgetService` aggregates for budget spend. A private
`buildWhere(query)` unconditionally sets `status: AiAuditStatus.SUCCESS` (the exact spend
definition `CostBudgetService.getUserSpend()` uses — same cross-module plain-value enum import from
`../../openai/constants/ai-audit-status.enum`, no `OpenaiModule` DI coupling) plus the optional
`startDate`/`endDate` range (`createdAt: { gte, lte }`), mirroring
`AiAuditService.getCostSummary()`'s `buildWhereClause()` verbatim.

- **`getSpendByUser(query)`** — `groupBy: ['userId']`, `_sum: { estimatedCost, totalTokens }`,
  `_count: { _all: true }`, `orderBy: { _sum: { estimatedCost: sortOrder } }` (default `'desc'`),
  `skip`/`take` paginated. A null `userId` maps to a literal `'anonymous'` bucket
  (`?? ANONYMOUS_BUCKET`) rather than being dropped — unattributed spend is still spend. Pagination
  `total` (distinct-user count) comes from a **second** unpaginated `groupBy(['userId'])` run in the
  same `Promise.all()`, since Prisma `groupBy` has no built-in total-groups count and a raw
  `count()` would count rows, not groups.
- **`getSpendByModel(query)`** — `groupBy: ['model']`, same aggregates, spend-descending, no
  pagination.
- **`getSpendByFeature(query)`** — `groupBy: ['endpoint']`, mapped through a `FEATURE_LABELS`
  `Record<string, string>` (`chat.completions` → `'chat'`, `embeddings` → `'embeddings'`,
  `moderations` → `'moderations'`; unknown endpoint → passthrough). **Chat-vs-RAG spend is not
  distinguishable** from `ai_audit_logs` columns (no feature/source column — the PRD's deliberate
  no-new-audit-column decision), so RAG-driven completions fold into the `'chat'` bucket; this is
  documented in an inline comment on `FEATURE_LABELS`, and each row carries both the mapped
  `feature` and the raw `endpoint`.

Every mapped numeric field uses `?? 0`, so an empty table / all-null aggregate yields zeroed
numbers and empty arrays, never `NaN`. Result interfaces
(`SpendByUserResult`/`SpendByModelResult`/`SpendByFeatureResult` + their `*Row` shapes) live in
`types/cost-management.types.ts`; **response DTOs are deferred to AI-073**, per the issue's scope.

**Query DTOs** (`dto/`, barrel-exported): a shared `SpendAnalyticsQueryDto` base
(`startDate`/`endDate`, `@IsDateString()`) with `SpendByUserQueryDto extends` it adding
`page`/`limit` (`@Type(() => Number)` + `@Min`/`@Max(100)`, matching `QueryBudgetsDto`) and
`sortOrder` (`@IsIn(['asc', 'desc'])`); `SpendByModelQueryDto`/`SpendByFeatureQueryDto` are empty
subclasses of the base (date-range only), kept as named classes so AI-073's controller/Swagger get
correct type names. No module wiring change — `CostManagementModule` already provides
`CostAnalyticsService` from AI-057. Tests (`cost-analytics.service.spec.ts`, 11) follow
`cost-budget.service.spec.ts`'s `jest.mock('.../database.service', ...)` ESM guard +
`mockDeep<DatabaseService>()`, scripting `groupBy` returns and asserting the exact Prisma call args
(where/by/`_sum`/orderBy/skip/take) plus the post-processing (anonymous bucket, feature-label
mapping, sort direction, null→0 coercion, empty-table shape).

### RetentionService — batched cleanup methods + RetentionReport (AI-069)

`RetentionService` (`src/modules/cost-management/services/retention.service.ts`) replaces AI-057's
constructor-only shell with the four time-based cleanups + `runFullCleanup()` (spec §5.4/§9). **No
cron yet** and no `getRetentionConfig()`/`updateRetentionConfig()` — those are AI-070's
runtime-config/`@Cron` concern. No module wiring change (`CostManagementModule` already provides it
from AI-057).

**Batched deletes (NFR-RET-001)** — one private `runBatchedDelete(fetchIds, deleteByIds)` helper
drives all four cleanups via closures; each cleanup differs only by its Prisma delegate and
where-clause. It pages ids ascending (`findMany({ where, select: { id: true }, orderBy: { id:
'asc' }, take: RETENTION_BATCH_SIZE })`), deletes each page by `deleteMany({ where: { id: { in } } })`,
sums `count`, and stops when a page is empty **or** shorter than the batch
(`hasMore = rows.length === RETENTION_BATCH_SIZE`). `RETENTION_BATCH_SIZE = 1000` (module const,
implementation detail — not in `retention-config.constant.ts`, since it isn't an operator-tunable
period) — never an unbounded `deleteMany` over a 100K-row backlog. A 2.5-batch backlog issues
exactly 3 `findMany` + 3 `deleteMany` (short-page early-break avoids a wasted 4th probe query).

**Cutoffs** — private `computeCutoff(retentionDays)` = `new Date(Date.now() - retentionDays *
MS_PER_DAY)`; ms arithmetic is timezone-agnostic (UTC-correct), and every where-clause uses a
strict `lt`, so a row aged _exactly_ `retentionDays` is kept.

- `cleanupAuditLogs`/`cleanupModerationLogs` — `createdAt < cutoff` on `aiAuditLog`/`moderationLog`.
- `cleanupArchivedConversations` — `{ isArchived: true, updatedAt: { lt: cutoff } }` on
  `chatConversation`; messages removed via the schema's `onDelete: Cascade`, never manually. Active
  conversations are excluded by the filter and, more fundamentally, by **safety-by-omission**
  (FR-RET-002): there is no method that deletes active conversations at all.
- `cleanupStaleEmbeddingCache` — `createdAt < cutoff` on `embeddingCache`, intentionally pure
  time-based (cache rows carry no chunk reference, so the spec's "not referenced by an active
  chunk" condition is unenforceable; over-deletion costs one re-embedding — PRD decision, noted in
  a code comment).

**`runFullCleanup()`** runs the four sequentially against `getEffectiveConfig()` (reads the
`retention` config namespace via `ConfigService`, field-by-field fallback to `RETENTION_CONFIG`),
returning a `RetentionReport` (per-category `{ deleted, failed, error? }` + `totalDeleted` + `ranAt`
+ `durationMs`). Each category runs inside a private `runCategory()` try/catch: a failure is logged
via `AppLoggerService.error()`, marked `failed: true` (deleted 0), and the run **continues** to the
next — a partial cleanup beats an aborted one. The spec §9.2 one-line summary is always logged via
`AppLoggerService.log()`. New types `RetentionCategoryResult`/`RetentionReport` in
`types/cost-management.types.ts`.

Tests (`retention.service.spec.ts`, 11) use the module's standard ESM-guard + `mockDeep` setup with
a frozen clock (`jest.useFakeTimers()` + `setSystemTime`, real timers restored in `afterEach`) to
assert exact `lt` cutoffs; they cover the batch summation ([1000, 1000, 500] → 3 deletes),
partial-failure continuation, config fallback, and a runtime FR-RET-002 guard that
`document`/`documentChunk`/`chatMessage` `deleteMany` are never invoked during a full run.

### CostAnalyticsService — timeline, daily trend & projected monthly spend (AI-068)

Extends `CostAnalyticsService` (AI-067) with the three time-bucketed analytics (spec §5.4),
completing Epic 5. No module change.

- **`getSpendTimeline(query)`** — daily buckets via `$queryRaw` +
  `date_trunc('day', "createdAt")` (Prisma `groupBy` can't group by a date truncation). Columns are
  camelCase-quoted (no per-field `@map` on `ai_audit_logs`). `status = 'SUCCESS'` filtered, ordered
  ascending; range defaults to the trailing 30 days. Days with no spend are back-filled as zero
  buckets (`fillGapDays()` walks every UTC day in `[start, end]` via a `YYYY-MM-DD` `Map`) so charts
  get a contiguous axis.
- **`getDailySpendTrend(days = 30)`** — clamps `days` to `[1, 365]` (`0`/`NaN` → 30) and delegates
  to the timeline path over a trailing range.
- **`getProjectedMonthlySpend()`** — FR-COST-004: `aggregate(_sum estimatedCost)` since the UTC
  first-of-month, then `monthToDate ÷ daysElapsed × daysInMonth` (`daysElapsed = getUTCDate()`,
  today counted as elapsed; `daysInMonth` = UTC day-0 of next month). Returns all five inputs so the
  arithmetic is auditable; `0` (never `NaN`) on empty data.

**`$queryRaw` is used for the timeline (the codebase's first raw SQL beyond the health check).**
Parameterization uses `$queryRaw`'s own tagged-template form (every interpolation is a bound
parameter — identical to `Prisma.sql`, never string concatenation). The optional `userId` filter is
handled by **branching into two full tagged-template queries** rather than composing a `Prisma.sql`
fragment — composing one needs a `Prisma` **value** import from the generated client, which breaks
Jest (the documented generated-client `.js`-extension load failure, since the spec loads the real
service). Raw aggregates (`Decimal`/`bigint`/`number`/`string`) are normalized to `number` by a
private `toNumber()` that narrows each case explicitly (avoids `no-base-to-string` on `unknown`).

New types `SpendTimelinePoint`/`SpendTimelineResult`/`ProjectedSpendResult`; new
`SpendTimelineQueryDto` (extends `SpendAnalyticsQueryDto` + `userId`). Tests (9 new, 20 total) mock
`$queryRaw` fixtures (gap-fill + Decimal/bigint normalization + bound-param assertions) and use a
frozen clock for trend windows and projection arithmetic (31-day, first-of-month, 28-day February,
empty-data). The raw SQL's first live execution is deferred to AI-075.

### RetentionService — dynamic cron registration + runtime config (AI-070)

Completes Epic 6 (Data Retention: AI-069 + AI-070). `RetentionService` now `implements
OnModuleInit` and gains a fourth constructor dependency, `SchedulerRegistry` (`@nestjs/schedule`) —
already globally provided by `ScheduleModule.forRoot()` in `AppModule`, no module wiring change
needed.

**Cron registration** (`onModuleInit()`): a static `@Cron()` can't read `retention.cron` from
config, so it's registered dynamically. Checks `schedulerRegistry.doesExist('cron',
'retention-cleanup')` first and returns (logged) if already registered — guards `npm run dev`'s
file-watch re-init from throwing on `addCronJob()`'s duplicate-name check. Otherwise constructs
`new CronJob(cronExpression, onTick)` inside a try/catch (the `cron` package's `CronTime` parser
throws synchronously on an invalid expression — caught, logged, registration skipped, no boot
crash), then `addCronJob()` + `job.start()` (a constructed-but-unstarted `CronJob` never ticks).
`onTick` calls `this.runFullCleanup().catch(...)` — a defensive backstop, since AI-069's
`runFullCleanup()` already resolves cleanly per-category and never rejects in practice.

**`cron` added as an explicit direct dependency** (exact-pinned `4.4.0` matching the version
already resolved transitively via `@nestjs/schedule`) — the same footgun class this codebase has
hit three times before (`axios`/`@langchain/core`/`@types/multer`, AI-037/042/044): importing
`CronJob` directly from a transitive-only package risks it silently disappearing under a future
`--legacy-peer-deps` install. Installed with `--legacy-peer-deps` per the pre-existing `dotenv`
peer conflict (AI-037); `npm ls cron` confirms one deduped resolution.

**Runtime config**: `getRetentionConfig(): RetentionRuntimeConfig` returns the four day fields via
a now three-tier `getEffectiveConfig()` (runtime override → env-namespaced config →
`RETENTION_CONFIG` fallback) plus `cron` (config → fallback only, never overridable).
`updateRetentionConfig(partial)` throws `BadRequestException` if `'cron' in partial` — an explicit
rejection over silently ignoring it, so the unsupported operation surfaces to the caller. Each
present day field is validated (`Number.isInteger(value) && value > 0`, else `BadRequestException`)
and merged into a private in-memory `configOverrides` object — reset on restart, no persistence
(PRD decision). Since `getEffectiveConfig()` re-reads `configOverrides` every call, an override
takes effect starting with the very next `runFullCleanup()`/`getRetentionStats()` call.

**`getRetentionStats()`** (AI-073's future `GET /retention/stats` seam) returns `{ lastReport,
rowsDue }` — `lastReport` is a new private field set at the end of `runFullCleanup()` (the one
addition to AI-069's method), `null` until the first run; `rowsDue` runs four cheap parallel
`count()` queries against the current effective cutoffs, reusing the existing `computeCutoff()`
helper.

New types: `RetentionRuntimeConfig`, `RetentionConfigOverrides`, `RetentionRowsDue`,
`RetentionStatsResult`. Tests (16 new, 27 total) add a real `SchedulerRegistry` instance (no mock —
plain in-memory, no constructor deps) to the `TestingModule`: registration + `cronTime.source`/
`isActive` assertions, a second `onModuleInit()` call proving the double-registration guard, an
invalid-expression no-throw/no-registration/logged-error case, and a tick test that spies
`runFullCleanup` (rejected), calls `job.fireOnTick()`, then flushes microtasks to observe the
internal `.catch()` — never real/advanced timers. Plus config merge/validation/cron-rejection and
stats-shape coverage.

### CostManagementController — analytics + retention endpoints (AI-073)

The remaining ten Phase 4 cost-management routes (spec §6.3/§6.4), all thin delegates, all
`isPublic: true`. **Retention lives on its own `RetentionController`** (`retention.controller.ts`,
`@Controller('retention')`), not on `CostManagementController` — both carry `@ApiTags
('cost-management')` so they group together in Swagger despite separate path prefixes, per this
issue's own preferred split (cleaner Swagger grouping than a route-prefix override on one shared
class). `CostManagementController` gained `@Controller('cost')` (previously a bare `@Controller()`
AI-057 stub) plus six analytics routes; its unused `retentionService` param was removed since
retention moved out — `costBudgetService` stays injected-but-unused, still AI-072's job.

**Analytics** (→ `CostAnalyticsService`, AI-067/AI-068): `by-user`/`by-model`/`by-feature`/
`timeline` pass their query DTO straight through. `daily-trend` unpacks `query.days` and passes it
**positionally** (`getDailySpendTrend(query.days)`) — an omitted `days` resolves to `undefined` at
the controller, and the service's own default parameter supplies `30`. A new `DailyTrendQueryDto`
validates only the lower bound (`@IsInt() @Min(1)`) — the upper 365 clamp already lives in the
service (AI-068), not duplicated here. `projected` takes no arguments.

**Retention** (→ `RetentionService`, AI-069/AI-070): `GET /config` returns `getRetentionConfig()`
directly (synchronous). `PATCH /config` calls `updateRetentionConfig(dto)` then **re-reads and
returns** `getRetentionConfig()` — a read-back rather than assuming the write succeeded silently.
`POST /cleanup` returns `runFullCleanup()`'s `RetentionReport` verbatim (`successStatus: 201` in
Swagger only — NestJS's `@Post()` already defaults to 201, no `@HttpCode()` needed). `GET /stats`
returns `getRetentionStats()` verbatim.

**`UpdateRetentionConfigDto` declares only the four day fields — no `cron` property at all**, so a
client-supplied `cron` key is rejected by `main.ts`'s global `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true })` with a 400 ("property cron should not exist") before the controller
or `RetentionService.updateRetentionConfig()`'s own rejection is ever reached — the same
"omit-to-reject" pattern `AI-051`'s `UploadDocumentDto` fix documented, applied deliberately here
rather than discovered as a bug.

Nine new response DTOs (barrel-exported): row+wrapper pairs for by-user/by-model/by-feature
(mirroring `PaginatedBudgetsResDto`'s nested-array pattern); a single `SpendTimelineResDto`
**shared** by both `timeline` and `daily-trend` (both service methods return the identical
`{ data: SpendTimelinePoint[] }` shape — a second near-duplicate class would be pure boilerplate);
`ProjectedSpendResDto`; `RetentionConfigResDto`/`RetentionReportResDto` (+ nested category
DTO)/`RetentionStatsResDto` (+ nested rows-due DTO, `lastReport` nullable).

**Live-verified** (real Postgres, real accumulated `ai_audit_logs` from prior phases' sessions —
not fixtures): all 10 routes in the boot log with zero DI errors; `GET /cost/analytics/by-user`
and `/projected` returned genuine non-trivial aggregates; `daily-trend?days=0` → 400; `PATCH
/retention/config` with a `cron` key → 400 (`forbidNonWhitelisted`, verified against the real
global pipe); a valid `{"auditDays":7}` override → 200, reflected immediately on read-back;
`POST /retention/cleanup` under that override → **201** with real per-category deleted counts
(`totalDeleted: 4`, real stale audit-log rows), and a follow-up `GET /retention/stats` showed
`lastReport` populated and `rowsDue` zeroed. `/api/docs-json` confirmed all 10 routes tagged
`cost-management`. The temporary `auditDays: 7` override was discarded by stopping the dev server
(AI-070's designed reset-on-restart semantics) — no manual config cleanup needed.

### ModerationController — check, check-batch, logs & stats endpoints (AI-071)

The standalone moderation API surface (spec §6.1) on `ModerationController` (replacing the AI-057
stub) plus two new `ModerationService` query methods:

- **`getModerationLogs(query)`** — paginated read over `moderation_logs`, mirroring
  `AiAuditService.findAll()`'s shape exactly. A private `buildLogsWhere()` layers
  `userId`/`isFlagged`/`direction`/`source` equality filters on a shared `buildDateRangeWhere()`
  helper (same `createdAt: { gte, lte }` pattern `AiAuditService`/`CostAnalyticsService` use). Rows
  map to a `ModerationLogEntity` — `publicId`, never internal `id`; JSONB `categories`/
  `categoryScores` cast to `Record<string, boolean>`/`Record<string, number>` at the read boundary.
- **`getModerationStats(query)`** — totals/flagged-count/per-direction counts + a bounded
  in-application tally over just the flagged rows' JSONB `categories` (top 5 by count) within the
  same date range — never a full-table scan. `violationRate` guarded by a `totalChecks > 0`
  ternary, so an empty table returns `0`, never `NaN`.

**Controller**: `POST /check` resolves `userId` via the shared `resolveUserId()` util (same
`x-user-id`-header-then-`body.userId` convention `ModerationGuard`/`CostBudgetGuard` use) and calls
`moderateText(dto.text, { source: dto.source ?? 'standalone', direction: 'input', userId })` —
`direction: 'input'` passed explicitly even though it's the service's own default, self-documenting
intent. `POST /check-batch` is a pure delegate (`moderateBatch()` takes no options). `GET /logs`
maps nullable `requestId`/`userId` to `undefined` via a private `toLogRes()` mapper (this
codebase's standard paginated-list convention). `GET /stats` is a pure delegate. All four routes
`isPublic: true`; none of them are guarded by `ModerationGuard`/`OutputModerationInterceptor` —
those apply to chat/RAG routes (AI-063), not to this module's own standalone API.

Ten new DTOs (barrel-exported): `CheckModerationDto`/`CheckBatchModerationDto` (50-item cap,
`@ArrayNotEmpty`)/`QueryModerationLogsDto` (`direction?` via `@IsIn(Object.values(...))`, since
`ModerationDirection` is an `as const` object, not a native `enum`)/`ModerationStatsQueryDto`, plus
matching response DTOs (`ModerationResultResDto`, `ModerationLogResDto`,
`PaginatedModerationLogsResDto`, `ModerationStatsResDto` with nested direction-split/top-category
DTOs).

**Real bug found and fixed during live verification**: `GET /moderation/logs?isFlagged=false`
returned zero rows against a table where all 14 existing rows had `isFlagged: false` (confirmed via
`GET /stats`'s `flaggedCount: 0`/`totalChecks: 14`) — the filter was silently inverted. Root cause:
`main.ts`'s global `ValidationPipe` sets `transformOptions: { enableImplicitConversion: true }`,
and class-transformer's `PLAIN_TO_CLASS` order runs its own naive `Boolean(value)` coercion
**before** any `@Transform` decorator runs — `Boolean('false')` is `true` in JavaScript (any
non-empty string is truthy), so `'false'` becomes `true` before a first-draft
`@Transform(({ value }) => ...)` fix ever saw the raw string (verified via a standalone repro
script that this first draft still failed). The fix reads the **original, untransformed** value via
the `@Transform` callback's `obj`/`key` parameters (`obj[key]`) instead of its already-coerced
`value` — bypassing the pre-coercion entirely (verified both via the repro script and live:
`?isFlagged=false` → 14/14 matched, `?isFlagged=true` → 0). **`QueryBudgetsDto.isActive` (AI-064,
already shipped) has the identical latent bug** — not fixed here (different, already-completed
module's DTO, outside this issue's file scope) but flagged as a Follow Up using the same
`obj[key]`-based pattern.

**Live-verified** (real Postgres): all 4 routes in the boot log, zero DI errors; `check`/
`check-batch` returned 200/201 (the underlying moderation call itself fails open — the already-
tracked AI-059 finding that OpenRouter doesn't proxy `/moderations`; confirmed via `psql` each check
still wrote a `moderation_logs` row with `metadata: {"failedOpen": true}`, proving this route's own
pipeline works correctly regardless of that separate upstream issue); missing/empty `text`/`texts`
→ 400; `direction=sideways` → 400; `/logs` paginated and filtered correctly post-fix; `/stats`
matched the real row count; `/api/docs-json` confirmed all 4 routes tagged `moderation`.

### CostManagementController — budget endpoints (AI-072)

The six budget routes (spec §6.2) on `CostManagementController` (same class as AI-073's analytics
routes, declared as a "Budgets" block above them), all thin delegates to `CostBudgetService`
(AI-064/AI-065), all `isPublic: true`:

- `POST /cost/budgets` → `createBudget()` (201; the service's P2002→`ConflictException` propagates
  a 409 for a duplicate `userId` with no controller-side handling)
- `GET /cost/budgets` → `findAllBudgets()`, rows mapped via a private `toBudgetRes()`
  (`?? undefined` on nullable limits)
- `GET /cost/budgets/alerts` → `getUsersApproachingLimit()` — **must stay declared before the
  `:userId` route**: NestJS matches routes in declaration order, so a later position would match
  the literal segment `alerts` as a userId. Pinned by a structural test in
  `cost-management.controller.spec.ts` that asserts both prototype-method declaration order
  (`Object.getOwnPropertyNames()` preserves it) **and** each method's `Reflect.getMetadata('path')`
  value, so neither a reorder nor a rename can silently break it.
- `GET /cost/budgets/:userId` — the one composed route: `findBudgetByUserId()` (null → 404, thrown
  before `checkBudget()` is ever called — a direct lookup of a nonexistent resource is a NotFound,
  unlike `CostBudgetGuard`'s no-budget-means-unlimited pass-through semantics) + `checkBudget()`
  merged into `BudgetStatusResDto` with a derived `status` string via the new `BudgetStatus`
  constant (`constants/budget-status.constant.ts`): `!allowed` → `'exceeded'`, `warning` present →
  `'approaching_limit'`, else `'within_budget'`. `dailyLimit`/`monthlyLimit` come from the budget
  **row**, not the check — `checkBudget()` reports null limits when enforcement is disabled or the
  budget is inactive, but a status lookup should still show what's configured.
- `PATCH /cost/budgets/:publicId` → `updateBudget()`; `DELETE /cost/budgets/:publicId` →
  `deleteBudget()` (204, `@HttpCode` + `@ApiNoContentResponse`, the standard delete stack)

Two new response DTOs (`BudgetStatusResDto`, `BudgetAlertResDto`) join AI-064's
`BudgetResDto`/`PaginatedBudgetsResDto`.

**`QueryBudgetsDto.isActive`'s boolean-coercion bug (AI-071's flagged Follow Up) is fixed here** —
its consuming route ships in this issue. AI-071's inline `toBoolean` `@Transform` helper was
extracted to a shared **`src/common/utils/transform-query-boolean.util.ts`**
(`transformQueryBoolean`) at its second consumer (the same extract-at-second-consumer precedent as
AI-066's `resolveUserId()`), and both `QueryModerationLogsDto.isFlagged` and
`QueryBudgetsDto.isActive` now use it. Any future query-string boolean DTO field must use
`@Transform(transformQueryBoolean)` — never `@Type(() => Boolean)`, which silently coerces the
string `'false'` to `true` under `main.ts`'s `enableImplicitConversion` (see the util's comment and
AI-071's section above for the full mechanism).

**Live-verified** (real Postgres): all six routes in the boot log, `budgets/alerts` mapped before
`budgets/:userId`; 201/409/400/404/204 semantics all exercised via `curl`; `?isActive=false` → 0
rows against 1 active budget (the fix working live); all three derived statuses observed against a
synthetic `ai_audit_logs` spend row (0.45 spend vs 0.5/0.4 limits → `approaching_limit` with
`warning: "Approaching daily limit (90%)"` / `exceeded` at 112%), including AI-065's
PATCH-invalidates-spend-cache behavior observed directly (status served a cached 0-spend snapshot
until a PATCH invalidated it). Synthetic rows cleaned up afterward.

### Phase 4 controller tests audit + moderation integration + full regression (AI-074)

Verification-only close-out mirroring AI-034/AI-054 — no production code changes, test files only.
Closes out Epic 7's AFK work; only AI-059 and AI-075 (both HITL) remain in Phase 4.

**Coverage audit found one real gap**: every Phase 4 route (20 across `ModerationController`,
`RetentionController`, `CostManagementController`) already had a delegation test from its
originating issue, but **5 cost-analytics query DTOs shipped in AI-067/AI-068 had zero
`validate()` coverage** — `SpendAnalyticsQueryDto`, `SpendByUserQueryDto`, `SpendByModelQueryDto`,
`SpendByFeatureQueryDto`, `SpendTimelineQueryDto`. Closed with 10 new tests in
`cost-management-dtos.spec.ts` (one invalid + one valid payload per DTO), including proving the
two field-less subclasses (`SpendByModelQueryDto`/`SpendByFeatureQueryDto`) correctly inherit
`SpendAnalyticsQueryDto`'s date-range validation.

**Guard-ordering structural pin already existed** — added proactively in AI-066
(`chat.controller.spec.ts`/`rag.controller.spec.ts`'s `describe('guard order (AI-066)', ...)`
blocks, asserting `Reflect.getMetadata('__guards__', ...)` equals `[ModerationGuard,
CostBudgetGuard]` on all four AI routes). Re-ran to confirm it still passes rather than duplicating
it — this acceptance criterion was satisfied before this issue started.

**New moderation-blocks-before-handler integration test**
(`src/modules/ai-chat/__tests__/moderation-guard-integration.spec.ts`) goes one step further than
`chat-function-calling.integration.spec.ts`'s "mock only real external boundaries" convention: it
builds a real `INestApplication` (`Test.createTestingModule({ controllers: [ChatController], ... })`
→ `createNestApplication()` → `app.init()`) and drives `POST
/chat/conversations/:publicId/messages` via `supertest`, so `ModerationGuard`/`CostBudgetGuard` run
through the actual NestJS guard pipeline rather than a direct `canActivate()` call. Real providers:
`ChatService`, `OpenaiService`, `RetryService`, `TokenService`, `AiAuditService`, `ModerationGuard`,
`ModerationService`, `OutputModerationInterceptor`, `CostBudgetGuard`, `Reflector`. Mocked:
`DatabaseService`, `OPENAI_CLIENT` (both `moderations.create` and `chat.completions.create`
scripted per test), `ModelRegistryService`, and the tool/streaming/cost-budget services (unused —
`toolsEnabled: false` and `costBudget.enabled: false` keep the suite scoped to `ModerationGuard`
alone, since budget enforcement already has its own dedicated coverage from AI-066).

Two cases: a **flagged** moderation response asserts HTTP 422, `dbMock.chatMessage.create` never
called (proving `ChatService.sendMessage()` — whose first side effect is `addUserMessage()` — never
ran), `chat.completions.create` never called, and exactly one `moderationLog.create` with
`isFlagged: true`/`action: 'blocked'`/`source: 'chat'`. A **clean** response asserts HTTP 201 with
the real assistant content in the body, `chatMessage.create` called twice (user + assistant message
— proving the real handler executed), and one `moderationLog.create` with `isFlagged: false`/
`action: 'allowed'`. Only the non-streaming route was integration-tested — the streaming route
carries an identical guard stack with no route-specific branching, and its own SSE transport
behavior is already covered by `chat.controller.spec.ts`'s AI-033/034 tests.

**Full regression**: `npm run test` went from 682 to **694** passing tests (+12: 10 DTO tests + 2
integration tests), zero changes to any Phase 1–3 spec file's assertions. `npx tsc --noEmit
--project tsconfig.build.json`, `npm run lint:check` (0 errors, 68 warnings — identical baseline to
AI-072's), and `npm run build` all pass clean.

**Phase 4 PRD stays `ready-for-agent`** at this point in the timeline — AI-059 (OpenRouter
`/moderations` proxy probe, HITL) and AI-075 (live smoke test, HITL) remain open; AI-075 was
already blocked on this issue and AI-059, and is now blocked on AI-059 alone. (AI-059 is completed
in a later section below — see "Live probe — OpenRouter does not proxy /moderations".)

### Live probe — OpenRouter does not proxy /moderations + moderation-only fallback (AI-059)

**Decisive finding**: `curl -X POST "$OPENAI_BASE_URL/moderations"` (real key, real network)
returns **404 with `content-type: text/html`** — a Cloudflare-served Next.js website 404 page
(`server: cloudflare`, real DNS to OpenRouter's edge, CSP referencing `clerk.openrouter.ai`/Stripe —
genuinely their marketing site, not a network failure), while `GET /models` and `POST
/chat/completions` on the identical base URL both return 200. **OpenRouter does not expose a
`/moderations` route at all** — this closes the open question AI-063 flagged in its own
live-verification session.

**Fallback client, confined to `OpenaiModule`** (per the PRD's planned design): two new optional env
vars, `MODERATION_API_BASE_URL`/`MODERATION_API_KEY` (`@IsOptional()`, read into `openaiConfig`). A
new `MODERATION_CLIENT` injection token's factory (`openai.module.ts`) calls a new pure, directly
unit-tested function `resolveModerationClient()` (`utils/resolve-moderation-client.util.ts`):
returns the **exact same `OPENAI_CLIENT` instance** when `MODERATION_API_KEY` is unset (zero
behavior change for any deployment that never sets it — the default today), or constructs a
separate `OpenAI` client when it is. `OpenaiService` gained a second `@Inject(MODERATION_CLIENT)`
constructor dependency; `executeModeration()` (the sole call site shared by
`moderateText()`/`moderateBatch()`) now calls `this.moderationClient.moderations.create(...)`
instead of `this.openaiClient...`. `ModerationModule` is untouched and still has no idea which
upstream serves moderation.

**Static-fixture mode (`MODERATION_STATIC_MODE`)** — a narrow escape hatch added specifically
because the real direct-OpenAI key available for a true live proof authenticates correctly against
`https://api.openai.com/v1/moderations` (not a 401/403) but the account has **zero billing
credit** (reproducible `429 "Too Many Requests"`, OpenAI's generic quota-exceeded error) — strong
affirmative evidence the fallback wiring itself is correct, just blocked on a billing decision no
amount of engineering work can resolve. When `MODERATION_STATIC_MODE=true` (default `false`,
opt-in — same polarity as `moderationConfig.outputEnabled`), `executeModeration()` skips the
network entirely and calls a new pure function, `buildStaticModerationResponse()`
(`utils/static-moderation-fixture.util.ts`), which keyword-matches the input against a small JSON
fixture (`fixtures/static-moderation-responses.json` — one `flagged`/one `clean` canned
OpenAI-shaped response) so both branches of the real pipeline stay exercisable through the real
HTTP surface with no network call. This is a single `if` branch inside
`retryService.executeWithRetry()`'s callback — the surrounding try/catch/audit-logging tail is
unchanged, so a static-mode call still produces a real `ai_audit_logs` row (`model:
'static-fixture-moderation'`, clearly distinguishable from a genuine call) and a mandatory
`logger.warn()` fires on every use so it can never silently masquerade as live in application logs.
`ModerationService` and everything above it (guards, interceptors, `ModerationController`) are
untouched — the flag lives entirely inside this one seam. `nest-cli.json` gained an asset-copy
entry for `modules/openai/fixtures/**/*` (outDir `dist/src`, same gotcha/fix as AI-055's
`seed-data/`).

**Live-verified, three real-network probes**: (1) OpenRouter `/moderations` → 404 HTML (above);
(2) real OpenAI `/moderations` with the commented-out direct key → 429 zero-credit error,
reproduced twice; (3) booted `npm run dev` with `MODERATION_STATIC_MODE=true` and hit the real
`POST /moderation/check` route (no mocks) — a violence-keyword message → `isFlagged: true` with the
fixture's exact scores, a benign message → `isFlagged: false`, warning logged both times; re-booted
with the flag unset and confirmed the pre-existing OpenRouter-404 fail-open behavior is completely
unchanged. `.env` itself was left unchanged (all three new vars absent, matching this repo's
convention of only listing actively-overridden vars) — setting `MODERATION_API_KEY` to the
zero-credit key would only add retry latency for the same fail-open outcome.

**Full regression**: `npm run test` went from 697 to **704** (+7: 4 `resolveModerationClient()`/
`buildStaticModerationResponse()` util tests + 3 `OpenaiService` static-mode tests), zero
regressions. `tsc --noEmit`, `lint:check` (0 errors, 68 warnings — unchanged baseline), and `build`
all pass clean (confirmed the fixture JSON lands in `dist/src/modules/openai/fixtures/` post-build).

**Follow Up**: once the OpenAI account has real credit, re-run probe (2) above for a genuine 200,
then set `MODERATION_API_KEY`/`MODERATION_API_BASE_URL` in `.env` — moderation will transparently
start using real OpenAI instead of failing open via OpenRouter, no code changes needed.

### Live API smoke test — moderation, budget, analytics, retention (AI-075)

Phase 4's closing HITL issue, executed against real `npm run dev` + real Postgres + real HTTP,
verified via `curl`/`psql` rather than trusting logs. Ran with `MODERATION_STATIC_MODE=true`
(AI-059) since the real moderation upstream is still nonfunctional (OpenRouter doesn't proxy the
endpoint; the direct OpenAI key has zero billing credit) — static mode is the only way to exercise
genuine flagged/clean classification live rather than only the fail-open branch.

**Moderation**: clean/flagged checks both correctly classified with real per-category scores; a
flagged chat message → 422, zero `chat_messages` rows persisted, a `moderation_logs` row with
`action: 'blocked'`; a clean message → 201 with both messages persisted and an `allowed` log row;
`MODERATION_ENABLED=false` → zero new log rows across a bypass test.

**Real finding — output moderation doesn't redact persisted conversation history.** With
`MODERATION_OUTPUT_ENABLED=true`, a genuinely flaggable model answer was correctly replaced in the
client's response and correctly logged (original text preserved in `moderation_logs`,
`action: 'replaced'`) — but `GET /chat/conversations/:publicId` returns the **original, unredacted**
answer, since `ChatService` persists the assistant message inside the handler, before
`OutputModerationInterceptor` runs on the response. A client re-fetching history later sees the
real text even though the initial POST response was safely redacted. Left as a Follow Up — a
design decision (redact at read time, or persist redacted text and lose the audit-preserved
original), not a one-line fix, and never previously exercisable live (AI-062's unit tests mock the
DB write; no prior session enabled `MODERATION_OUTPUT_ENABLED`).

**Budget**: created a `dailyLimitUsd: 0.001` budget; free-tier `estimatedCost: 0` required
synthetic `ai_audit_logs` rows via `psql` (AI-066/AI-072's precedent). **Demonstrated the spend
cache's 60s staleness window in both directions**: back-to-back `GET /cost/budgets/:userId` calls
within the TTL served the same stale (pre-insert) value twice; the same call after the TTL genuinely
elapsed returned the fresh, correct `exceeded` state. A real chat message then got a real **429**
reproducing AI-066's documented `$0.00`-`.toFixed(2)` cosmetic quirk on a sub-cent limit; a second
test user in the 80–99% band got a 201 with a real **`X-Budget-Warning: Approaching daily limit
(85%)`** header. `GET /cost/budgets/alerts` correctly listed both test users.

**Analytics — real bug found and fixed.** `by-user`/`by-feature`/`projected` all matched known
rows exactly. `timeline` did not: `CostAnalyticsService.queryTimeline()`'s raw `$queryRaw` selected
a bare `date_trunc('day', "createdAt")` timestamp, and **node-postgres parses a `timestamp without
time zone` result assuming the Node process's own local timezone**, not UTC — verified directly
with a standalone `pg.Client` script (a value that should read `2026-07-11` came back as
`2026-07-10T18:30:00.000Z` in this IST-deployed sandbox). This silently shifted every day-bucket by
the deployment's local UTC offset, dependent entirely on where the app happens to run. **Fixed** by
having the SQL return pre-formatted `'YYYY-MM-DD'` text via `to_char(date_trunc('day',
"createdAt"), 'YYYY-MM-DD')` instead of a raw timestamp — a text column passes through `pg` with no
Date-parsing step at all, eliminating the bug class structurally. `RawTimelineRow.day` narrowed
`Date` → `string`; `dayKey()` simplified to a direct pass-through. A second, related anomaly (the
implicit "now" upper bound still excluding today's synthetic rows even after the fix) turned out to
be a **testing-methodology artifact, not an app bug**: this Postgres server's session `TimeZone`
GUC defaults to `Asia/Kolkata`, so every synthetic row inserted via bare `psql ... now()` was stored
with an IST-shifted wall-clock value, while the real app (via its own Prisma/Node connection)
always writes true UTC wall-clock — confirmed by directly comparing a real app-generated row's
`createdAt` against a synthetic one from the same few minutes. **Any future synthetic-row insertion
via `psql` in this sandbox must use `(now() AT TIME ZONE 'utc')`, not bare `now()`** — AI-066/AI-072
happened not to hit this because their checks never compared against an implicit "now" upper
bound.

**Retention**: back-dated one row per cutoff (audit log 100d, moderation log 100d, embedding-cache
200d, an archived conversation's `updatedAt` 40d) plus a same-age control set — including,
critically, an old-but-**active** (non-archived) conversation. `rowsDue` showed `{1,1,1,1}`
pre-cleanup; `POST /retention/cleanup` deleted exactly 4 rows, one per category, zero failures.
`psql` confirmed all four back-dated rows gone, all four fresh rows survived, and — the key safety
property (FR-RET-002) — **the old active conversation survived untouched** despite being older
than the archived-conversation cutoff, proving retention never touches active data regardless of
age. Cron registration (`'0 2 * * *'`) was already visible in the boot log.

**All test state removed** (conversations, budgets, synthetic audit/moderation/embedding-cache
rows) via the app's own DELETE routes plus targeted `psql` deletes; a final sweep confirmed zero
rows matching any test marker remain. `npm run test`: **705/705** (+1, the timezone-safety
regression test), zero regressions. `tsc --noEmit`, `lint:check` (0 errors, 68 warnings —
unchanged), and `build` all pass clean.

**All 20 Phase 4 issues are now `completed`. The Safety & Compliance PRD
(`docs/prd/2026-07-10-safety-compliance.md`) is marked `completed`.**

## Capstone — Cross-Phase Integration

Per `docs/specs/Capstone_Knowledge_Base_QA_Specification.md`: not a new spec-to-PRD-to-issues
pipeline, but a focused deliverable proving all 4 phases work together as one product — App 1 from
the goal doc, **Knowledge Base Q&A**. Everything it touches already existed; the capstone's own
code is a thin composition layer, plus a much larger realistic demo dataset and a cross-phase
integration test suite.

### Realistic seed dataset extended from 10 to 50 documents

`src/modules/rag/seed-data/` (Phase 3's original 10 hand-written CloudPulse documents, see AI-055's
sections above) gained **40 more documents**, bringing every `DocumentCategory` to exactly 10:
5 more `guide` (migration, performance tuning, backup/restore, SSO configuration, custom fields),
8 more `faq` (billing, security, technical, account, mobile app, notifications, data export, API),
8 more `docs` (architecture overview, data model, webhooks reference, Node.js SDK reference, Python
SDK reference, CLI reference, permissions reference, search reference), 10 new `tutorial` documents
(step-by-step walkthroughs — first board, inviting a team, automation basics, custom fields, Slack/
GitHub integrations, API quickstart, Zapier recipes, the timeline view, webhook setup), and 9 new
monthly `changelog` documents (`changelog-2026-01.md` through `-09.md`, splitting/extending the
existing `changelog-2026.md`'s version history with three brand-new later releases — v3.5.0/3.5.1/
3.6.0 — covering a fictional mobile app launch, full-text search, and Enterprise data residency).
All 40 were generated by five parallel agents, each handed the exact same canonical "CloudPulse
facts" sheet (pricing tiers, rate limits, security specifics, CLI commands, version history) so
every new document stays internally consistent with the original 10 and with each other — no
agent invented a pricing figure or rate limit that contradicts another document.

`src/modules/rag/seed-data/qa-pairs.json` grew from 50 to **250 entries** (5 per document — 3
simple, 1 multi-step, 1 edge-case — matching the exact schema and per-document distribution
`MockDataService.seedRealisticDataset()` already expected). `MockDataService`'s
`REALISTIC_SEED_METADATA` map (title + `DocumentCategory` per filename) was extended with all 40
new entries; `REALISTIC_SEED_TAG` (`'realistic-seed'`) was exported from `mock-data.service.ts` so
`CapstoneService` can identify exactly the documents `seedRealisticDataset()` created, without
duplicating the tag string. No changes were needed to `seedRealisticDataset()`'s own logic — it
already reads every `.md` file in the directory and every entry in `qa-pairs.json`, so scaling from
10→50 documents and 50→250 Q&A pairs was purely a data change.

### CapstoneModule (`src/modules/capstone/`)

`CapstoneService` implements no new AI capability — it composes `MockDataService`
(`RagModule`, exported alongside `DocumentService`/`PineconeService` specifically for this),
`ChatService` (`AiChatModule`), and `CostBudgetService` (`CostManagementModule`) into four
endpoints:

- **`POST /capstone/seed`** — seeds the 50-document realistic dataset (`MockDataService
.seedRealisticDataset()`, which already awaits every document's full chunk→embed→Pinecone-upsert
  pipeline internally — there is no separate "wait for embeddings" step to add), seeds 3 sample
  multi-turn demo conversations (skipping any whose exact title already exists, so re-running
  `seed()` without a `reset()` first doesn't pile up duplicates — each conversation's message
  turns are wrapped in their own try/catch so one flaky free-tier model response can't abort the
  rest of the seed), seeds 3 sample cost budgets with different limit shapes (catching
  `ConflictException` per-budget so a second `seed()` run is also safe), then runs a real
  evaluation (`CAPSTONE_EVAL_SAMPLE_SIZE = 100`) and returns one summary object: `{ documents,
  chunks, vectors, qaPairs, conversations, budgets, evaluation, summary }`.
- **`POST /capstone/reset`** — deletes exactly what `seed()` created: every document tagged
  `realistic-seed` (via `DocumentService.delete()`, which cascades chunks/Q&A pairs through the
  schema's `onDelete: Cascade` and cleans up Pinecone vectors), every conversation titled with the
  `[Capstone Demo]` prefix, and the 3 fixed `capstone-demo-*` budgets. Nothing else in the database
  is touched — this is a scoped reset, not a general wipe.
- **`GET /capstone/status`** — demo readiness (`ready: documents >= 50`), current dataset counts,
  and the most recent in-process evaluation report (`lastEvaluation`, `null` until a `seed()` or
  `run-evaluation` call populates it — reset on restart, the same tradeoff `RetentionService
.lastReport` already accepts).
- **`POST /capstone/run-evaluation`** — reuses `RagModule`'s existing `EvaluateDto`/`EvaluateResDto`
  directly (no new DTO needed) so a caller can pass an explicit `sampleSize` or an ad hoc `qaPairs`
  list, exactly like `POST /rag/evaluate` already supports.

`CapstoneModule` imports `RagModule`, `AiChatModule`, and `CostManagementModule` and exports
nothing — nothing else in the app needs to depend on the capstone demo-seeding surface. `RagModule`
gained an `exports: [MockDataService, DocumentService, PineconeService]` array (previously
exported nothing) specifically to make this possible, following the same "only export what's
needed externally" convention `AiChatModule`/`CostManagementModule` already established.

**Live-verified** against the real Postgres/Pinecone/OpenRouter stack used throughout this project:
`POST /capstone/seed` ingested all 50 documents (114 chunks/vectors — a couple of documents' chunks
count lower than others depending on content length) and seeded 250 Q&A pairs, 3 conversations, and
3 budgets successfully — but the request itself returned a 500 because the final evaluation step
hit a transient `PineconeConnectionError` mid-batch, the exact same pre-existing, already-documented
finding from AI-055/AI-075 ("`SearchService.search()`/`RagService.query()` don't catch Pinecone
timeouts... a transient error mid-batch surfaced as an uncaught 500"), not a new defect. `GET
/capstone/status` confirmed the partial success (`documents: 50, chunks: 114, vectors: 114, qaPairs:
250, conversations: 3, budgets: 3`); a direct `POST /rag/search` call in between confirmed Pinecone
connectivity itself was fine seconds later. Re-running `POST /capstone/run-evaluation` with a
smaller `sampleSize: 10` succeeded cleanly: **70% overall accuracy, 83% simple-question accuracy**
(6/6 simple questions attempted, 5 correct; both edge-case questions appropriately declined),
comfortably clearing the spec's own thresholds (simple > 70%, overall > 50%). `POST /capstone/reset`
then correctly deleted all 50 documents, 3 conversations, and 3 budgets in one call, confirmed via a
follow-up `GET /capstone/status` showing all counts zeroed (Pinecone's vector count briefly still
showed the pre-delete figure — the same `describeIndexStats()` eventual-consistency lag documented
since AI-055, not an app-level bug).

### Integration test suite (`src/modules/capstone/__tests__/`)

Five tests, one per capstone spec §4 scenario, each proving a distinct cross-phase flow through
real services with only the true external boundaries mocked (`DatabaseService`'s Prisma client,
`OPENAI_CLIENT`/`MODERATION_CLIENT`, `PineconeService`) — the same convention established by
`chat-function-calling.integration.spec.ts` (AI-034) and `moderation-guard-integration.spec.ts`
(AI-074). A shared `capstone-test-helpers.ts` holds common mock factories (`makeOpenaiClientMock`,
`makeChatMessageFactory`'s stateful message-list pattern, etc.) so the 5 spec files don't duplicate
boilerplate:

1. **`rag-flow-moderation.integration.spec.ts`** — a real `RagController` (via `supertest` +
   `INestApplication`) ingests a document, answers a clean question with citations, blocks a
   flagged question with 422 (moderation runs before RAG ever executes — asserted via
   `chat.completions.create` never being called for the flagged path), and confirms
   `ai_audit_logs` cover both the embedding call and the completion call while `moderation_logs`
   shows the blocked input.
2. **`chat-rag-tools-streaming.integration.spec.ts`** — one conversation exercised through a RAG
   turn (`RagService.queryWithConversation()`), a tool-calling turn (the real two-call calculator
   protocol), a follow-up referencing the RAG answer (asserted by inspecting the actual `messages`
   array sent to the model on the last completion call), and a streamed turn — calling
   `ChatService`/`RagService` directly (not through HTTP), matching AI-034's own precedent, since
   the cross-phase wiring under test lives in the service layer. A shared, mutable
   `chatConversation.findUnique` mock branches on whether the query is by `publicId`
   (`findConversationOrThrow`) or by internal `id` (`buildContext()`), backed by the same
   growing message array both `ChatService.sendMessage()` and `RagService.queryWithConversation()`
   write to — proving conversation context is genuinely shared, not just independently mocked per
   call site.
3. **`cost-budget-enforcement.integration.spec.ts`** — a real `ChatController` +
   `CostBudgetGuard` + `CostBudgetService`, with `costBudget.cacheTtlMs: 0` (so each check re-reads
   a scripted `aiAuditLog.aggregate()` spend figure instead of reusing a 60-second cache entry
   mid-test) drives spend from under- to over-limit across two calls: the first is allowed and
   audited, the second returns 429 with a spend-details message and never reaches the handler.
4. **`data-retention-safety.integration.spec.ts`** — calls the real `RetentionService
.runFullCleanup()` against a hand-built in-memory fixture (old + current audit logs, old +
   current moderation logs, an old archived conversation, a recent archived conversation, and —
   the property that matters most — an **old but active** conversation) and confirms exactly the
   old rows are deleted, current rows survive, and the old-active conversation survives regardless
   of age, since no code path in `RetentionService` ever targets a non-archived conversation.
5. **`end-to-end-evaluation.integration.spec.ts`** — calls `MockDataService.evaluate()` directly
   with an explicit 10-pair `qaPairs` list (the same ad hoc-evaluation path `EvaluateDto.qaPairs`
   already supports) and scripted model answers engineered to produce a deterministic 70% overall /
   83% simple accuracy — proving the evaluate() → classify → aggregate → audit pipeline meets the
   spec's exact thresholds without depending on live network calls in the automated suite. The real
   50-document, real-network version of this same proof is the live run documented above —
   mirroring this codebase's established split between a deterministic mocked-boundary automated
   test and a live HITL smoke test (e.g. AI-054 vs AI-055).

**Full regression**: `npm run test` went from 705 to **710** passing tests (+5, one per scenario
above), zero changes to any pre-capstone spec file's assertions. `npx tsc --noEmit --project
tsconfig.build.json` and `npm run lint:check` (0 errors) both pass clean.

### Demo script and project completion report

`docs/demo-script.md` — a 15-20 minute, 5-act walkthrough (Knowledge Base → Chat & Streaming →
Safety & Governance → Model Registry & Pricing → Under the Hood) for demoing the whole platform to
stakeholders, plus a troubleshooting table covering the known Pinecone-flakiness/free-tier-model
findings already documented elsewhere in this file.

`docs/project-completion-report.md` — the project's closing document: goal-alignment table (100%
coverage), architecture diagram, per-phase summary with issue/test counts and key learnings,
technical stats (85 endpoints, 26 services, 15 tables, 710 tests, ~13,900 LOC), tools/practices/
practice-app checklists, a template "What I Learned" section left for personal reflection, demo
instructions, and a future-enhancements list (real auth, WebSocket streaming, fine-tuning, Azure
OpenAI, retry-wrapping `PineconeService`, an LLM-as-judge evaluator, streaming tool execution, and
fixing the output-moderation-doesn't-redact-history gap AI-075 found live).

### OpenAI-compatible providers

The `OPENAI_CLIENT` factory in `src/modules/openai/openai.module.ts` accepts an optional
`OPENAI_BASE_URL` env var, forwarded as `baseURL` to the OpenAI SDK constructor. This lets the
module talk to any OpenAI-compatible API — OpenRouter, Groq, Together AI, etc. — without touching
service, controller, or DTO logic; only the underlying HTTP endpoint changes.

- Leave `OPENAI_BASE_URL` empty to use the real OpenAI API (default SDK behavior, no change).
- To use OpenRouter's free models, set:

  ```bash
  OPENAI_BASE_URL=https://openrouter.ai/api/v1
  OPENAI_API_KEY=sk-or-v1-...
  ```

  Then pass a provider-specific model string (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`) in
  the `model` field of request DTOs — these strings don't need to exist in the `OpenAIModel` enum,
  which only enumerates native OpenAI models.

**Model field validation**: `model`/`models` fields (`ChatCompletionDto`, `ModelCompareDto`,
`PromptTestDto`, `TokenCountDto`) use the custom `@IsValidModel()` decorator
(`src/modules/openai/validators/is-valid-model.validator.ts`) instead of `@IsEnum(OpenAIModel)`.
It accepts either:

- A native `OpenAIModel` enum value (`gpt-4`, `gpt-4o`, `gpt-4o-mini`), or
- An OpenRouter-style `provider/model-name` or `provider/model-name:variant` string, matched by
  `/^[a-z0-9-]+\/[a-z0-9._-]+(:[a-z0-9-]+)?$/` (lowercase, no spaces).

Empty strings, whitespace, and anything matching neither shape are rejected.

### Dynamic model registry (`ai_providers` / `ai_models`)

The app no longer relies solely on the hardcoded `MODEL_PRICING` constant (3 native OpenAI
models). Two Prisma tables track every model the app knows about:

- **`ai_providers`** — `name`, `slug` (unique), `baseUrl?`, `description?`, `isActive`.
- **`ai_models`** — `providerId` (FK), `name`, `modelId` (unique, e.g. `gpt-4o` or
  `google/gemma-3-27b-it:free`), `tier` (`free`/`paid`), `inputPricePer1M`/`outputPricePer1M`,
  `contextWindow?`, `source` (`manual` or `openrouter_sync`), `isActive`, `lastSyncedAt?`.

Both are soft-deleted (`isActive: false`) via `ModelRegistryService`, never hard-deleted.

**`OpenRouterSyncService`** (`services/openrouter-sync.service.ts`) fetches
`GET https://openrouter.ai/api/v1/models` (no auth required — it's a public catalog endpoint) and
upserts providers (by `slug`, derived from the model ID's `provider/model` prefix) and models (by
`modelId`). It runs once on `onModuleInit()` and daily at 3 AM via `@Cron('0 3 * * *')`
(`@nestjs/schedule`, registered via `ScheduleModule.forRoot()` in `AppModule`). Toggle with
`OPENROUTER_SYNC_ENABLED=false` in `.env`. **Rows with `source: 'manual'` are never overwritten by
a sync** — that's how hand-added/edited models stay authoritative once you touch them.

**`ModelRegistryService`** (`services/model-registry.service.ts`, exported from `OpenaiModule`) is
the CRUD + lookup layer: `findAllModels`/`findAllProviders` (filterable, paginated),
`createModel`/`updateModel`/`deleteModel` and the provider equivalents (manual writes always set
`source: 'manual'`), `getModelPricing(modelId)`, `getPricingTable()`, `getAllActivePricing()` (bulk
map used by `TokenService`'s cache), `countModels`/`countProviders`.

**Cost calculation chain** (`TokenService.calculateCost`, now `async`): DB (`ai_models`, via a
5-minute in-memory `Map` cache refreshed lazily on expiry) → hardcoded `MODEL_PRICING` constant →
`0`. `OpenaiService.chatCompletion()` awaits this after every call. `TokenService.getModelPricing()`
(sync, hardcoded-only) is kept for the legacy `GET /openai/models/pricing` endpoint; prefer
`GET /openai/pricing` (`ModelRegistryService.getPricingTable()`) for the full DB-backed table.

**`TokenService.countTokens()` caches one `Tiktoken` encoder per model** (`encoderCache: Map<string,
Tiktoken>`), added during AI-021. `tiktoken`'s `encoding_for_model()` reloads its full BPE rank
table from embedded data on every call — measured ~110–145ms per call, uncached — so any caller
that invokes `countTokens()` in a loop (e.g. `ChatService.buildContext()` iterating a conversation's
messages) would otherwise blow well past any reasonable performance budget (a 50-message
`buildContext()` call took ~6.5s before this fix). Cached `.encode()` calls average ~0.25ms.
`TokenService` implements `OnModuleDestroy` to `.free()` all cached encoders on shutdown instead of
per-call. `model` is `string` (widened from the native-only `OpenAIModel` enum in AI-021, via
`model as TiktokenModel` at the `encoding_for_model()` call site) since Phase 2 conversations can
use any OpenRouter-style model string. The public `countTokens()` signature, return values, and
fallback-to-`estimateTokens()` behavior for models tiktoken doesn't recognize are unchanged.

**Default model is a free model, not a hardcoded enum value.** `openai.defaultModel` (config,
`OPENAI_DEFAULT_MODEL` env var, falls back to `meta-llama/llama-3.3-70b-instruct:free`) is what
`OpenaiService.chatCompletion()` and `OpenaiController`'s `compareModels`/`promptTest`/`countTokens`
fall back to when a request omits `model`/`models` — none of them hardcode `OpenAIModel.GPT_4O`
anymore. This means a fresh clone never accidentally calls a paid model by default. OpenRouter's
free-tier model catalog changes over time (a previously-valid `:free` slug can 404 as
"unavailable" — verified during this change), so if the default 404s, check
`GET /openai/models/free` for a currently-live replacement and update `OPENAI_DEFAULT_MODEL`.

**New endpoints** (all under `/openai`, all `isPublic: true` like the rest of this module):

| Method | Path                  | Purpose                                                                                |
| ------ | --------------------- | -------------------------------------------------------------------------------------- |
| GET    | `providers`           | List providers with `modelCount`                                                       |
| POST   | `providers`           | Manually add a provider                                                                |
| PATCH  | `providers/:publicId` | Update a provider                                                                      |
| DELETE | `providers/:publicId` | Deactivate a provider                                                                  |
| GET    | `models`              | List models (filters: `tier`, `providerId`, `search`, `source`, `isActive`; paginated) |
| GET    | `models/free`         | Shortcut: `tier=free`                                                                  |
| GET    | `models/paid`         | Shortcut: `tier=paid`                                                                  |
| POST   | `models`              | Manually add a model (`source: 'manual'`)                                              |
| PATCH  | `models/:publicId`    | Update a model (resets `source` to `'manual'`)                                         |
| DELETE | `models/:publicId`    | Deactivate a model                                                                     |
| GET    | `pricing`             | Full pricing table grouped by provider (active models only)                            |
| POST   | `pricing/calculate`   | `{ modelId, inputTokens, outputTokens }` → cost breakdown                              |
| POST   | `sync/openrouter`     | Trigger a manual sync; returns created/updated counts                                  |
| GET    | `sync/status`         | `lastSyncedAt`, `modelsCount`, `providersCount`                                        |

### Swagger

- Docs at `/api/docs` (not under the `api/v1` prefix — intentionally stable across version bumps)
- Bearer auth scheme key: `'access-token'` — use `@ApiBearerAuth('access-token')` on controllers
- Use `@ApiEndpoint({ summary, type?, successStatus?, isPublic? })` composite decorator instead of
  repeating `@ApiOperation + @ApiOkResponse + @ApiBearerAuth + @ApiResponse(4xx)` everywhere

## Creating a New Feature Module

```bash
# scaffold the module structure
nest g module modules/auth
nest g controller modules/auth
nest g service modules/auth
```

Then:

1. Create `src/modules/<name>/dto/` for request/response DTOs with `class-validator` decorators
2. Add `@ApiTags('<name>')` to the controller — tag must match one registered in `main.ts`
3. Use `@ApiEndpoint({ ... })` on every route handler
4. Inject `DatabaseService` directly (it is global — no need to import `DatabaseModule`)
5. Inject `AppLoggerService` directly (global via `LoggerModule`)
6. Add AI API calls to `AuditLog` table via `DatabaseService` for cost tracking

## Code Quality

- **Lint + format run on every commit** via Husky pre-commit → lint-staged
- **Commit messages** must follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
  enforced by commitlint on commit-msg hook
- **`no-console` is a warning** — use `AppLoggerService` instead
- **`no-unsafe-*` rules are warnings** (downgraded from error) — NestJS guard/middleware
  signatures use `Record<string, any>` which makes these unfixable at the root
- Type-check before submitting: `npx tsc --noEmit --project tsconfig.build.json`
$$
