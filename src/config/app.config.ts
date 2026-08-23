import { registerAs, type ConfigType } from '@nestjs/config';

import type { NodeEnvironment } from './env.validation';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT!, 10),
  env: process.env.NODE_ENV as NodeEnvironment,
  url: process.env.APP_URL!,
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL!,
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET!,
  expiration: process.env.JWT_EXPIRATION!,
}));

export const openaiConfig = registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY!,
  orgId: process.env.OPENAI_ORG_ID,
  baseUrl: process.env.OPENAI_BASE_URL,
  defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
  maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES ?? '5', 10),
  retryBaseDelayMs: parseInt(process.env.OPENAI_RETRY_BASE_DELAY_MS ?? '1000', 10),
  circuitFailureThreshold: parseInt(process.env.OPENAI_CIRCUIT_FAILURE_THRESHOLD ?? '5', 10),
  circuitCooldownMs: parseInt(process.env.OPENAI_CIRCUIT_COOLDOWN_MS ?? '60000', 10),
  timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS ?? '30000', 10),
  openRouterSyncEnabled: process.env.OPENROUTER_SYNC_ENABLED !== 'false',
  // Moderation-only fallback client (AI-059) — see MODERATION_CLIENT's factory in openai.module.ts.
  moderationApiBaseUrl: process.env.MODERATION_API_BASE_URL,
  moderationApiKey: process.env.MODERATION_API_KEY,
  // AI-059 — skip the network entirely and return a canned fixture; see
  // static-moderation-fixture.util.ts. Opt-in, default false, like moderationConfig.outputEnabled.
  moderationStaticMode: process.env.MODERATION_STATIC_MODE === 'true',
}));

export const pineconeConfig = registerAs('pinecone', () => ({
  apiKey: process.env.PINECONE_API_KEY,
  index: process.env.PINECONE_INDEX,
  namespace: process.env.PINECONE_NAMESPACE ?? 'documents',
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL!, 10),
  limit: parseInt(process.env.THROTTLE_LIMIT!, 10),
}));

export const chatConfig = registerAs('chat', () => ({
  maxContextMessages: parseInt(process.env.CHAT_MAX_CONTEXT_MESSAGES ?? '50', 10),
  contextWindowPercentage: parseFloat(process.env.CHAT_CONTEXT_WINDOW_PERCENTAGE ?? '0.8'),
  toolTimeoutMs: parseInt(process.env.CHAT_TOOL_TIMEOUT_MS ?? '10000', 10),
  httpToolTimeoutMs: parseInt(process.env.CHAT_HTTP_TOOL_TIMEOUT_MS ?? '5000', 10),
  autoTitle: process.env.CHAT_AUTO_TITLE !== 'false',
  httpToolAllowedDomains: process.env.CHAT_TOOL_HTTP_ALLOWED_DOMAINS
    ? process.env.CHAT_TOOL_HTTP_ALLOWED_DOMAINS.split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    : [],
  defaultContextWindow: 128000,
}));

export const ragConfig = registerAs('rag', () => ({
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1536', 10),
  embeddingBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '20', 10),
  topK: parseInt(process.env.RAG_TOP_K ?? '5', 10),
  similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD ?? '0.3'),
  maxContextTokens: parseInt(process.env.RAG_MAX_CONTEXT_TOKENS ?? '4000', 10),
  chunkSize: parseInt(process.env.CHUNK_SIZE ?? '500', 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP ?? '50', 10),
}));

export const moderationConfig = registerAs('moderation', () => ({
  enabled: process.env.MODERATION_ENABLED !== 'false',
  inputEnabled: process.env.MODERATION_INPUT_ENABLED !== 'false',
  // Opt-in, unlike enabled/inputEnabled — output moderation defaults OFF per spec §7.4.
  outputEnabled: process.env.MODERATION_OUTPUT_ENABLED === 'true',
  blockThreshold: parseFloat(process.env.MODERATION_BLOCK_THRESHOLD ?? '0.7'),
}));

export const costBudgetConfig = registerAs('costBudget', () => ({
  enabled: process.env.COST_BUDGET_ENABLED !== 'false',
  cacheTtlMs: parseInt(process.env.COST_BUDGET_CACHE_TTL_MS ?? '60000', 10),
}));

export const retentionConfig = registerAs('retention', () => ({
  auditDays: parseInt(process.env.RETENTION_AUDIT_DAYS ?? '90', 10),
  moderationDays: parseInt(process.env.RETENTION_MODERATION_DAYS ?? '90', 10),
  archivedConversationDays: parseInt(process.env.RETENTION_ARCHIVED_CONVERSATION_DAYS ?? '30', 10),
  embeddingCacheDays: parseInt(process.env.RETENTION_EMBEDDING_CACHE_DAYS ?? '180', 10),
  cron: process.env.RETENTION_CRON ?? '0 2 * * *',
}));

// ConfigType<typeof xConfig> extracts the exact return type of the factory,
// so these stay in sync with the factories above automatically.
export type AppConfig = ConfigType<typeof appConfig>;
export type DatabaseConfig = ConfigType<typeof databaseConfig>;
export type JwtConfig = ConfigType<typeof jwtConfig>;
export type OpenAIConfig = ConfigType<typeof openaiConfig>;
export type PineconeConfig = ConfigType<typeof pineconeConfig>;
export type ThrottleConfig = ConfigType<typeof throttleConfig>;
export type ChatConfig = ConfigType<typeof chatConfig>;
export type RagConfig = ConfigType<typeof ragConfig>;
export type ModerationConfig = ConfigType<typeof moderationConfig>;
export type CostBudgetConfig = ConfigType<typeof costBudgetConfig>;
export type RetentionConfig = ConfigType<typeof retentionConfig>;
