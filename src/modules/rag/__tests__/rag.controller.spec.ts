import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { AskDto } from '../dto/ask.dto';
import { EvaluateDto } from '../dto/evaluate.dto';
import { GenerateDocumentsDto } from '../dto/generate-documents.dto';
import { GenerateQaDto } from '../dto/generate-qa.dto';
import { QueryQaPairsDto } from '../dto/query-qa-pairs.dto';
import { SearchDto } from '../dto/search.dto';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { RagController } from '../rag.controller';
import { DocumentService } from '../services/document.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';
import { MockDataService } from '../services/mock-data.service';
import { PineconeService } from '../services/pinecone.service';
import { RagService } from '../services/rag.service';
import { SearchService } from '../services/search.service';
import type {
  DocumentChunkEntity,
  DocumentEntity,
  DocumentWithChunks,
  EvaluationResult,
  PaginatedChunksResult,
  PaginatedDocumentsResult,
  PaginatedQaPairsResult,
  QaPairEntity,
  RagResult,
  SearchResult,
} from '../types/rag.types';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url) —
// RagController imports DocumentService, which imports DatabaseService.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

// RagController now also imports MockDataService (AI-053), which imports the ESM-only
// @faker-js/faker at module load time — same Jest/CJS-transform incompatibility documented in
// AI-048 (see mock-data.service.spec.ts). MockDataService is provided via useValue below, so
// faker is never actually called; this stub only needs to satisfy the module load.
jest.mock('@faker-js/faker', () => ({ faker: {} }));

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkPublicId: 'chunk-pub-1',
    documentPublicId: 'doc-pub-1',
    documentTitle: 'Return Policy',
    content: 'Items can be returned within 30 days.',
    chunkIndex: 3,
    score: 0.92,
    category: 'docs',
    ...overrides,
  };
}

function makeRagResult(overrides: Partial<RagResult> = {}): RagResult {
  return {
    answer: 'Items can be returned within 30 days. [Source: Return Policy]',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    sources: [
      {
        documentTitle: 'Return Policy',
        documentPublicId: 'doc-pub-1',
        chunkContent: 'Items can be returned within 30 days.',
        chunkIndex: 3,
        similarityScore: 0.92,
      },
    ],
    usage: { inputTokens: 450, outputTokens: 85, totalTokens: 535 },
    estimatedCost: 0,
    latencyMs: 2300,
    chunksRetrieved: 1,
    searchLatencyMs: 120,
    generationLatencyMs: 2180,
    ...overrides,
  };
}

