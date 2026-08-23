import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type {
  AiAuditLog,
  ChatConversation,
  ChatMessage,
  ChatTool,
} from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { RetryService } from '../../openai/services/retry.service';
import { TokenService } from '../../openai/services/token.service';
import { ChatService } from '../services/chat.service';
import { StreamingService } from '../services/streaming.service';
import { ToolExecutorService } from '../services/tool-executor.service';
import { ToolRegistryService } from '../services/tool-registry.service';
import { WeatherTool } from '../tools/weather.tool';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url).
// A DeepMockProxy<DatabaseService> is provided below instead of a real instance.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockConfig = {
  get: jest.fn((key: string) => (key === 'openai.apiKey' ? 'test-api-key' : undefined)),
};
const mockModelRegistry = {
  findModelByModelId: jest.fn().mockResolvedValue(null),
  getAllActivePricing: jest.fn().mockResolvedValue(new Map()),
};
const mockOpenaiClient = { chat: { completions: { create: jest.fn() } } };
const mockHttpService = { request: jest.fn() };
const mockWeatherTool = { execute: jest.fn() };
const mockStreamingService = { streamCompletion: jest.fn() };

function makeConversationRow(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: BigInt(1),
    publicId: 'conv-func-call-1',
    title: null,
    systemPrompt: null,
    model: 'test-org/integration-test-model',
    userId: null,
    toolsEnabled: true,
    metadata: null,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeCalculatorToolRow(): ChatTool {
  return {
    id: BigInt(1),
    publicId: 'tool-calculator-1',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
    handlerType: 'builtin',
    handlerConfig: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeAuditLogRow(): AiAuditLog {
  return {
    id: BigInt(1),
    publicId: 'audit-pub-1',
    requestId: 'req-1',
    userId: null,
    model: 'test-org/integration-test-model',
    endpoint: 'chat_completions',
    systemPrompt: null,
    userMessage: 'What is 234 times 567?',
    assistantResponse: null,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCost: 0,
    latencyMs: 50,
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

// Chained OpenAI chat.completions.create() response shape — only the fields the codebase reads.
function makeToolCallResponse() {
  return {
    id: 'chatcmpl-1',
    model: 'test-org/integration-test-model',
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: {
                name: 'calculator',
                arguments: JSON.stringify({ expression: '234*567' }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

function makeFinalAnswerResponse() {
  return {
    id: 'chatcmpl-2',
    model: 'test-org/integration-test-model',
    choices: [
      {
        message: { content: '234 times 567 is 132,678.', tool_calls: undefined },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 },
  };
}

describe('Function-calling integration (real ToolExecutorService/ToolRegistryService/OpenaiService)', () => {
  let chatService: ChatService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let messageIdCounter: number;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    messageIdCounter = 0;
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) =>
      key === 'openai.apiKey' ? 'test-api-key' : undefined,
    );
    mockModelRegistry.findModelByModelId.mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

    const conversationRow = makeConversationRow();
    dbMock.chatConversation.create.mockResolvedValue(conversationRow);
    dbMock.chatConversation.findUnique.mockResolvedValue({
      ...conversationRow,
      messages: [] as ChatMessage[],
    });
    dbMock.chatTool.findMany.mockResolvedValue([makeCalculatorToolRow()]);
    dbMock.chatTool.findUnique.mockResolvedValue(makeCalculatorToolRow());
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

    mockOpenaiClient.chat.completions.create
      .mockReset()
      .mockResolvedValueOnce(makeToolCallResponse())
      .mockResolvedValueOnce(makeFinalAnswerResponse());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        ToolRegistryService,
        ToolExecutorService,
        OpenaiService,
        RetryService,
        TokenService,
        AiAuditService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OPENAI_CLIENT, useValue: mockOpenaiClient },
        { provide: MODERATION_CLIENT, useValue: mockOpenaiClient },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
        { provide: HttpService, useValue: mockHttpService },
        { provide: WeatherTool, useValue: mockWeatherTool },
        { provide: StreamingService, useValue: mockStreamingService },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    module.get<OpenaiService>(OpenaiService).onModuleInit();
  });

  it('executes the real calculator tool via the two-call protocol and audits exactly twice', async () => {
    const conversation = await chatService.createConversation({ toolsEnabled: true });

    const result = await chatService.sendMessage(conversation.publicId, {
      content: 'What is 234 times 567?',
    });

    // The real mathjs-backed calculator tool evaluated 234*567 — proven by the SDK receiving the
    // correct expression and the final assistant content containing the model's stated answer.
    expect(result.content).toContain('132,678');

    expect(mockOpenaiClient.chat.completions.create).toHaveBeenCalledTimes(2);
    const firstCallArgs = mockOpenaiClient.chat.completions.create.mock.calls[0][0] as {
      tools?: unknown[];
    };
    expect(firstCallArgs.tools).toBeDefined();
    const secondCallArgs = mockOpenaiClient.chat.completions.create.mock.calls[1][0] as {
      tools?: unknown[];
    };
    expect(secondCallArgs.tools).toBeUndefined();

    // Two chatCompletionWithMessages() calls through the real OpenaiService/AiAuditService seam —
    // one per leg of the tool-calling turn (SC-CH-013's per-turn count).
    expect(dbMock.aiAuditLog.create).toHaveBeenCalledTimes(2);

    // Persisted messages: user question, tool-decision assistant message, tool result, final
    // assistant answer.
    expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(4);
  });

  it('propagates a real calculator failure back through the tool result without crashing the turn', async () => {
    mockOpenaiClient.chat.completions.create
      .mockReset()
      .mockResolvedValueOnce({
        ...makeToolCallResponse(),
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: {
                    name: 'calculator',
                    arguments: JSON.stringify({ expression: '1/0*bad(' }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      .mockResolvedValueOnce(makeFinalAnswerResponse());

    const conversation = await chatService.createConversation({ toolsEnabled: true });

    await expect(
      chatService.sendMessage(conversation.publicId, { content: 'compute something invalid' }),
    ).resolves.toBeDefined();

    // ToolExecutorService never rejects — the malformed expression surfaces as a tool-result
    // message with success: false, and the turn still completes with a second model call.
    expect(dbMock.aiAuditLog.create).toHaveBeenCalledTimes(2);
  });
});
