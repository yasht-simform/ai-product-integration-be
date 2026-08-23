import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone, type Index, type RecordMetadata } from '@pinecone-database/pinecone';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PINECONE_CONFIG } from '../constants/pinecone-config.constant';

export interface PineconeVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

export interface PineconeMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface PineconeIndexStats {
  totalRecordCount: number;
  dimension?: number;
}

@Injectable()
export class PineconeService {
  private readonly client: Pinecone | null;
  private readonly indexName: string | undefined;
  private readonly namespace: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const apiKey = this.configService.get<string>('pinecone.apiKey');
    this.indexName = this.configService.get<string>('pinecone.index');
    this.namespace =
      this.configService.get<string>('pinecone.namespace') ?? PINECONE_CONFIG.namespace;

    this.client = apiKey && this.indexName ? new Pinecone({ apiKey }) : null;

    if (!this.client) {
      this.logger.warn(
        'Pinecone is not configured (PINECONE_API_KEY/PINECONE_INDEX unset) — vector operations will fail until configured',
      );
    }
  }

  async upsert(vectors: PineconeVector[]): Promise<void> {
    const index = this.getIndex();

    await index.upsert({
      records: vectors.map((vector) => ({
        id: vector.id,
        values: vector.values,
        metadata: vector.metadata as unknown as RecordMetadata,
      })),
    });
  }

  async query(
    vector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<PineconeMatch[]> {
    const index = this.getIndex();

    const response = await index.query({
      vector,
      topK,
      includeMetadata: true,
      ...(filter !== undefined ? { filter } : {}),
    });

    return response.matches.map((match) => ({
      id: match.id,
      score: match.score ?? 0,
      metadata: match.metadata ?? {},
    }));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    const index = this.getIndex();
    await index.deleteMany({ ids });
  }

  async deleteByFilter(filter: Record<string, unknown>): Promise<void> {
    const index = this.getIndex();
    await index.deleteMany({ filter });
  }

  async describeIndex(): Promise<PineconeIndexStats> {
    const index = this.getIndex();
    const stats = await index.describeIndexStats();

    return {
      totalRecordCount: stats.totalRecordCount ?? 0,
      dimension: stats.dimension,
    };
  }

  private getIndex(): Index {
    const { client, indexName } = this;
    if (!client || !indexName) {
      throw new ServiceUnavailableException('Pinecone is not configured');
    }
    return client.index({ name: indexName }).namespace(this.namespace);
  }
}
