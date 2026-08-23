import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { MODERATION_CLIENT, OPENAI_CLIENT } from './constants/injection-tokens';
import { OpenaiController } from './openai.controller';
import { AiAuditService } from './services/ai-audit.service';
import { ModelRegistryService } from './services/model-registry.service';
import { OpenaiService } from './services/openai.service';
import { OpenRouterSyncService } from './services/openrouter-sync.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { RetryService } from './services/retry.service';
import { TokenService } from './services/token.service';
import { resolveModerationClient } from './utils/resolve-moderation-client.util';

@Module({
  imports: [HttpModule],
  controllers: [OpenaiController],
  providers: [
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenAI({
          apiKey: config.get<string>('openai.apiKey') ?? '',
          organization: config.get<string>('openai.orgId'),
          baseURL: config.get<string>('openai.baseUrl') || undefined,
          timeout: config.get<number>('openai.timeoutMs'),
        }),
    },
    // AI-059 — OpenRouter (this app's default OPENAI_BASE_URL) does not proxy POST /moderations
    // (live-verified: 404 with a text/html Next.js 404 page, not a JSON API error, while GET
    // /models and POST /chat/completions on the same base URL both return 200). When
    // MODERATION_API_KEY is set, moderation calls go to a separate client instance instead —
    // otherwise this resolves to the exact same OPENAI_CLIENT instance, so nothing changes for a
    // deployment that never sets it.
    {
      provide: MODERATION_CLIENT,
      inject: [ConfigService, OPENAI_CLIENT],
      useFactory: (config: ConfigService, primaryClient: OpenAI) =>
        resolveModerationClient({
          moderationApiKey: config.get<string>('openai.moderationApiKey'),
          moderationApiBaseUrl: config.get<string>('openai.moderationApiBaseUrl'),
          timeoutMs: config.get<number>('openai.timeoutMs'),
          primaryClient,
        }),
    },
    OpenaiService,
    TokenService,
    RetryService,
    AiAuditService,
    PromptTemplateService,
    ModelRegistryService,
    OpenRouterSyncService,
  ],
  exports: [OPENAI_CLIENT, OpenaiService, AiAuditService, TokenService, ModelRegistryService],
})
export class OpenaiModule {}
