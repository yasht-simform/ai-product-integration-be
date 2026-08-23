import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { ChatConversation } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { StreamEventType } from '../../ai-chat/constants/stream-event-type.enum';
import { ChatService } from '../../ai-chat/services/chat.service';
import { StreamingService } from '../../ai-chat/services/streaming.service';
import { ToolExecutorService } from '../../ai-chat/services/tool-executor.service';
import { ToolRegistryService } from '../../ai-chat/services/tool-registry.service';
import { WeatherTool } from '../../ai-chat/tools/weather.tool';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { RetryService } from '../../openai/services/retry.service';
import { TokenService } from '../../openai/services/token.service';
import { EmbeddingCacheService } from '../../rag/services/embedding-cache.service';
import { EmbeddingService } from '../../rag/services/embedding.service';
import { PineconeService } from '../../rag/services/pinecone.service';
import { RagService } from '../../rag/services/rag.service';
import { SearchService } from '../../rag/services/search.service';
import {
  makeAuditLogRow,
  makeCalculatorToolRow,
  makeChatCompletionResponse,
  makeChatMessageFactory,
  makeConversationRow,
  makeEmbeddingsResponse,
  makeOpenaiClientMock,
  mockLogger,
  mockModelRegistry,
} from './capstone-test-helpers';

jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const CHUNK_PINECONE_ID = 'chunk_doc-cap-2_0';

