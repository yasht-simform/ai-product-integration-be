import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import request from 'supertest';
import type { App } from 'supertest/types';

import type {
  AiAuditLog,
  ChatConversation,
  ChatMessage,
} from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { CostBudgetService } from '../../cost-management/services/cost-budget.service';
import { ModerationAction } from '../../moderation/constants/moderation-action.constant';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { ModerationService } from '../../moderation/services/moderation.service';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { RetryService } from '../../openai/services/retry.service';
import { TokenService } from '../../openai/services/token.service';
import { ChatController } from '../chat.controller';
import { ChatService } from '../services/chat.service';
import { StreamingService } from '../services/streaming.service';
import { ToolExecutorService } from '../services/tool-executor.service';
import { ToolRegistryService } from '../services/tool-registry.service';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url).
// A DeepMockProxy<DatabaseService> is provided below instead of a real instance.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const configValues: Record<string, unknown> = {
  'openai.apiKey': 'test-api-key',
  'moderation.enabled': true,
  'moderation.inputEnabled': true,
  'moderation.outputEnabled': false,
  'moderation.blockThreshold': 0.7,
  // Disabled so CostBudgetGuard (second in the chain) always passes with zero DB calls — this
  // suite is about ModerationGuard, not budget enforcement (that's AI-066's own test suite).
  'costBudget.enabled': false,
};
const mockConfig = { get: jest.fn((key: string) => configValues[key]) };
const mockModelRegistry = {
  findModelByModelId: jest.fn().mockResolvedValue(null),
  getAllActivePricing: jest.fn().mockResolvedValue(new Map()),
};
const mockOpenaiClient = {
  chat: { completions: { create: jest.fn() } },
  moderations: { create: jest.fn() },
};
const mockToolRegistry = { getToolDefinitions: jest.fn() };
const mockToolExecutor = { execute: jest.fn() };
const mockStreamingService = { streamCompletion: jest.fn() };
const mockCostBudgetService = { checkBudget: jest.fn() };

