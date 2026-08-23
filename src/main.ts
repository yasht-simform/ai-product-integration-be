import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppLoggerService } from './common/logger/app-logger.service';
import { DatabaseService } from './database/database.service';

async function bootstrap() {
  // bufferLogs holds all startup logs until useLogger() is called,
  // so early boot messages pass through our custom logger too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const corsOrigins = configService.get<string[]>('app.corsOrigins') ?? [];

  // ── Security ──────────────────────────────────────────────────────────────

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  // ── Global prefix ─────────────────────────────────────────────────────────

  app.setGlobalPrefix('api/v1');

  // ── Validation ────────────────────────────────────────────────────────────

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger ───────────────────────────────────────────────────────────────
  //
  // Available at /api/docs — outside the api/v1 prefix so it is always stable.

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Product Integration API')
    .setDescription(
      'REST API for AI product integrations — chat completions, embeddings, ' +
        'retrieval-augmented generation, and content moderation via OpenAI and Pinecone.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('health', 'Health and readiness probes')
    .addTag(
      'openai',
      'OpenAI chat completions, token counting, prompt templates, and circuit breaker health',
    )
    .addTag('auth', 'Authentication and authorization')
    .addTag('users', 'User management')
    .addTag('ai-chat', 'AI chat completions')
    .addTag('embeddings', 'Text embeddings and vector similarity search')
    .addTag('rag', 'Retrieval-augmented generation')
    .addTag('moderation', 'Content moderation and safety')
    .addTag('cost-management', 'Per-user cost budgets, analytics, and data retention')
    .addTag('capstone', 'Demo dataset seeding and readiness checks proving all 4 phases together')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────

  const prismaService = app.get(DatabaseService);
  prismaService.enableShutdownHooks(app);
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log(`Application running on port ${port}`, 'Bootstrap');
  logger.log(`Swagger docs → http://localhost:${port}/api/docs`, 'Bootstrap');
}
void bootstrap();
