import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

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

// pdf-parse's PDFParse constructs a real pdf.js worker via a dynamic import() that fails under
// Jest's default CJS transform ("A dynamic import callback was invoked without
// --experimental-vm-modules") regardless of the PDF content — an environment limitation, not a
// fixture problem. Per this issue's own Testing Notes, mocking pdf-parse's module export directly
// is the fallback when a real fixture isn't practical without an extra Node flag; PDF text
// extraction itself is treated as trusted third-party behavior for these tests.
const mockGetText = jest.fn();
const mockDestroy = jest.fn().mockResolvedValue(undefined);
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

// Word-count-based fake tokenizer — deterministic and easy to reason about in assertions, per
// this issue's own Testing Notes ("stub TokenService.countTokens() with a fixed-length function").
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function makeWords(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i + 1}`).join(' ');
}

function configGet(overrides: Record<string, number>): (key: string) => number | undefined {
  return (key: string) => overrides[key];
}

describe('DocumentService — parse + chunk pipeline', () => {
  let service: DocumentService;
  let configMock: { get: jest.Mock };
  let countTokensMock: jest.Mock;

  beforeEach(async () => {
    configMock = { get: jest.fn().mockReturnValue(undefined) };
    countTokensMock = jest.fn((text: string) => wordCount(text));
    mockGetText.mockReset();
    mockDestroy.mockReset().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: DatabaseService, useValue: {} },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: TokenService, useValue: { countTokens: countTokensMock } },
        { provide: OpenaiService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: EmbeddingCacheService, useValue: {} },
        { provide: PineconeService, useValue: {} },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
  });

  describe('parseSource()', () => {
    it('decodes TXT/MD buffers as UTF-8 directly', async () => {
      const buffer = Buffer.from('Plain text content', 'utf-8');

      const result = await service.parseSource(buffer, 'txt');

      expect(result).toBe('Plain text content');
    });

    it('decodes MD buffers as UTF-8 directly', async () => {
      const buffer = Buffer.from('# Heading\n\nBody text', 'utf-8');

      const result = await service.parseSource(buffer, 'md');

      expect(result).toBe('# Heading\n\nBody text');
    });

    it('extracts text from a PDF buffer via pdf-parse', async () => {
      mockGetText.mockResolvedValue({ text: 'Hello World\n\n' });

      const result = await service.parseSource(Buffer.from('%PDF-1.1 fixture'), 'pdf');

      expect(result).toBe('Hello World');
      expect(mockGetText).toHaveBeenCalledWith({ pageJoiner: '' });
      expect(mockDestroy).toHaveBeenCalled();
    });

    it('throws a clear error for an image-only/textless PDF', async () => {
      mockGetText.mockResolvedValue({ text: '\n\n' });

      await expect(service.parseSource(Buffer.from('%PDF-1.1 fixture'), 'pdf')).rejects.toThrow(
        /no extractable text/i,
      );
      expect(mockDestroy).toHaveBeenCalled();
    });

    it('throws a clear error for an unparseable PDF buffer', async () => {
      mockGetText.mockRejectedValue(new Error('Invalid PDF structure.'));

      await expect(service.parseSource(Buffer.from('not a pdf at all'), 'pdf')).rejects.toThrow(
        /Failed to parse PDF: Invalid PDF structure\./,
      );
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('chunkText()', () => {
    it('produces overlapping chunks whose boundaries share content', async () => {
      configMock.get.mockImplementation(configGet({ 'rag.chunkSize': 10, 'rag.chunkOverlap': 3 }));
      const text = makeWords(60);

      const chunks = await service.chunkText(text);

      expect(chunks.length).toBeGreaterThan(1);
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentTailWords = chunks[i].content.trim().split(/\s+/).slice(-3);
        const nextHeadWords = chunks[i + 1].content.trim().split(/\s+/).slice(0, 3);
        expect(nextHeadWords.some((w) => currentTailWords.includes(w))).toBe(true);
      }
    });

    it('assigns accurate startChar/endChar offsets into the source text', async () => {
      configMock.get.mockImplementation(configGet({ 'rag.chunkSize': 10, 'rag.chunkOverlap': 3 }));
      const text = makeWords(60);

      const chunks = await service.chunkText(text);

      for (const chunk of chunks) {
        expect(text.slice(chunk.startChar, chunk.endChar)).toBe(chunk.content);
      }
    });

    it('computes tokenCount via the injected TokenService, not a character estimate', async () => {
      configMock.get.mockImplementation(configGet({ 'rag.chunkSize': 10, 'rag.chunkOverlap': 3 }));
      const text = makeWords(60);

      const chunks = await service.chunkText(text);

      expect(countTokensMock).toHaveBeenCalled();
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBe(wordCount(chunk.content));
      }
    });

    it('merges a trailing sub-minChunkSize chunk into the previous chunk', async () => {
      // CHUNKING_CONFIG.minChunkSize is a hardcoded 100-token threshold — scale the fake
      // tokenizer up so a small tail (a handful of words) reliably falls under it.
      countTokensMock.mockImplementation((text: string) => wordCount(text) * 20);
      configMock.get.mockImplementation(
        configGet({ 'rag.chunkSize': 200, 'rag.chunkOverlap': 60 }),
      );
      const text = makeWords(65);

      const chunks = await service.chunkText(text);

      expect(chunks.every((c) => c.tokenCount >= 100)).toBe(true);
      expect(chunks[chunks.length - 1]?.endChar).toBe(text.length);
    });

    it('leaves a well-sized trailing chunk unmerged', async () => {
      countTokensMock.mockImplementation((text: string) => wordCount(text) * 10);
      configMock.get.mockImplementation(configGet({ 'rag.chunkSize': 200, 'rag.chunkOverlap': 0 }));
      const text = makeWords(40);

      const chunks = await service.chunkText(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[1]?.tokenCount).toBeGreaterThanOrEqual(100);
    });
  });
});
