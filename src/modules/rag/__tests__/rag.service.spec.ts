import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ChatService } from '../../ai-chat/services/chat.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { RAG_CONFIG } from '../constants/rag-config.constant';
import { RagService } from '../services/rag.service';
import { SearchService } from '../services/search.service';
import type { SearchResult } from '../types/rag.types';

// ChatService imports DatabaseService, which imports the Prisma-generated ESM client
// (import.meta.url) — must be mocked before ChatService's module graph loads under Jest.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkPublicId: 'chunk-pub-1',
    documentPublicId: 'doc-pub-1',
    documentTitle: 'Return Policy',
    content: 'Returns are accepted within 30 days.',
    chunkIndex: 0,
    score: 0.92,
    category: 'docs',
    ...overrides,
  };
}

describe('RagService.query()', () => {
  let service: RagService;
  let searchServiceMock: { search: jest.Mock };
  let openaiServiceMock: { chatCompletionWithMessages: jest.Mock };

  beforeEach(async () => {
    searchServiceMock = { search: jest.fn().mockResolvedValue([]) };
    openaiServiceMock = {
      chatCompletionWithMessages: jest.fn().mockResolvedValue({
        content: 'Returns are accepted within 30 days. [Source: Return Policy]',
        model: 'gpt-4o-mini',
        usage: { inputTokens: 200, outputTokens: 40, totalTokens: 240 },
        estimatedCost: 0.001,
        latencyMs: 500,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: SearchService, useValue: searchServiceMock },
        { provide: OpenaiService, useValue: openaiServiceMock },
        { provide: TokenService, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: ChatService, useValue: {} },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('includes RAG_CONFIG.systemPrompt verbatim as the system message', async () => {
    await service.query('What is the return policy?');

    const [{ messages }] = openaiServiceMock.chatCompletionWithMessages.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    expect(messages[0]).toEqual({ role: 'system', content: RAG_CONFIG.systemPrompt });
  });

  it('builds a context block that includes every retrieved chunk, labeled for citation', async () => {
    searchServiceMock.search.mockResolvedValue([
      makeSearchResult({ documentTitle: 'Return Policy', content: 'chunk one text' }),
      makeSearchResult({ documentTitle: 'Shipping Guide', content: 'chunk two text' }),
    ]);

    await service.query('What is the return policy?');

    const [{ messages }] = openaiServiceMock.chatCompletionWithMessages.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const userMessage = messages[1]?.content ?? '';
    expect(userMessage).toContain('chunk one text');
    expect(userMessage).toContain('chunk two text');
    expect(userMessage).toContain('Return Policy');
    expect(userMessage).toContain('Shipping Guide');
    expect(userMessage).toContain('What is the return policy?');
  });

  it('defaults generation temperature to 0.3', async () => {
    await service.query('question');

    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.3 }),
    );
  });

  it('overrides temperature via options.temperature', async () => {
    await service.query('question', { temperature: 0.7 });

    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7 }),
    );
  });

  it('passes topK/categoryFilter through to SearchService.search()', async () => {
    await service.query('question', { topK: 3, categoryFilter: 'faq' });

    expect(searchServiceMock.search).toHaveBeenCalledWith('question', {
      topK: 3,
      categoryFilter: 'faq',
    });
  });

  it('builds RagResult.sources from SearchService results, not the model output', async () => {
    searchServiceMock.search.mockResolvedValue([
      makeSearchResult({
        chunkPublicId: 'chunk-pub-1',
        documentPublicId: 'doc-pub-1',
        documentTitle: 'Return Policy',
        content: 'Returns accepted within 30 days.',
        chunkIndex: 2,
        score: 0.88,
      }),
    ]);

    const result = await service.query('question');

    expect(result.sources).toEqual([
      {
        documentTitle: 'Return Policy',
        documentPublicId: 'doc-pub-1',
        chunkContent: 'Returns accepted within 30 days.',
        chunkIndex: 2,
        similarityScore: 0.88,
      },
    ]);
    expect(result.chunksRetrieved).toBe(1);
  });

  it('still calls the model and returns an answer when search returns zero results', async () => {
    searchServiceMock.search.mockResolvedValue([]);

    const result = await service.query('question with no matches');

    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalled();
    const [{ messages }] = openaiServiceMock.chatCompletionWithMessages.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    expect(messages[1]?.content).toContain('No relevant documents were found');
    expect(result.answer).toBe('Returns are accepted within 30 days. [Source: Return Policy]');
    expect(result.sources).toEqual([]);
    expect(result.chunksRetrieved).toBe(0);
  });

  it('reports usage/estimatedCost/model from the generation call', async () => {
    const result = await service.query('question');

    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, totalTokens: 240 });
    expect(result.estimatedCost).toBe(0.001);
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('reports independently-measured searchLatencyMs/generationLatencyMs and a combined latencyMs', async () => {
    const result = await service.query('question');

    expect(typeof result.searchLatencyMs).toBe('number');
    expect(typeof result.generationLatencyMs).toBe('number');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.searchLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.generationLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(
      result.searchLatencyMs + result.generationLatencyMs,
    );
  });

  it('passes options.model through to chatCompletionWithMessages()', async () => {
    await service.query('question', { model: 'gpt-4o' });

    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });
});

