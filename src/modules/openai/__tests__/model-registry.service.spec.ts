import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { AiModel, AiProvider } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ModelSource } from '../constants/model-source.enum';
import { ModelTier } from '../constants/model-tier.enum';
import { ModelRegistryService } from '../services/model-registry.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: BigInt(1),
    publicId: 'provider-pub-1',
    name: 'OpenAI',
    slug: 'openai',
    baseUrl: null,
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeModel(overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: BigInt(1),
    publicId: 'model-pub-1',
    providerId: BigInt(1),
    name: 'GPT-4o',
    modelId: 'gpt-4o',
    tier: ModelTier.PAID,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    contextWindow: 128000,
    description: null,
    source: ModelSource.MANUAL,
    isActive: true,
    lastSyncedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ModelRegistryService', () => {
  let service: ModelRegistryService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRegistryService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ModelRegistryService>(ModelRegistryService);
    jest.clearAllMocks();
  });

  describe('findAllModels()', () => {
    it('maps DB rows to entities with provider fields flattened', async () => {
      const provider = makeProvider();
      dbMock.aiModel.findMany.mockResolvedValue([{ ...makeModel(), provider } as never]);
      dbMock.aiModel.count.mockResolvedValue(1);

      const result = await service.findAllModels({});

      expect(result.data[0]).toMatchObject({
        publicId: 'model-pub-1',
        providerPublicId: 'provider-pub-1',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
      });
      expect(result.total).toBe(1);
    });

    it('builds a where clause including tier, source, isActive, and search', async () => {
      dbMock.aiModel.findMany.mockResolvedValue([]);
      dbMock.aiModel.count.mockResolvedValue(0);

      await service.findAllModels({
        tier: ModelTier.FREE,
        source: ModelSource.OPENROUTER_SYNC,
        isActive: true,
        search: 'gemma',
      });

      expect(dbMock.aiModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tier: ModelTier.FREE,
            source: ModelSource.OPENROUTER_SYNC,
            isActive: true,
            OR: [
              { name: { contains: 'gemma', mode: 'insensitive' } },
              { modelId: { contains: 'gemma', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('caps limit at 100', async () => {
      dbMock.aiModel.findMany.mockResolvedValue([]);
      dbMock.aiModel.count.mockResolvedValue(0);

      await service.findAllModels({ limit: 500 });

      expect(dbMock.aiModel.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });
  });

  describe('findModelByModelId()', () => {
    it('returns null when no model matches', async () => {
      dbMock.aiModel.findUnique.mockResolvedValue(null);

      await expect(service.findModelByModelId('missing')).resolves.toBeNull();
    });

    it('returns the mapped entity when found', async () => {
      const provider = makeProvider();
      dbMock.aiModel.findUnique.mockResolvedValue({ ...makeModel(), provider } as never);

      const result = await service.findModelByModelId('gpt-4o');

      expect(result?.modelId).toBe('gpt-4o');
      expect(result?.providerName).toBe('OpenAI');
    });
  });

  describe('createModel()', () => {
    it('throws NotFoundException when the provider does not exist', async () => {
      dbMock.aiProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.createModel({
          providerId: 'missing-provider',
          name: 'X',
          modelId: 'x/y',
          tier: ModelTier.FREE,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates the model with source MANUAL', async () => {
      const provider = makeProvider();
      dbMock.aiProvider.findUnique.mockResolvedValue(provider);
      dbMock.aiModel.create.mockResolvedValue({ ...makeModel(), provider } as never);

      await service.createModel({
        providerId: provider.publicId,
        name: 'GPT-4o',
        modelId: 'gpt-4o',
        tier: ModelTier.PAID,
      });

      expect(dbMock.aiModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: ModelSource.MANUAL }),
        }),
      );
    });

    it('throws ConflictException on a duplicate modelId (P2002)', async () => {
      const provider = makeProvider();
      dbMock.aiProvider.findUnique.mockResolvedValue(provider);
      dbMock.aiModel.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.createModel({
          providerId: provider.publicId,
          name: 'GPT-4o',
          modelId: 'gpt-4o',
          tier: ModelTier.PAID,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateModel()', () => {
    it('always resets source to MANUAL, even for a previously synced model', async () => {
      const provider = makeProvider();
      const existing = { ...makeModel({ source: ModelSource.OPENROUTER_SYNC }), provider };
      dbMock.aiModel.findUnique.mockResolvedValue(existing);
      dbMock.aiModel.update.mockResolvedValue({ ...existing, source: ModelSource.MANUAL });

      await service.updateModel('model-pub-1', { name: 'Renamed' });

      expect(dbMock.aiModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: ModelSource.MANUAL }),
        }),
      );
    });

    it('throws NotFoundException when the model does not exist', async () => {
      dbMock.aiModel.findUnique.mockResolvedValue(null);

      await expect(service.updateModel('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteModel()', () => {
    it('soft-deletes by setting isActive to false', async () => {
      const provider = makeProvider();
      dbMock.aiModel.findUnique.mockResolvedValue({ ...makeModel(), provider } as never);
      dbMock.aiModel.update.mockResolvedValue({
        ...makeModel(),
        isActive: false,
        provider,
      } as never);

      await service.deleteModel('model-pub-1');

      expect(dbMock.aiModel.update).toHaveBeenCalledWith({
        where: { publicId: 'model-pub-1' },
        data: { isActive: false },
      });
    });
  });

  describe('findAllProviders()', () => {
    it('flattens _count.models into modelCount', async () => {
      dbMock.aiProvider.findMany.mockResolvedValue([
        { ...makeProvider(), _count: { models: 3 } } as never,
      ]);

      const result = await service.findAllProviders();

      expect(result[0].modelCount).toBe(3);
    });
  });

  describe('createProvider()', () => {
    it('throws ConflictException on a duplicate slug (P2002)', async () => {
      dbMock.aiProvider.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.createProvider({ name: 'OpenAI', slug: 'openai' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getModelPricing()', () => {
    it('returns DB pricing when the model is registered', async () => {
      dbMock.aiModel.findUnique.mockResolvedValue(
        makeModel({ inputPricePer1M: 5, outputPricePer1M: 15 }),
      );

      await expect(service.getModelPricing('gpt-4o')).resolves.toEqual({ input: 5, output: 15 });
    });

    it('falls back to MODEL_PRICING when not in the DB', async () => {
      dbMock.aiModel.findUnique.mockResolvedValue(null);

      await expect(service.getModelPricing('gpt-4')).resolves.toEqual({
        input: 30.0,
        output: 60.0,
      });
    });

    it('falls back to zero pricing for a completely unknown model', async () => {
      dbMock.aiModel.findUnique.mockResolvedValue(null);

      await expect(service.getModelPricing('unknown/model')).resolves.toEqual({
        input: 0,
        output: 0,
      });
    });
  });

  describe('getPricingTable()', () => {
    it('excludes providers with no active models', async () => {
      dbMock.aiProvider.findMany.mockResolvedValue([
        { ...makeProvider(), models: [] } as never,
        {
          ...makeProvider({ publicId: 'p2', slug: 'google', name: 'Google' }),
          models: [makeModel()],
        } as never,
      ]);

      const result = await service.getPricingTable();

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].slug).toBe('google');
    });
  });
});
