import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StatsResDto {
  @ApiProperty()
  totalDocuments: number;

  @ApiProperty()
  totalChunks: number;

  @ApiProperty({ description: 'Total vectors stored in the Pinecone index' })
  totalVectors: number;

  @ApiProperty({ description: 'Embedding cache hit rate, 0-1' })
  cacheHitRate: number;

  @ApiProperty()
  embeddingModel: string;

  @ApiPropertyOptional({ description: 'Pinecone index vector dimension' })
  indexDimensions?: number;
}
