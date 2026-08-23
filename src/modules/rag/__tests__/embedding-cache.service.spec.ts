import { createHash } from 'crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { EmbeddingCache } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function hashOf(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

function makeCacheRow(overrides: Partial<EmbeddingCache> = {}): EmbeddingCache {
  return {
    id: BigInt(1),
    publicId: 'cache-pub-1',
    textHash: hashOf('hello world'),
    embedding: [0.1, 0.2, 0.3],
    model: 'text-embedding-3-small',
    tokenCount: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('EmbeddingCacheService', () => {
  let service: EmbeddingCacheService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingCacheService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<EmbeddingCacheService>(EmbeddingCacheService);
    jest.clearAllMocks();
  });

  describe('get()', () => {
    it('returns the cached embedding on a hit', async () => {
      dbMock.embeddingCache.findUnique.mockResolvedValue(makeCacheRow());

      const result = await service.get('hello world');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(dbMock.embeddingCache.findUnique).toHaveBeenCalledWith({
        where: { textHash: hashOf('hello world') },
      });
    });

    it('returns null on a miss', async () => {
      dbMock.embeddingCache.findUnique.mockResolvedValue(null);

      const result = await service.get('never seen before');

      expect(result).toBeNull();
    });

    it('hashes normalized text — differing whitespace/case query the same textHash', async () => {
      dbMock.embeddingCache.findUnique.mockResolvedValue(null);

      await service.get('Hello World');
      await service.get('  hello world  ');

      const firstCallHash = dbMock.embeddingCache.findUnique.mock.calls[0]?.[0]?.where.textHash;
      const secondCallHash = dbMock.embeddingCache.findUnique.mock.calls[1]?.[0]?.where.textHash;
      expect(firstCallHash).toBe(secondCallHash);
      expect(firstCallHash).toBe(hashOf('hello world'));
    });
  });

  describe('set()', () => {
    it('upserts by textHash', async () => {
      dbMock.embeddingCache.upsert.mockResolvedValue(makeCacheRow());

      await service.set('hello world', [0.1, 0.2, 0.3], 'text-embedding-3-small');

      expect(dbMock.embeddingCache.upsert).toHaveBeenCalledWith({
        where: { textHash: hashOf('hello world') },
        create: {
          textHash: hashOf('hello world'),
          embedding: [0.1, 0.2, 0.3],
          model: 'text-embedding-3-small',
        },
        update: { embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' },
      });
    });

    it('is idempotent — calling twice for the same text does not throw', async () => {
      dbMock.embeddingCache.upsert.mockResolvedValue(makeCacheRow());

      await service.set('hello world', [0.1, 0.2, 0.3], 'text-embedding-3-small');
      await expect(
        service.set('hello world', [0.1, 0.2, 0.3], 'text-embedding-3-small'),
      ).resolves.toBeUndefined();

      expect(dbMock.embeddingCache.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate()', () => {
    it('deletes the row matching the given hash', async () => {
      dbMock.embeddingCache.deleteMany.mockResolvedValue({ count: 1 });

      await service.invalidate('some-hash');

      expect(dbMock.embeddingCache.deleteMany).toHaveBeenCalledWith({
        where: { textHash: 'some-hash' },
      });
    });

    it('does not throw when the hash does not exist', async () => {
      dbMock.embeddingCache.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.invalidate('missing-hash')).resolves.toBeUndefined();
    });
  });

  describe('getCacheStats()', () => {
    it('reports hits/misses from the in-memory counter and totalCached from the DB', async () => {
      dbMock.embeddingCache.findUnique
        .mockResolvedValueOnce(makeCacheRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeCacheRow());
      dbMock.embeddingCache.count.mockResolvedValue(42);

      await service.get('hit-1');
      await service.get('miss-1');
      await service.get('hit-2');

      const stats = await service.getCacheStats();

      expect(stats).toEqual({ hits: 2, misses: 1, totalCached: 42 });
    });

    it('returns zero hits/misses before any get() calls', async () => {
      dbMock.embeddingCache.count.mockResolvedValue(0);

      const stats = await service.getCacheStats();

      expect(stats).toEqual({ hits: 0, misses: 0, totalCached: 0 });
    });
  });
});
