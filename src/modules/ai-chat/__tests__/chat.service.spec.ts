import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { ChatConversation, ChatMessage } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import type { ChatCompletionResult } from '../../openai/types/openai.types';
import { StreamEventType } from '../constants/stream-event-type.enum';
import { ChatService } from '../services/chat.service';
import { StreamingService } from '../services/streaming.service';
import { ToolExecutorService } from '../services/tool-executor.service';
import { ToolRegistryService } from '../services/tool-registry.service';
import type { StreamEvent } from '../types/ai-chat.types';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockModelRegistry = {
  findModelByModelId: jest.fn(),
  getAllActivePricing: jest.fn().mockResolvedValue(new Map()),
};
const mockOpenaiService = { chatCompletionWithMessages: jest.fn() };
const mockToolRegistry = { getToolDefinitions: jest.fn() };
const mockToolExecutor = { execute: jest.fn() };
const mockStreamingService = { streamCompletion: jest.fn() };
const mockAiAuditService = { log: jest.fn() };

// eslint-disable-next-line @typescript-eslint/require-await -- must match AsyncGenerator shape
async function* toAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

function makeCompletionResult(overrides: Partial<ChatCompletionResult> = {}): ChatCompletionResult {
  return {
    content: 'the answer',
    model: 'gpt-4o',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    estimatedCost: 0.01,
    latencyMs: 250,
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<{ id: string; name: string; arguments: string }> = {}) {
  const { id = 'call_1', name = 'calculator', arguments: args = '{}' } = overrides;
  return { id, type: 'function' as const, function: { name, arguments: args } };
}

function makeConversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: BigInt(1),
    publicId: 'conversation-pub-1',
    title: null,
    systemPrompt: null,
    model: 'gpt-4o',
    userId: null,
    toolsEnabled: false,
    metadata: null,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: BigInt(1),
    publicId: 'message-pub-1',
    conversationId: BigInt(1),
    role: 'user',
    content: 'hello',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    tokenCount: null,
    cost: null,
    latencyMs: null,
    model: null,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ChatService', () => {
  let service: ChatService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    configMock = { get: jest.fn() };

    mockModelRegistry.findModelByModelId.mockReset().mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockReset().mockResolvedValue(new Map());
    mockOpenaiService.chatCompletionWithMessages.mockReset();
    mockToolRegistry.getToolDefinitions.mockReset().mockResolvedValue([]);
    mockToolExecutor.execute.mockReset();
    mockStreamingService.streamCompletion.mockReset();
    mockAiAuditService.log.mockReset().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        TokenService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: configMock },
        { provide: OpenaiService, useValue: mockOpenaiService },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: ToolExecutorService, useValue: mockToolExecutor },
        { provide: StreamingService, useValue: mockStreamingService },
        { provide: AiAuditService, useValue: mockAiAuditService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();
  });

  describe('createConversation()', () => {
    it('defaults model to openai.defaultModel config when omitted', async () => {
      configMock.get.mockReturnValue('meta-llama/llama-3.3-70b-instruct:free');
      dbMock.chatConversation.create.mockResolvedValue(
        makeConversation({ model: 'meta-llama/llama-3.3-70b-instruct:free' }),
      );

      await service.createConversation({});

      expect(dbMock.chatConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ model: 'meta-llama/llama-3.3-70b-instruct:free' }),
        }),
      );
    });

    it('defaults toolsEnabled to false and leaves title null when omitted', async () => {
      configMock.get.mockReturnValue('gpt-4o');
      dbMock.chatConversation.create.mockResolvedValue(makeConversation());

      await service.createConversation({});

      expect(dbMock.chatConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ toolsEnabled: false, title: undefined }),
        }),
      );
    });

    it('uses the provided model instead of the config default', async () => {
      dbMock.chatConversation.create.mockResolvedValue(makeConversation({ model: 'gpt-4o-mini' }));

      await service.createConversation({ model: 'gpt-4o-mini' });

      expect(dbMock.chatConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ model: 'gpt-4o-mini' }) }),
      );
      expect(configMock.get).not.toHaveBeenCalled();
    });
  });

  describe('findAllConversations()', () => {
    it('caps limit at 100', async () => {
      dbMock.chatConversation.findMany.mockResolvedValue([]);
      dbMock.chatConversation.count.mockResolvedValue(0);

      await service.findAllConversations({ limit: 500 });

      expect(dbMock.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('filters by userId and isArchived', async () => {
      dbMock.chatConversation.findMany.mockResolvedValue([]);
      dbMock.chatConversation.count.mockResolvedValue(0);

      await service.findAllConversations({ userId: 'user-1', isArchived: true });

      expect(dbMock.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isArchived: true },
        }),
      );
    });

    it('orders by updatedAt desc and returns pagination metadata', async () => {
      dbMock.chatConversation.findMany.mockResolvedValue([makeConversation()]);
      dbMock.chatConversation.count.mockResolvedValue(1);

      const result = await service.findAllConversations({ page: 2, limit: 10 });

      expect(dbMock.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { updatedAt: 'desc' }, skip: 10, take: 10 }),
      );
      expect(result).toEqual({ data: expect.any(Array), total: 1, page: 2, limit: 10 });
    });
  });

  describe('findConversation()', () => {
    it('returns messages: [] for a conversation with no messages, without throwing', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue({
        ...makeConversation(),
        messages: [],
      } as never);

      const result = await service.findConversation('conversation-pub-1');

      expect(result.messages).toEqual([]);
    });

    it('returns messages ordered as fetched', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue({
        ...makeConversation(),
        messages: [makeMessage()],
      } as never);

      const result = await service.findConversation('conversation-pub-1');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].publicId).toBe('message-pub-1');
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.findConversation('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getConversationHandle()', () => {
    it('resolves the internal row id and configured model from a publicId', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(
        makeConversation({ id: BigInt(42), model: 'gpt-4o-mini' }),
      );

      const result = await service.getConversationHandle('conversation-pub-1');

      expect(result).toEqual({ id: BigInt(42), model: 'gpt-4o-mini' });
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.getConversationHandle('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateConversation()', () => {
    it('updates title/systemPrompt/model', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation());
      dbMock.chatConversation.update.mockResolvedValue(makeConversation({ title: 'Renamed' }));

      await service.updateConversation('conversation-pub-1', { title: 'Renamed' });

      expect(dbMock.chatConversation.update).toHaveBeenCalledWith({
        where: { publicId: 'conversation-pub-1' },
        data: { title: 'Renamed', systemPrompt: undefined, model: undefined },
      });
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.updateConversation('missing', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('archiveConversation()', () => {
    it('sets isArchived to true without deleting', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation());

      await service.archiveConversation('conversation-pub-1');

      expect(dbMock.chatConversation.update).toHaveBeenCalledWith({
        where: { publicId: 'conversation-pub-1' },
        data: { isArchived: true },
      });
      expect(dbMock.chatConversation.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.archiveConversation('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteConversation()', () => {
    // Proves the service issues the delete against the right conversation. The actual
    // cascade-to-chat_messages behavior lives in Postgres (onDelete: Cascade, AI-015's migration
    // SQL) and can't be observed through a DeepMockProxy<DatabaseService> — asserting it for real
    // would require an integration test against a live Postgres instance, which this codebase's
    // unit-test suite doesn't run (see CLAUDE.md's Jest/ESM note on why DatabaseService is always
    // mocked here). The migration SQL was verified directly in AI-015 to include
    // `ON DELETE CASCADE` on the chat_messages.conversationId foreign key.
    it('deletes the conversation by publicId', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation());

      await service.deleteConversation('conversation-pub-1');

      expect(dbMock.chatConversation.delete).toHaveBeenCalledWith({
        where: { publicId: 'conversation-pub-1' },
      });
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.deleteConversation('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(dbMock.chatConversation.delete).not.toHaveBeenCalled();
    });
  });

  describe('addUserMessage()', () => {
    it('inserts a role: user message', async () => {
      configMock.get.mockReturnValue(true);
      dbMock.chatMessage.create.mockResolvedValue(makeMessage({ content: 'hi there' }));
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation({ title: 'Existing' }));

      await service.addUserMessage(BigInt(1), 'hi there');

      expect(dbMock.chatMessage.create).toHaveBeenCalledWith({
        data: { conversationId: BigInt(1), role: 'user', content: 'hi there' },
      });
    });

    it('sets the title from the first 50 chars + "..." when the conversation has no title', async () => {
      configMock.get.mockReturnValue(true);
      dbMock.chatMessage.create.mockResolvedValue(makeMessage());
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation({ title: null }));

      const longContent = 'a'.repeat(80);
      await service.addUserMessage(BigInt(1), longContent);

      expect(dbMock.chatConversation.update).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        data: { title: `${'a'.repeat(50)}...` },
      });
    });

    it('does not overwrite an already-set title', async () => {
      configMock.get.mockReturnValue(true);
      dbMock.chatMessage.create.mockResolvedValue(makeMessage());
      dbMock.chatConversation.findUnique.mockResolvedValue(makeConversation({ title: 'Existing' }));

      await service.addUserMessage(BigInt(1), 'second message');

      expect(dbMock.chatConversation.update).not.toHaveBeenCalled();
    });

    it('does not auto-title when chatConfig.autoTitle is false', async () => {
      configMock.get.mockReturnValue(false);
      dbMock.chatMessage.create.mockResolvedValue(makeMessage());

      await service.addUserMessage(BigInt(1), 'hello');

      expect(dbMock.chatConversation.findUnique).not.toHaveBeenCalled();
      expect(dbMock.chatConversation.update).not.toHaveBeenCalled();
    });
  });

  describe('addAssistantMessage()', () => {
    it('inserts a role: assistant message with tokenCount/cost/latencyMs/model', async () => {
      dbMock.chatMessage.create.mockResolvedValue(
        makeMessage({ role: 'assistant', tokenCount: 42, cost: 0.01, latencyMs: 500 }),
      );

      await service.addAssistantMessage(BigInt(1), {
        content: 'the answer',
        tokenCount: 42,
        cost: 0.01,
        latencyMs: 500,
        model: 'gpt-4o',
      });

      expect(dbMock.chatMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: BigInt(1),
          role: 'assistant',
          content: 'the answer',
          toolCalls: undefined,
          tokenCount: 42,
          cost: 0.01,
          latencyMs: 500,
          model: 'gpt-4o',
          metadata: undefined,
        },
      });
    });

    it('stores { incomplete: true } in metadata when incomplete is set', async () => {
      dbMock.chatMessage.create.mockResolvedValue(makeMessage({ role: 'assistant' }));

      await service.addAssistantMessage(BigInt(1), { content: 'partial', incomplete: true });

      expect(dbMock.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: { incomplete: true } }),
        }),
      );
    });
  });

  describe('addToolResult()', () => {
    it('inserts a role: tool message with toolCallId/toolName and serialized content', async () => {
      dbMock.chatMessage.create.mockResolvedValue(
        makeMessage({ role: 'tool', toolCallId: 'call-1', toolName: 'calculator' }),
      );

      await service.addToolResult(BigInt(1), 'call-1', 'calculator', { result: 42 });

      expect(dbMock.chatMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: BigInt(1),
          role: 'tool',
          content: JSON.stringify({ result: 42 }),
          toolCallId: 'call-1',
          toolName: 'calculator',
        },
      });
    });
  });

  describe('sendMessage()', () => {
    // autoTitle defaults false here — sendMessage()'s own ordering guarantees are the behavior
    // under test, not addUserMessage()'s auto-title side effect (already covered above).
    function mockChatConfig(
      overrides: Partial<{
        autoTitle: boolean;
        maxContextMessages: number;
        contextWindowPercentage: number;
        defaultContextWindow: number;
      }> = {},
    ) {
      const merged = {
        autoTitle: false,
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
        ...overrides,
      };
      configMock.get.mockImplementation((key: string) => {
        if (key === 'chat.autoTitle') return merged.autoTitle;
        if (key === 'chat.maxContextMessages') return merged.maxContextMessages;
        if (key === 'chat.contextWindowPercentage') return merged.contextWindowPercentage;
        if (key === 'chat.defaultContextWindow') return merged.defaultContextWindow;
        return undefined;
      });
    }

    function mockConversationWithNoMessages(overrides: Partial<ChatConversation> = {}) {
      dbMock.chatConversation.findUnique.mockResolvedValue({
        ...makeConversation(overrides),
        messages: [],
      } as never);
    }

    function mockMessageCreates() {
      dbMock.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: 'user', content: 'hi' }))
        .mockResolvedValueOnce(
          makeMessage({
            id: BigInt(2),
            publicId: 'message-pub-2',
            role: 'assistant',
            content: 'the answer',
          }),
        );
    }

    it('persists the user message, builds context, calls the model, then persists the assistant message, in that exact order', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

      await service.sendMessage('conversation-pub-1', { content: 'hi' });

      const [userCallOrder, assistantCallOrder] =
        dbMock.chatMessage.create.mock.invocationCallOrder;
      const [modelCallOrder] =
        mockOpenaiService.chatCompletionWithMessages.mock.invocationCallOrder;

      expect(userCallOrder).toBeLessThan(modelCallOrder);
      expect(modelCallOrder).toBeLessThan(assistantCallOrder);
    });

    it('rejects whitespace-only content before any DB write or model call', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();

      await expect(
        service.sendMessage('conversation-pub-1', { content: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
      expect(mockOpenaiService.chatCompletionWithMessages).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown conversationPublicId', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.sendMessage('missing', { content: 'hi' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    });

    it('applies dto model/temperature/maxTokens overrides to the model call only, without persisting them onto the conversation', async () => {
      mockChatConfig();
      mockConversationWithNoMessages({ model: 'gpt-4o' });
      mockMessageCreates();
      mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

      await service.sendMessage('conversation-pub-1', {
        content: 'hi',
        model: OpenAIModel.GPT_4O_MINI,
        temperature: 0.2,
        maxTokens: 100,
      });

      expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          model: OpenAIModel.GPT_4O_MINI,
          temperature: 0.2,
          maxTokens: 100,
        }),
      );
      expect(dbMock.chatConversation.update).not.toHaveBeenCalled();
    });

    it('falls back to the conversation default model when dto.model is omitted', async () => {
      mockChatConfig();
      mockConversationWithNoMessages({ model: 'gpt-4o-mini' });
      mockMessageCreates();
      mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

      await service.sendMessage('conversation-pub-1', { content: 'hi' });

      expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o-mini' }),
      );
    });

    it('returns a response shaped with messageId, content, model, usage, estimatedCost, and latencyMs', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

      const result = await service.sendMessage('conversation-pub-1', { content: 'hi' });

      expect(result).toEqual({
        messageId: 'message-pub-2',
        role: 'assistant',
        content: 'the answer',
        model: 'gpt-4o',
        toolCalls: undefined,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        estimatedCost: 0.01,
        latencyMs: 250,
      });
    });

    describe('tool-calling flow (toolsEnabled)', () => {
      it('runs the two-call protocol: tool-decision call, tool execution, tool-result persisted, synthesis call', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        mockToolRegistry.getToolDefinitions.mockResolvedValue([
          {
            type: 'function',
            function: { name: 'calculator', description: '...', parameters: {} },
          },
        ]);
        dbMock.chatMessage.create
          .mockResolvedValueOnce(makeMessage({ role: 'user' }))
          .mockResolvedValueOnce(makeMessage({ role: 'assistant', content: null }))
          .mockResolvedValueOnce(
            makeMessage({ role: 'tool', toolCallId: 'call_1', toolName: 'calculator' }),
          )
          .mockResolvedValueOnce(
            makeMessage({
              id: BigInt(5),
              publicId: 'message-pub-5',
              role: 'assistant',
              content: '234 × 567 = 132,678',
            }),
          );

        const toolCall = makeToolCall({
          id: 'call_1',
          name: 'calculator',
          arguments: JSON.stringify({ expression: '234 * 567' }),
        });
        mockOpenaiService.chatCompletionWithMessages
          .mockResolvedValueOnce(makeCompletionResult({ content: '', toolCalls: [toolCall] }))
          .mockResolvedValueOnce(makeCompletionResult({ content: '234 × 567 = 132,678' }));
        mockToolExecutor.execute.mockResolvedValue({
          success: true,
          result: { result: 132678 },
          executionMs: 5,
        });

        const result = await service.sendMessage('conversation-pub-1', {
          content: 'What is 234 times 567?',
        });

        expect(mockToolExecutor.execute).toHaveBeenCalledWith('calculator', {
          expression: '234 * 567',
        });
        expect(dbMock.chatMessage.create).toHaveBeenCalledTimes(4);
        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('234 × 567 = 132,678');
      });

      it('executes multiple tool calls concurrently, not sequentially', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        mockToolRegistry.getToolDefinitions.mockResolvedValue([
          { type: 'function', function: { name: 'weather', description: '', parameters: {} } },
        ]);
        dbMock.chatMessage.create.mockResolvedValue(makeMessage());

        const toolCalls = [
          makeToolCall({ id: 'call_1', name: 'weather', arguments: '{"city":"London"}' }),
          makeToolCall({ id: 'call_2', name: 'datetime', arguments: '{"timezone":"UTC"}' }),
        ];
        mockOpenaiService.chatCompletionWithMessages
          .mockResolvedValueOnce(makeCompletionResult({ content: '', toolCalls }))
          .mockResolvedValueOnce(makeCompletionResult({ content: 'done' }));

        const DELAY_MS = 50;
        mockToolExecutor.execute.mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ success: true, result: {}, executionMs: DELAY_MS }),
                DELAY_MS,
              ),
            ),
        );

        const start = Date.now();
        await service.sendMessage('conversation-pub-1', { content: 'weather and time?' });
        const elapsed = Date.now() - start;

        expect(mockToolExecutor.execute).toHaveBeenCalledTimes(2);
        expect(elapsed).toBeLessThan(DELAY_MS * 1.8);
      });

      it('persists a tool-error result and still reaches the synthesis call for an invalid tool', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        mockToolRegistry.getToolDefinitions.mockResolvedValue([
          { type: 'function', function: { name: 'calculator', description: '', parameters: {} } },
        ]);
        dbMock.chatMessage.create.mockResolvedValue(makeMessage());

        const toolCall = makeToolCall({ id: 'call_1', name: 'not-a-tool', arguments: '{}' });
        mockOpenaiService.chatCompletionWithMessages
          .mockResolvedValueOnce(makeCompletionResult({ content: '', toolCalls: [toolCall] }))
          .mockResolvedValueOnce(
            makeCompletionResult({ content: "I wasn't able to use that tool." }),
          );
        mockToolExecutor.execute.mockResolvedValue({
          success: false,
          result: null,
          error: "Tool 'not-a-tool' is not available",
          executionMs: 1,
        });

        await service.sendMessage('conversation-pub-1', { content: 'use a fake tool' });

        expect(dbMock.chatMessage.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              role: 'tool',
              content: expect.stringContaining("Tool 'not-a-tool' is not available"),
            }),
          }),
        );
        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledTimes(2);
      });

      it('passes tool definitions on the first call and omits them on the synthesis call', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        const definitions = [
          { type: 'function', function: { name: 'calculator', description: '', parameters: {} } },
        ];
        mockToolRegistry.getToolDefinitions.mockResolvedValue(definitions);
        dbMock.chatMessage.create.mockResolvedValue(makeMessage());

        const toolCall = makeToolCall();
        mockOpenaiService.chatCompletionWithMessages
          .mockResolvedValueOnce(makeCompletionResult({ content: '', toolCalls: [toolCall] }))
          .mockResolvedValueOnce(makeCompletionResult({ content: 'done' }));
        mockToolExecutor.execute.mockResolvedValue({ success: true, result: {}, executionMs: 1 });

        await service.sendMessage('conversation-pub-1', { content: 'hi' });

        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ tools: definitions }),
        );
        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ tools: undefined }),
        );
      });

      it('passes tools: undefined when toolsEnabled is true but no active tools are registered', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        mockToolRegistry.getToolDefinitions.mockResolvedValue([]);
        mockMessageCreates();
        mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

        await service.sendMessage('conversation-pub-1', { content: 'hi' });

        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledWith(
          expect.objectContaining({ tools: undefined }),
        );
      });

      it('falls back to empty args when the model returns malformed tool-call arguments JSON', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: true });
        mockToolRegistry.getToolDefinitions.mockResolvedValue([
          { type: 'function', function: { name: 'calculator', description: '', parameters: {} } },
        ]);
        dbMock.chatMessage.create.mockResolvedValue(makeMessage());
        const toolCall = makeToolCall({ arguments: 'not-json{' });
        mockOpenaiService.chatCompletionWithMessages
          .mockResolvedValueOnce(makeCompletionResult({ content: '', toolCalls: [toolCall] }))
          .mockResolvedValueOnce(makeCompletionResult({ content: 'done' }));
        mockToolExecutor.execute.mockResolvedValue({
          success: false,
          result: null,
          error: 'expression is required',
          executionMs: 1,
        });

        await service.sendMessage('conversation-pub-1', { content: 'hi' });

        expect(mockToolExecutor.execute).toHaveBeenCalledWith('calculator', {});
      });
    });

    describe('tools-disabled conversation (unaffected)', () => {
      it('never calls the tool registry or executor when toolsEnabled is false', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: false });
        mockMessageCreates();
        mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(makeCompletionResult());

        await service.sendMessage('conversation-pub-1', { content: 'hi' });

        expect(mockToolRegistry.getToolDefinitions).not.toHaveBeenCalled();
        expect(mockToolExecutor.execute).not.toHaveBeenCalled();
        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledTimes(1);
      });

      it('ignores toolCalls on the response when toolsEnabled is false (defensive guard)', async () => {
        mockChatConfig();
        mockConversationWithNoMessages({ toolsEnabled: false });
        mockMessageCreates();
        const toolCall = makeToolCall();
        mockOpenaiService.chatCompletionWithMessages.mockResolvedValue(
          makeCompletionResult({ toolCalls: [toolCall] }),
        );

        await service.sendMessage('conversation-pub-1', { content: 'hi' });

        expect(mockToolExecutor.execute).not.toHaveBeenCalled();
        expect(mockOpenaiService.chatCompletionWithMessages).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('sendMessageStream()', () => {
    // autoTitle defaults false here for the same reason as sendMessage()'s block above.
    function mockChatConfig(
      overrides: Partial<{
        autoTitle: boolean;
        maxContextMessages: number;
        contextWindowPercentage: number;
        defaultContextWindow: number;
      }> = {},
    ) {
      const merged = {
        autoTitle: false,
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
        ...overrides,
      };
      configMock.get.mockImplementation((key: string) => {
        if (key === 'chat.autoTitle') return merged.autoTitle;
        if (key === 'chat.maxContextMessages') return merged.maxContextMessages;
        if (key === 'chat.contextWindowPercentage') return merged.contextWindowPercentage;
        if (key === 'chat.defaultContextWindow') return merged.defaultContextWindow;
        return undefined;
      });
    }

    function mockConversationWithNoMessages(overrides: Partial<ChatConversation> = {}) {
      dbMock.chatConversation.findUnique.mockResolvedValue({
        ...makeConversation(overrides),
        messages: [],
      } as never);
    }

    function mockMessageCreates() {
      dbMock.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: 'user', content: 'hi' }))
        .mockResolvedValueOnce(
          makeMessage({
            id: BigInt(2),
            publicId: 'message-pub-2',
            role: 'assistant',
            content: 'the answer',
          }),
        );
    }

    async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
      const events: StreamEvent[] = [];
      for await (const event of gen) {
        events.push(event);
      }
      return events;
    }

    it('re-yields every event from StreamingService and persists a full assistant message with incomplete: false on normal completion', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockStreamingService.streamCompletion.mockReturnValue(
        toAsyncGenerator<StreamEvent>([
          { type: StreamEventType.TOKEN, data: 'Hello' },
          { type: StreamEventType.TOKEN, data: ', world!' },
        ]),
      );

      const controller = new AbortController();
      const events = await drain(
        service.sendMessageStream('conversation-pub-1', { content: 'hi' }, controller.signal),
      );

      expect(events.slice(0, 2)).toEqual([
        { type: StreamEventType.TOKEN, data: 'Hello' },
        { type: StreamEventType.TOKEN, data: ', world!' },
      ]);
      expect(dbMock.chatMessage.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'Hello, world!',
            metadata: undefined,
          }),
        }),
      );
    });

    it('yields a final done event with messageId/usage/estimatedCost/latencyMs on normal completion', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockStreamingService.streamCompletion.mockReturnValue(
        toAsyncGenerator<StreamEvent>([{ type: StreamEventType.TOKEN, data: 'hi there' }]),
      );

      const controller = new AbortController();
      const events = await drain(
        service.sendMessageStream('conversation-pub-1', { content: 'hi' }, controller.signal),
      );

      const doneEvent = events.at(-1);
      expect(doneEvent?.type).toBe(StreamEventType.DONE);
      const data = doneEvent?.data as {
        messageId: string;
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        estimatedCost: number;
        latencyMs: number;
      };
      expect(data.messageId).toBe('message-pub-2');
      expect(typeof data.usage.totalTokens).toBe('number');
      expect(typeof data.estimatedCost).toBe('number');
      expect(typeof data.latencyMs).toBe('number');
    });

    it('persists exactly the accumulated content up to an abort, with incomplete: true and no done event', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      const controller = new AbortController();
      // Simulates the SSE controller (AI-033) calling controller.abort() on client disconnect —
      // StreamingService (AI-028) would then stop yielding; here the mock stops after 2 tokens
      // and marks the same signal aborted, exactly as the real generator would leave it.
      mockStreamingService.streamCompletion.mockImplementation(() =>
        // eslint-disable-next-line @typescript-eslint/require-await -- must match AsyncGenerator shape
        (async function* () {
          yield { type: StreamEventType.TOKEN, data: 'partial ' } satisfies StreamEvent;
          yield { type: StreamEventType.TOKEN, data: 'content' } satisfies StreamEvent;
          controller.abort();
        })(),
      );

      const events = await drain(
        service.sendMessageStream('conversation-pub-1', { content: 'hi' }, controller.signal),
      );

      expect(events.some((e) => e.type === StreamEventType.DONE)).toBe(false);
      expect(dbMock.chatMessage.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'partial content',
            metadata: { incomplete: true },
          }),
        }),
      );
      expect(mockAiAuditService.log).toHaveBeenCalledTimes(1);
      expect(mockAiAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ status: AiAuditStatus.FAILED }),
      );
    });

    it('treats a mid-stream error event the same as an abort: partial save, incomplete: true, audit FAILED', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockStreamingService.streamCompletion.mockReturnValue(
        toAsyncGenerator<StreamEvent>([
          { type: StreamEventType.TOKEN, data: 'partial' },
          { type: StreamEventType.ERROR, data: { error: 'upstream API failure' } },
        ]),
      );

      const controller = new AbortController();
      const events = await drain(
        service.sendMessageStream('conversation-pub-1', { content: 'hi' }, controller.signal),
      );

      expect(events).toContainEqual({
        type: StreamEventType.ERROR,
        data: { error: 'upstream API failure' },
      });
      expect(events.some((e) => e.type === StreamEventType.DONE)).toBe(false);
      expect(dbMock.chatMessage.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'partial',
            metadata: { incomplete: true },
          }),
        }),
      );
      expect(mockAiAuditService.log).toHaveBeenCalledTimes(1);
      expect(mockAiAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AiAuditStatus.FAILED,
          errorMessage: 'upstream API failure',
        }),
      );
    });

    it('logs exactly one audit entry with status SUCCESS on normal completion', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      mockMessageCreates();
      mockStreamingService.streamCompletion.mockReturnValue(
        toAsyncGenerator<StreamEvent>([{ type: StreamEventType.TOKEN, data: 'ok' }]),
      );

      const controller = new AbortController();
      await drain(
        service.sendMessageStream('conversation-pub-1', { content: 'hi' }, controller.signal),
      );

      expect(mockAiAuditService.log).toHaveBeenCalledTimes(1);
      expect(mockAiAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ status: AiAuditStatus.SUCCESS }),
      );
    });

    it('rejects whitespace-only content before any DB write or StreamingService call', async () => {
      mockChatConfig();
      mockConversationWithNoMessages();
      const controller = new AbortController();

      await expect(
        drain(
          service.sendMessageStream('conversation-pub-1', { content: '   ' }, controller.signal),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
      expect(mockStreamingService.streamCompletion).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown conversationPublicId', async () => {
      dbMock.chatConversation.findUnique.mockResolvedValue(null);
      const controller = new AbortController();

      await expect(
        drain(service.sendMessageStream('missing', { content: 'hi' }, controller.signal)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dbMock.chatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('buildContext()', () => {
    function mockConfig(overrides: {
      maxContextMessages?: number;
      contextWindowPercentage?: number;
      defaultContextWindow?: number;
    }) {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'chat.maxContextMessages') return overrides.maxContextMessages;
        if (key === 'chat.contextWindowPercentage') return overrides.contextWindowPercentage;
        if (key === 'chat.defaultContextWindow') return overrides.defaultContextWindow;
        return undefined;
      });
    }

    // dbMock is a plain jest mock — it returns exactly what mockResolvedValue is given, ignoring
    // the service's actual `orderBy: { createdAt: 'desc' }` query arg. Since buildContext() then
    // reverses the array to get oldest-first order, the fixture must be supplied newest-first
    // (as real Prisma would return it) so the round-trip lands back at the intended chronological
    // order — pass `messages` oldest-first here; this helper reverses it for the mock.
    function conversationWithMessages(
      conversationOverrides: Partial<ChatConversation>,
      messagesOldestFirst: ChatMessage[],
    ) {
      return {
        ...makeConversation(conversationOverrides),
        messages: [...messagesOldestFirst].reverse(),
      };
    }

    it('always includes the system prompt as the first entry when the conversation has one', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: 'You are helpful.' }, [
          makeMessage({ role: 'user', content: 'hi' }),
        ]),
      );

      const context = await service.buildContext(BigInt(1));

      expect(context[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    });

    it('omits the system entry entirely when the conversation has no systemPrompt', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: null }, [makeMessage({ content: 'hi' })]),
      );

      const context = await service.buildContext(BigInt(1));

      expect(context.some((m) => m.role === 'system')).toBe(false);
    });

    it('drops the oldest non-system messages when the token budget is exceeded, keeping the system prompt', async () => {
      // A tiny context window forces trimming well before all 60 messages fit.
      mockConfig({ maxContextMessages: 60, contextWindowPercentage: 1, defaultContextWindow: 200 });

      const messages = Array.from({ length: 60 }, (_, i) =>
        makeMessage({
          id: BigInt(i + 1),
          publicId: `message-pub-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message number ${i} with extra padding text to consume more tokens per entry`,
        }),
      );
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: 'System instructions.' }, messages),
      );

      const context = await service.buildContext(BigInt(1));
      const serialized = JSON.stringify(context);

      expect(context[0]).toEqual({ role: 'system', content: 'System instructions.' });
      expect(context.length).toBeLessThan(61);
      expect(serialized).not.toContain('message number 0 ');
      expect(serialized).toContain('message number 59');
    });

    it('never builds a context whose total tokens exceed contextWindow * contextWindowPercentage', async () => {
      mockConfig({
        maxContextMessages: 60,
        contextWindowPercentage: 0.5,
        defaultContextWindow: 100,
      });

      const messages = Array.from({ length: 60 }, (_, i) =>
        makeMessage({
          id: BigInt(i + 1),
          publicId: `message-pub-${i}`,
          role: 'user',
          content: `msg ${i} padding padding padding padding`,
        }),
      );
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: null }, messages),
      );

      const context = await service.buildContext(BigInt(1));
      const tokenService = new TokenService(mockLogger as never, mockModelRegistry as never);
      const totalTokens = context.reduce(
        (sum, m) => sum + tokenService.countTokens(typeof m.content === 'string' ? m.content : ''),
        0,
      );

      expect(totalTokens).toBeLessThanOrEqual(100 * 0.5);
    });

    it('truncates a single message that alone exceeds the entire budget, rather than dropping it', async () => {
      mockConfig({ maxContextMessages: 50, contextWindowPercentage: 1, defaultContextWindow: 20 });

      const hugeContent = 'word '.repeat(500);
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: null }, [makeMessage({ content: hugeContent })]),
      );

      const context = await service.buildContext(BigInt(1));

      expect(context).toHaveLength(1);
      const [only] = context;
      expect(only.content).not.toBe(hugeContent);
      expect((only.content as string).length).toBeLessThan(hugeContent.length);
    });

    it('uses the model registry contextWindow when the model is found', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });
      mockModelRegistry.findModelByModelId.mockResolvedValue({ contextWindow: 500 });
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ model: 'gpt-4o-mini' }, [makeMessage({ content: 'hi' })]),
      );

      await service.buildContext(BigInt(1));

      expect(mockModelRegistry.findModelByModelId).toHaveBeenCalledWith('gpt-4o-mini');
    });

    it('maps a role: tool message to tool_call_id and an assistant message to tool_calls', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });
      const toolCalls = [
        { id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{}' } },
      ];
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: null }, [
          makeMessage({ role: 'assistant', content: null, toolCalls }),
          makeMessage({
            role: 'tool',
            content: '42',
            toolCallId: 'call_1',
            toolName: 'calculator',
          }),
        ]),
      );

      const context = await service.buildContext(BigInt(1));

      expect(context[0]).toMatchObject({ role: 'assistant', tool_calls: toolCalls });
      expect(context[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });
      dbMock.chatConversation.findUnique.mockResolvedValue(null);

      await expect(service.buildContext(BigInt(999))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('completes well within a generous time budget for a 50-message conversation (NFR-CH-002 targets <100ms)', async () => {
      mockConfig({
        maxContextMessages: 50,
        contextWindowPercentage: 0.8,
        defaultContextWindow: 128000,
      });

      const messages = Array.from({ length: 50 }, (_, i) =>
        makeMessage({ id: BigInt(i + 1), publicId: `message-pub-${i}`, content: `message ${i}` }),
      );
      dbMock.chatConversation.findUnique.mockResolvedValue(
        conversationWithMessages({ systemPrompt: 'sys' }, messages),
      );

      // encoding_for_model() pays a one-time ~100ms+ WASM rank-table load the first time a given
      // model is encoded in this process; TokenService now caches the encoder per model
      // (see token.service.ts) so every call after the first is sub-millisecond. Warm the cache
      // with an unrelated call before timing, matching how a long-running server actually
      // behaves — the NFR targets steady-state performance, not one-time process startup cost.
      service['tokenService'].countTokens('warm up the encoder cache', 'gpt-4o');

      const start = Date.now();
      await service.buildContext(BigInt(1));
      const elapsed = Date.now() - start;

      // NFR-CH-002's actual target is <100ms; relaxed here to avoid CI flakiness.
      expect(elapsed).toBeLessThan(500);
    });
  });
});
