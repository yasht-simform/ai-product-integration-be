import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { Document, DocumentChunk, QaPair } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { DocumentCategory } from '../constants/document-category.constant';
import { QaComplexity } from '../constants/qa-complexity.constant';
import { RAG_CONFIG } from '../constants/rag-config.constant';
import { DocumentService } from '../services/document.service';
import { MockDataService } from '../services/mock-data.service';
import { RagService } from '../services/rag.service';
import type { DocumentEntity, RagResult } from '../types/rag.types';

// MockDataService (and RagService, transitively via ChatService) import DatabaseService, which
// imports the Prisma-generated ESM client (import.meta.url) — must be mocked before their module
// graphs load under Jest.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

// @faker-js/faker@10 ships pure ESM (its dist/index.js uses import/export syntax) — Jest's
// default CJS transform can't parse it, the same class of Jest/ESM incompatibility as
// pdf-parse's dynamic-import worker (see AI-042's CLAUDE.md section), fixed the same way: mock
// the module's export directly rather than reconfiguring Jest project-wide. Returns
// deterministic, controllable text (fixed word counts per paragraph(n)/sentence() call) so the
// word-count-bound and structural-marker assertions below are exact, not just regex-plausible.
const FAKER_WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
];

function pickWords(count: number): string {
  return Array.from({ length: count }, (_, i) => FAKER_WORDS[i % FAKER_WORDS.length]).join(' ');
}

