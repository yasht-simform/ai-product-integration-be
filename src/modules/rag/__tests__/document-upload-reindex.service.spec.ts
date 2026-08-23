import { BadRequestException, NotFoundException } from '@nestjs/common';
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

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'notes.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 100,
    buffer: Buffer.from('plain text content'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('DocumentService — upload / reindex / status / chunks', () => {
  let service: DocumentService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let configMock: { get: jest.Mock };
  let pineconeServiceMock: { upsert: jest.Mock; deleteByFilter: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    configMock = { get: jest.fn().mockReturnValue('text-embedding-3-small') };
    pineconeServiceMock = { upsert: jest.fn(), deleteByFilter: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: TokenService, useValue: {} },
        { provide: OpenaiService, useValue: { generateEmbeddingsBatch: jest.fn() } },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: PineconeService, useValue: pineconeServiceMock },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);

    dbMock.document.update.mockImplementation(({ data }) =>
      Promise.resolve(makeDocumentRow(data as Partial<Document>)),
    );
    dbMock.documentChunk.createMany.mockResolvedValue({ count: 0 });
  });

  describe('ingestFromFile()', () => {
    it('rejects unsupported file types before any parsing is attempted', async () => {
      const parseSourceSpy = jest.spyOn(service, 'parseSource');
      const file = makeFile({ originalname: 'malware.exe' });

      await expect(service.ingestFromFile(file)).rejects.toBeInstanceOf(BadRequestException);
      expect(parseSourceSpy).not.toHaveBeenCalled();
      expect(dbMock.document.create).not.toHaveBeenCalled();
    });

    it('rejects a file with no extension', async () => {
      const file = makeFile({ originalname: 'README' });

      await expect(service.ingestFromFile(file)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('populates sourceType/originalFilename/fileSize from the Multer file object', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      jest.spyOn(service, 'chunkText').mockResolvedValue([]);
      const file = makeFile({
        originalname: 'report.pdf',
        mimetype: 'application/pdf',
        size: 45230,
        buffer: Buffer.from('%PDF-1.1 fixture'),
      });
      jest.spyOn(service, 'parseSource').mockResolvedValue('extracted pdf text');

      await service.ingestFromFile(file);

      expect(dbMock.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'report.pdf',
          sourceType: 'pdf',
          originalFilename: 'report.pdf',
          fileSize: 45230,
        }),
      });
    });

    it('parses the buffer using the extension-derived source type, then ingests the extracted text', async () => {
      dbMock.document.create.mockResolvedValue(makeDocumentRow());
      const parseSourceSpy = jest.spyOn(service, 'parseSource').mockResolvedValue('extracted text');
      const chunkTextSpy = jest.spyOn(service, 'chunkText').mockResolvedValue([]);
      const file = makeFile({ originalname: 'notes.md', buffer: Buffer.from('# Notes') });

      await service.ingestFromFile(file);

      expect(parseSourceSpy).toHaveBeenCalledWith(file.buffer, 'md');
      expect(chunkTextSpy).toHaveBeenCalledWith('extracted text', 'text-embedding-3-small');
    });
  });

  describe('reindexDocument()', () => {
    it('reconstructs the original text exactly from existing chunk offsets', async () => {
      const originalText =
        'The quick brown fox jumps over the lazy dog and then runs away quickly into the forest.';
      const chunkRows = [
        makeChunkRow({ chunkIndex: 0, content: originalText.slice(0, 30), startChar: 0 }),
        makeChunkRow({ chunkIndex: 1, content: originalText.slice(20, 60), startChar: 20 }),
        makeChunkRow({
          chunkIndex: 2,
          content: originalText.slice(50),
          startChar: 50,
          endChar: originalText.length,
        }),
      ];
      dbMock.document.findUnique.mockResolvedValue({
        ...makeDocumentRow(),
        chunks: chunkRows,
      } as never);
      dbMock.documentChunk.deleteMany.mockResolvedValue({ count: chunkRows.length });
      const chunkTextSpy = jest.spyOn(service, 'chunkText').mockResolvedValue([]);

      await service.reindexDocument('doc-pub-1');

      expect(chunkTextSpy).toHaveBeenCalledWith(originalText, 'text-embedding-3-small');
    });

    it('deletes prior chunks and Pinecone vectors before writing new ones', async () => {
      dbMock.document.findUnique.mockResolvedValue({
        ...makeDocumentRow(),
        chunks: [makeChunkRow()],
      } as never);
      dbMock.documentChunk.deleteMany.mockResolvedValue({ count: 1 });
      jest.spyOn(service, 'chunkText').mockResolvedValue([]);

      await service.reindexDocument('doc-pub-1');

      expect(dbMock.documentChunk.deleteMany).toHaveBeenCalledWith({
        where: { documentId: BigInt(1) },
      });
      expect(pineconeServiceMock.deleteByFilter).toHaveBeenCalledWith({
        documentId: 'doc-pub-1',
      });
    });

    it('re-runs the ingestion pipeline against the reconstructed text', async () => {
      dbMock.document.findUnique.mockResolvedValue({
        ...makeDocumentRow(),
        chunks: [makeChunkRow({ content: 'hello world', startChar: 0, endChar: 11 })],
      } as never);
      dbMock.documentChunk.deleteMany.mockResolvedValue({ count: 1 });
      jest.spyOn(service, 'chunkText').mockResolvedValue([]);

      const result = await service.reindexDocument('doc-pub-1');

      expect(result.embeddingStatus).toBe('completed');
      expect(dbMock.document.update).toHaveBeenLastCalledWith({
        where: { id: BigInt(1) },
        data: { embeddingStatus: 'completed', totalChunks: 0, totalTokens: 0 },
      });
    });

    it('throws NotFoundException when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.reindexDocument('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(dbMock.documentChunk.deleteMany).not.toHaveBeenCalled();
      expect(pineconeServiceMock.deleteByFilter).not.toHaveBeenCalled();
    });
  });

  describe('getIngestionStatus()', () => {
    it('returns embeddingStatus/totalChunks/totalTokens for polling', async () => {
      dbMock.document.findUnique.mockResolvedValue(
        makeDocumentRow({ embeddingStatus: 'completed', totalChunks: 5, totalTokens: 250 }),
      );

      const result = await service.getIngestionStatus('doc-pub-1');

      expect(result).toEqual({ embeddingStatus: 'completed', totalChunks: 5, totalTokens: 250 });
    });

    it('throws NotFoundException when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.getIngestionStatus('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getChunks()', () => {
    it('returns paginated chunks ordered by chunkIndex', async () => {
      dbMock.document.findUnique.mockResolvedValue(makeDocumentRow());
      dbMock.documentChunk.findMany.mockResolvedValue([makeChunkRow()]);
      dbMock.documentChunk.count.mockResolvedValue(1);

      const result = await service.getChunks('doc-pub-1', { page: 1, limit: 20 });

      expect(dbMock.documentChunk.findMany).toHaveBeenCalledWith({
        where: { documentId: BigInt(1) },
        orderBy: { chunkIndex: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: [expect.objectContaining({ publicId: 'chunk-pub-1' })],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('defaults to page 1 / limit 20 when omitted', async () => {
      dbMock.document.findUnique.mockResolvedValue(makeDocumentRow());
      dbMock.documentChunk.findMany.mockResolvedValue([]);
      dbMock.documentChunk.count.mockResolvedValue(0);

      await service.getChunks('doc-pub-1', {});

      expect(dbMock.documentChunk.findMany).toHaveBeenCalledWith({
        where: { documentId: BigInt(1) },
        orderBy: { chunkIndex: 'asc' },
        skip: 0,
        take: 20,
      });
    });

    it('throws NotFoundException when the document does not exist', async () => {
      dbMock.document.findUnique.mockResolvedValue(null);

      await expect(service.getChunks('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
