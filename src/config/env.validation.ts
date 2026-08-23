import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Staging = 'staging',
  Test = 'test',
}

class EnvironmentVariables {
  // ── App ────────────────────────────────────────────────────────────────────

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number;

  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment;

  @IsUrl({ require_tld: false })
  APP_URL: string;

  // ── Database ───────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // ── JWT ────────────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRATION: string;

  // ── OpenAI ─────────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY: string;

  @IsOptional()
  @IsString()
  OPENAI_ORG_ID?: string;

  @IsOptional()
  @IsString()
  OPENAI_BASE_URL?: string;

  @IsOptional()
  @IsString()
  OPENAI_DEFAULT_MODEL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENAI_MAX_RETRIES?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENAI_RETRY_BASE_DELAY_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENAI_CIRCUIT_FAILURE_THRESHOLD?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENAI_CIRCUIT_COOLDOWN_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENAI_TIMEOUT_MS?: number;

  @IsOptional()
  @IsString()
  OPENROUTER_SYNC_ENABLED?: string;

  // Moderation-only fallback client (AI-059) — unset means moderateText()/moderateBatch() reuse
  // the primary OPENAI_CLIENT unchanged. Only needed when OPENAI_BASE_URL points at a provider
  // (e.g. OpenRouter) that doesn't proxy POST /moderations.
  @IsOptional()
  @IsString()
  MODERATION_API_BASE_URL?: string;

  @IsOptional()
  @IsString()
  MODERATION_API_KEY?: string;

  // When 'true', OpenaiService.executeModeration() returns a canned fixture response instead of
  // calling any upstream — for verifying the moderation pipeline without billable API quota.
  @IsOptional()
  @IsString()
  MODERATION_STATIC_MODE?: string;

  // ── Pinecone ───────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  PINECONE_API_KEY?: string;

  @IsOptional()
  @IsString()
  PINECONE_INDEX?: string;

  @IsOptional()
  @IsString()
  PINECONE_NAMESPACE?: string;

  // ── Sentry ─────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsUrl()
  SENTRY_DSN?: string;

  // ── CORS ───────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  // ── Rate limiting ──────────────────────────────────────────────────────────

  @IsInt()
  @Min(1)
  THROTTLE_TTL: number;

  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number;

  // ── Chat ───────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(1)
  CHAT_MAX_CONTEXT_MESSAGES?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(1)
  CHAT_CONTEXT_WINDOW_PERCENTAGE?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CHAT_TOOL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CHAT_HTTP_TOOL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsString()
  CHAT_AUTO_TITLE?: string;

  @IsOptional()
  @IsString()
  CHAT_TOOL_HTTP_ALLOWED_DOMAINS?: string;

  // ── RAG / Embeddings ───────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  EMBEDDING_MODEL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMBEDDING_DIMENSIONS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMBEDDING_BATCH_SIZE?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RAG_TOP_K?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  RAG_SIMILARITY_THRESHOLD?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RAG_MAX_CONTEXT_TOKENS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CHUNK_SIZE?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  CHUNK_OVERLAP?: number;

  // ── Moderation ─────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  MODERATION_ENABLED?: string;

  @IsOptional()
  @IsString()
  MODERATION_INPUT_ENABLED?: string;

  @IsOptional()
  @IsString()
  MODERATION_OUTPUT_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  MODERATION_BLOCK_THRESHOLD?: number;

  // ── Cost Budgets ───────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  COST_BUDGET_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  COST_BUDGET_CACHE_TTL_MS?: number;

  // ── Data Retention ─────────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_AUDIT_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_MODERATION_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_ARCHIVED_CONVERSATION_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RETENTION_EMBEDDING_CACHE_DAYS?: number;

  @IsOptional()
  @IsString()
  RETENTION_CRON?: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((err) => Object.values(err.constraints ?? {}));
    throw new Error(`Environment validation failed:\n  ${messages.join('\n  ')}`);
  }

  return validated;
}
