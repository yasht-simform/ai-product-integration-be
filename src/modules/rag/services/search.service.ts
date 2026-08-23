import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { EMBEDDING_CONFIG } from '../constants/embedding-config.constant';
import { RAG_CONFIG } from '../constants/rag-config.constant';
import type { SearchOptions, SearchResult } from '../types/rag.types';
import { EmbeddingCacheService } from './embedding-cache.service';
import { EmbeddingService } from './embedding.service';
import { PineconeService, type PineconeMatch } from './pinecone.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly openaiService: OpenaiService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingCacheService: EmbeddingCacheService,
    private readonly pineconeService: PineconeService,
  ) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const topK = options.topK ?? this.configService.get<number>('rag.topK') ?? RAG_CONFIG.topK;
    const similarityThreshold =
      options.similarityThreshold ??
      this.configService.get<number>('rag.similarityThreshold') ??
      RAG_CONFIG.similarityThreshold;

    const queryEmbedding = await this.resolveQueryEmbedding(query);
    const filter = this.buildFilter(options);
    const matches = await this.pineconeService.query(queryEmbedding, topK, filter);

    const aboveThreshold = matches.filter((match) => match.score >= similarityThreshold);
    if (aboveThreshold.length === 0) {
      return [];
    }

    return this.resolveChunks(aboveThreshold);
  }

  async searchWithScores(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.search(query, options);
  }

  private async resolveQueryEmbedding(query: string): Promise<number[]> {
    const cached = await this.embeddingCacheService.get(query);
    if (cached) {
      return cached;
    }

    const model = this.configService.get<string>('rag.embeddingModel') ?? EMBEDDING_CONFIG.model;
    const embedding = await this.openaiService.generateEmbedding(query, model);
    await this.embeddingCacheService.set(query, embedding, model);
    return embedding;
  }

  private buildFilter(options: SearchOptions): Record<string, unknown> | undefined {
    const filter: Record<string, unknown> = {};

    if (options.categoryFilter) {
      filter.category = options.categoryFilter;
    }
    if (options.documentIds && options.documentIds.length > 0) {
      filter.documentId = { $in: options.documentIds };
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private async resolveChunks(matches: PineconeMatch[]): Promise<SearchResult[]> {
    const pineconeIds = matches.map((match) => match.id);

    const chunks = await this.databaseService.documentChunk.findMany({
      where: { pineconeId: { in: pineconeIds } },
      include: { document: true },
    });

    const chunkByPineconeId = new Map(chunks.map((chunk) => [chunk.pineconeId, chunk]));

    return matches
      .map((match): SearchResult | null => {
        const chunk = chunkByPineconeId.get(match.id);
        if (!chunk) {
          return null;
        }

        return {
          chunkPublicId: chunk.publicId,
          documentPublicId: chunk.document.publicId,
          documentTitle: chunk.document.title,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          score: match.score,
          category: chunk.document.category,
        };
      })
      .filter((result): result is SearchResult => result !== null);
  }
}
