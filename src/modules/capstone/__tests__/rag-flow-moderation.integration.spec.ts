import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { Document } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ChatService } from '../../ai-chat/services/chat.service';
import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { CostBudgetService } from '../../cost-management/services/cost-budget.service';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { ModerationService } from '../../moderation/services/moderation.service';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { RetryService } from '../../openai/services/retry.service';
import { TokenService } from '../../openai/services/token.service';
import { RagController } from '../../rag/rag.controller';
import { DocumentService } from '../../rag/services/document.service';
import { EmbeddingCacheService } from '../../rag/services/embedding-cache.service';
import { EmbeddingService } from '../../rag/services/embedding.service';
import { MockDataService } from '../../rag/services/mock-data.service';
import { PineconeService } from '../../rag/services/pinecone.service';
import { RagService } from '../../rag/services/rag.service';
import { SearchService } from '../../rag/services/search.service';
import {
  makeAuditLogRow,
  makeChatCompletionResponse,
  makeEmbeddingsResponse,
  makeModerationResponse,
  makeOpenaiClientMock,
  mockLogger,
  mockModelRegistry,
} from './capstone-test-helpers';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url).
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));
// RagController transitively imports MockDataService → the ESM-only @faker-js/faker (AI-053's
// documented gotcha) — MockDataService is stubbed via useValue below and never instantiated.
jest.mock('@faker-js/faker', () => ({ faker: {} }));

const CHUNK_PINECONE_ID = 'chunk_doc-cap-1_0';

