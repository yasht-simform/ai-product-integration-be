import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { Document } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { DocumentService } from '../services/document.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';
import { EmbeddingService } from '../services/embedding.service';
import { PineconeService } from '../services/pinecone.service';
import type { ChunkDescriptor } from '../types/rag.types';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeDocumentRow(overrides: Partial<Document> = {}): Document {
  return {
    id: BigInt(1),
    publicId: 'doc-pub-1',
    title: 'Return Policy',
    description: 'How returns work',
    sourceType: 'txt',
    originalFilename: null,
    fileSize: null,
    totalChunks: 0,
    totalTokens: 0,
    embeddingModel: 'text-embedding-3-small',
    embeddingStatus: 'pending',
    category: 'docs',
    tags: ['policy'],
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeChunks(count: number): ChunkDescriptor[] {
  return Array.from({ length: count }, (_, i) => ({
    content: `chunk ${i} content`,
    chunkIndex: i,
    tokenCount: 5,
    startChar: i * 20,
    endChar: i * 20 + 15,
  }));
}

describe('DocumentService — ingestion pipeline', () => {
  let service: DocumentService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let configMock: { get: jest.Mock };
  let embeddingCacheMock: { get: jest.Mock; set: jest.Mock };
  let openaiServiceMock: { generateEmbeddingsBatch: jest.Mock };
  let pineconeServiceMock: { upsert: jest.Mock; deleteByFilter: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    configMock = { get: jest.fn().mockReturnValue(undefined) };
    embeddingCacheMock = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    openaiServiceMock = { generateEmbeddingsBatch: jest.fn() };
    pineconeServiceMock = { upsert: jest.fn(), deleteByFilter: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: TokenService, useValue: {} },
        { provide: OpenaiService, useValue: openaiServiceMock },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: embeddingCacheMock },
        { provide: PineconeService, useValue: pineconeServiceMock },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);

    // document.update is called for both the 'processing' transition and the final
    // 'completed'/'failed' transition — always resolve with a row reflecting what was written.
    dbMock.document.update.mockImplementation(({ data }) =>
      Promise.resolve(makeDocumentRow(data as Partial<Document>)),
    );
    dbMock.documentChunk.createMany.mockResolvedValue({ count: 0 });
  });

  describe('createFromText() — happy path', () => {
    it('runs chunk → cache-check → embed-on-miss → cache-set → upsert → persist → status-update in order', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(2));
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);

      const callOrder: string[] = [];
      embeddingCacheMock.get.mockImplementation((text: string) => {
        callOrder.push(`cache-get:${text}`);
        return Promise.resolve(null);
      });
      openaiServiceMock.generateEmbeddingsBatch.mockImplementation((texts: string[]) => {
        callOrder.push('embed');
        return Promise.resolve(texts.map(() => [0.1, 0.2]));
      });
      embeddingCacheMock.set.mockImplementation((text: string) => {
        callOrder.push(`cache-set:${text}`);
        return Promise.resolve();
      });
      pineconeServiceMock.upsert.mockImplementation(() => {
        callOrder.push('pinecone-upsert');
        return Promise.resolve();
      });
      dbMock.documentChunk.createMany.mockImplementation(() => {
        callOrder.push('persist');
        return Promise.resolve({ count: 2 });
      });
      dbMock.document.update.mockImplementation(({ data }) => {
        const typedData = data as { embeddingStatus?: string };
        callOrder.push(`status-update:${typedData.embeddingStatus}`);
        return Promise.resolve(makeDocumentRow(typedData));
      });

      const result = await service.createFromText({
        title: 'Return Policy',
        content: 'chunk 0 content ... chunk 1 content',
      });

      expect(callOrder).toEqual([
        'status-update:processing',
        'cache-get:chunk 0 content',
        'cache-get:chunk 1 content',
        'embed',
        'cache-set:chunk 0 content',
        'cache-set:chunk 1 content',
        'pinecone-upsert',
        'persist',
        'status-update:completed',
      ]);
      expect(result.embeddingStatus).toBe('completed');
    });

    it('creates the document row with sourceType "txt" before ingesting', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue([]);

      await service.createFromText({ title: 'Notes', content: 'some raw text' });

      expect(dbMock.document.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sourceType: 'txt' }) }),
      );
    });

    it('upserts vectors with the documented id format and metadata shape', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(1));
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);

      await service.createFromText({ content: 'chunk 0 content' });

      expect(pineconeServiceMock.upsert).toHaveBeenCalledWith([
        {
          id: 'chunk_doc-pub-1_0',
          values: [0.1, 0.2, 0.3],
          metadata: {
            documentId: 'doc-pub-1',
            documentTitle: 'Return Policy',
            chunkIndex: 0,
            tokenCount: 5,
            category: 'docs',
          },
        },
      ]);
    });

    it('persists a DocumentChunk row per chunk with content, tokenCount, offsets, and pineconeId', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(1));
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([[0.1, 0.2]]);

      await service.createFromText({ content: 'chunk 0 content' });

      expect(dbMock.documentChunk.createMany).toHaveBeenCalledWith({
        data: [
          {
            documentId: BigInt(1),
            chunkIndex: 0,
            content: 'chunk 0 content',
            tokenCount: 5,
            startChar: 0,
            endChar: 15,
            pineconeId: 'chunk_doc-pub-1_0',
            embeddingStatus: 'completed',
          },
        ],
      });
    });

    it('sets document.totalChunks/totalTokens to the actual persisted chunk count/sum', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(3));
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([[0.1], [0.2], [0.3]]);

      await service.createFromText({ content: 'text' });

      expect(dbMock.document.update).toHaveBeenLastCalledWith({
        where: { id: BigInt(1) },
        data: { embeddingStatus: 'completed', totalChunks: 3, totalTokens: 15 },
      });
    });
  });

  describe('embedding cache', () => {
    it('skips generateEmbeddingsBatch entirely on an all-cache-hit run', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(2));
      embeddingCacheMock.get.mockResolvedValue([0.9, 0.9]);

      await service.createFromText({ content: 'text' });

      expect(openaiServiceMock.generateEmbeddingsBatch).not.toHaveBeenCalled();
      expect(embeddingCacheMock.set).not.toHaveBeenCalled();
      expect(pineconeServiceMock.upsert).toHaveBeenCalledWith([
        expect.objectContaining({ values: [0.9, 0.9] }),
        expect.objectContaining({ values: [0.9, 0.9] }),
      ]);
    });

    it('embeds only the cache-miss chunks and merges them with cache hits in original order', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(3));
      embeddingCacheMock.get.mockImplementation((text: string) =>
        Promise.resolve(text.includes('chunk 1') ? [0.5, 0.5] : null),
      );
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([
        [0.1, 0.1],
        [0.3, 0.3],
      ]);

      await service.createFromText({ content: 'text' });

      expect(openaiServiceMock.generateEmbeddingsBatch).toHaveBeenCalledWith(
        ['chunk 0 content', 'chunk 2 content'],
        'text-embedding-3-small',
      );
      expect(pineconeServiceMock.upsert).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'chunk_doc-pub-1_0', values: [0.1, 0.1] }),
        expect.objectContaining({ id: 'chunk_doc-pub-1_1', values: [0.5, 0.5] }),
        expect.objectContaining({ id: 'chunk_doc-pub-1_2', values: [0.3, 0.3] }),
      ]);
    });

    it('batches cache misses into groups no larger than ragConfig.embeddingBatchSize', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(5));
      configMock.get.mockImplementation((key: string) =>
        key === 'rag.embeddingBatchSize' ? 2 : undefined,
      );
      openaiServiceMock.generateEmbeddingsBatch.mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1])),
      );

      await service.createFromText({ content: 'text' });

      expect(openaiServiceMock.generateEmbeddingsBatch).toHaveBeenCalledTimes(3);
      expect(openaiServiceMock.generateEmbeddingsBatch).toHaveBeenNthCalledWith(
        1,
        ['chunk 0 content', 'chunk 1 content'],
        'text-embedding-3-small',
      );
      expect(openaiServiceMock.generateEmbeddingsBatch).toHaveBeenNthCalledWith(
        3,
        ['chunk 4 content'],
        'text-embedding-3-small',
      );
    });
  });

  describe('failure handling', () => {
    it('sets embeddingStatus to failed and resolves (does not throw) when a mid-pipeline step rejects', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue(makeChunks(1));
      openaiServiceMock.generateEmbeddingsBatch.mockResolvedValue([[0.1]]);
      pineconeServiceMock.upsert.mockRejectedValue(new Error('Pinecone unavailable'));

      const result = await service.createFromText({ content: 'chunk 0 content' });

      expect(result.embeddingStatus).toBe('failed');
      expect(dbMock.documentChunk.createMany).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Ingestion failed for document doc-pub-1'),
      );
      expect(dbMock.document.update).toHaveBeenLastCalledWith({
        where: { id: BigInt(1) },
        data: { embeddingStatus: 'failed' },
      });
    });

    it('sets embeddingStatus to failed when chunking itself throws', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockRejectedValue(new Error('splitter exploded'));

      const result = await service.createFromText({ content: 'text' });

      expect(result.embeddingStatus).toBe('failed');
      expect(embeddingCacheMock.get).not.toHaveBeenCalled();
      expect(pineconeServiceMock.upsert).not.toHaveBeenCalled();
    });
  });
});
