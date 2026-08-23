import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PineconeService } from '../services/pinecone.service';

const mockIndexHandle = {
  upsert: jest.fn(),
  query: jest.fn(),
  deleteMany: jest.fn(),
  describeIndexStats: jest.fn(),
};

const mockNamespace = jest.fn().mockReturnValue(mockIndexHandle);
const mockIndex = jest.fn().mockReturnValue({ namespace: mockNamespace });

jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn().mockImplementation(() => ({ index: mockIndex })),
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const DEFAULT_CONFIG: Record<string, unknown> = {
  'pinecone.apiKey': 'test-api-key',
  'pinecone.index': 'test-index',
  'pinecone.namespace': 'documents',
};

async function createService(overrides: Record<string, unknown> = {}): Promise<PineconeService> {
  const merged = { ...DEFAULT_CONFIG, ...overrides };
  const configMock = {
    get: jest.fn().mockImplementation((key: string) => merged[key]),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PineconeService,
      { provide: ConfigService, useValue: configMock },
      { provide: AppLoggerService, useValue: mockLogger },
    ],
  }).compile();

  return module.get<PineconeService>(PineconeService);
}

describe('PineconeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNamespace.mockReturnValue(mockIndexHandle);
    mockIndex.mockReturnValue({ namespace: mockNamespace });
  });

  describe('upsert()', () => {
    it('upserts vectors scoped to the configured index/namespace', async () => {
      const service = await createService();
      mockIndexHandle.upsert.mockResolvedValue(undefined);

      await service.upsert([
        { id: 'chunk_doc-1_0', values: [0.1, 0.2], metadata: { documentId: 'doc-1' } },
      ]);

      expect(mockIndex).toHaveBeenCalledWith({ name: 'test-index' });
      expect(mockNamespace).toHaveBeenCalledWith('documents');
      expect(mockIndexHandle.upsert).toHaveBeenCalledWith({
        records: [{ id: 'chunk_doc-1_0', values: [0.1, 0.2], metadata: { documentId: 'doc-1' } }],
      });
    });
  });

  describe('query()', () => {
    it('queries with topK and includeMetadata, mapping results to PineconeMatch[]', async () => {
      const service = await createService();
      mockIndexHandle.query.mockResolvedValue({
        matches: [
          { id: 'chunk-1', score: 0.92, metadata: { documentTitle: 'Doc A' } },
          { id: 'chunk-2', score: 0.81, metadata: { documentTitle: 'Doc B' } },
        ],
        namespace: 'documents',
      });

      const result = await service.query([0.1, 0.2], 5);

      expect(mockIndexHandle.query).toHaveBeenCalledWith({
        vector: [0.1, 0.2],
        topK: 5,
        includeMetadata: true,
      });
      expect(result).toEqual([
        { id: 'chunk-1', score: 0.92, metadata: { documentTitle: 'Doc A' } },
        { id: 'chunk-2', score: 0.81, metadata: { documentTitle: 'Doc B' } },
      ]);
    });

    it('forwards a filter only when provided', async () => {
      const service = await createService();
      mockIndexHandle.query.mockResolvedValue({ matches: [], namespace: 'documents' });

      await service.query([0.1], 3, { category: 'faq' });

      expect(mockIndexHandle.query).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { category: 'faq' } }),
      );

      await service.query([0.1], 3);

      expect(mockIndexHandle.query).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ filter: expect.anything() }),
      );
    });

    it('defaults a missing score to 0', async () => {
      const service = await createService();
      mockIndexHandle.query.mockResolvedValue({
        matches: [{ id: 'chunk-1', metadata: {} }],
        namespace: 'documents',
      });

      const result = await service.query([0.1], 1);

      expect(result[0]?.score).toBe(0);
    });
  });

  describe('deleteByIds()', () => {
    it('deletes vectors by id array', async () => {
      const service = await createService();
      mockIndexHandle.deleteMany.mockResolvedValue(undefined);

      await service.deleteByIds(['chunk-1', 'chunk-2']);

      expect(mockIndexHandle.deleteMany).toHaveBeenCalledWith({ ids: ['chunk-1', 'chunk-2'] });
    });
  });

  describe('deleteByFilter()', () => {
    it('deletes vectors by metadata filter', async () => {
      const service = await createService();
      mockIndexHandle.deleteMany.mockResolvedValue(undefined);

      await service.deleteByFilter({ documentId: 'doc-1' });

      expect(mockIndexHandle.deleteMany).toHaveBeenCalledWith({ filter: { documentId: 'doc-1' } });
    });
  });

  describe('describeIndex()', () => {
    it('maps totalRecordCount and dimension from describeIndexStats()', async () => {
      const service = await createService();
      mockIndexHandle.describeIndexStats.mockResolvedValue({
        totalRecordCount: 1234,
        dimension: 1536,
      });

      const result = await service.describeIndex();

      expect(result).toEqual({ totalRecordCount: 1234, dimension: 1536 });
    });

    it('defaults totalRecordCount to 0 when the SDK response omits it', async () => {
      const service = await createService();
      mockIndexHandle.describeIndexStats.mockResolvedValue({});

      const result = await service.describeIndex();

      expect(result.totalRecordCount).toBe(0);
    });
  });

  describe('not-configured guard', () => {
    it('throws ServiceUnavailableException without calling the SDK when apiKey is missing', async () => {
      const service = await createService({ 'pinecone.apiKey': undefined });

      await expect(service.upsert([])).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockIndex).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException without calling the SDK when index name is missing', async () => {
      const service = await createService({ 'pinecone.index': undefined });

      await expect(service.query([0.1], 5)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockIndex).not.toHaveBeenCalled();
    });

    it('applies the guard to deleteByIds/deleteByFilter/describeIndex as well', async () => {
      const service = await createService({ 'pinecone.apiKey': undefined });

      await expect(service.deleteByIds(['a'])).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.deleteByFilter({ a: 1 })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.describeIndex()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
