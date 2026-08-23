import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { Document } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { CostBudgetGuard } from '../../cost-management/guards/cost-budget.guard';
import { ModerationGuard } from '../../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../../moderation/interceptors/output-moderation.interceptor';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { RagController } from '../rag.controller';
import { DocumentService } from '../services/document.service';
import { EmbeddingCacheService } from '../services/embedding-cache.service';
import { EmbeddingService } from '../services/embedding.service';
import { MockDataService } from '../services/mock-data.service';
import { PineconeService } from '../services/pinecone.service';
import { RagService } from '../services/rag.service';
import { SearchService } from '../services/search.service';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url).
// A DeepMockProxy<DatabaseService> is provided below instead of a real instance.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

// RagController imports MockDataService (AI-053), which imports the ESM-only @faker-js/faker at
// module load time — same Jest/CJS-transform incompatibility documented in AI-048/AI-053.
// MockDataService is provided via useValue below and never actually instantiated, so this stub
// only needs to satisfy the module load.
jest.mock('@faker-js/faker', () => ({ faker: {} }));

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
    embeddingStatus: 'completed',
    category: 'docs',
    tags: ['policy'],
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// This is the structural proof AI-054's own acceptance criteria asked for: FR-RAG-009 (delete a
// document → both the Postgres row and its Pinecone vectors go away) verified from the actual
// RagController route entrypoint, through a *real* DocumentService — not the wholesale
// DocumentService mock every other RagController delegation test uses. Only the two genuine
// external boundaries (DatabaseService's Prisma client, PineconeService's SDK client) are mocked,
// mirroring chat-function-calling.integration.spec.ts's (AI-034) "mock at the SDK boundary, not
// by stubbing the service under test" convention. The equivalent proof already exists at the
// DocumentService-unit level (document.service.spec.ts's delete() tests, from AI-041) — this test
// closes the gap of that proof never having been exercised through RagController itself.
describe('RagController — document delete cascade (FR-RAG-009)', () => {
  let controller: RagController;
  let dbMock: DeepMockProxy<DatabaseService>;
  let pineconeServiceMock: { deleteByFilter: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    pineconeServiceMock = { deleteByFilter: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        DocumentService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: TokenService, useValue: {} },
        { provide: OpenaiService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: {} },
        { provide: PineconeService, useValue: pineconeServiceMock },
        { provide: SearchService, useValue: {} },
        { provide: RagService, useValue: {} },
        { provide: MockDataService, useValue: {} },
      ],
    })
      // RagController's ask routes carry @UseGuards(ModerationGuard, CostBudgetGuard)/
      // @UseInterceptors(OutputModerationInterceptor) (AI-063/AI-066) — Nest registers classes
      // referenced by these decorators as injectables of the enclosing module at compile() time,
      // regardless of whether this test's target route (deleteDocument) actually carries them.
      // Override all three with pass-through stubs so the module compiles without pulling in the
      // real ModerationService/CostBudgetService dependency chains.
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

  it('issues both the Postgres delete (cascades to chunks via onDelete: Cascade) and the Pinecone deleteByFilter call', async () => {
    dbMock.document.findUnique.mockResolvedValue(makeDocumentRow());
    dbMock.document.delete.mockResolvedValue(makeDocumentRow());

    await controller.deleteDocument('doc-pub-1');

    expect(dbMock.document.delete).toHaveBeenCalledWith({ where: { publicId: 'doc-pub-1' } });
    expect(pineconeServiceMock.deleteByFilter).toHaveBeenCalledWith({
      documentId: 'doc-pub-1',
    });
    // Pinecone cleanup only makes sense after the row lookup succeeds — proves ordering, not just
    // that both calls eventually happened.
    expect(dbMock.document.delete.mock.invocationCallOrder[0]).toBeLessThan(
      pineconeServiceMock.deleteByFilter.mock.invocationCallOrder[0],
    );
  });

  it('propagates NotFoundException without touching Pinecone when the document does not exist', async () => {
    dbMock.document.findUnique.mockResolvedValue(null);

    await expect(controller.deleteDocument('missing')).rejects.toBeInstanceOf(NotFoundException);

    expect(dbMock.document.delete).not.toHaveBeenCalled();
    expect(pineconeServiceMock.deleteByFilter).not.toHaveBeenCalled();
  });
});
