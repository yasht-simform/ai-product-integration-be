import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { CostBudgetGuard } from '../cost-management/guards/cost-budget.guard';
import { ModerateField } from '../moderation/decorators/moderate-field.decorator';
import { ModerateOutputField } from '../moderation/decorators/moderate-output-field.decorator';
import { ModerationGuard } from '../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../moderation/interceptors/output-moderation.interceptor';
import { DocumentCategory } from './constants/document-category.constant';
import { EMBEDDING_CONFIG } from './constants/embedding-config.constant';
import {
  AskDto,
  AskResDto,
  CreateDocumentTextDto,
  DocumentChunkResDto,
  DocumentResDto,
  DocumentWithChunksResDto,
  EvaluateDto,
  EvaluateResDto,
  GenerateDocumentsDto,
  GenerateQaDto,
  PaginatedDocumentChunksResDto,
  PaginatedDocumentsResDto,
  PaginatedQaPairsResDto,
  QaPairResDto,
  QueryChunksDto,
  QueryDocumentsDto,
  QueryQaPairsDto,
  SearchDto,
  SearchResDto,
  SearchResultResDto,
  SeedResultResDto,
  StatsResDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto';
import { DocumentService } from './services/document.service';
import { EmbeddingCacheService } from './services/embedding-cache.service';
import { MockDataService } from './services/mock-data.service';
import { PineconeService } from './services/pinecone.service';
import { RagService } from './services/rag.service';
import { SearchService } from './services/search.service';
import type {
  DocumentChunkEntity,
  DocumentEntity,
  DocumentWithChunks,
  QaPairEntity,
  RagResult,
  SearchResult,
} from './types/rag.types';

@ApiTags('rag')
@Controller('rag')
export class RagController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly searchService: SearchService,
    private readonly ragService: RagService,
    private readonly mockDataService: MockDataService,
    private readonly pineconeService: PineconeService,
    private readonly embeddingCacheService: EmbeddingCacheService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Documents ─────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Upload and ingest a document (PDF, TXT, or MD)',
    type: DocumentResDto,
    successStatus: 201,
    isPublic: true,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File upload with optional metadata',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF, TXT, or MD file' },
        title: { type: 'string', description: 'Override title (default: filename)' },
        description: { type: 'string', description: 'Document description' },
        category: { type: 'string', enum: Object.values(DocumentCategory) },
        tags: { type: 'string', description: 'Comma-separated tags' },
      },
    },
  })
  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ): Promise<DocumentResDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const document = await this.documentService.ingestFromFile(file, {
      title: dto.title,
      description: dto.description,
      category: dto.category,
      tags: this.parseTags(dto.tags),
    });
    return this.toDocumentRes(document);
  }

  @ApiEndpoint({
    summary: 'Create and ingest a document from raw text',
    type: DocumentResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('documents/text')
  async createDocumentFromText(@Body() dto: CreateDocumentTextDto): Promise<DocumentResDto> {
    const document = await this.documentService.createFromText(dto);
    return this.toDocumentRes(document);
  }

  @ApiEndpoint({
    summary: 'List documents with filters and pagination',
    type: PaginatedDocumentsResDto,
    isPublic: true,
  })
  @Get('documents')
  async findAllDocuments(@Query() query: QueryDocumentsDto): Promise<PaginatedDocumentsResDto> {
    const result = await this.documentService.findAll(query);
    return { ...result, data: result.data.map((d) => this.toDocumentRes(d)) };
  }

  @ApiEndpoint({
    summary: 'Get a document with its chunks, chunk count, and embedding status',
    type: DocumentWithChunksResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @Get('documents/:publicId')
  async findDocument(@Param('publicId') publicId: string): Promise<DocumentWithChunksResDto> {
    const document = await this.documentService.findOne(publicId);
    return this.toDocumentWithChunksRes(document);
  }

  @ApiEndpoint({
    summary: "Get a document's chunks (paginated)",
    type: PaginatedDocumentChunksResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @Get('documents/:publicId/chunks')
  async findDocumentChunks(
    @Param('publicId') publicId: string,
    @Query() query: QueryChunksDto,
  ): Promise<PaginatedDocumentChunksResDto> {
    const result = await this.documentService.getChunks(publicId, query);
    return { ...result, data: result.data.map((c) => this.toChunkRes(c)) };
  }

  @ApiEndpoint({
    summary: 'Update document metadata (title, description, category, tags)',
    type: DocumentResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @Patch('documents/:publicId')
  async updateDocument(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResDto> {
    const document = await this.documentService.update(publicId, dto);
    return this.toDocumentRes(document);
  }

  @ApiEndpoint({
    summary: 'Delete a document, its chunks, and its Pinecone vectors',
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @Delete('documents/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(@Param('publicId') publicId: string): Promise<void> {
    return this.documentService.delete(publicId);
  }

  @ApiEndpoint({
    summary: 'Re-chunk and re-embed a document',
    type: DocumentResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @Post('documents/:publicId/reindex')
  async reindexDocument(@Param('publicId') publicId: string): Promise<DocumentResDto> {
    const document = await this.documentService.reindexDocument(publicId);
    return this.toDocumentRes(document);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Semantic search across all documents',
    type: SearchResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('search')
  async search(@Body() dto: SearchDto): Promise<SearchResDto> {
    const searchStart = Date.now();
    const results = await this.searchService.search(dto.query, {
      topK: dto.topK,
      similarityThreshold: dto.similarityThreshold,
      categoryFilter: dto.category,
      documentIds: dto.documentIds,
    });
    const searchLatencyMs = Date.now() - searchStart;

    return {
      results: results.map((r) => this.toSearchResultRes(r)),
      totalResults: results.length,
      searchLatencyMs,
    };
  }

  // ── Q&A (RAG) ─────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Ask a question and get a RAG-powered answer with citations',
    type: AskResDto,
    successStatus: 201,
    isPublic: true,
  })
  @UseGuards(ModerationGuard, CostBudgetGuard)
  @ModerateField('question', 'rag')
  @UseInterceptors(OutputModerationInterceptor)
  @ModerateOutputField('answer', 'rag')
  @Post('ask')
  async ask(@Body() dto: AskDto): Promise<AskResDto> {
    const result = await this.ragService.query(dto.question, {
      topK: dto.topK,
      model: dto.model,
      temperature: dto.temperature,
      categoryFilter: dto.category,
    });
    return this.toAskRes(result, dto.includeSourceChunks);
  }

  @ApiEndpoint({
    summary: 'Ask a question within an existing conversation (RAG + chat history)',
    type: AskResDto,
    successStatus: 201,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @UseGuards(ModerationGuard, CostBudgetGuard)
  @ModerateField('question', 'rag')
  @Post('ask/conversation/:publicId')
  async askInConversation(
    @Param('publicId') publicId: string,
    @Body() dto: AskDto,
  ): Promise<AskResDto> {
    const result = await this.ragService.queryWithConversation(publicId, dto.question, {
      topK: dto.topK,
      model: dto.model,
      temperature: dto.temperature,
      categoryFilter: dto.category,
    });
    return this.toAskRes(result, dto.includeSourceChunks);
  }

  // ── Mock Data ─────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Generate N fake documents using faker-based templates',
    type: [DocumentResDto],
    successStatus: 201,
    isPublic: true,
  })
  @Post('mock/generate-documents')
  async generateMockDocuments(@Body() dto: GenerateDocumentsDto): Promise<DocumentResDto[]> {
    const documents = await this.mockDataService.generateDocuments(dto.count, {
      categories: dto.categories,
      minWords: dto.minWords,
      maxWords: dto.maxWords,
    });
    return documents.map((d) => this.toDocumentRes(d));
  }

  @ApiEndpoint({
    summary: 'Generate Q&A pairs from existing documents',
    type: [QaPairResDto],
    successStatus: 201,
    isPublic: true,
  })
  @Post('mock/generate-qa')
  async generateMockQa(@Body() dto: GenerateQaDto): Promise<QaPairResDto[]> {
    const pairs = await this.mockDataService.generateQAPairs(dto.count, dto.documentIds);
    return pairs.map((p) => this.toQaPairRes(p));
  }

  @ApiEndpoint({
    summary: 'Run the full default seed (50 documents + 500 Q&A pairs)',
    type: SeedResultResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('mock/seed')
  async seedMockData(): Promise<SeedResultResDto> {
    return this.mockDataService.seedDefaultDataset();
  }

  @ApiEndpoint({
    summary:
      'Seed the hand-written, coherent English CloudPulse dataset (50 documents + 250 Q&A pairs) for meaningful evaluation',
    type: SeedResultResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('mock/seed-realistic')
  async seedRealisticMockData(): Promise<SeedResultResDto> {
    return this.mockDataService.seedRealisticDataset();
  }

  @ApiEndpoint({
    summary: 'List generated Q&A pairs (for evaluation)',
    type: PaginatedQaPairsResDto,
    isPublic: true,
  })
  @Get('mock/qa-pairs')
  async findAllQaPairs(@Query() query: QueryQaPairsDto): Promise<PaginatedQaPairsResDto> {
    const result = await this.mockDataService.findAllQaPairs(query);
    return { ...result, data: result.data.map((p) => this.toQaPairRes(p)) };
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Run Q&A pairs through RAG and score accuracy by complexity tier',
    type: EvaluateResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('evaluate')
  async evaluate(@Body() dto: EvaluateDto): Promise<EvaluateResDto> {
    return this.mockDataService.evaluate(dto.sampleSize, dto.qaPairs);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  // The one route in this module that legitimately aggregates multiple services directly
  // (per this issue's own scope) — every other route delegates to exactly one service.
  @ApiEndpoint({
    summary: 'Embedding pipeline stats: documents, chunks, vectors, cache hit rate',
    type: StatsResDto,
    isPublic: true,
  })
  @Get('stats')
  async getStats(): Promise<StatsResDto> {
    const [{ totalDocuments, totalChunks }, cacheStats] = await Promise.all([
      this.documentService.getStats(),
      this.embeddingCacheService.getCacheStats(),
    ]);

    let totalVectors = 0;
    let indexDimensions: number | undefined;
    try {
      const pineconeStats = await this.pineconeService.describeIndex();
      totalVectors = pineconeStats.totalRecordCount;
      indexDimensions = pineconeStats.dimension;
    } catch (error) {
      // Pinecone connectivity/config issues shouldn't take down the whole stats response —
      // document/chunk/cache stats are still useful on their own.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not fetch Pinecone index stats: ${message}`);
    }

    const totalCacheLookups = cacheStats.hits + cacheStats.misses;
    const cacheHitRate = totalCacheLookups > 0 ? cacheStats.hits / totalCacheLookups : 0;

    return {
      totalDocuments,
      totalChunks,
      totalVectors,
      cacheHitRate,
      embeddingModel:
        this.configService.get<string>('rag.embeddingModel') ?? EMBEDDING_CONFIG.model,
      indexDimensions,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private parseTags(tags?: string): string[] | undefined {
    if (!tags) return undefined;
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return tagList.length > 0 ? tagList : undefined;
  }

  private toDocumentRes(document: DocumentEntity): DocumentResDto {
    return {
      publicId: document.publicId,
      title: document.title,
      description: document.description ?? undefined,
      sourceType: document.sourceType,
      originalFilename: document.originalFilename ?? undefined,
      fileSize: document.fileSize ?? undefined,
      totalChunks: document.totalChunks,
      totalTokens: document.totalTokens,
      embeddingModel: document.embeddingModel,
      embeddingStatus: document.embeddingStatus,
      category: document.category ?? undefined,
      tags: document.tags,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private toChunkRes(chunk: DocumentChunkEntity): DocumentChunkResDto {
    return {
      publicId: chunk.publicId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
      embeddingStatus: chunk.embeddingStatus,
      createdAt: chunk.createdAt,
    };
  }

  private toDocumentWithChunksRes(document: DocumentWithChunks): DocumentWithChunksResDto {
    return {
      ...this.toDocumentRes(document),
      chunks: document.chunks.map((c) => this.toChunkRes(c)),
    };
  }

  private toSearchResultRes(result: SearchResult): SearchResultResDto {
    return {
      chunkPublicId: result.chunkPublicId,
      documentPublicId: result.documentPublicId,
      documentTitle: result.documentTitle,
      content: result.content,
      chunkIndex: result.chunkIndex,
      score: result.score,
      category: result.category ?? undefined,
    };
  }

  // `includeSourceChunks: false` strips sources from the response (default/undefined keeps them),
  // per AI-046's own documented Follow Up: RagService.query()/queryWithConversation() always
  // populate RagResult.sources — this controller is the response-shaping layer that decides
  // whether to surface them, per spec §6.3's optional "Include raw chunks in response" field.
  private toAskRes(result: RagResult, includeSourceChunks?: boolean): AskResDto {
    return {
      answer: result.answer,
      model: result.model,
      sources: includeSourceChunks === false ? [] : result.sources,
      usage: result.usage,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
      chunksRetrieved: result.chunksRetrieved,
      searchLatencyMs: result.searchLatencyMs,
      generationLatencyMs: result.generationLatencyMs,
    };
  }

  private toQaPairRes(pair: QaPairEntity): QaPairResDto {
    return {
      publicId: pair.publicId,
      question: pair.question,
      expectedAnswer: pair.expectedAnswer,
      sourceDocumentId: pair.sourceDocumentId,
      complexity: pair.complexity,
      createdAt: pair.createdAt,
    };
  }
}