jest.mock('@faker-js/faker', () => ({
  faker: {
    commerce: { productName: () => 'Acme Widget' },
    hacker: {
      noun: () => 'firewall',
      verb: () => 'configure',
      ingverb: () => 'streaming',
      abbreviation: () => 'HTTP',
    },
    lorem: {
      paragraph: (count = 3) => `${pickWords(count * 8)}.`,
      sentence: () => `${pickWords(6)}.`,
    },
    number: {
      int: (opts: { min?: number; max?: number } = {}) =>
        Math.floor(((opts.min ?? 0) + (opts.max ?? 10)) / 2),
    },
    system: { semver: () => '1.2.3' },
    date: { past: () => new Date('2026-01-01') },
  },
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeDocumentEntity(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
    publicId: 'doc-pub-1',
    title: 'Generated Doc',
    description: null,
    sourceType: 'txt',
    originalFilename: null,
    fileSize: null,
    totalChunks: 3,
    totalTokens: 300,
    embeddingModel: 'text-embedding-3-small',
    embeddingStatus: 'completed',
    category: 'docs',
    tags: ['mock-data'],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface CreateFromTextCall {
  title: string;
  category: string;
  tags: string[];
  content: string;
}

let idCounter = 0;

function makeDocumentRow(
  overrides: Partial<Document> = {},
  chunkContents: string[] = ['## Installation\n\nSome install content.'],
): Document & { chunks: DocumentChunk[] } {
  idCounter += 1;
  const id = BigInt(idCounter);
  const publicId = overrides.publicId ?? `doc-pub-${idCounter}`;

  const document: Document = {
    id,
    publicId,
    title: `Document ${idCounter}`,
    description: null,
    sourceType: 'txt',
    originalFilename: null,
    fileSize: null,
    totalChunks: chunkContents.length,
    totalTokens: 100,
    embeddingModel: 'text-embedding-3-small',
    embeddingStatus: 'completed',
    category: 'docs',
    tags: ['mock-data'],
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
    id,
    publicId,
  };

  const chunks: DocumentChunk[] = chunkContents.map((content, i) => ({
    id: BigInt(idCounter * 1000 + i),
    publicId: `${publicId}-chunk-${i}`,
    documentId: id,
    chunkIndex: i,
    content,
    tokenCount: 20,
    startChar: 0,
    endChar: content.length,
    pineconeId: `chunk_${publicId}_${i}`,
    embeddingStatus: 'completed',
    metadata: null,
    createdAt: new Date('2026-01-01'),
  }));

  return { ...document, chunks };
}

function makeQaPairRow(overrides: Partial<QaPair> = {}): QaPair {
  return {
    id: BigInt(1),
    publicId: 'qa-pub-1',
    question: 'What is the default port?',
    expectedAnswer: 'The default port is 8080.',
    sourceDocumentId: BigInt(1),
    complexity: QaComplexity.SIMPLE,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeRagResult(overrides: Partial<RagResult> = {}): RagResult {
  return {
    answer: 'The default port is 8080.',
    model: 'gpt-4o-mini',
    sources: [],
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    estimatedCost: 0.001,
    latencyMs: 1000,
    chunksRetrieved: 1,
    searchLatencyMs: 100,
    generationLatencyMs: 900,
    ...overrides,
  };
}

describe('MockDataService', () => {
  let service: MockDataService;
  let documentServiceMock: { createFromText: jest.Mock };
  let ragServiceMock: { query: jest.Mock };
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    idCounter = 0;
    documentServiceMock = {
      createFromText: jest
        .fn()
        .mockImplementation(({ title, category }: CreateFromTextCall) =>
          Promise.resolve(makeDocumentEntity({ title, category })),
        ),
    };
    ragServiceMock = { query: jest.fn() };
    dbMock = mockDeep<DatabaseService>();
    dbMock.document.findMany.mockResolvedValue([]);
    dbMock.qaPair.createMany.mockResolvedValue({ count: 0 });
    dbMock.qaPair.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockDataService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: DocumentService, useValue: documentServiceMock },
        { provide: RagService, useValue: ragServiceMock },
      ],
    }).compile();

    service = module.get<MockDataService>(MockDataService);
  });

  function calls(): CreateFromTextCall[] {
    return documentServiceMock.createFromText.mock.calls.map(
      (call) => call[0] as CreateFromTextCall,
    );
  }

  describe('generateDocuments()', () => {
    it('produces exactly `count` documents, calling createFromText() the same number of times', async () => {
      const result = await service.generateDocuments(10);

      expect(result).toHaveLength(10);
      expect(documentServiceMock.createFromText).toHaveBeenCalledTimes(10);
    });

    it('distributes documents round-robin across all 5 categories by default', async () => {
      await service.generateDocuments(10);

      const categories = calls().map((c) => c.category);
      expect(new Set(categories).size).toBe(5);
      for (const category of Object.values(DocumentCategory)) {
        expect(categories.filter((c) => c === category)).toHaveLength(2);
      }
    });

    it('narrows distribution to options.categories when provided', async () => {
      await service.generateDocuments(4, { categories: [DocumentCategory.FAQ] });

      const categories = calls().map((c) => c.category);
      expect(categories).toEqual([
        DocumentCategory.FAQ,
        DocumentCategory.FAQ,
        DocumentCategory.FAQ,
        DocumentCategory.FAQ,
      ]);
    });

    it('keeps every generated document word count within [minWords, maxWords]', async () => {
      await service.generateDocuments(5, { minWords: 100, maxWords: 300 });

      for (const call of calls()) {
        const words = countWords(call.content);
        expect(words).toBeGreaterThanOrEqual(100);
        expect(words).toBeLessThanOrEqual(300);
      }
    });

    it('respects a narrow custom [minWords, maxWords] range', async () => {
      await service.generateDocuments(3, {
        categories: [DocumentCategory.GUIDE],
        minWords: 220,
        maxWords: 260,
      });

      for (const call of calls()) {
        const words = countWords(call.content);
        expect(words).toBeGreaterThanOrEqual(220);
        expect(words).toBeLessThanOrEqual(260);
      }
    });

    it('tags generated documents for later identification', async () => {
      await service.generateDocuments(1);

      expect(calls()[0]?.tags).toContain('mock-data');
    });

    describe('category-specific structural markers', () => {
      // minWords is bumped well above the default so every template's section pool cycles at
      // least once, making these assertions deterministic regardless of faker's random paragraph
      // lengths (otherwise a very short generated paragraph could stop iteration before a later
      // section in the array — e.g. "## Installation" — was ever appended).
      const generous = { minWords: 500, maxWords: 2000 };

      it('guide documents contain an installation section with numbered CLI steps', async () => {
        await service.generateDocuments(1, { categories: [DocumentCategory.GUIDE], ...generous });

        const content = calls()[0]?.content ?? '';
        expect(content).toContain('## Installation');
        expect(content).toMatch(/1\. Download/);
      });

      it('faq documents contain question-format headings', async () => {
        await service.generateDocuments(1, { categories: [DocumentCategory.FAQ], ...generous });

        const content = calls()[0]?.content ?? '';
        expect(content).toMatch(/## .+\?/);
      });

      it('docs documents contain an API reference section', async () => {
        await service.generateDocuments(1, { categories: [DocumentCategory.DOCS], ...generous });

        const content = calls()[0]?.content ?? '';
        expect(content).toContain('## API Reference');
        expect(content).toMatch(/### `(GET|POST) \/api\//);
      });

      it('tutorial documents contain numbered steps', async () => {
        await service.generateDocuments(1, {
          categories: [DocumentCategory.TUTORIAL],
          ...generous,
        });

        const content = calls()[0]?.content ?? '';
        expect(content).toMatch(/### Step 1:/);
      });

      it('changelog documents contain version-like dated headers', async () => {
        await service.generateDocuments(1, {
          categories: [DocumentCategory.CHANGELOG],
          ...generous,
        });

        const content = calls()[0]?.content ?? '';
        expect(content).toMatch(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/);
      });
    });

    it("reflects createFromText()'s embeddingStatus on the returned documents, never 'pending'", async () => {
      documentServiceMock.createFromText.mockResolvedValueOnce(
        makeDocumentEntity({ embeddingStatus: 'completed' }),
      );
      documentServiceMock.createFromText.mockResolvedValueOnce(
        makeDocumentEntity({ embeddingStatus: 'failed' }),
      );

      const result = await service.generateDocuments(2);

      expect(result.map((d) => d.embeddingStatus)).toEqual(['completed', 'failed']);
      expect(result.every((d) => d.embeddingStatus !== 'pending')).toBe(true);
    });
  });

  describe('generateQAPairs()', () => {
    it('produces the requested 60/25/15 complexity split for an exact-division count', async () => {
      const documents = [
        makeDocumentRow({}, [
          '## Installation\n\nStep one content.',
          '## Configuration\n\nStep two content.',
        ]),
        makeDocumentRow({}, ['## Pricing\n\nFree tier details.', '## Support\n\nContact details.']),
        makeDocumentRow({}, ['## Overview\n\nProduct overview text.']),
      ];
      dbMock.document.findMany.mockResolvedValue(documents);

      const result = await service.generateQAPairs(100);

      expect(result).toHaveLength(100);
      expect(result.filter((p) => p.complexity === QaComplexity.SIMPLE)).toHaveLength(60);
      expect(result.filter((p) => p.complexity === QaComplexity.MULTI_STEP)).toHaveLength(25);
      expect(result.filter((p) => p.complexity === QaComplexity.EDGE_CASE)).toHaveLength(15);
    });

    it('queries all documents when documentIds is omitted, and narrows via `in` when provided', async () => {
      dbMock.document.findMany.mockResolvedValue([makeDocumentRow()] as never);

      await service.generateQAPairs(10);
      expect(dbMock.document.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: {} }),
      );

      await service.generateQAPairs(10, ['doc-pub-1', 'doc-pub-2']);
      expect(dbMock.document.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { publicId: { in: ['doc-pub-1', 'doc-pub-2'] } } }),
      );
    });

    it('makes every simple-tier expectedAnswer exactly one chunk of its source document', async () => {
      const documentA = makeDocumentRow({ publicId: 'doc-a', title: 'Doc A' }, [
        '## Installation\n\nInstall content A.',
        '## Configuration\n\nConfig content A.',
      ]);
      dbMock.document.findMany.mockResolvedValue([documentA] as never);

      const result = await service.generateQAPairs(10);
      const simplePairs = result.filter((p) => p.complexity === QaComplexity.SIMPLE);

      expect(simplePairs.length).toBeGreaterThan(0);
      for (const pair of simplePairs) {
        expect(pair.sourceDocumentId).toBe('doc-a');
        expect(documentA.chunks.some((c) => c.content.trim() === pair.expectedAnswer)).toBe(true);
      }
    });

    it("sets edge-case expectedAnswer to RAG_CONFIG's no-info sentinel and keeps questions unrelated to indexed content", async () => {
      const documentA = makeDocumentRow({ publicId: 'doc-a', title: 'Doc A' }, [
        '## Installation\n\nInstall content A.',
      ]);
      dbMock.document.findMany.mockResolvedValue([documentA] as never);

      const result = await service.generateQAPairs(20);
      const edgeCasePairs = result.filter((p) => p.complexity === QaComplexity.EDGE_CASE);

      expect(edgeCasePairs.length).toBeGreaterThan(0);
      for (const pair of edgeCasePairs) {
        expect(pair.expectedAnswer).toBe(RAG_CONFIG.noInfoSentinel);
        for (const chunk of documentA.chunks) {
          expect(chunk.content).not.toContain(pair.question);
        }
      }
    });

    it('synthesizes multi-step pairs across two different documents when at least two are available', async () => {
      const documentA = makeDocumentRow({ publicId: 'doc-a', title: 'Doc A' }, [
        '## Installation\n\nInstall content A.',
      ]);
      const documentB = makeDocumentRow({ publicId: 'doc-b', title: 'Doc B' }, [
        '## Pricing\n\nPricing content B.',
      ]);
      dbMock.document.findMany.mockResolvedValue([documentA, documentB] as never);

      const result = await service.generateQAPairs(20);
      const multiStepPairs = result.filter((p) => p.complexity === QaComplexity.MULTI_STEP);

      expect(multiStepPairs.length).toBeGreaterThan(0);
      for (const pair of multiStepPairs) {
        expect(pair.expectedAnswer).toContain('Doc A');
        expect(pair.expectedAnswer).toContain('Doc B');
      }
    });

    it('falls back to comparing two chunks of the same document when only one document is available', async () => {
      const documentA = makeDocumentRow({ publicId: 'doc-a', title: 'Doc A' }, [
        '## Installation\n\nInstall content A.',
        '## Configuration\n\nConfig content A.',
      ]);
      dbMock.document.findMany.mockResolvedValue([documentA] as never);

      const result = await service.generateQAPairs(20);
      const multiStepPairs = result.filter((p) => p.complexity === QaComplexity.MULTI_STEP);

      expect(multiStepPairs.length).toBeGreaterThan(0);
      for (const pair of multiStepPairs) {
        expect(pair.sourceDocumentId).toBe('doc-a');
        expect(pair.expectedAnswer).not.toContain('From "');
      }
    });

    it('skips documents with no chunks when selecting a source pool', async () => {
      const emptyDocument = makeDocumentRow({ publicId: 'doc-empty' }, []);
      const usableDocument = makeDocumentRow({ publicId: 'doc-usable' }, [
        '## Installation\n\nInstall content.',
      ]);
      dbMock.document.findMany.mockResolvedValue([emptyDocument, usableDocument] as never);

      const result = await service.generateQAPairs(10);

      expect(result.every((p) => p.sourceDocumentId === 'doc-usable')).toBe(true);
    });

    it('throws BadRequestException when no documents with chunks are available', async () => {
      dbMock.document.findMany.mockResolvedValue([]);

      await expect(service.generateQAPairs(10)).rejects.toThrow(
        'No documents with embedded chunks are available to generate Q&A pairs from',
      );
    });

    it('persists every generated pair via qaPair.createMany, using the internal BigInt document id', async () => {
      const documentA = makeDocumentRow({ publicId: 'doc-a' }, ['## Installation\n\nContent A.']);
      dbMock.document.findMany.mockResolvedValue([documentA] as never);

      await service.generateQAPairs(10);

      expect(dbMock.qaPair.createMany).toHaveBeenCalledTimes(1);
      const [{ data }] = dbMock.qaPair.createMany.mock.calls[0] as [
        { data: { sourceDocumentId: bigint }[] },
      ];
      expect(data).toHaveLength(10);
      expect(data.every((row) => row.sourceDocumentId === documentA.id)).toBe(true);
    });
  });

  describe('seedDefaultDataset()', () => {
    it('generates 10 documents per category and Q&A pairs for all of them, returning accurate counts', async () => {
      const generatedDocuments = Array.from({ length: 50 }, (_, i) =>
        makeDocumentEntity({ publicId: `seed-doc-${i}` }),
      );
      const generatedQaPairs = Array.from({ length: 500 }, (_, i) => ({
        publicId: `seed-qa-${i}`,
        question: `Question ${i}`,
        expectedAnswer: `Answer ${i}`,
        sourceDocumentId: 'seed-doc-0',
        complexity: QaComplexity.SIMPLE,
        createdAt: new Date('2026-01-01'),
      }));

      const generateDocumentsSpy = jest
        .spyOn(service, 'generateDocuments')
        .mockResolvedValue(generatedDocuments);
      const generateQAPairsSpy = jest
        .spyOn(service, 'generateQAPairs')
        .mockResolvedValue(generatedQaPairs);

      const result = await service.seedDefaultDataset();

      expect(generateDocumentsSpy).toHaveBeenCalledWith(50);
      expect(generateQAPairsSpy).toHaveBeenCalledWith(
        500,
        generatedDocuments.map((d) => d.publicId),
      );
      expect(result).toEqual({ documents: 50, qaPairs: 500 });
    });
  });

  describe('evaluate()', () => {
    it('defaults to a sample size of 50 when none is given', async () => {
      await service.evaluate();

      expect(dbMock.qaPair.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    });

    it('clamps sampleSize to the configured maximum regardless of what is requested', async () => {
      await service.evaluate(99999);

      expect(dbMock.qaPair.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    });

    it('classifies an edge-case answer containing an IDK phrase as appropriateIDK', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.EDGE_CASE,
          expectedAnswer: RAG_CONFIG.noInfoSentinel,
        }),
      ] as never);
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({ answer: "I don't have enough information to answer that." }),
      );

      const result = await service.evaluate(1);

      expect(result.appropriateIDK).toBe(1);
      expect(result.incorrect).toBe(0);
    });

    it('classifies an edge-case answer without an IDK phrase as incorrect, never on content similarity', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.EDGE_CASE,
          expectedAnswer: RAG_CONFIG.noInfoSentinel,
        }),
      ] as never);
      // Shares the word "information" with expectedAnswer but confidently answers instead of
      // declining — must be scored incorrect regardless of any keyword overlap.
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({ answer: 'Here is the information you requested: the answer is 42.' }),
      );

      const result = await service.evaluate(1);

      expect(result.incorrect).toBe(1);
      expect(result.appropriateIDK).toBe(0);
    });

    it('classifies a simple-tier answer with high keyword overlap as correct', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.SIMPLE,
          expectedAnswer: 'The default configuration port is eight thousand and eighty.',
        }),
      ] as never);
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({ answer: 'The default configuration port is eight thousand and eighty.' }),
      );

      const result = await service.evaluate(1);

      expect(result.correct).toBe(1);
    });

    it('classifies a simple-tier answer with partial keyword overlap as partiallyCorrect', async () => {
      // expectedAnswer has 5 keywords ("port", "number", "setting", "equals", "eighty"); the
      // answer shares exactly one ("port") — a 0.2 overlap ratio, at the partial threshold but
      // below the 0.5 correct threshold.
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.SIMPLE,
          expectedAnswer: 'port number setting equals eighty',
        }),
      ] as never);
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({ answer: 'The port configuration remains completely different otherwise.' }),
      );

      const result = await service.evaluate(1);

      expect(result.partiallyCorrect).toBe(1);
    });

    it('classifies a simple-tier answer with no keyword overlap as incorrect', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.SIMPLE,
          expectedAnswer: 'The default configuration port number setting equals eighty.',
        }),
      ] as never);
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({
          answer: 'Completely different subject matter entirely unrelated response.',
        }),
      );

      const result = await service.evaluate(1);

      expect(result.incorrect).toBe(1);
    });

    it('aggregates totals, accuracy, and averages across a fixture result set', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          publicId: 'qa-1',
          complexity: QaComplexity.SIMPLE,
          expectedAnswer: 'alpha bravo charlie',
        }),
        makeQaPairRow({
          publicId: 'qa-2',
          complexity: QaComplexity.SIMPLE,
          expectedAnswer: 'delta echo foxtrot',
        }),
        makeQaPairRow({
          publicId: 'qa-3',
          complexity: QaComplexity.EDGE_CASE,
          expectedAnswer: RAG_CONFIG.noInfoSentinel,
        }),
      ] as never);
      ragServiceMock.query
        .mockResolvedValueOnce(
          makeRagResult({
            answer: 'alpha bravo charlie',
            latencyMs: 100,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          }),
        )
        .mockResolvedValueOnce(
          makeRagResult({
            answer: 'totally unrelated content here',
            latencyMs: 200,
            usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
          }),
        )
        .mockResolvedValueOnce(
          makeRagResult({
            answer: "I don't have enough information to answer that.",
            latencyMs: 300,
            usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
          }),
        );

      const result = await service.evaluate(3);

      expect(result.totalQuestions).toBe(3);
      expect(result.correct).toBe(1);
      expect(result.incorrect).toBe(1);
      expect(result.appropriateIDK).toBe(1);
      expect(result.accuracy).toBeCloseTo(1 / 3, 2);
      expect(result.avgLatencyMs).toBe(200);
      expect(result.avgTokens).toBe(33);
    });

    it("scores byComplexity.edge-case's `correct` field on declining appropriately, not on the 'correct' classification bucket", async () => {
      dbMock.qaPair.findMany.mockResolvedValue([
        makeQaPairRow({
          complexity: QaComplexity.EDGE_CASE,
          expectedAnswer: RAG_CONFIG.noInfoSentinel,
        }),
      ] as never);
      ragServiceMock.query.mockResolvedValue(
        makeRagResult({ answer: "I don't have enough information to answer that." }),
      );

      const result = await service.evaluate(1);

      expect(result.byComplexity[QaComplexity.EDGE_CASE]).toEqual({
        total: 1,
        correct: 1,
        accuracy: 1,
      });
    });

    it('returns a zeroed-out result with no crash when no Q&A pairs are available', async () => {
      dbMock.qaPair.findMany.mockResolvedValue([]);

      const result = await service.evaluate();

      expect(result.totalQuestions).toBe(0);
      expect(result.accuracy).toBe(0);
      expect(result.avgLatencyMs).toBe(0);
      expect(result.avgTokens).toBe(0);
      expect(ragServiceMock.query).not.toHaveBeenCalled();
      for (const tier of Object.values(QaComplexity)) {
        expect(result.byComplexity[tier]).toEqual({ total: 0, correct: 0, accuracy: 0 });
      }
    });
  });
});
