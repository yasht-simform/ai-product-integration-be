import { HttpService } from '@nestjs/axios';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { ChatMessage, UserCostBudget } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ChatController } from '../../ai-chat/chat.controller';
import { ChatService } from '../../ai-chat/services/chat.service';
import { StreamingService } from '../../ai-chat/services/streaming.service';
import { ToolExecutorService } from '../../ai-chat/services/tool-executor.service';
import { ToolRegistryService } from '../../ai-chat/services/tool-registry.service';
import { WeatherTool } from '../../ai-chat/tools/weather.tool';
import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { CostBudgetService } from '../../cost-management/services/cost-budget.service';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { ModerationService } from '../../moderation/services/moderation.service';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { RetryService } from '../../openai/services/retry.service';
import { TokenService } from '../../openai/services/token.service';
import {
  makeAuditLogRow,
  makeChatCompletionResponse,
  makeChatMessageFactory,
  makeConversationRow,
  makeOpenaiClientMock,
  mockLogger,
  mockModelRegistry,
} from './capstone-test-helpers';

jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

function makeBudgetRow(overrides: Partial<UserCostBudget> = {}): UserCostBudget {
  return {
    id: BigInt(1),
    publicId: 'budget-pub-1',
    userId: 'capstone-test-user',
    dailyLimitUsd: 0.001,
    monthlyLimitUsd: null,
    isActive: true,
    alertThreshold: 0.8,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Test 3 (capstone spec §4): cost budget enforcement — proves Phase 1 (audited AI calls) and
// Phase 4 (CostBudgetGuard/CostBudgetService) work together through the real ChatController route,
// exactly reproducing AI-066's own live-verified scenario (a synthetic spend figure standing in
// for real dollar cost, since the configured free-tier model always reports $0).
describe('Capstone Test 3 — Cost Budget Enforcement', () => {
  let app: INestApplication<App>;
  let dbMock: DeepMockProxy<DatabaseService>;
  let mockOpenaiClient: ReturnType<typeof makeOpenaiClientMock>;
  let messageFactory: ReturnType<typeof makeChatMessageFactory>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    jest.clearAllMocks();
    mockModelRegistry.findModelByModelId.mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

    const conversationRow = makeConversationRow({
      publicId: 'conv-budget-1',
      userId: 'capstone-test-user',
    });
    messageFactory = makeChatMessageFactory();

    dbMock.chatConversation.findUnique.mockResolvedValue({
      ...conversationRow,
      messages: [] as ChatMessage[],
    });
    dbMock.chatMessage.create.mockImplementation(messageFactory.create);
    dbMock.aiAuditLog.create.mockResolvedValue(makeAuditLogRow());
    dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudgetRow());

    mockOpenaiClient = makeOpenaiClientMock();
    mockOpenaiClient.chat.completions.create.mockResolvedValue(
      makeChatCompletionResponse('Sure, happy to help.'),
    );

    const configValues: Record<string, unknown> = {
      'openai.apiKey': 'test-api-key',
      'moderation.enabled': false,
      'costBudget.enabled': true,
      // Zero TTL so every checkBudget() call re-queries the (scripted) aggregate instead of
      // reusing a cached spend figure — this test drives spend across two distinct values within
      // a single fast-running test, unlike production's normal 60s cache window.
      'costBudget.cacheTtlMs': 0,
    };
    const mockConfig = { get: jest.fn((key: string) => configValues[key]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        ToolRegistryService,
        ToolExecutorService,
        { provide: StreamingService, useValue: { streamCompletion: jest.fn() } },
        OpenaiService,
        RetryService,
        TokenService,
        AiAuditService,
        ModerationGuard,
        ModerationService,
        OutputModerationInterceptor,
        Reflector,
        CostBudgetGuard,
        CostBudgetService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OPENAI_CLIENT, useValue: mockOpenaiClient },
        { provide: MODERATION_CLIENT, useValue: mockOpenaiClient },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
        { provide: HttpService, useValue: { request: jest.fn() } },
        { provide: WeatherTool, useValue: { execute: jest.fn() } },
      ],
    }).compile();

    module.get<OpenaiService>(OpenaiService).onModuleInit();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows calls under the daily limit, then returns 429 with spend details once exceeded', async () => {
    // Step 1 + 2: a $0.001 daily budget already exists; spend starts at 0 (under limit) — the
    // first AI call is allowed and audited.
    dbMock.aiAuditLog.aggregate.mockResolvedValue({ _sum: { estimatedCost: 0 } } as never);

    const firstResponse = await request(app.getHttpServer())
      .post('/chat/conversations/conv-budget-1/messages')
      .set('x-user-id', 'capstone-test-user')
      .send({ content: 'Hello there' });

    expect(firstResponse.status).toBe(201);
    expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(2); // user + assistant
    expect(dbMock.aiAuditLog.create).toHaveBeenCalledTimes(1);

    // Step 3: spend now exceeds the $0.001 daily limit — the next call is blocked with 429 before
    // ChatService ever runs.
    dbMock.aiAuditLog.aggregate.mockResolvedValue({ _sum: { estimatedCost: 0.002 } } as never);
    dbMock.chatMessage.create.mockClear();

    const secondResponse = await request(app.getHttpServer())
      .post('/chat/conversations/conv-budget-1/messages')
      .set('x-user-id', 'capstone-test-user')
      .send({ content: 'One more message' });

    expect(secondResponse.status).toBe(429);
    expect(typeof secondResponse.body.message).toBe('string');
    expect((secondResponse.body.message as string).toLowerCase()).toContain('budget');
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();

    // Step 4: the audit log shows exactly the one successful call from Step 1-2 (the blocked call
    // never reached the handler, so it was never audited), and a direct budget-status check shows
    // the budget as exceeded.
    expect(dbMock.aiAuditLog.create).toHaveBeenCalledTimes(1);

    const costBudgetService = app.get(CostBudgetService);
    const status = await costBudgetService.checkBudget('capstone-test-user');
    expect(status.allowed).toBe(false);
    expect(status.dailySpend).toBeGreaterThanOrEqual(status.dailyLimit ?? Infinity);
  });
});
