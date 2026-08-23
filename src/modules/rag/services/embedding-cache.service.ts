import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class EmbeddingCacheService {
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLoggerService,
  ) {}

  async get(text: string): Promise<number[] | null> {
    const textHash = this.hash(text);
    const cached = await this.databaseService.embeddingCache.findUnique({ where: { textHash } });

    if (!cached) {
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    return cached.embedding as number[];
  }

  async set(text: string, embedding: number[], model: string): Promise<void> {
    const textHash = this.hash(text);
    const embeddingJson = embedding as Prisma.InputJsonValue;

    await this.databaseService.embeddingCache.upsert({
      where: { textHash },
      create: { textHash, embedding: embeddingJson, model },
      update: { embedding: embeddingJson, model },
    });
  }

  async invalidate(textHash: string): Promise<void> {
    await this.databaseService.embeddingCache.deleteMany({ where: { textHash } });
  }

  async getCacheStats(): Promise<{ hits: number; misses: number; totalCached: number }> {
    const totalCached = await this.databaseService.embeddingCache.count();
    return { hits: this.hits, misses: this.misses, totalCached };
  }

  private hash(text: string): string {
    const normalized = text.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }
}
