import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { Document, DocumentChunk } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { DocumentService } from '../services/document.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';
import { EmbeddingService } from '../services/embedding.service';
import { PineconeService } from '../services/pinecone.service';

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

function makeChunkRow(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    id: BigInt(1),
    publicId: 'chunk-pub-1',
    documentId: BigInt(1),
    chunkIndex: 0,
    content: 'chunk text',
    tokenCount: 10,
    startChar: 0,
    endChar: 10,
    pineconeId: null,
    embeddingStatus: 'pending',
    metadata: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('DocumentService', () => {
  let service: DocumentService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let pineconeServiceMock: { deleteByFilter: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    pineconeServiceMock = { deleteByFilter: jest.fn() };
    configMock = { get: jest.fn().mockReturnValue('text-embedding-3-small') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: TokenService, useValue: {} },
        { provide: OpenaiService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: {} },
        { provide: PineconeService, useValue: pineconeServiceMock },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    jest.clearAllMocks();
    configMock.get.mockReturnValue('text-embedding-3-small');
  });

  describe('create()', () => {
    it('persists a document with pending status and zeroed chunk/token counts', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());

      const result = await service.create({
        title: 'Return Policy',
        description: 'How returns work',
        sourceType: 'txt',
        category: 'docs',
        tags: ['policy'],
      });

      expect(dbMock.document.create).toHaveBeenCalledWith({
        data: {
          title: 'Return Policy',
          description: 'How returns work',
          sourceType: 'txt',
          category: 'docs',
          tags: ['policy'],
          embeddingModel: 'text-embedding-3-small',
          embeddingStatus: 'pending',
          totalChunks: 0,
          totalTokens: 0,
        },
      });
      expect(result.embeddingStatus).toBe('pending');
      expect(result.totalChunks).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it('defaults title to "Untitled Document" when omitted', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow({ title: 'Untitled Document' }));

      await service.create({ sourceType: 'generated' });

      expect(dbMock.document.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: 'Untitled Document' }) }),
      );
    });
  });

  describe('findAll()', () => {
    it('applies category/status/tags/search filters and pagination', async () => {
      dbMock.document.findMany.mockResolvedValue([makeDocumentRow()]);
      dbMock.document.count.mockResolvedValue(1);

      const result = await service.findAll({
        category: 'docs',
        status: 'pending',
        tags: 'policy, returns',
        search: 'return',
        page: 2,
        limit: 10,
      });

      expect(dbMock.document.findMany).toHaveBeenCalledWith({
        where: {
          category: 'docs',
          embeddingStatus: 'pending',
          tags: { hasSome: ['policy', 'returns'] },
          OR: [
            { title: { contains: 'return', mode: 'insensitive' } },
            { description: { contains: 'return', mode: 'insensitive' } },
          ],
        },
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        data: [expect.objectContaining({ publicId: 'doc-pub-1' })],
        total: 1,
        page: 2,
        limit: 10,
      });
    });

    it('defaults to page 1 / limit 20 with no filters', async () => {
      dbMock.document.findMany.mockResolvedValue([]);
      dbMock.document.count.mockResolvedValue(0);

      await service.findAll({});

      expect(dbMock.document.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne()', () => {
    it('returns the document with an empty chunks array when none exist', async () => {
      dbMock.document.findUnique.mockResolvedValue({ ...makeDocumentRow(), chunks: [] } as never);

      const result = await service.findOne('doc-pub-1');

      expect(result.chunks).toEqual([]);
    });

    it('returns the document with its chunks mapped', async () => {
      dbMock.document.findUnique.mockResolvedValue({
        ...makeDocumentRow(),
        chunks: [makeChunkRow()],
      } as never);

      const result = await service.findOne('doc-pub-1');

      expect(result.chunks).toEqual([
        expect.objectContaining({ publicId: 'chunk-pub-1', chunkIndex: 0 }),
      ]);
    });

    it('throws NotFoundException when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update()', () => {
    it('updates only metadata fields', async () => {
      dbMock.document.findUnique.mockResolvedValue(makeDocumentRow());
      dbMock.document.update.mockResolvedValue(makeDocumentRow({ title: 'Updated Title' }));

      const result = await service.update('doc-pub-1', { title: 'Updated Title' });

      expect(dbMock.document.update).toHaveBeenCalledWith({
        where: { publicId: 'doc-pub-1' },
        data: {
          title: 'Updated Title',
          description: undefined,
          category: undefined,
          tags: undefined,
        },
      });
      expect(result.title).toBe('Updated Title');
    });

    it('throws NotFoundException when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete()', () => {
    it('deletes the row and cleans up the matching Pinecone vectors', async () => {
      dbMock.document.findUnique.mockResolvedValue(makeDocumentRow());
      dbMock.document.delete.mockResolvedValue(makeDocumentRow());

      await service.delete('doc-pub-1');

      expect(dbMock.document.delete).toHaveBeenCalledWith({ where: { publicId: 'doc-pub-1' } });
      expect(pineconeServiceMock.deleteByFilter).toHaveBeenCalledWith({
        documentId: 'doc-pub-1',
      });
    });

    it('throws NotFoundException without touching Pinecone when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(pineconeServiceMock.deleteByFilter).not.toHaveBeenCalled();
    });
  });
});
