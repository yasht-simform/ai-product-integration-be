import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
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

  // ── Pinecone ───────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  PINECONE_API_KEY: string;

  @IsString()
  @IsNotEmpty()
  PINECONE_INDEX: string;

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
