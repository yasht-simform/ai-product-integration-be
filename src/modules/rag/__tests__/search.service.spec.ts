import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { Document, DocumentChunk } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';
import { EmbeddingService } from '../services/embedding.service';
import { PineconeService, type PineconeMatch } from '../services/pinecone.service';
import { SearchService } from '../services/search.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeChunkWithDocument(
  overrides: Partial<DocumentChunk> = {},
  documentOverrides: Partial<Document> = {},
): DocumentChunk & { document: Document } {
  const document: Document = {
    id: BigInt(1),
    publicId: 'doc-pub-1',
    title: 'Return Policy',
    description: 'How returns work',
    sourceType: 'txt',
    originalFilename: null,
    fileSize: null,
    totalChunks: 1,
    totalTokens: 10,
    embeddingModel: 'text-embedding-3-small',
    embeddingStatus: 'completed',
    category: 'docs',
    tags: ['policy'],
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...documentOverrides,
  };

  return {
    id: BigInt(1),
    publicId: 'chunk-pub-1',
    documentId: BigInt(1),
    chunkIndex: 0,
    content: 'chunk text',
    tokenCount: 10,
    startChar: 0,
    endChar: 10,
    pineconeId: 'chunk_doc-pub-1_0',
    embeddingStatus: 'completed',
    metadata: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
    document,
  };
}

function makeMatch(overrides: Partial<PineconeMatch> = {}): PineconeMatch {
  return { id: 'chunk_doc-pub-1_0', score: 0.9, metadata: {}, ...overrides };
}

describe('SearchService', () => {
  let service: SearchService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let configMock: { get: jest.Mock };
  let openaiServiceMock: { generateEmbedding: jest.Mock };
  let embeddingCacheMock: { get: jest.Mock; set: jest.Mock };
  let pineconeServiceMock: { query: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    configMock = { get: jest.fn().mockReturnValue(undefined) };
    openaiServiceMock = { generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    embeddingCacheMock = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    pineconeServiceMock = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: OpenaiService, useValue: openaiServiceMock },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: embeddingCacheMock },
        { provide: PineconeService, useValue: pineconeServiceMock },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  describe('query embedding — cache-aware path', () => {
    it('reuses a cached embedding and skips generateEmbedding on a cache hit', async () => {
      embeddingCacheMock.get.mockResolvedValue([0.5, 0.5]);
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('what is the return policy?');

      expect(embeddingCacheMock.get).toHaveBeenCalledWith('what is the return policy?');
      expect(openaiServiceMock.generateEmbedding).not.toHaveBeenCalled();
      expect(pineconeServiceMock.query).toHaveBeenCalledWith([0.5, 0.5], 5, undefined);
    });

    it('embeds via OpenaiService and caches the result on a cache miss', async () => {
      embeddingCacheMock.get.mockResolvedValue(null);
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('what is the return policy?');

      expect(openaiServiceMock.generateEmbedding).toHaveBeenCalledWith(
        'what is the return policy?',
        'text-embedding-3-small',
      );
      expect(embeddingCacheMock.set).toHaveBeenCalledWith(
        'what is the return policy?',
        [0.1, 0.2, 0.3],
        'text-embedding-3-small',
      );
    });
  });

  describe('search()', () => {
    it('ranks the most relevant result first, resolved to full chunk text + document title', async () => {
      pineconeServiceMock.query.mockResolvedValue([
        makeMatch({ id: 'chunk_doc-pub-1_0', score: 0.95 }),
        makeMatch({ id: 'chunk_doc-pub-2_0', score: 0.8 }),
      ]);
      dbMock.documentChunk.findMany.mockResolvedValue([
        makeChunkWithDocument(
          { pineconeId: 'chunk_doc-pub-2_0', content: 'second chunk' },
          { publicId: 'doc-pub-2', title: 'Second Doc' },
        ),
        makeChunkWithDocument({ pineconeId: 'chunk_doc-pub-1_0', content: 'first chunk' }),
      ] as never);

      const results = await service.search('query text');

      expect(results).toEqual([
        expect.objectContaining({
          chunkPublicId: 'chunk-pub-1',
          documentPublicId: 'doc-pub-1',
          documentTitle: 'Return Policy',
          content: 'first chunk',
          score: 0.95,
        }),
        expect.objectContaining({
          documentPublicId: 'doc-pub-2',
          documentTitle: 'Second Doc',
          content: 'second chunk',
          score: 0.8,
        }),
      ]);
    });

    it('excludes results below the similarity threshold', async () => {
      pineconeServiceMock.query.mockResolvedValue([
        makeMatch({ id: 'chunk_doc-pub-1_0', score: 0.9 }),
        makeMatch({ id: 'chunk_doc-pub-2_0', score: 0.5 }),
      ]);
      dbMock.documentChunk.findMany.mockResolvedValue([
        makeChunkWithDocument({ pineconeId: 'chunk_doc-pub-1_0' }),
      ] as never);

      const results = await service.search('query text', { similarityThreshold: 0.7 });

      expect(dbMock.documentChunk.findMany).toHaveBeenCalledWith({
        where: { pineconeId: { in: ['chunk_doc-pub-1_0'] } },
        include: { document: true },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.score).toBe(0.9);
    });

    it('narrows the Pinecone query filter by categoryFilter', async () => {
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('query text', { categoryFilter: 'docs' });

      expect(pineconeServiceMock.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, {
        category: 'docs',
      });
    });

    it('narrows the Pinecone query filter by documentIds', async () => {
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('query text', { documentIds: ['doc-pub-1', 'doc-pub-2'] });

      expect(pineconeServiceMock.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, {
        documentId: { $in: ['doc-pub-1', 'doc-pub-2'] },
      });
    });

    it('combines categoryFilter and documentIds into a single filter', async () => {
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('query text', { categoryFilter: 'docs', documentIds: ['doc-pub-1'] });

      expect(pineconeServiceMock.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, {
        category: 'docs',
        documentId: { $in: ['doc-pub-1'] },
      });
    });

    it('respects a custom topK', async () => {
      pineconeServiceMock.query.mockResolvedValue([]);

      await service.search('query text', { topK: 10 });

      expect(pineconeServiceMock.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10, undefined);
    });

    it('returns an empty array without throwing when Pinecone returns no matches', async () => {
      pineconeServiceMock.query.mockResolvedValue([]);

      const results = await service.search('query text');

      expect(results).toEqual([]);
      expect(dbMock.documentChunk.findMany).not.toHaveBeenCalled();
    });

    it('skips a match with no corresponding document_chunks row rather than throwing', async () => {
      pineconeServiceMock.query.mockResolvedValue([makeMatch({ id: 'chunk_orphan_0' })]);
      dbMock.documentChunk.findMany.mockResolvedValue([]);

      const results = await service.search('query text');

      expect(results).toEqual([]);
    });
  });

  describe('searchWithScores()', () => {
    it('delegates to search() and returns the same shape (score already included)', async () => {
      pineconeServiceMock.query.mockResolvedValue([makeMatch({ score: 0.85 })]);
      dbMock.documentChunk.findMany.mockResolvedValue([makeChunkWithDocument()] as never);

      const results = await service.searchWithScores('query text');

      expect(results).toEqual([expect.objectContaining({ score: 0.85 })]);
    });
  });
});
