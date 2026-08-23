import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { of } from 'rxjs';

import type { AiModel, AiProvider } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ModelSource } from '../constants/model-source.enum';
import { ModelTier } from '../constants/model-tier.enum';
import { OpenRouterSyncService } from '../services/openrouter-sync.service';
import type { OpenRouterModel } from '../types/openrouter.types';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeOpenRouterModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B IT (free)',
    pricing: { prompt: '0', completion: '0' },
    context_length: 96000,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: BigInt(1),
    publicId: 'provider-pub-1',
    name: 'Google',
    slug: 'google',
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
    name: 'Gemma 3 27B IT (free)',
    modelId: 'google/gemma-3-27b-it:free',
    tier: ModelTier.FREE,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 96000,
    description: null,
    source: ModelSource.OPENROUTER_SYNC,
    isActive: true,
    lastSyncedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OpenRouterSyncService', () => {
  let service: OpenRouterSyncService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let httpMock: { get: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    httpMock = { get: jest.fn() };
    configMock = { get: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenRouterSyncService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: HttpService, useValue: httpMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<OpenRouterSyncService>(OpenRouterSyncService);
    jest.clearAllMocks();
    configMock.get.mockReturnValue(true);
  });

  describe('syncAll()', () => {
    it('creates a new provider and model when neither exists', async () => {
      httpMock.get.mockReturnValue(of({ data: { data: [makeOpenRouterModel()] } }));
      dbMock.aiProvider.findMany.mockResolvedValue([]);
      dbMock.aiProvider.create.mockResolvedValue(makeProvider());
      dbMock.aiModel.findMany.mockResolvedValue([]);
      dbMock.aiModel.create.mockResolvedValue(makeModel());

      const result = await service.syncAll();

      expect(dbMock.aiProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'google' }) }),
      );
      expect(dbMock.aiModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            modelId: 'google/gemma-3-27b-it:free',
            tier: ModelTier.FREE,
            source: ModelSource.OPENROUTER_SYNC,
          }),
        }),
      );
      expect(result).toEqual({ providersCreated: 1, modelsCreated: 1, modelsUpdated: 0 });
    });

    it('reuses an existing provider instead of creating a duplicate', async () => {
      httpMock.get.mockReturnValue(of({ data: { data: [makeOpenRouterModel()] } }));
      dbMock.aiProvider.findMany.mockResolvedValue([makeProvider()]);
      dbMock.aiModel.findMany.mockResolvedValue([]);
      dbMock.aiModel.create.mockResolvedValue(makeModel());

      const result = await service.syncAll();

      expect(dbMock.aiProvider.create).not.toHaveBeenCalled();
      expect(result.providersCreated).toBe(0);
    });

    it('updates an existing openrouter_sync model with fresh pricing', async () => {
      httpMock.get.mockReturnValue(
        of({
          data: {
            data: [
              makeOpenRouterModel({ pricing: { prompt: '0.0000001', completion: '0.0000002' } }),
            ],
          },
        }),
      );
      dbMock.aiProvider.findMany.mockResolvedValue([makeProvider()]);
      dbMock.aiModel.findMany.mockResolvedValue([
        makeModel({ source: ModelSource.OPENROUTER_SYNC }),
      ]);
      dbMock.aiModel.update.mockResolvedValue(makeModel());

      const result = await service.syncAll();

      expect(dbMock.aiModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { modelId: 'google/gemma-3-27b-it:free' } }),
      );
      const updateCall = dbMock.aiModel.update.mock.calls[0][0] as {
        data: { inputPricePer1M: number; outputPricePer1M: number };
      };
      expect(updateCall.data.inputPricePer1M).toBeCloseTo(0.1, 8);
      expect(updateCall.data.outputPricePer1M).toBeCloseTo(0.2, 8);
      expect(result.modelsUpdated).toBe(1);
    });

    it('does not overwrite a manually-edited model', async () => {
      httpMock.get.mockReturnValue(of({ data: { data: [makeOpenRouterModel()] } }));
      dbMock.aiProvider.findMany.mockResolvedValue([makeProvider()]);
      dbMock.aiModel.findMany.mockResolvedValue([makeModel({ source: ModelSource.MANUAL })]);

      const result = await service.syncAll();

      expect(dbMock.aiModel.update).not.toHaveBeenCalled();
      expect(dbMock.aiModel.create).not.toHaveBeenCalled();
      expect(result).toEqual({ providersCreated: 0, modelsCreated: 0, modelsUpdated: 0 });
    });
  });

  describe('syncFreeModelsOnly()', () => {
    it('filters out models with non-zero pricing', async () => {
      httpMock.get.mockReturnValue(
        of({
          data: {
            data: [
              makeOpenRouterModel(),
              makeOpenRouterModel({
                id: 'openai/gpt-4o',
                pricing: { prompt: '0.0000025', completion: '0.00001' },
              }),
            ],
          },
        }),
      );
      dbMock.aiProvider.findMany.mockResolvedValue([makeProvider()]);
      dbMock.aiModel.findMany.mockResolvedValue([]);
      dbMock.aiModel.create.mockResolvedValue(makeModel());

      await service.syncFreeModelsOnly();

      expect(dbMock.aiModel.create).toHaveBeenCalledTimes(1);
      expect(dbMock.aiModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modelId: 'google/gemma-3-27b-it:free' }),
        }),
      );
    });
  });

  describe('onModuleInit()', () => {
    it('runs a sync when enabled', async () => {
      httpMock.get.mockReturnValue(of({ data: { data: [] } }));
      dbMock.aiProvider.findMany.mockResolvedValue([]);
      dbMock.aiModel.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(httpMock.get).toHaveBeenCalled();
    });

    it('skips sync when OPENROUTER_SYNC_ENABLED is false', async () => {
      configMock.get.mockReturnValue(false);

      await service.onModuleInit();

      expect(httpMock.get).not.toHaveBeenCalled();
    });

    it('does not throw when the sync fails', async () => {
      httpMock.get.mockReturnValue(
        of({
          data: {
            get data() {
              throw new Error('network error');
            },
          },
        }),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getLastSyncedAt()', () => {
    it('returns null before any sync has run', () => {
      expect(service.getLastSyncedAt()).toBeNull();
    });

    it('returns a timestamp after a successful sync', async () => {
      httpMock.get.mockReturnValue(of({ data: { data: [] } }));
      dbMock.aiProvider.findMany.mockResolvedValue([]);
      dbMock.aiModel.findMany.mockResolvedValue([]);

      await service.syncAll();

      expect(service.getLastSyncedAt()).toBeInstanceOf(Date);
    });
  });
});
