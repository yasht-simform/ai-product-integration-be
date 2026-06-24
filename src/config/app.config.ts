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
  defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o',
}));

export const pineconeConfig = registerAs('pinecone', () => ({
  apiKey: process.env.PINECONE_API_KEY!,
  index: process.env.PINECONE_INDEX!,
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL!, 10),
  limit: parseInt(process.env.THROTTLE_LIMIT!, 10),
}));

// ConfigType<typeof xConfig> extracts the exact return type of the factory,
// so these stay in sync with the factories above automatically.
export type AppConfig = ConfigType<typeof appConfig>;
export type DatabaseConfig = ConfigType<typeof databaseConfig>;
export type JwtConfig = ConfigType<typeof jwtConfig>;
export type OpenAIConfig = ConfigType<typeof openaiConfig>;
export type PineconeConfig = ConfigType<typeof pineconeConfig>;
export type ThrottleConfig = ConfigType<typeof throttleConfig>;