function makeDocumentRow(overrides: Partial<Document> = {}): Document {
  return {
    id: BigInt(1),
    publicId: 'doc-cap-1',
    title: 'Capstone Test Doc',
    description: null,
    sourceType: 'txt',
    originalFilename: null,
    fileSize: null,
    totalChunks: 0,
    totalTokens: 0,
    embeddingModel: 'text-embedding-3-small',
    embeddingStatus: 'pending',
    category: 'docs',
    tags: [],
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Test 1 (capstone spec §4): full RAG flow gated by content moderation — proves Phase 3 (document
// ingestion + RAG retrieval/generation) and Phase 4 (input moderation guard + output interceptor,
// audit logging) work together through the real RagController route entrypoint, not a mocked
// service layer.
describe('Capstone Test 1 — Full RAG Flow with Moderation', () => {
  let app: INestApplication<App>;
  let dbMock: DeepMockProxy<DatabaseService>;
  let pineconeServiceMock: {
    query: jest.Mock;
    upsert: jest.Mock;
    deleteByFilter: jest.Mock;
    describeIndex: jest.Mock;
  };
  let mockOpenaiClient: ReturnType<typeof makeOpenaiClientMock>;
  let documentRow: Document;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    jest.clearAllMocks();
    mockModelRegistry.findModelByModelId.mockResolvedValue(null);
    mockModelRegistry.getAllActivePricing.mockResolvedValue(new Map());

    documentRow = makeDocumentRow();
    dbMock.document.create.mockResolvedValue(documentRow);
    dbMock.document.update.mockImplementation((args) => {
      const data = args.data as Record<string, unknown>;
      documentRow = { ...documentRow, ...data };
      return Promise.resolve(documentRow);
    });
    dbMock.documentChunk.createMany.mockResolvedValue({ count: 1 });
    dbMock.documentChunk.findMany.mockResolvedValue([
      {
        id: BigInt(1),
        publicId: 'chunk-pub-1',
        documentId: BigInt(1),
        chunkIndex: 0,
        content:
          'CloudPulse supports up to 500 tasks on the Free plan, with a 60 requests-per-minute API rate limit.',
        tokenCount: 20,
        startChar: 0,
        endChar: 100,
        pineconeId: CHUNK_PINECONE_ID,
        embeddingStatus: 'completed',
        createdAt: new Date('2026-01-01'),

        document: { publicId: 'doc-cap-1', title: 'Capstone Test Doc', category: 'docs' } as any,
      },
    ]);
    dbMock.embeddingCache.findUnique.mockResolvedValue(null);
    dbMock.aiAuditLog.create.mockResolvedValue(makeAuditLogRow());
    dbMock.moderationLog.create.mockResolvedValue({
      id: BigInt(1),
      publicId: 'modlog-pub-1',
      requestId: null,
      userId: null,
      direction: 'input',
      content: 'stub',
      isFlagged: false,
      categories: {},
      categoryScores: {},
      action: 'allowed',
      source: 'rag',
      metadata: null,
      createdAt: new Date('2026-01-01'),
    });

    pineconeServiceMock = {
      query: jest.fn().mockResolvedValue([{ id: CHUNK_PINECONE_ID, score: 0.9, metadata: {} }]),
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteByFilter: jest.fn().mockResolvedValue(undefined),
      describeIndex: jest.fn().mockResolvedValue({ totalRecordCount: 1 }),
    };

    mockOpenaiClient = makeOpenaiClientMock();
    mockOpenaiClient.embeddings.create.mockResolvedValue(makeEmbeddingsResponse(1));

    const configValues: Record<string, unknown> = {
      'openai.apiKey': 'test-api-key',
      'moderation.enabled': true,
      'moderation.inputEnabled': true,
      'moderation.outputEnabled': false,
      'moderation.blockThreshold': 0.7,
      'costBudget.enabled': false,
      'rag.topK': 5,
      'rag.similarityThreshold': 0.3,
    };
    const mockConfig = { get: jest.fn((key: string) => configValues[key]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        DocumentService,
        SearchService,
        RagService,
        EmbeddingCacheService,
        { provide: EmbeddingService, useValue: {} },
        { provide: MockDataService, useValue: {} },
        // RagService's constructor needs ChatService, but query() (the non-conversation ask
        // route this test exercises) never calls any of its methods.
        { provide: ChatService, useValue: {} },
        OpenaiService,
        RetryService,
        TokenService,
        AiAuditService,
        ModerationGuard,
        ModerationService,
        OutputModerationInterceptor,
        Reflector,
        CostBudgetGuard,
        { provide: CostBudgetService, useValue: { checkBudget: jest.fn() } },
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OPENAI_CLIENT, useValue: mockOpenaiClient },
        { provide: MODERATION_CLIENT, useValue: mockOpenaiClient },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
        { provide: PineconeService, useValue: pineconeServiceMock },
      ],
    }).compile();

    module.get<OpenaiService>(OpenaiService).onModuleInit();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('ingests a document, answers a clean question with citations, blocks a flagged question with 422, and audits both the embedding and completion calls', async () => {
    // Step 1 + 2: moderation is enabled (via config above) and a document is uploaded.
    mockOpenaiClient.moderations.create.mockResolvedValue(makeModerationResponse(false));

    const uploadResponse = await request(app.getHttpServer()).post('/rag/documents/text').send({
      title: 'Capstone Test Doc',
      category: 'docs',
      content:
        'CloudPulse supports up to 500 tasks on the Free plan, with a 60 requests-per-minute API rate limit.',
    });
    expect(uploadResponse.status).toBe(201);
    expect(mockOpenaiClient.embeddings.create).toHaveBeenCalled();

    // Step 3: a clean question gets a RAG answer with citations.
    mockOpenaiClient.chat.completions.create.mockResolvedValue(
      makeChatCompletionResponse(
        'CloudPulse supports up to 500 tasks on the Free plan. [Source: Capstone Test Doc]',
      ),
    );

    const askResponse = await request(app.getHttpServer())
      .post('/rag/ask')
      .send({ question: 'How many tasks does the Free plan support?' });

    expect(askResponse.status).toBe(201);
    const askBody = askResponse.body as { answer: string; sources: unknown[] };
    expect(askBody.answer).toContain('500 tasks');
    expect(askBody.sources.length).toBeGreaterThan(0);

    // Step 4: a flagged question never reaches RAG generation — 422, no second completion call.
    mockOpenaiClient.moderations.create.mockResolvedValue(makeModerationResponse(true));
    mockOpenaiClient.chat.completions.create.mockClear();

    const flaggedResponse = await request(app.getHttpServer())
      .post('/rag/ask')
      .send({ question: 'a violent threat disguised as a question' });

    expect(flaggedResponse.status).toBe(422);
    expect(mockOpenaiClient.chat.completions.create).not.toHaveBeenCalled();

    // Step 5: audit logs cover both the embedding call (document ingestion) and the completion
    // call (the clean ask) — and the moderation log shows the blocked input.
    const auditEndpoints = dbMock.aiAuditLog.create.mock.calls.map(
      (call) => (call[0].data as Record<string, unknown>).endpoint,
    );
    expect(auditEndpoints).toContain('embeddings');
    expect(auditEndpoints).toContain('chat.completions');

    const blockedLog = dbMock.moderationLog.create.mock.calls.find(
      (call) => (call[0].data as Record<string, unknown>).isFlagged === true,
    );
    expect(blockedLog).toBeDefined();
    expect((blockedLog?.[0].data as Record<string, unknown>).action).toBe('blocked');
  });
});
