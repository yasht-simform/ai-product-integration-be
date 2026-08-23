import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EvaluateResDto } from '../../rag/dto';

export class CapstoneStatusResDto {
  @ApiProperty({ description: 'true once all 50 demo documents are present and embedded' })
  ready: boolean;

  @ApiProperty({ description: 'Documents currently tagged as the capstone demo dataset' })
  documents: number;

  @ApiProperty({ description: 'Chunks across the demo dataset' })
  chunks: number;

  @ApiProperty({ description: 'Pinecone vectors reported for the whole index (not demo-scoped)' })
  vectors: number;

  @ApiProperty({ description: 'Q&A pairs available for evaluation' })
  qaPairs: number;

  @ApiProperty({ description: 'Demo conversations currently seeded' })
  conversations: number;

  @ApiProperty({ description: 'Demo cost budgets currently seeded' })
  budgets: number;

  @ApiPropertyOptional({
    type: EvaluateResDto,
    nullable: true,
    description: 'Most recent evaluation report from this process, or null if none has run yet',
  })
  lastEvaluation: EvaluateResDto | null;
}
