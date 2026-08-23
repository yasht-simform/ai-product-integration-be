import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { AiAuditStatus } from '../constants/ai-audit-status.enum';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../constants/injection-tokens';
import { OpenAIModel } from '../constants/openai-model.enum';
import { CircuitOpenException } from '../exceptions/circuit-open.exception';
import { AiAuditService } from '../services/ai-audit.service';
import { OpenaiService } from '../services/openai.service';
import { RetryService } from '../services/retry.service';
import { TokenService } from '../services/token.service';
import type { ChatCompletionParams, MessagesCompletionParams } from '../types/openai.types';

// AiAuditService imports DatabaseService, which imports the Prisma-generated ESM client.
// Mocking DatabaseService prevents Jest (CommonJS) from loading import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const mockOpenAIClient = {
  chat: { completions: { create: jest.fn() } },
  embeddings: { create: jest.fn() },
  moderations: { create: jest.fn() },
};

const makeSuccessResponse = () => ({
  choices: [{ message: { content: 'Hello!' } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  model: 'gpt-4o',
});

const makeEmbeddingResponse = (count = 1) => ({
  data: Array.from({ length: count }, (_, index) => ({
    embedding: [0.01, -0.02, 0.03],
    index,
    object: 'embedding' as const,
  })),
  model: 'text-embedding-3-small',
  object: 'list' as const,
  usage: { prompt_tokens: 12, total_tokens: 12 },
});

const makeModerationResult = (overrides: { flagged?: boolean } = {}) => ({
  flagged: overrides.flagged ?? false,
  categories: { hate: false, sexual: overrides.flagged ?? false, violence: false },
  category_scores: { hate: 0.001, sexual: overrides.flagged ? 0.85 : 0.002, violence: 0.02 },
  category_applied_input_types: { hate: ['text'], sexual: ['text'], violence: ['text'] },
});

const makeModerationResponse = (
  results: Array<ReturnType<typeof makeModerationResult>> = [makeModerationResult()],
) => ({
  id: 'modr-1',
  model: 'omni-moderation-latest',
  results,
});

function makeParams(overrides: Partial<ChatCompletionParams> = {}): ChatCompletionParams {
  return {
    prompt: 'What is 2+2?',
    requestId: 'req-test',
    ...overrides,
  };
}

function makeMessagesParams(
  overrides: Partial<MessagesCompletionParams> = {},
): MessagesCompletionParams {
  return {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2+2?' },
    ],
    requestId: 'req-test',
    ...overrides,
  };
}

describe('OpenaiService', () => {
  let service: OpenaiService;
  let retryMock: { executeWithRetry: jest.Mock };
  let tokenMock: { calculateCost: jest.Mock; getModelPricing: jest.Mock };
  let auditMock: { log: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    retryMock = {
      executeWithRetry: jest.fn().mockImplementation(async (op: () => Promise<unknown>) => op()),
    };
    tokenMock = {
      calculateCost: jest.fn().mockResolvedValue(0.0015),
      getModelPricing: jest.fn().mockReturnValue({}),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };

    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'openai.apiKey') return 'sk-test-key';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenaiService,
        { provide: OPENAI_CLIENT, useValue: mockOpenAIClient },
        // No MODERATION_API_KEY configured in these tests → the real factory (openai.module.ts)
        // would resolve MODERATION_CLIENT to the same primary instance; reusing mockOpenAIClient
        // here reproduces that default wiring without duplicating every moderation assertion.
        { provide: MODERATION_CLIENT, useValue: mockOpenAIClient },
        { provide: RetryService, useValue: retryMock },
        { provide: TokenService, useValue: tokenMock },
        { provide: AiAuditService, useValue: auditMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<OpenaiService>(OpenaiService);
    // Explicitly trigger the lifecycle hook — TestingModule.compile() does not
    // automatically call onModuleInit() for individually provided services.
    service.onModuleInit();

    jest.clearAllMocks();
    // Re-apply implementations cleared by clearAllMocks (mockOpenAIClient is module-scoped)
    retryMock.executeWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());
    tokenMock.calculateCost.mockResolvedValue(0.0015);
    auditMock.log.mockResolvedValue(undefined);
    mockOpenAIClient.chat.completions.create.mockResolvedValue(makeSuccessResponse());
    mockOpenAIClient.embeddings.create.mockResolvedValue(makeEmbeddingResponse());
    mockOpenAIClient.moderations.create.mockResolvedValue(makeModerationResponse());
  });

  describe('chatCompletion() — success path', () => {
    it('returns ChatCompletionResult with correct usage and estimatedCost', async () => {
      const result = await service.chatCompletion(makeParams());

      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('gpt-4o');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      expect(result.estimatedCost).toBe(0.0015);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('calls AiAuditService.log() with status SUCCESS on a successful call', async () => {
      await service.chatCompletion(makeParams({ userId: 'u-1', model: OpenAIModel.GPT_4O }));

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AiAuditStatus.SUCCESS,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCost: 0.0015,
          retryCount: 0,
        }),
      );
    });
  });

  describe('chatCompletion() — failure path', () => {
    it('calls AiAuditService.log() with status FAILED when executeWithRetry rejects', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('connection error'));

      await expect(service.chatCompletion(makeParams())).rejects.toThrow();

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AiAuditStatus.FAILED,
          errorMessage: 'connection error',
        }),
      );
    });

    it('rethrows error from RetryService as an HttpException', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('upstream failed'));

      await expect(service.chatCompletion(makeParams())).rejects.toBeInstanceOf(HttpException);
    });

    it('throws ServiceUnavailableException without calling the SDK when API key is missing', async () => {
      // Simulate missing API key — override the flag set by onModuleInit()
      (service as unknown as { isConfigured: boolean }).isConfigured = false;

      await expect(service.chatCompletion(makeParams())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockOpenAIClient.chat.completions.create).not.toHaveBeenCalled();
      expect(retryMock.executeWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('chatCompletionWithMessages() — success path', () => {
    it('returns ChatCompletionResult built from the given message array', async () => {
      const result = await service.chatCompletionWithMessages(makeMessagesParams());

      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('gpt-4o');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      expect(result.toolCalls).toBeUndefined();

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is 2+2?' },
          ],
        }),
      );
    });

    it('forwards tools to the SDK call only when provided', async () => {
      const tools = [
        {
          type: 'function' as const,
          function: { name: 'calculator', description: 'Evaluate an expression', parameters: {} },
        },
      ];

      await service.chatCompletionWithMessages(makeMessagesParams({ tools }));

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
      );

      await service.chatCompletionWithMessages(makeMessagesParams());

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ tools: expect.anything() }),
      );
    });

    it('surfaces tool_calls on the result when the SDK response includes them', async () => {
      const toolCalls = [
        {
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
        },
      ];
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null, tool_calls: toolCalls } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        model: 'gpt-4o',
      });

      const result = await service.chatCompletionWithMessages(makeMessagesParams());

      expect(result.toolCalls).toEqual(toolCalls);
      expect(result.content).toBe('');
    });

    it('derives audit systemPrompt/userMessage from the message array', async () => {
      await service.chatCompletionWithMessages(
        makeMessagesParams({
          userId: 'u-1',
          messages: [
            { role: 'system', content: 'System instructions' },
            { role: 'user', content: 'First question' },
            { role: 'assistant', content: 'An answer' },
            { role: 'user', content: 'Second question' },
          ],
        }),
      );

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'System instructions',
          userMessage: 'Second question',
          status: AiAuditStatus.SUCCESS,
        }),
      );
    });
  });

  describe('chatCompletionWithMessages() — failure path', () => {
    it('calls AiAuditService.log() with status FAILED and correct error info when the SDK call fails', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('connection error'));

      await expect(service.chatCompletionWithMessages(makeMessagesParams())).rejects.toBeInstanceOf(
        HttpException,
      );

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AiAuditStatus.FAILED,
          errorMessage: 'connection error',
        }),
      );
    });

    it('throws ServiceUnavailableException without calling the SDK when API key is missing', async () => {
      (service as unknown as { isConfigured: boolean }).isConfigured = false;

      await expect(service.chatCompletionWithMessages(makeMessagesParams())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockOpenAIClient.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  describe('generateEmbedding() — success path', () => {
    it('returns the embedding vector from the SDK response', async () => {
      mockOpenAIClient.embeddings.create.mockResolvedValue(makeEmbeddingResponse());

      const result = await service.generateEmbedding('hello world');

      expect(result).toEqual([0.01, -0.02, 0.03]);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'hello world', model: 'text-embedding-3-small' }),
      );
    });

    it('defaults to rag.embeddingModel from config when no model is passed', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'openai.apiKey') return 'sk-test-key';
        if (key === 'rag.embeddingModel') return 'text-embedding-3-large';
        return undefined;
      });

      await service.generateEmbedding('hello world');

      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-large' }),
      );
    });

    it('routes through RetryService.executeWithRetry()', async () => {
      await service.generateEmbedding('hello world');

      expect(retryMock.executeWithRetry).toHaveBeenCalledTimes(1);
    });

    it('recovers when RetryService.executeWithRetry() retries then succeeds', async () => {
      retryMock.executeWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());

      const result = await service.generateEmbedding('hello world');

      expect(result).toEqual([0.01, -0.02, 0.03]);
    });

    it('calls AiAuditService.log() with endpoint EMBEDDINGS and status SUCCESS', async () => {
      await service.generateEmbedding('hello world');

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'embeddings',
          status: AiAuditStatus.SUCCESS,
          inputTokens: 12,
          outputTokens: 0,
          totalTokens: 12,
          userMessage: 'hello world',
        }),
      );
    });

    it('estimates cost via TokenService.calculateCost(model, inputTokens, 0)', async () => {
      await service.generateEmbedding('hello world', 'text-embedding-3-small');

      expect(tokenMock.calculateCost).toHaveBeenCalledWith('text-embedding-3-small', 12, 0);
    });
  });

  describe('generateEmbedding() — failure path', () => {
    it('calls AiAuditService.log() with status FAILED when the SDK call fails', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('embedding service down'));

      await expect(service.generateEmbedding('hello world')).rejects.toThrow();

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'embeddings',
          status: AiAuditStatus.FAILED,
          errorMessage: 'embedding service down',
        }),
      );
    });

    it('rethrows a CircuitOpenException unchanged, same as chatCompletion()', async () => {
      const circuitOpenError = new CircuitOpenException();
      retryMock.executeWithRetry.mockRejectedValue(circuitOpenError);

      await expect(service.generateEmbedding('hello world')).rejects.toBe(circuitOpenError);
    });

    it('throws ServiceUnavailableException without calling the SDK when API key is missing', async () => {
      (service as unknown as { isConfigured: boolean }).isConfigured = false;

      await expect(service.generateEmbedding('hello world')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockOpenAIClient.embeddings.create).not.toHaveBeenCalled();
      expect(retryMock.executeWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('generateEmbeddingsBatch()', () => {
    it('embeds multiple texts in a single API call and returns vectors in input order', async () => {
      mockOpenAIClient.embeddings.create.mockResolvedValue(makeEmbeddingResponse(3));

      const result = await service.generateEmbeddingsBatch(['a', 'b', 'c']);

      expect(result).toEqual([
        [0.01, -0.02, 0.03],
        [0.01, -0.02, 0.03],
        [0.01, -0.02, 0.03],
      ]);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: ['a', 'b', 'c'] }),
      );
    });

    it('calls AiAuditService.log() once with endpoint EMBEDDINGS for the whole batch', async () => {
      mockOpenAIClient.embeddings.create.mockResolvedValue(makeEmbeddingResponse(3));

      await service.generateEmbeddingsBatch(['a', 'b', 'c']);

      expect(auditMock.log).toHaveBeenCalledTimes(1);
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'embeddings', status: AiAuditStatus.SUCCESS }),
      );
    });

    it('calls AiAuditService.log() with status FAILED when the SDK call fails', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('batch embedding failed'));

      await expect(service.generateEmbeddingsBatch(['a', 'b'])).rejects.toThrow();

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'embeddings', status: AiAuditStatus.FAILED }),
      );
    });
  });

  describe('moderateText()', () => {
    it('returns a clean camelCase ModerationResult for a non-flagged input', async () => {
      mockOpenAIClient.moderations.create.mockResolvedValue(
        makeModerationResponse([makeModerationResult({ flagged: false })]),
      );

      const result = await service.moderateText('hello world');

      expect(result).toEqual({
        flagged: false,
        categories: { hate: false, sexual: false, violence: false },
        categoryScores: { hate: 0.001, sexual: 0.002, violence: 0.02 },
      });
      expect(mockOpenAIClient.moderations.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'hello world' }),
      );
    });

    it('returns a flagged ModerationResult when the SDK flags the input', async () => {
      mockOpenAIClient.moderations.create.mockResolvedValue(
        makeModerationResponse([makeModerationResult({ flagged: true })]),
      );

      const result = await service.moderateText('bad input');

      expect(result.flagged).toBe(true);
      expect(result.categories.sexual).toBe(true);
      expect(result.categoryScores.sexual).toBe(0.85);
    });

    it('recovers when RetryService.executeWithRetry() retries then succeeds', async () => {
      retryMock.executeWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());

      const result = await service.moderateText('hello world');

      expect(result.flagged).toBe(false);
      expect(retryMock.executeWithRetry).toHaveBeenCalledTimes(1);
    });

    it('calls AiAuditService.log() with endpoint MODERATIONS, estimatedCost 0, and status SUCCESS', async () => {
      await service.moderateText('hello world');

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'moderations',
          status: AiAuditStatus.SUCCESS,
          estimatedCost: 0,
          userMessage: 'hello world',
        }),
      );
    });

    it('calls AiAuditService.log() with status FAILED when the SDK call fails', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('moderation service down'));

      await expect(service.moderateText('hello world')).rejects.toThrow();

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'moderations',
          status: AiAuditStatus.FAILED,
          estimatedCost: 0,
          errorMessage: 'moderation service down',
        }),
      );
    });

    it('rethrows a CircuitOpenException unchanged, same as chatCompletion()/generateEmbedding()', async () => {
      const circuitOpenError = new CircuitOpenException();
      retryMock.executeWithRetry.mockRejectedValue(circuitOpenError);

      await expect(service.moderateText('hello world')).rejects.toBe(circuitOpenError);
    });

    it('throws ServiceUnavailableException without calling the SDK when API key is missing', async () => {
      (service as unknown as { isConfigured: boolean }).isConfigured = false;

      await expect(service.moderateText('hello world')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockOpenAIClient.moderations.create).not.toHaveBeenCalled();
      expect(retryMock.executeWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('moderateText() — MODERATION_STATIC_MODE (AI-059)', () => {
    beforeEach(() => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'openai.apiKey') return 'sk-test-key';
        if (key === 'openai.moderationStaticMode') return true;
        return undefined;
      });
    });

    it('never calls the SDK and returns a fixture-derived flagged result for flagged text', async () => {
      const result = await service.moderateText('I want to hurt someone');

      expect(mockOpenAIClient.moderations.create).not.toHaveBeenCalled();
      expect(result.flagged).toBe(true);
    });

    it('never calls the SDK and returns a fixture-derived clean result for clean text', async () => {
      const result = await service.moderateText('a lovely sunny day');

      expect(mockOpenAIClient.moderations.create).not.toHaveBeenCalled();
      expect(result.flagged).toBe(false);
    });

    it('still audits the call, with the fixture model name and status SUCCESS', async () => {
      await service.moderateText('a lovely sunny day');

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'moderations',
          status: AiAuditStatus.SUCCESS,
          model: 'static-fixture-moderation',
          estimatedCost: 0,
        }),
      );
    });
  });

  describe('moderateBatch()', () => {
    it('classifies multiple inputs in a single API call and returns results in input order', async () => {
      mockOpenAIClient.moderations.create.mockResolvedValue(
        makeModerationResponse([
          makeModerationResult({ flagged: false }),
          makeModerationResult({ flagged: true }),
          makeModerationResult({ flagged: false }),
        ]),
      );

      const result = await service.moderateBatch(['a', 'b', 'c']);

      expect(result).toEqual([
        expect.objectContaining({ flagged: false }),
        expect.objectContaining({ flagged: true }),
        expect.objectContaining({ flagged: false }),
      ]);
      expect(mockOpenAIClient.moderations.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAIClient.moderations.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: ['a', 'b', 'c'] }),
      );
    });

    it('calls AiAuditService.log() once with endpoint MODERATIONS for the whole batch', async () => {
      mockOpenAIClient.moderations.create.mockResolvedValue(
        makeModerationResponse([makeModerationResult(), makeModerationResult()]),
      );

      await service.moderateBatch(['a', 'b']);

      expect(auditMock.log).toHaveBeenCalledTimes(1);
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'moderations',
          status: AiAuditStatus.SUCCESS,
          estimatedCost: 0,
          userMessage: 'a',
        }),
      );
    });

    it('calls AiAuditService.log() with status FAILED when the SDK call fails', async () => {
      retryMock.executeWithRetry.mockRejectedValue(new Error('batch moderation failed'));

      await expect(service.moderateBatch(['a', 'b'])).rejects.toThrow();

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'moderations', status: AiAuditStatus.FAILED }),
      );
    });
  });
});
