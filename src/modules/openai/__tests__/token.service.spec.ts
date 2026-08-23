import { Test, type TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OpenAIModel } from '../constants/openai-model.enum';
import { ModelRegistryService } from '../services/model-registry.service';
import { TokenService } from '../services/token.service';

// ModelRegistryService imports DatabaseService, which imports the Prisma-generated ESM client.
// Mocking DatabaseService prevents Jest (CommonJS) from loading import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockModelRegistry = {
  getAllActivePricing: jest.fn().mockResolvedValue(new Map()),
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    mockModelRegistry.getAllActivePricing.mockClear().mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  describe('countTokens', () => {
    it('returns 2 for "Hello world" with gpt-4o', () => {
      expect(service.countTokens('Hello world', OpenAIModel.GPT_4O)).toBe(2);
    });

    it('returns 6 for "What is a REST API?" with gpt-4o', () => {
      expect(service.countTokens('What is a REST API?', OpenAIModel.GPT_4O)).toBe(6);
    });

    it('uses GPT_4O as the default model', () => {
      expect(service.countTokens('Hello world')).toBe(2);
    });

    it('completes 10 consecutive calls without error (WASM memory management)', () => {
      for (let i = 0; i < 10; i++) {
        expect(() => service.countTokens('test token', OpenAIModel.GPT_4O)).not.toThrow();
      }
    });

    it('falls back to the heuristic estimate for a model tiktoken does not recognize', () => {
      const unknownModel = 'meta-llama/llama-4-maverick:free' as OpenAIModel;

      expect(() => service.countTokens('Hello world', unknownModel)).not.toThrow();
      expect(service.countTokens('Hello world', unknownModel)).toBe(
        service.estimateTokens('Hello world'),
      );
    });

    it('logs a debug message when falling back to the heuristic estimate', () => {
      const unknownModel = 'meta-llama/llama-4-maverick:free' as OpenAIModel;

      service.countTokens('Hello world', unknownModel);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `tiktoken does not support model: ${unknownModel}, using heuristic estimate`,
      );
    });
  });

  describe('estimateTokens', () => {
    it('returns 3 for "Hello world" (11 chars / 4 = 2.75 → ceil = 3)', () => {
      expect(service.estimateTokens('Hello world')).toBe(3);
    });

    it('returns 1 for a 4-char string', () => {
      expect(service.estimateTokens('abcd')).toBe(1);
    });
  });

  describe('calculateCost', () => {
    it('returns 2.5 for gpt-4o with 1M input tokens, 0 output', async () => {
      await expect(service.calculateCost('gpt-4o', 1_000_000, 0)).resolves.toBe(2.5);
    });

    it('returns 10.0 for gpt-4o with 0 input, 1M output tokens', async () => {
      await expect(service.calculateCost('gpt-4o', 0, 1_000_000)).resolves.toBe(10.0);
    });

    it('computes correctly for gpt-4o-mini with 500 input and 250 output tokens', async () => {
      // (500 / 1M) * 0.15 + (250 / 1M) * 0.6 = 0.000075 + 0.00015 = 0.000225
      await expect(service.calculateCost('gpt-4o-mini', 500, 250)).resolves.toBeCloseTo(
        0.000225,
        8,
      );
    });

    it('returns 0 for an unknown model instead of throwing', async () => {
      await expect(service.calculateCost('unknown-model-xyz', 100, 100)).resolves.toBe(0);
    });

    it('logs a debug message for an unknown model', async () => {
      await service.calculateCost('unknown-model-xyz', 100, 100);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No pricing data for model: unknown-model-xyz, cost set to 0',
      );
    });

    it('prefers DB pricing over the hardcoded MODEL_PRICING constant', async () => {
      mockModelRegistry.getAllActivePricing.mockResolvedValue(
        new Map([['gpt-4o', { input: 1, output: 1 }]]),
      );

      await expect(service.calculateCost('gpt-4o', 1_000_000, 0)).resolves.toBe(1);
    });

    it('falls back to MODEL_PRICING when the model is not registered in the DB', async () => {
      mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

      await expect(service.calculateCost('gpt-4o', 1_000_000, 0)).resolves.toBe(2.5);
    });
  });

  describe('getModelPricing', () => {
    it('returns pricing entries for all supported models', () => {
      const pricing = service.getModelPricing();
      expect(pricing['gpt-4']).toBeDefined();
      expect(pricing['gpt-4o']).toBeDefined();
      expect(pricing['gpt-4o-mini']).toBeDefined();
    });

    it('returns correct input price for gpt-4o', () => {
      expect(service.getModelPricing()['gpt-4o'].input).toBe(2.5);
    });
  });
});
