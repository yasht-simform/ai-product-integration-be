import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';

import type { Document, DocumentChunk, Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { CHUNKING_CONFIG } from '../constants/chunking-config.constant';
import { DocumentSourceType } from '../constants/document-source-type.constant';
import { EMBEDDING_CONFIG } from '../constants/embedding-config.constant';
import { EmbeddingStatus } from '../constants/embedding-status.constant';
import type { CreateDocumentTextDto } from '../dto/create-document-text.dto';
import type { CreateDocumentDto } from '../dto/create-document.dto';
import type { QueryChunksDto } from '../dto/query-chunks.dto';
import type { QueryDocumentsDto } from '../dto/query-documents.dto';
import type { UpdateDocumentDto } from '../dto/update-document.dto';
import type {
  ChunkDescriptor,
  DocumentChunkEntity,
  DocumentEntity,
  DocumentStatsResult,
  DocumentWithChunks,
  IngestionStatusResult,
  PaginatedChunksResult,
  PaginatedDocumentsResult,
} from '../types/rag.types';
import { EmbeddingCacheService } from './embedding-cache.service';
import { EmbeddingService } from './embedding.service';
import { PineconeService, type PineconeVector } from './pinecone.service';

const SUPPORTED_FILE_SOURCE_TYPES: DocumentSourceType[] = [
  DocumentSourceType.PDF,
  DocumentSourceType.TXT,
  DocumentSourceType.MD,
];

@Injectable()
export class DocumentService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly tokenService: TokenService,
    private readonly openaiService: OpenaiService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingCacheService: EmbeddingCacheService,
    private readonly pineconeService: PineconeService,
  ) {}

  async create(dto: CreateDocumentDto): Promise<DocumentEntity> {
    const document = await this.createDocumentRow(dto);
    return this.toDocumentEntity(document);
  }

  async createFromText(dto: CreateDocumentTextDto): Promise<DocumentEntity> {
    const document = await this.createDocumentRow({
      title: dto.title,
      description: dto.description,
      sourceType: DocumentSourceType.TXT,
      category: dto.category,
      tags: dto.tags,
    });

    return this.ingestDocument(document, dto.content);
  }

  private async createDocumentRow(
    dto: CreateDocumentDto & { originalFilename?: string; fileSize?: number },
  ): Promise<Document> {
    return this.databaseService.document.create({
      data: {
        title: dto.title ?? 'Untitled Document',
        description: dto.description,
        sourceType: dto.sourceType,
        originalFilename: dto.originalFilename,
        fileSize: dto.fileSize,
        category: dto.category,
        tags: dto.tags ?? [],
        embeddingModel:
          this.configService.get<string>('rag.embeddingModel') ?? 'text-embedding-3-small',
        embeddingStatus: EmbeddingStatus.PENDING,
        totalChunks: 0,
        totalTokens: 0,
      },
    });
  }

  async ingestFromFile(
    file: Express.Multer.File,
    overrides?: Partial<Pick<CreateDocumentDto, 'title' | 'description' | 'category' | 'tags'>>,
  ): Promise<DocumentEntity> {
    const sourceType = this.resolveSourceTypeFromFilename(file.originalname);
    const text = await this.parseSource(file.buffer, sourceType);

    const document = await this.createDocumentRow({
      title: overrides?.title ?? file.originalname,
      description: overrides?.description,
      sourceType,
      category: overrides?.category,
      tags: overrides?.tags,
      originalFilename: file.originalname,
      fileSize: file.size,
    });

    return this.ingestDocument(document, text);
  }

  async reindexDocument(publicId: string): Promise<DocumentEntity> {
    const document = await this.databaseService.document.findUnique({
      where: { publicId },
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
    });
    if (!document) {
      throw new NotFoundException(`Document "${publicId}" not found`);
    }

    const text = this.reconstructText(document.chunks);

    await this.databaseService.documentChunk.deleteMany({ where: { documentId: document.id } });
    await this.pineconeService.deleteByFilter({ documentId: document.publicId });

    return this.ingestDocument(document, text);
  }

  async getIngestionStatus(publicId: string): Promise<IngestionStatusResult> {
    const document = await this.findDocumentOrThrow(publicId);
    return {
      embeddingStatus: document.embeddingStatus,
      totalChunks: document.totalChunks,
      totalTokens: document.totalTokens,
    };
  }

  async getChunks(documentPublicId: string, query: QueryChunksDto): Promise<PaginatedChunksResult> {
    const document = await this.findDocumentOrThrow(documentPublicId);
    const { page = 1, limit = 20 } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const [chunks, total] = await Promise.all([
      this.databaseService.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
        skip,
        take,
      }),
      this.databaseService.documentChunk.count({ where: { documentId: document.id } }),
    ]);

    return { data: chunks.map((c) => this.toChunkEntity(c)), total, page, limit: take };
  }

  private resolveSourceTypeFromFilename(filename: string): DocumentSourceType {
    const extension = filename.split('.').pop()?.toLowerCase();

    if (!extension || !SUPPORTED_FILE_SOURCE_TYPES.includes(extension as DocumentSourceType)) {
      throw new BadRequestException(
        `Unsupported file type "${extension ?? filename}" — expected one of: ${SUPPORTED_FILE_SOURCE_TYPES.join(', ')}`,
      );
    }

    return extension as DocumentSourceType;
  }

  private reconstructText(chunks: DocumentChunk[]): string {
    const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

    return sorted
      .map((chunk, i) => {
        const next = sorted[i + 1];
        if (!next) return chunk.content;
        return chunk.content.slice(0, next.startChar - chunk.startChar);
      })
      .join('');
  }

  private async ingestDocument(document: Document, text: string): Promise<DocumentEntity> {
    await this.databaseService.document.update({
      where: { id: document.id },
      data: { embeddingStatus: EmbeddingStatus.PROCESSING },
    });

    try {
      const chunks = await this.chunkText(text, document.embeddingModel);
      const embeddings = await this.embedChunks(chunks, document.embeddingModel);

      const vectors: PineconeVector[] = chunks.map((chunk, i) => ({
        id: `chunk_${document.publicId}_${chunk.chunkIndex}`,
        values: embeddings[i] ?? [],
        metadata: {
          documentId: document.publicId,
          documentTitle: document.title,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          ...(document.category ? { category: document.category } : {}),
        },
      }));

      if (vectors.length > 0) {
        await this.pineconeService.upsert(vectors);
      }

      if (chunks.length > 0) {
        await this.databaseService.documentChunk.createMany({
          data: chunks.map((chunk, i) => ({
            documentId: document.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
            pineconeId: vectors[i]?.id,
            embeddingStatus: EmbeddingStatus.COMPLETED,
          })),
        });
      }

      const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

      const completed = await this.databaseService.document.update({
        where: { id: document.id },
        data: {
          embeddingStatus: EmbeddingStatus.COMPLETED,
          totalChunks: chunks.length,
          totalTokens,
        },
      });

      return this.toDocumentEntity(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ingestion failed for document ${document.publicId}: ${message}`);

      const failed = await this.databaseService.document.update({
        where: { id: document.id },
        data: { embeddingStatus: EmbeddingStatus.FAILED },
      });

      return this.toDocumentEntity(failed);
    }
  }

  private async embedChunks(chunks: ChunkDescriptor[], model: string): Promise<number[][]> {
    const embeddings: (number[] | undefined)[] = new Array<undefined>(chunks.length).fill(
      undefined,
    );
    const missIndices: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const cached = await this.embeddingCacheService.get(chunks[i].content);
      if (cached) {
        embeddings[i] = cached;
      } else {
        missIndices.push(i);
      }
    }

    const batchSize =
      this.configService.get<number>('rag.embeddingBatchSize') ?? EMBEDDING_CONFIG.batchSize;

    for (let start = 0; start < missIndices.length; start += batchSize) {
      const batchIndices = missIndices.slice(start, start + batchSize);
      const batchTexts = batchIndices.map((idx) => chunks[idx].content);
      const batchEmbeddings = await this.openaiService.generateEmbeddingsBatch(batchTexts, model);

      for (let i = 0; i < batchIndices.length; i++) {
        const idx = batchIndices[i];
        const embedding = batchEmbeddings[i] ?? [];
        embeddings[idx] = embedding;
        await this.embeddingCacheService.set(chunks[idx].content, embedding, model);
      }
    }

    return embeddings.map((embedding) => embedding ?? []);
  }

  async parseSource(buffer: Buffer, sourceType: string): Promise<string> {
    if (sourceType === DocumentSourceType.PDF) {
      return this.parsePdf(buffer);
    }
    return buffer.toString('utf-8');
  }

  async chunkText(text: string, model?: string): Promise<ChunkDescriptor[]> {
    const tokenModel =
      model ?? this.configService.get<string>('rag.embeddingModel') ?? EMBEDDING_CONFIG.model;
    const chunkSize = this.configService.get<number>('rag.chunkSize') ?? CHUNKING_CONFIG.chunkSize;
    const chunkOverlap =
      this.configService.get<number>('rag.chunkOverlap') ?? CHUNKING_CONFIG.chunkOverlap;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: [...CHUNKING_CONFIG.separators],
      lengthFunction: (chunk: string) => this.tokenService.countTokens(chunk, tokenModel),
    });

    const rawChunks = await splitter.splitText(text);
    const chunks = this.toChunkDescriptors(rawChunks, text, tokenModel);
    return this.mergeTrailingChunk(chunks, text, tokenModel);
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    let parser: PDFParse | undefined;
    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText({ pageJoiner: '' });
      const text = result.text.trim();
      if (!text) {
        throw new Error('No extractable text found in PDF — it may be image-only or corrupted');
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('No extractable text')) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse PDF: ${message}`);
    } finally {
      await parser?.destroy();
    }
  }

  private toChunkDescriptors(
    rawChunks: string[],
    sourceText: string,
    model: string,
  ): ChunkDescriptor[] {
    const chunks: ChunkDescriptor[] = [];
    let searchFrom = 0;

    rawChunks.forEach((content, chunkIndex) => {
      const startChar = sourceText.indexOf(content, searchFrom);
      if (startChar === -1) {
        throw new Error(`Failed to locate chunk ${chunkIndex} offset in source text`);
      }
      const endChar = startChar + content.length;
      searchFrom = startChar + 1;

      chunks.push({
        content,
        chunkIndex,
        tokenCount: this.tokenService.countTokens(content, model),
        startChar,
        endChar,
      });
    });

    return chunks;
  }

  private mergeTrailingChunk(
    chunks: ChunkDescriptor[],
    sourceText: string,
    model: string,
  ): ChunkDescriptor[] {
    if (chunks.length < 2) return chunks;

    const last = chunks[chunks.length - 1];
    if (!last || last.tokenCount >= CHUNKING_CONFIG.minChunkSize) return chunks;

    const merged = chunks.slice(0, -1);
    const previous = merged[merged.length - 1];
    if (!previous) return chunks;

    const content = sourceText.slice(previous.startChar, last.endChar);
    merged[merged.length - 1] = {
      ...previous,
      content,
      endChar: last.endChar,
      tokenCount: this.tokenService.countTokens(content, model),
    };
    return merged;
  }

  async findAll(query: QueryDocumentsDto): Promise<PaginatedDocumentsResult> {
    const { page = 1, limit = 20, category, status, tags, search } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.DocumentWhereInput = {};
    if (category) where.category = category;
    if (status) where.embeddingStatus = status;
    if (tags) {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) where.tags = { hasSome: tagList };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      this.databaseService.document.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.databaseService.document.count({ where }),
    ]);

    return { data: documents.map((d) => this.toDocumentEntity(d)), total, page, limit: take };
  }

  async findOne(publicId: string): Promise<DocumentWithChunks> {
    const document = await this.databaseService.document.findUnique({
      where: { publicId },
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
    });
    if (!document) {
      throw new NotFoundException(`Document "${publicId}" not found`);
    }

    return {
      ...this.toDocumentEntity(document),
      chunks: document.chunks.map((c) => this.toChunkEntity(c)),
    };
  }

  async update(publicId: string, dto: UpdateDocumentDto): Promise<DocumentEntity> {
    await this.findDocumentOrThrow(publicId);

    const document = await this.databaseService.document.update({
      where: { publicId },
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        tags: dto.tags,
      },
    });
    return this.toDocumentEntity(document);
  }

  async delete(publicId: string): Promise<void> {
    await this.findDocumentOrThrow(publicId);
    await this.databaseService.document.delete({ where: { publicId } });
    await this.pineconeService.deleteByFilter({ documentId: publicId });
  }

  async getStats(): Promise<DocumentStatsResult> {
    const [totalDocuments, totalChunks] = await Promise.all([
      this.databaseService.document.count(),
      this.databaseService.documentChunk.count(),
    ]);
    return { totalDocuments, totalChunks };
  }

  private async findDocumentOrThrow(publicId: string): Promise<Document> {
    const document = await this.databaseService.document.findUnique({ where: { publicId } });
    if (!document) {
      throw new NotFoundException(`Document "${publicId}" not found`);
    }
    return document;
  }

  private toDocumentEntity(document: Document): DocumentEntity {
    return {
      publicId: document.publicId,
      title: document.title,
      description: document.description,
      sourceType: document.sourceType,
      originalFilename: document.originalFilename,
      fileSize: document.fileSize,
      totalChunks: document.totalChunks,
      totalTokens: document.totalTokens,
      embeddingModel: document.embeddingModel,
      embeddingStatus: document.embeddingStatus,
      category: document.category,
      tags: document.tags,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private toChunkEntity(chunk: DocumentChunk): DocumentChunkEntity {
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
}
