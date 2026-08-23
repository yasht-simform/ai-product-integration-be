import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggerModule } from './common/logger/logger.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import {
  appConfig,
  chatConfig,
  costBudgetConfig,
  databaseConfig,
  jwtConfig,
  moderationConfig,
  openaiConfig,
  pineconeConfig,
  ragConfig,
  retentionConfig,
  throttleConfig,
  validate,
} from './config';
import { DatabaseModule } from './database/database.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { CapstoneModule } from './modules/capstone/capstone.module';
import { CostManagementModule } from './modules/cost-management/cost-management.module';
import { HealthModule } from './modules/health/health.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { OpenaiModule } from './modules/openai/openai.module';
import { RagModule } from './modules/rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        openaiConfig,
        pineconeConfig,
        throttleConfig,
        chatConfig,
        ragConfig,
        moderationConfig,
        costBudgetConfig,
        retentionConfig,
      ],
    }),
    // @nestjs/throttler v6 uses milliseconds for ttl.
    // THROTTLE_TTL env var is stored in seconds, so multiply by 1000 here.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('throttle.ttl', 60) * 1000,
            limit: config.get<number>('throttle.limit', 30),
          },
        ],
      }),
    }),
    ScheduleModule.forRoot(),
    LoggerModule,
    DatabaseModule,
    HealthModule,
    OpenaiModule,
    AiChatModule,
    RagModule,
    ModerationModule,
    CostManagementModule,
    CapstoneModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // APP_GUARD applies ThrottlerBehindProxyGuard to every route automatically.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