describe('RagService.queryWithConversation()', () => {
  let service: RagService;
  let searchServiceMock: { search: jest.Mock };
  let openaiServiceMock: { chatCompletionWithMessages: jest.Mock };
  let chatServiceMock: {
    getConversationHandle: jest.Mock;
    addUserMessage: jest.Mock;
    addAssistantMessage: jest.Mock;
    buildContext: jest.Mock;
  };
  let modelRegistryServiceMock: { findModelByModelId: jest.Mock };
  let configMock: { get: jest.Mock };

  // Deterministic fake tokenizer: the system-prompt fixture costs a fixed 10 tokens; a
  // chunk-augmented user message costs 40 tokens per spliced chunk + 5 overhead; the
  // zero-chunk "no relevant documents" fallback costs a fixed 5. This makes budget-driven
  // chunk-reduction assertions exact rather than dependent on incidental string lengths.
  function countTokens(text: string): number {
    if (text === 'SYS_PROMPT_MARKER') return 10;
    const chunkMarkers = (text.match(/\[\d+\] \(Source:/g) ?? []).length;
    if (chunkMarkers > 0) return chunkMarkers * 40 + 5;
    if (text.includes('No relevant documents')) return 5;
    return 1;
  }

  beforeEach(async () => {
    searchServiceMock = { search: jest.fn().mockResolvedValue([]) };
    openaiServiceMock = {
      chatCompletionWithMessages: jest.fn().mockResolvedValue({
        content: 'Returns are accepted within 30 days.',
        model: 'gpt-4o-mini',
        usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        estimatedCost: 0.0008,
        latencyMs: 400,
      }),
    };
    chatServiceMock = {
      getConversationHandle: jest.fn().mockResolvedValue({ id: BigInt(1), model: 'gpt-4o-mini' }),
      addUserMessage: jest.fn().mockResolvedValue({}),
      addAssistantMessage: jest.fn().mockResolvedValue({}),
      buildContext: jest.fn().mockResolvedValue([
        { role: 'system', content: 'SYS_PROMPT_MARKER' },
        { role: 'user', content: 'What is the return policy?' },
      ]),
    };
    modelRegistryServiceMock = { findModelByModelId: jest.fn().mockResolvedValue(null) };
    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'chat.defaultContextWindow') return 100;
        if (key === 'chat.contextWindowPercentage') return 1;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: SearchService, useValue: searchServiceMock },
        { provide: OpenaiService, useValue: openaiServiceMock },
        { provide: TokenService, useValue: { countTokens: jest.fn(countTokens) } },
        { provide: ModelRegistryService, useValue: modelRegistryServiceMock },
        { provide: ChatService, useValue: chatServiceMock },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('resolves the conversation handle and calls ChatService.buildContext() for existing history', async () => {
    await service.queryWithConversation('conv-pub-1', 'What is the return policy?');

    expect(chatServiceMock.getConversationHandle).toHaveBeenCalledWith('conv-pub-1');
    expect(chatServiceMock.buildContext).toHaveBeenCalledWith(BigInt(1));
  });

  it('persists the turn via addUserMessage()/addAssistantMessage()', async () => {
    await service.queryWithConversation('conv-pub-1', 'What is the return policy?');

    expect(chatServiceMock.addUserMessage).toHaveBeenCalledWith(
      BigInt(1),
      'What is the return policy?',
    );
    expect(chatServiceMock.addAssistantMessage).toHaveBeenCalledWith(
      BigInt(1),
      expect.objectContaining({ content: 'Returns are accepted within 30 days.' }),
    );
  });

  it('splices retrieved chunks into the last user message content, not a new message role', async () => {
    searchServiceMock.search.mockResolvedValue([
      makeSearchResult({ documentTitle: 'Return Policy', content: 'Returns within 30 days.' }),
    ]);

    await service.queryWithConversation('conv-pub-1', 'What is the return policy?');

    const [{ messages }] = openaiServiceMock.chatCompletionWithMessages.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: 'SYS_PROMPT_MARKER' });
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Returns within 30 days.');
    expect(messages[1]?.content).toContain('Return Policy');
    expect(messages[1]?.content).toContain('What is the return policy?');
    expect(messages.every((m) => ['system', 'user', 'assistant', 'tool'].includes(m.role))).toBe(
      true,
    );
  });

  it('reduces chunk count rather than trimming conversation history when the budget is exceeded', async () => {
    searchServiceMock.search.mockResolvedValue([
      makeSearchResult({ chunkPublicId: 'c1', documentTitle: 'Doc A', chunkIndex: 0, score: 0.95 }),
      makeSearchResult({ chunkPublicId: 'c2', documentTitle: 'Doc B', chunkIndex: 1, score: 0.9 }),
      makeSearchResult({ chunkPublicId: 'c3', documentTitle: 'Doc C', chunkIndex: 2, score: 0.85 }),
    ]);

    const result = await service.queryWithConversation('conv-pub-1', 'question');

    // budget = 100 (contextWindow 100 * percentage 1); history (system message) = 10 tokens.
    // 3 chunks -> 3*40+5=125 -> 135 > 100 (reduce); 2 chunks -> 2*40+5=85 -> 95 <= 100 (fits).
    expect(result.chunksRetrieved).toBe(2);
    expect(result.sources.map((s) => s.documentTitle)).toEqual(['Doc A', 'Doc B']);
    // buildContext() is called exactly once — conversation history itself is never re-fetched
    // or re-trimmed by RagService; only the chunk count driving the spliced tail changes.
    expect(chatServiceMock.buildContext).toHaveBeenCalledTimes(1);
  });

  it('resolves the generation model from options.model, falling back to the conversation model', async () => {
    await service.queryWithConversation('conv-pub-1', 'question');
    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );

    await service.queryWithConversation('conv-pub-1', 'question', { model: 'gpt-4o' });
    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });

  it('throws BadRequestException for a whitespace-only question without persisting anything', async () => {
    await expect(service.queryWithConversation('conv-pub-1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(chatServiceMock.addUserMessage).not.toHaveBeenCalled();
  });

  it('still generates an answer when search returns zero results', async () => {
    searchServiceMock.search.mockResolvedValue([]);

    const result = await service.queryWithConversation('conv-pub-1', 'question');

    expect(openaiServiceMock.chatCompletionWithMessages).toHaveBeenCalled();
    expect(result.sources).toEqual([]);
    expect(result.chunksRetrieved).toBe(0);
  });
});