function makeConversationRow(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: BigInt(1),
    publicId: 'conv-moderation-1',
    title: null,
    systemPrompt: null,
    model: 'test-org/integration-test-model',
    userId: null,
    toolsEnabled: false,
    metadata: null,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeAuditLogRow(): AiAuditLog {
  return {
    id: BigInt(1),
    publicId: 'audit-pub-1',
    requestId: 'req-1',
    userId: null,
    model: 'omni-moderation-latest',
    endpoint: 'moderations',
    systemPrompt: null,
    userMessage: 'test',
    assistantResponse: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    latencyMs: 5,
    temperature: null,
    maxTokens: null,
    status: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    metadata: null,
    createdAt: new Date('2026-01-01'),
  };
}

function makeCleanModerationResponse() {
  return {
    id: 'modr-clean',
    model: 'omni-moderation-latest',
    results: [
      {
        flagged: false,
        categories: { violence: false, hate: false },
        category_scores: { violence: 0.01, hate: 0.02 },
      },
    ],
  };
}

function makeFlaggedModerationResponse() {
  return {
    id: 'modr-flagged',
    model: 'omni-moderation-latest',
    results: [
      {
        flagged: true,
        categories: { violence: true, hate: false },
        category_scores: { violence: 0.95, hate: 0.05 },
      },
    ],
  };
}

function makeFinalAnswerResponse() {
  return {
    id: 'chatcmpl-1',
    model: 'test-org/integration-test-model',
    choices: [
      {
        message: { content: 'Sure, happy to help.', tool_calls: undefined },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// Proves ModerationGuard (AI-061) actually blocks a real HTTP request BEFORE ChatController's
// handler/ChatService runs, wired through the framework (not a unit-level canActivate() call) —
// mocking only DatabaseService and OPENAI_CLIENT, per AI-034/AI-054's "real external boundaries
// only" convention.
describe('ModerationGuard blocks before handler (AI-074 integration)', () => {
  let app: INestApplication<App>;
  let dbMock: DeepMockProxy<DatabaseService>;
  let messageIdCounter: number;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    messageIdCounter = 0;
    jest.clearAllMocks();
    mockModelRegistry.findModelByModelId.mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

    dbMock.chatConversation.findUnique.mockResolvedValue({
      ...makeConversationRow(),
      messages: [] as ChatMessage[],
    });
    dbMock.chatMessage.create.mockImplementation((args) => {
      const data = args.data as Record<string, unknown>;
      const row: ChatMessage = {
        id: BigInt(++messageIdCounter),
        publicId: `msg-pub-${messageIdCounter}`,
        conversationId: data.conversationId as bigint,
        role: data.role as string,
        content: (data.content as string | null) ?? null,
        toolCalls: (data.toolCalls as ChatMessage['toolCalls']) ?? null,
        toolCallId: (data.toolCallId as string | null) ?? null,
        toolName: (data.toolName as string | null) ?? null,
        tokenCount: (data.tokenCount as number | null) ?? null,
        cost: (data.cost as number | null) ?? null,
        latencyMs: (data.latencyMs as number | null) ?? null,
        model: (data.model as string | null) ?? null,
        metadata: (data.metadata as ChatMessage['metadata']) ?? null,
        createdAt: new Date('2026-01-01'),
      };
      return Promise.resolve(row);
    });
    dbMock.aiAuditLog.create.mockResolvedValue(makeAuditLogRow());
    dbMock.moderationLog.create.mockResolvedValue({
      id: BigInt(1),
      publicId: 'modlog-pub-1',
      requestId: null,
      userId: null,
      direction: 'input',
      content: 'stub',
      isFlagged: false,
      categories: {},
      categoryScores: {},
      action: 'allowed',
      source: 'chat',
      metadata: null,
      createdAt: new Date('2026-01-01'),
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: ToolExecutorService, useValue: mockToolExecutor },
        { provide: StreamingService, useValue: mockStreamingService },
        OpenaiService,
        RetryService,
        TokenService,
        AiAuditService,
        ModerationGuard,
        ModerationService,
        OutputModerationInterceptor,
        Reflector,
        CostBudgetGuard,
        { provide: CostBudgetService, useValue: mockCostBudgetService },
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OPENAI_CLIENT, useValue: mockOpenaiClient },
        { provide: MODERATION_CLIENT, useValue: mockOpenaiClient },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
      ],
    }).compile();

    module.get<OpenaiService>(OpenaiService).onModuleInit();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 422 for flagged input, never reaches the chat handler, and logs one blocked check', async () => {
    mockOpenaiClient.moderations.create.mockResolvedValue(makeFlaggedModerationResponse());

    const response = await request(app.getHttpServer())
      .post('/chat/conversations/conv-moderation-1/messages')
      .send({ content: 'a violent threat' });

    expect(response.status).toBe(422);

    // The handler (ChatService.sendMessage → addUserMessage) never ran.
    expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    // The chat completion model was never invoked either — moderation blocked before any chat call.
    expect(mockOpenaiClient.chat.completions.create).not.toHaveBeenCalled();

    expect(dbMock.moderationLog.create).toHaveBeenCalledTimes(1);
    const logArgs = dbMock.moderationLog.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(logArgs.isFlagged).toBe(true);
    expect(logArgs.action).toBe(ModerationAction.BLOCKED);
    expect(logArgs.source).toBe('chat');
  });

  it('passes clean input through to the real chat handler and logs one allowed check', async () => {
    mockOpenaiClient.moderations.create.mockResolvedValue(makeCleanModerationResponse());
    mockOpenaiClient.chat.completions.create.mockResolvedValue(makeFinalAnswerResponse());

    const response = await request(app.getHttpServer())
      .post('/chat/conversations/conv-moderation-1/messages')
      .send({ content: 'What is the capital of France?' });

    expect(response.status).toBe(201);
    expect((response.body as { content: string }).content).toBe('Sure, happy to help.');

    // The handler ran for real: user message + assistant message persisted.
    expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(2);
    expect(mockOpenaiClient.chat.completions.create).toHaveBeenCalledTimes(1);

    expect(dbMock.moderationLog.create).toHaveBeenCalledTimes(1);
    const logArgs = dbMock.moderationLog.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(logArgs.isFlagged).toBe(false);
    expect(logArgs.action).toBe(ModerationAction.ALLOWED);
  });
});