function makeDocumentEntity(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeChunkEntity(overrides: Partial<DocumentChunkEntity> = {}): DocumentChunkEntity {
  return {
    publicId: 'chunk-pub-1',
    chunkIndex: 0,
    content: 'chunk text',
    tokenCount: 10,
    startChar: 0,
    endChar: 10,
    embeddingStatus: 'completed',
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

function makeQaPairEntity(overrides: Partial<QaPairEntity> = {}): QaPairEntity {
  return {
    publicId: 'qa-pub-1',
    question: 'What is the return policy?',
    expectedAnswer: 'Items can be returned within 30 days.',
    sourceDocumentId: 'doc-pub-1',
    complexity: 'simple',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeEvaluationResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    totalQuestions: 100,
    correct: 72,
    partiallyCorrect: 15,
    incorrect: 8,
    appropriateIDK: 5,
    accuracy: 0.72,
    avgLatencyMs: 2100,
    avgTokens: 520,
    byComplexity: {
      simple: { total: 60, correct: 52, accuracy: 0.87 },
      'multi-step': { total: 25, correct: 15, accuracy: 0.6 },
      'edge-case': { total: 15, correct: 5, accuracy: 0.33 },
    },
    ...overrides,
  };
}

// ── DTO validation ──────────────────────────────────────────────────────────

describe('UploadDocumentDto validation', () => {
  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(UploadDocumentDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid category', async () => {
    const dto = plainToInstance(UploadDocumentDto, { category: 'unknown' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(UploadDocumentDto, {
      title: 'Return Policy',
      description: 'How returns work',
      category: 'faq',
      tags: 'policy,returns',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SearchDto validation', () => {
  it('rejects a missing query', async () => {
    const dto = plainToInstance(SearchDto, {});

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'query')).toBe(true);
  });

  it('rejects an invalid category', async () => {
    const dto = plainToInstance(SearchDto, { query: 'returns', category: 'unknown' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('rejects a similarityThreshold above 1', async () => {
    const dto = plainToInstance(SearchDto, { query: 'returns', similarityThreshold: 1.5 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'similarityThreshold')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(SearchDto, {
      query: 'What is the return policy?',
      topK: 3,
      similarityThreshold: 0.8,
      category: 'docs',
      documentIds: ['doc-pub-1'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('AskDto validation', () => {
  it('rejects a missing question', async () => {
    const dto = plainToInstance(AskDto, {});

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'question')).toBe(true);
  });

  it('rejects an invalid model string', async () => {
    const dto = plainToInstance(AskDto, { question: 'What is the return policy?', model: '  ' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'model')).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(AskDto, { question: 'What is the return policy?' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(AskDto, {
      question: 'What is the return policy?',
      topK: 3,
      model: 'gpt-4o-mini',
      temperature: 0.5,
      category: 'faq',
      includeSourceChunks: false,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('GenerateDocumentsDto validation', () => {
  it('rejects a missing count', async () => {
    const dto = plainToInstance(GenerateDocumentsDto, {});

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'count')).toBe(true);
  });

  it('rejects an invalid category in the categories array', async () => {
    const dto = plainToInstance(GenerateDocumentsDto, { count: 5, categories: ['unknown'] });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'categories')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(GenerateDocumentsDto, {
      count: 5,
      categories: ['docs', 'faq'],
      minWords: 100,
      maxWords: 500,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('GenerateQaDto validation', () => {
  it('rejects a missing count', async () => {
    const dto = plainToInstance(GenerateQaDto, {});

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'count')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(GenerateQaDto, { count: 10, documentIds: ['doc-pub-1'] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryQaPairsDto validation', () => {
  it('rejects an invalid complexity', async () => {
    const dto = plainToInstance(QueryQaPairsDto, { complexity: 'unknown' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'complexity')).toBe(true);
  });

  it('accepts string query values, coercing page/limit to numbers', async () => {
    const dto = plainToInstance(QueryQaPairsDto, {
      documentId: 'doc-pub-1',
      complexity: 'simple',
      page: '2',
      limit: '10',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });
});

describe('EvaluateDto validation', () => {
  it('rejects a sampleSize above 200', async () => {
    const dto = plainToInstance(EvaluateDto, { sampleSize: 500 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'sampleSize')).toBe(true);
  });

  it('accepts an empty payload — sampleSize is optional', async () => {
    const dto = plainToInstance(EvaluateDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

// ── Controller delegation ────────────────────────────────────────────────────

describe('RagController', () => {
  let controller: RagController;
  let documentServiceMock: {
    ingestFromFile: jest.Mock;
    createFromText: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    getChunks: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    reindexDocument: jest.Mock;
    getStats: jest.Mock;
  };
  let searchServiceMock: { search: jest.Mock };
  let ragServiceMock: { query: jest.Mock; queryWithConversation: jest.Mock };
  let mockDataServiceMock: {
    generateDocuments: jest.Mock;
    generateQAPairs: jest.Mock;
    seedDefaultDataset: jest.Mock;
    findAllQaPairs: jest.Mock;
    evaluate: jest.Mock;
  };
  let pineconeServiceMock: { describeIndex: jest.Mock };
  let embeddingCacheServiceMock: { getCacheStats: jest.Mock };
  let configServiceMock: { get: jest.Mock };

  beforeEach(async () => {
    documentServiceMock = {
      ingestFromFile: jest.fn(),
      createFromText: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      getChunks: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      reindexDocument: jest.fn(),
      getStats: jest.fn(),
    };
    searchServiceMock = { search: jest.fn() };
    ragServiceMock = { query: jest.fn(), queryWithConversation: jest.fn() };
    mockDataServiceMock = {
      generateDocuments: jest.fn(),
      generateQAPairs: jest.fn(),
      seedDefaultDataset: jest.fn(),
      findAllQaPairs: jest.fn(),
      evaluate: jest.fn(),
    };
    pineconeServiceMock = { describeIndex: jest.fn() };
    embeddingCacheServiceMock = { getCacheStats: jest.fn() };
    configServiceMock = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        { provide: DocumentService, useValue: documentServiceMock },
        { provide: SearchService, useValue: searchServiceMock },
        { provide: RagService, useValue: ragServiceMock },
        { provide: MockDataService, useValue: mockDataServiceMock },
        { provide: PineconeService, useValue: pineconeServiceMock },
        { provide: EmbeddingCacheService, useValue: embeddingCacheServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        {
          provide: AppLoggerService,
          useValue: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
        },
      ],
    })
      // RagController's ask routes carry @UseGuards(ModerationGuard, CostBudgetGuard)/
      // @UseInterceptors(OutputModerationInterceptor) (AI-063/AI-066) — Nest registers classes
      // referenced by these decorators as injectables of the enclosing module at compile() time,
      // even though this spec never exercises the real HTTP guard/interceptor pipeline. Override
      // all three with pass-through stubs so this remains a pure delegation test.
      .overrideGuard(ModerationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CostBudgetGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(OutputModerationInterceptor)
      .useValue({
        intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle(),
      })
      .compile();

    controller = module.get<RagController>(RagController);
  });

  describe('uploadDocument()', () => {
    it('delegates to DocumentService.ingestFromFile() with parsed metadata overrides', async () => {
      const file = makeFile();
      documentServiceMock.ingestFromFile.mockResolvedValue(makeDocumentEntity());
      const dto: UploadDocumentDto = {
        title: 'Custom Title',
        description: 'A description',
        category: 'faq',
        tags: 'policy, returns',
      };

      const result = await controller.uploadDocument(file, dto);

      expect(documentServiceMock.ingestFromFile).toHaveBeenCalledWith(file, {
        title: 'Custom Title',
        description: 'A description',
        category: 'faq',
        tags: ['policy', 'returns'],
      });
      expect(result.publicId).toBe('doc-pub-1');
    });

    it('omits tags when none are provided', async () => {
      const file = makeFile();
      documentServiceMock.ingestFromFile.mockResolvedValue(makeDocumentEntity());

      await controller.uploadDocument(file, {});

      expect(documentServiceMock.ingestFromFile).toHaveBeenCalledWith(file, {
        title: undefined,
        description: undefined,
        category: undefined,
        tags: undefined,
      });
    });

    it('throws BadRequestException when no file is provided', async () => {
      await expect(
        controller.uploadDocument(undefined as unknown as Express.Multer.File, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documentServiceMock.ingestFromFile).not.toHaveBeenCalled();
    });
  });

  describe('createDocumentFromText()', () => {
    it('delegates to DocumentService.createFromText()', async () => {
      documentServiceMock.createFromText.mockResolvedValue(makeDocumentEntity());
      const dto = { content: 'Some raw text', title: 'Return Policy' };

      const result = await controller.createDocumentFromText(dto);

      expect(documentServiceMock.createFromText).toHaveBeenCalledWith(dto);
      expect(result.publicId).toBe('doc-pub-1');
    });
  });

  describe('findAllDocuments()', () => {
    it('delegates to DocumentService.findAll() and maps every item', async () => {
      const paginated: PaginatedDocumentsResult = {
        data: [makeDocumentEntity(), makeDocumentEntity({ publicId: 'doc-pub-2' })],
        total: 2,
        page: 1,
        limit: 20,
      };
      documentServiceMock.findAll.mockResolvedValue(paginated);

      const result = await controller.findAllDocuments({});

      expect(documentServiceMock.findAll).toHaveBeenCalledWith({});
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('findDocument()', () => {
    it('delegates to DocumentService.findOne() and maps chunks', async () => {
      const doc: DocumentWithChunks = { ...makeDocumentEntity(), chunks: [makeChunkEntity()] };
      documentServiceMock.findOne.mockResolvedValue(doc);

      const result = await controller.findDocument('doc-pub-1');

      expect(documentServiceMock.findOne).toHaveBeenCalledWith('doc-pub-1');
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].publicId).toBe('chunk-pub-1');
    });

    it('propagates NotFoundException from the service', async () => {
      documentServiceMock.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findDocument('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findDocumentChunks()', () => {
    it('delegates to DocumentService.getChunks() and maps every chunk', async () => {
      const paginated: PaginatedChunksResult = {
        data: [makeChunkEntity()],
        total: 1,
        page: 1,
        limit: 20,
      };
      documentServiceMock.getChunks.mockResolvedValue(paginated);

      const result = await controller.findDocumentChunks('doc-pub-1', {});

      expect(documentServiceMock.getChunks).toHaveBeenCalledWith('doc-pub-1', {});
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateDocument()', () => {
    it('delegates to DocumentService.update()', async () => {
      documentServiceMock.update.mockResolvedValue(makeDocumentEntity({ title: 'Renamed' }));
      const dto = { title: 'Renamed' };

      const result = await controller.updateDocument('doc-pub-1', dto);

      expect(documentServiceMock.update).toHaveBeenCalledWith('doc-pub-1', dto);
      expect(result.title).toBe('Renamed');
    });
  });

  describe('deleteDocument()', () => {
    it('delegates to DocumentService.delete()', async () => {
      documentServiceMock.delete.mockResolvedValue(undefined);

      await controller.deleteDocument('doc-pub-1');

      expect(documentServiceMock.delete).toHaveBeenCalledWith('doc-pub-1');
    });
  });

  describe('reindexDocument()', () => {
    it('delegates to DocumentService.reindexDocument()', async () => {
      documentServiceMock.reindexDocument.mockResolvedValue(
        makeDocumentEntity({ embeddingStatus: 'processing' }),
      );

      const result = await controller.reindexDocument('doc-pub-1');

      expect(documentServiceMock.reindexDocument).toHaveBeenCalledWith('doc-pub-1');
      expect(result.embeddingStatus).toBe('processing');
    });
  });

  describe('search()', () => {
    it('delegates to SearchService.search() and maps results with a measured latency', async () => {
      searchServiceMock.search.mockResolvedValue([makeSearchResult()]);
      const dto: SearchDto = {
        query: 'What is the return policy?',
        topK: 3,
        similarityThreshold: 0.8,
        category: 'docs',
        documentIds: ['doc-pub-1'],
      };

      const result = await controller.search(dto);

      expect(searchServiceMock.search).toHaveBeenCalledWith(dto.query, {
        topK: 3,
        similarityThreshold: 0.8,
        categoryFilter: 'docs',
        documentIds: ['doc-pub-1'],
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].chunkPublicId).toBe('chunk-pub-1');
      expect(result.totalResults).toBe(1);
      expect(typeof result.searchLatencyMs).toBe('number');
    });

    it('returns an empty results array when nothing matches', async () => {
      searchServiceMock.search.mockResolvedValue([]);

      const result = await controller.search({ query: 'unrelated question' });

      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });
  });

  describe('ask()', () => {
    it('delegates to RagService.query() and maps the result', async () => {
      ragServiceMock.query.mockResolvedValue(makeRagResult());
      const dto: AskDto = {
        question: 'What is the return policy?',
        topK: 3,
        model: 'gpt-4o-mini',
        temperature: 0.5,
        category: 'faq',
      };

      const result = await controller.ask(dto);

      expect(ragServiceMock.query).toHaveBeenCalledWith(dto.question, {
        topK: 3,
        model: 'gpt-4o-mini',
        temperature: 0.5,
        categoryFilter: 'faq',
      });
      expect(result.answer).toBe(makeRagResult().answer);
      expect(result.sources).toHaveLength(1);
      expect(result.usage.totalTokens).toBe(535);
    });

    it('strips sources when includeSourceChunks is false', async () => {
      ragServiceMock.query.mockResolvedValue(makeRagResult());

      const result = await controller.ask({
        question: 'What is the return policy?',
        includeSourceChunks: false,
      });

      expect(result.sources).toEqual([]);
    });

    it('keeps sources when includeSourceChunks is omitted', async () => {
      ragServiceMock.query.mockResolvedValue(makeRagResult());

      const result = await controller.ask({ question: 'What is the return policy?' });

      expect(result.sources).toHaveLength(1);
    });
  });

  describe('askInConversation()', () => {
    it('delegates to RagService.queryWithConversation() with the route publicId', async () => {
      ragServiceMock.queryWithConversation.mockResolvedValue(makeRagResult());
      const dto: AskDto = { question: 'What is the return policy?', topK: 2 };

      const result = await controller.askInConversation('conv-pub-1', dto);

      expect(ragServiceMock.queryWithConversation).toHaveBeenCalledWith(
        'conv-pub-1',
        dto.question,
        { topK: 2, model: undefined, temperature: undefined, categoryFilter: undefined },
      );
      expect(result.answer).toBe(makeRagResult().answer);
    });

    it('propagates NotFoundException for an unknown conversation', async () => {
      ragServiceMock.queryWithConversation.mockRejectedValue(new NotFoundException());

      await expect(
        controller.askInConversation('missing', { question: 'test' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateMockDocuments()', () => {
    it('delegates to MockDataService.generateDocuments() and maps every item', async () => {
      mockDataServiceMock.generateDocuments.mockResolvedValue([makeDocumentEntity()]);
      const dto: GenerateDocumentsDto = { count: 5, categories: ['docs'], minWords: 100 };

      const result = await controller.generateMockDocuments(dto);

      expect(mockDataServiceMock.generateDocuments).toHaveBeenCalledWith(5, {
        categories: ['docs'],
        minWords: 100,
        maxWords: undefined,
      });
      expect(result).toHaveLength(1);
      expect(result[0].publicId).toBe('doc-pub-1');
    });
  });

  describe('generateMockQa()', () => {
    it('delegates to MockDataService.generateQAPairs() and maps every item', async () => {
      mockDataServiceMock.generateQAPairs.mockResolvedValue([makeQaPairEntity()]);
      const dto: GenerateQaDto = { count: 10, documentIds: ['doc-pub-1'] };

      const result = await controller.generateMockQa(dto);

      expect(mockDataServiceMock.generateQAPairs).toHaveBeenCalledWith(10, ['doc-pub-1']);
      expect(result).toHaveLength(1);
      expect(result[0].publicId).toBe('qa-pub-1');
    });
  });

  describe('seedMockData()', () => {
    it('delegates to MockDataService.seedDefaultDataset()', async () => {
      mockDataServiceMock.seedDefaultDataset.mockResolvedValue({ documents: 50, qaPairs: 500 });

      const result = await controller.seedMockData();

      expect(mockDataServiceMock.seedDefaultDataset).toHaveBeenCalledWith();
      expect(result).toEqual({ documents: 50, qaPairs: 500 });
    });
  });

  describe('findAllQaPairs()', () => {
    it('delegates to MockDataService.findAllQaPairs() and maps every item', async () => {
      const paginated: PaginatedQaPairsResult = {
        data: [makeQaPairEntity()],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockDataServiceMock.findAllQaPairs.mockResolvedValue(paginated);

      const result = await controller.findAllQaPairs({});

      expect(mockDataServiceMock.findAllQaPairs).toHaveBeenCalledWith({});
      expect(result.data).toHaveLength(1);
      expect(result.data[0].publicId).toBe('qa-pub-1');
    });
  });

  describe('evaluate()', () => {
    it('delegates to MockDataService.evaluate() with the requested sampleSize', async () => {
      mockDataServiceMock.evaluate.mockResolvedValue(makeEvaluationResult());

      const result = await controller.evaluate({ sampleSize: 100 });

      expect(mockDataServiceMock.evaluate).toHaveBeenCalledWith(100, undefined);
      expect(result.totalQuestions).toBe(100);
      expect(result.byComplexity['simple'].accuracy).toBe(0.87);
    });

    it('passes undefined sampleSize through when omitted, deferring the default to the service', async () => {
      mockDataServiceMock.evaluate.mockResolvedValue(makeEvaluationResult());

      await controller.evaluate({});

      expect(mockDataServiceMock.evaluate).toHaveBeenCalledWith(undefined, undefined);
    });

    it('passes explicit qaPairs through to MockDataService.evaluate()', async () => {
      mockDataServiceMock.evaluate.mockResolvedValue(makeEvaluationResult());
      const qaPairs = [{ question: 'Q?', expectedAnswer: 'A', complexity: 'simple' }];

      await controller.evaluate({ qaPairs });

      expect(mockDataServiceMock.evaluate).toHaveBeenCalledWith(undefined, qaPairs);
    });
  });

  describe('getStats()', () => {
    it('aggregates DocumentService, PineconeService, and EmbeddingCacheService into one response', async () => {
      documentServiceMock.getStats.mockResolvedValue({ totalDocuments: 50, totalChunks: 620 });
      pineconeServiceMock.describeIndex.mockResolvedValue({
        totalRecordCount: 620,
        dimension: 1536,
      });
      embeddingCacheServiceMock.getCacheStats.mockResolvedValue({
        hits: 80,
        misses: 20,
        totalCached: 500,
      });
      configServiceMock.get.mockReturnValue('text-embedding-3-small');

      const result = await controller.getStats();

      expect(result).toEqual({
        totalDocuments: 50,
        totalChunks: 620,
        totalVectors: 620,
        cacheHitRate: 0.8,
        embeddingModel: 'text-embedding-3-small',
        indexDimensions: 1536,
      });
    });

    it('degrades gracefully when Pinecone is unavailable, keeping the other stats', async () => {
      documentServiceMock.getStats.mockResolvedValue({ totalDocuments: 50, totalChunks: 620 });
      pineconeServiceMock.describeIndex.mockRejectedValue(new Error('PineconeConnectionError'));
      embeddingCacheServiceMock.getCacheStats.mockResolvedValue({
        hits: 0,
        misses: 0,
        totalCached: 0,
      });
      configServiceMock.get.mockReturnValue(undefined);

      const result = await controller.getStats();

      expect(result.totalVectors).toBe(0);
      expect(result.indexDimensions).toBeUndefined();
      expect(result.totalDocuments).toBe(50);
      expect(result.cacheHitRate).toBe(0);
      expect(result.embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('guard order (AI-066)', () => {
    it('runs ModerationGuard before CostBudgetGuard on both ask routes', () => {
      const guardsMetadataKey = '__guards__';

      expect(Reflect.getMetadata(guardsMetadataKey, RagController.prototype.ask)).toEqual([
        ModerationGuard,
        CostBudgetGuard,
      ]);
      expect(
        Reflect.getMetadata(guardsMetadataKey, RagController.prototype.askInConversation),
      ).toEqual([ModerationGuard, CostBudgetGuard]);
    });
  });
});
