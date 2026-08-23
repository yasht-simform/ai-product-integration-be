import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { ChatController } from '../chat.controller';
import { StreamEventType } from '../constants/stream-event-type.enum';
import { ToolHandlerType } from '../constants/tool-handler-type.enum';
import type {
  AssistantMessageResDto,
  CreateConversationDto,
  CreateToolDto,
  SendMessageDto,
  UpdateConversationDto,
  UpdateToolDto,
} from '../dto';
import { ChatService } from '../services/chat.service';
import { ToolRegistryService } from '../services/tool-registry.service';
import type {
  ChatMessageEntity,
  ConversationEntity,
  ConversationWithMessages,
  StreamEvent,
  ToolEntity,
} from '../types/ai-chat.types';
import { formatSseFrame } from '../utils/sse-frame.util';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url) —
// ChatController imports ChatService/ToolRegistryService, both of which import DatabaseService.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

function makeConversationEntity(overrides: Partial<ConversationEntity> = {}): ConversationEntity {
  return {
    publicId: 'conv-pub-1',
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

function makeMessageEntity(overrides: Partial<ChatMessageEntity> = {}): ChatMessageEntity {
  return {
    publicId: 'msg-pub-1',
    conversationId: BigInt(1),
    role: 'user',
    content: 'hi',
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

function makeToolEntity(overrides: Partial<ToolEntity> = {}): ToolEntity {
  return {
    publicId: 'tool-pub-1',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate a mathematical expression',
    parameters: { type: 'object', properties: {} },
    handlerType: ToolHandlerType.BUILTIN,
    handlerConfig: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- must match AsyncGenerator shape
async function* toAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

interface FakeResponse {
  writeHead: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  on: jest.Mock;
  emitClose: () => void;
}

function makeFakeResponse(): FakeResponse {
  const listeners: Record<string, () => void> = {};
  return {
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    emitClose: () => listeners['close']?.(),
  };
}

describe('ChatController', () => {
  let controller: ChatController;
  let chatServiceMock: {
    createConversation: jest.Mock;
    findAllConversations: jest.Mock;
    findConversation: jest.Mock;
    updateConversation: jest.Mock;
    archiveConversation: jest.Mock;
    deleteConversation: jest.Mock;
    sendMessage: jest.Mock;
    sendMessageStream: jest.Mock;
  };
  let toolRegistryMock: {
    findAllTools: jest.Mock;
    createTool: jest.Mock;
    updateTool: jest.Mock;
    deleteTool: jest.Mock;
  };

  beforeEach(async () => {
    chatServiceMock = {
      createConversation: jest.fn(),
      findAllConversations: jest.fn(),
      findConversation: jest.fn(),
      updateConversation: jest.fn(),
      archiveConversation: jest.fn(),
      deleteConversation: jest.fn(),
      sendMessage: jest.fn(),
      sendMessageStream: jest.fn(),
    };
    toolRegistryMock = {
      findAllTools: jest.fn(),
      createTool: jest.fn(),
      updateTool: jest.fn(),
      deleteTool: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatServiceMock },
        { provide: ToolRegistryService, useValue: toolRegistryMock },
      ],
    })
      // ChatController's message routes carry @UseGuards(ModerationGuard, CostBudgetGuard)/
      // @UseInterceptors(OutputModerationInterceptor) (AI-063/AI-066) — Nest registers classes
      // referenced by these decorators as injectables of the enclosing module at compile() time,
      // even though this spec never exercises the real HTTP guard/interceptor pipeline. Override
      // all three with pass-through stubs so this remains a pure delegation test.
      .overrideGuard(ModerationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CostBudgetGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(OutputModerationInterceptor)
      .useValue({
        intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle(),
      })
      .compile();

    controller = module.get<ChatController>(ChatController);
  });

  // ── Conversations ────────────────────────────────────────────────────────────

  describe('createConversation()', () => {
    it('delegates to ChatService.createConversation() and maps null fields to undefined', async () => {
      chatServiceMock.createConversation.mockResolvedValue(makeConversationEntity());
      const dto: CreateConversationDto = { title: 'My chat' };

      const result = await controller.createConversation(dto);

      expect(chatServiceMock.createConversation).toHaveBeenCalledWith(dto);
      expect(result.publicId).toBe('conv-pub-1');
      expect(result.title).toBeUndefined();
      expect(result.systemPrompt).toBeUndefined();
    });
  });

  describe('findAllConversations()', () => {
    it('delegates to ChatService.findAllConversations() and maps every item', async () => {
      chatServiceMock.findAllConversations.mockResolvedValue({
        data: [makeConversationEntity(), makeConversationEntity({ publicId: 'conv-pub-2' })],
        total: 2,
        page: 1,
        limit: 20,
      });
      const query = { page: 1, limit: 20 };

      const result = await controller.findAllConversations(query);

      expect(chatServiceMock.findAllConversations).toHaveBeenCalledWith(query);
      expect(result.total).toBe(2);
      expect(result.data.map((c) => c.publicId)).toEqual(['conv-pub-1', 'conv-pub-2']);
    });
  });

  describe('findConversation()', () => {
    it('delegates to ChatService.findConversation() and maps nested messages', async () => {
      const conversationWithMessages: ConversationWithMessages = {
        ...makeConversationEntity(),
        messages: [makeMessageEntity()],
      };
      chatServiceMock.findConversation.mockResolvedValue(conversationWithMessages);

      const result = await controller.findConversation('conv-pub-1');

      expect(chatServiceMock.findConversation).toHaveBeenCalledWith('conv-pub-1');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('hi');
    });

    it('propagates NotFoundException for a missing conversation', async () => {
      chatServiceMock.findConversation.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.findConversation('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateConversation()', () => {
    it('delegates to ChatService.updateConversation() and returns the mapped result', async () => {
      chatServiceMock.updateConversation.mockResolvedValue(
        makeConversationEntity({ title: 'Renamed' }),
      );
      const dto: UpdateConversationDto = { title: 'Renamed' };

      const result = await controller.updateConversation('conv-pub-1', dto);

      expect(chatServiceMock.updateConversation).toHaveBeenCalledWith('conv-pub-1', dto);
      expect(result.title).toBe('Renamed');
    });

    it('propagates NotFoundException for a missing conversation', async () => {
      chatServiceMock.updateConversation.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.updateConversation('missing', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteConversation()', () => {
    it('delegates to ChatService.deleteConversation() and returns void', async () => {
      chatServiceMock.deleteConversation.mockResolvedValue(undefined);

      await expect(controller.deleteConversation('conv-pub-1')).resolves.toBeUndefined();
      expect(chatServiceMock.deleteConversation).toHaveBeenCalledWith('conv-pub-1');
    });
  });

  describe('archiveConversation()', () => {
    it('delegates to ChatService.archiveConversation() and returns void', async () => {
      chatServiceMock.archiveConversation.mockResolvedValue(undefined);

      await expect(controller.archiveConversation('conv-pub-1')).resolves.toBeUndefined();
      expect(chatServiceMock.archiveConversation).toHaveBeenCalledWith('conv-pub-1');
    });
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  describe('sendMessage()', () => {
    it('delegates to ChatService.sendMessage() and returns the result unmodified', async () => {
      const assistantResponse: AssistantMessageResDto = {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'hi there',
        model: 'gpt-4o',
        toolCalls: undefined,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        estimatedCost: 0,
        latencyMs: 10,
      };
      chatServiceMock.sendMessage.mockResolvedValue(assistantResponse);
      const dto: SendMessageDto = { content: 'hello' };

      const result = await controller.sendMessage('conv-pub-1', dto);

      expect(chatServiceMock.sendMessage).toHaveBeenCalledWith('conv-pub-1', dto);
      expect(result).toBe(assistantResponse);
    });

    it('propagates NotFoundException for a missing conversation', async () => {
      chatServiceMock.sendMessage.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.sendMessage('missing', { content: 'hello' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('sendMessageStream()', () => {
    it('primes the stream, writes SSE headers once ready, and writes one frame per event', async () => {
      const events: StreamEvent[] = [
        { type: StreamEventType.TOKEN, data: 'Hello' },
        {
          type: StreamEventType.DONE,
          data: {
            messageId: 'msg-1',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            estimatedCost: 0,
            latencyMs: 10,
          },
        },
      ];
      chatServiceMock.sendMessageStream.mockReturnValue(toAsyncGenerator(events));
      const response = makeFakeResponse();

      await controller.sendMessageStream(
        'conv-pub-1',
        { content: 'hi' },
        response as unknown as Response,
      );

      expect(response.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/event-stream' }),
      );
      expect(response.write).toHaveBeenCalledTimes(2);
      expect(response.write).toHaveBeenNthCalledWith(1, formatSseFrame(events[0]));
      expect(response.write).toHaveBeenNthCalledWith(2, formatSseFrame(events[1]));
      expect(response.end).toHaveBeenCalled();
    });

    it('propagates a pre-stream validation error without writing to the response', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await, require-yield -- must match AsyncGenerator shape; throws before any yield
      async function* throwingGenerator(): AsyncGenerator<StreamEvent> {
        throw new NotFoundException('Conversation not found');
      }
      chatServiceMock.sendMessageStream.mockReturnValue(throwingGenerator());
      const response = makeFakeResponse();

      await expect(
        controller.sendMessageStream('missing', { content: 'hi' }, response as unknown as Response),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(response.writeHead).not.toHaveBeenCalled();
      expect(response.write).not.toHaveBeenCalled();
    });

    it('aborts the internal AbortController when the response closes', async () => {
      const events: StreamEvent[] = [{ type: StreamEventType.TOKEN, data: 'Hi' }];
      chatServiceMock.sendMessageStream.mockReturnValue(toAsyncGenerator(events));
      const response = makeFakeResponse();

      await controller.sendMessageStream(
        'conv-pub-1',
        { content: 'hi' },
        response as unknown as Response,
      );

      const signal = chatServiceMock.sendMessageStream.mock.calls[0][2] as AbortSignal;
      expect(signal.aborted).toBe(false);

      response.emitClose();

      expect(signal.aborted).toBe(true);
    });

    it('writes an error frame instead of throwing when a failure occurs after headers are sent', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await -- must match AsyncGenerator shape
      async function* midStreamFailureGenerator(): AsyncGenerator<StreamEvent> {
        yield { type: StreamEventType.TOKEN, data: 'Hi' };
        throw new Error('db write failed');
      }
      chatServiceMock.sendMessageStream.mockReturnValue(midStreamFailureGenerator());
      const response = makeFakeResponse();

      await controller.sendMessageStream(
        'conv-pub-1',
        { content: 'hi' },
        response as unknown as Response,
      );

      expect(response.writeHead).toHaveBeenCalled();
      const lastFrame = response.write.mock.calls[
        response.write.mock.calls.length - 1
      ][0] as string;
      expect(lastFrame).toContain('event: error');
      expect(lastFrame).toContain('db write failed');
      expect(response.end).toHaveBeenCalled();
    });
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  describe('findAllTools()', () => {
    it('delegates to ToolRegistryService.findAllTools() and maps every item', async () => {
      toolRegistryMock.findAllTools.mockResolvedValue([makeToolEntity()]);

      const result = await controller.findAllTools();

      expect(toolRegistryMock.findAllTools).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('calculator');
    });
  });

  describe('createTool()', () => {
    it('delegates to ToolRegistryService.createTool()', async () => {
      toolRegistryMock.createTool.mockResolvedValue(makeToolEntity());
      const dto: CreateToolDto = {
        name: 'calculator',
        displayName: 'Calculator',
        description: 'Evaluate a mathematical expression',
        parameters: { type: 'object', properties: {} },
        handlerType: ToolHandlerType.BUILTIN,
      };

      const result = await controller.createTool(dto);

      expect(toolRegistryMock.createTool).toHaveBeenCalledWith(dto);
      expect(result.publicId).toBe('tool-pub-1');
    });
  });

  describe('updateTool()', () => {
    it('delegates to ToolRegistryService.updateTool()', async () => {
      toolRegistryMock.updateTool.mockResolvedValue(makeToolEntity({ displayName: 'Renamed' }));
      const dto: UpdateToolDto = { displayName: 'Renamed' };

      const result = await controller.updateTool('tool-pub-1', dto);

      expect(toolRegistryMock.updateTool).toHaveBeenCalledWith('tool-pub-1', dto);
      expect(result.displayName).toBe('Renamed');
    });

    it('propagates NotFoundException for a missing tool', async () => {
      toolRegistryMock.updateTool.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.updateTool('missing', { displayName: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteTool()', () => {
    it('delegates to ToolRegistryService.deleteTool() and returns void', async () => {
      toolRegistryMock.deleteTool.mockResolvedValue(undefined);

      await expect(controller.deleteTool('tool-pub-1')).resolves.toBeUndefined();
      expect(toolRegistryMock.deleteTool).toHaveBeenCalledWith('tool-pub-1');
    });
  });

  describe('guard order (AI-066)', () => {
    it('runs ModerationGuard before CostBudgetGuard on both message routes', () => {
      const guardsMetadataKey = '__guards__';

      expect(Reflect.getMetadata(guardsMetadataKey, ChatController.prototype.sendMessage)).toEqual([
        ModerationGuard,
        CostBudgetGuard,
      ]);
      expect(
        Reflect.getMetadata(guardsMetadataKey, ChatController.prototype.sendMessageStream),
      ).toEqual([ModerationGuard, CostBudgetGuard]);
    });
  });
});
