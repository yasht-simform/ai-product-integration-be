import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
  databaseConfig,
  jwtConfig,
  openaiConfig,
  pineconeConfig,
  throttleConfig,
  validate,
} from './config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, databaseConfig, jwtConfig, openaiConfig, pineconeConfig, throttleConfig],
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
    LoggerModule,
    DatabaseModule,
    HealthModule,
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