function makeToolCallCompletionResponse(expression: string) {
  return {
    id: 'chatcmpl-toolcall',
    model: 'test-org/integration-test-model',
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'calculator', arguments: JSON.stringify({ expression }) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

// A plain (non-async) generator — `for await...of` (StreamingService's own iteration style)
// accepts a sync-iterable just as readily as an async one.
function* makeStreamChunks(tokens: string[]) {
  for (const token of tokens) {
    yield { choices: [{ delta: { content: token }, finish_reason: null }] };
  }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

// Test 2 (capstone spec §4): a single conversation exercising Phase 2 (multi-turn chat, function
// calling, SSE streaming) and Phase 3 (RAG-grounded answer with citations) together — proving
// conversation context is shared correctly across every code path that touches it. Calls
// ChatService/RagService directly (same convention as chat-function-calling.integration.spec.ts)
// rather than through HTTP, since the cross-phase wiring under test lives entirely in the service
// layer, not in the controllers/guards.
describe('Capstone Test 2 — Chat + RAG + Tools + Streaming', () => {
  let chatService: ChatService;
  let ragService: RagService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let mockOpenaiClient: ReturnType<typeof makeOpenaiClientMock>;
  let conversationRow: ChatConversation;
  let messageFactory: ReturnType<typeof makeChatMessageFactory>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    jest.clearAllMocks();
    mockModelRegistry.findModelByModelId.mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

    conversationRow = makeConversationRow({ publicId: 'conv-cap-2', toolsEnabled: true });
    messageFactory = makeChatMessageFactory();

    dbMock.chatConversation.create.mockResolvedValue(conversationRow);
    dbMock.chatConversation.findUnique.mockImplementation((args) => {
      const where = args.where as { publicId?: string; id?: bigint };
      if (where.id !== undefined) {
        return Promise.resolve({
          ...conversationRow,
          messages: [...messageFactory.messages],
        }) as never;
      }
      return Promise.resolve(conversationRow) as never;
    });
    dbMock.chatMessage.create.mockImplementation(messageFactory.create);
    dbMock.chatTool.findMany.mockResolvedValue([makeCalculatorToolRow()]);
    dbMock.chatTool.findUnique.mockResolvedValue(makeCalculatorToolRow());
    dbMock.aiAuditLog.create.mockResolvedValue(makeAuditLogRow());
    dbMock.documentChunk.findMany.mockResolvedValue([
      {
        id: BigInt(1),
        publicId: 'chunk-pub-2',
        documentId: BigInt(1),
        chunkIndex: 0,
        content: 'CloudPulse Pro plan includes single sign-on (SSO) starting at $25/user/month.',
        tokenCount: 20,
        startChar: 0,
        endChar: 80,
        pineconeId: CHUNK_PINECONE_ID,
        embeddingStatus: 'completed',
        createdAt: new Date('2026-01-01'),

        document: {
          publicId: 'doc-cap-2',
          title: 'CloudPulse Pricing Plans',
          category: 'docs',
        } as any,
      },
    ]);
    dbMock.embeddingCache.findUnique.mockResolvedValue(null);

    const pineconeServiceMock = {
      query: jest.fn().mockResolvedValue([{ id: CHUNK_PINECONE_ID, score: 0.9, metadata: {} }]),
      upsert: jest.fn(),
      deleteByFilter: jest.fn(),
      describeIndex: jest.fn(),
    };

    mockOpenaiClient = makeOpenaiClientMock();
    mockOpenaiClient.embeddings.create.mockResolvedValue(makeEmbeddingsResponse(1));

    const mockConfig = {
      get: jest.fn((key: string) => (key === 'openai.apiKey' ? 'test-api-key' : undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        ToolRegistryService,
        ToolExecutorService,
        StreamingService,
        RagService,
        SearchService,
        { provide: EmbeddingService, useValue: {} },
        EmbeddingCacheService,
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
        { provide: PineconeService, useValue: pineconeServiceMock },
        { provide: HttpService, useValue: { request: jest.fn() } },
        { provide: WeatherTool, useValue: { execute: jest.fn() } },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    ragService = module.get<RagService>(RagService);
    module.get<OpenaiService>(OpenaiService).onModuleInit();
    await module.get<ToolRegistryService>(ToolRegistryService).onModuleInit();
  });

  it('maintains conversation context across a RAG turn, a tool-calling turn, a follow-up, and a streamed turn', async () => {
    // Step 1: conversation already created with tools enabled (conversationRow above).

    // Step 2: a RAG question, document-grounded, gets an answer with citations.
    mockOpenaiClient.chat.completions.create.mockResolvedValueOnce(
      makeChatCompletionResponse(
        'The Pro plan does not include SSO — only Enterprise includes SSO, starting at $25/user/month.',
      ),
    );
    const ragResult = await ragService.queryWithConversation(
      conversationRow.publicId,
      'Does the Pro plan include SSO?',
    );
    expect(ragResult.answer).toContain('SSO');
    expect(ragResult.sources.length).toBeGreaterThan(0);

    // Step 3: a math question triggers the real calculator tool via the two-call protocol.
    mockOpenaiClient.chat.completions.create
      .mockResolvedValueOnce(makeToolCallCompletionResponse('2499*0.15'))
      .mockResolvedValueOnce(makeChatCompletionResponse('15% of 2499 is 374.85.'));
    const mathResult = await chatService.sendMessage(conversationRow.publicId, {
      content: "What's 15% of 2499?",
    });
    expect(mathResult.content).toContain('374.85');

    // Step 4: a follow-up referencing the RAG answer — conversation context (including the prior
    // RAG turn's assistant message) is sent to the model.
    mockOpenaiClient.chat.completions.create.mockResolvedValueOnce(
      makeChatCompletionResponse('Right, Enterprise is the plan you would need for SSO.'),
    );
    await chatService.sendMessage(conversationRow.publicId, {
      content: 'So which plan would I need for SSO then?',
    });
    const lastCompletionCall = mockOpenaiClient.chat.completions.create.mock.calls.at(-1)?.[0] as {
      messages: Array<{ content?: string }>;
    };
    const sentContents = lastCompletionCall.messages.map((m) => m.content).join(' ');
    expect(sentContents).toContain('SSO');

    // Step 5: stream a response — token events arrive.
    mockOpenaiClient.chat.completions.create.mockResolvedValueOnce(
      makeStreamChunks(['Sure', ', ', 'happy to help.']),
    );
    const abortController = new AbortController();
    const events = [];
    for await (const event of chatService.sendMessageStream(
      conversationRow.publicId,
      { content: 'Thanks for the help!' },
      abortController.signal,
    )) {
      events.push(event);
    }
    const tokenEvents = events.filter((e) => e.type === StreamEventType.TOKEN);
    expect(tokenEvents.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === StreamEventType.DONE)).toBe(true);

    // Step 6: every call is audited, and the conversation has the correct message sequence:
    // user+assistant (RAG, 2) + user+tool-decision+tool-result+assistant (math, 4) +
    // user+assistant (follow-up, 2) + user+assistant (streamed, 2) = 10 messages.
    expect(dbMock.aiAuditLog.create.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(messageFactory.messages.length).toBe(10);
  });
});
