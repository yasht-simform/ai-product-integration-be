import { ApiProperty } from '@nestjs/swagger';

import { EvaluateResDto } from '../../rag/dto';

export class CapstoneSeedResDto {
  @ApiProperty({ description: 'Documents seeded (50 CloudPulse documents, 10 per category)' })
  documents: number;

  @ApiProperty({ description: 'Chunks produced across all seeded documents' })
  chunks: number;

  @ApiProperty({ description: 'Pinecone vectors upserted across all seeded documents' })
  vectors: number;

  @ApiProperty({ description: 'Q&A evaluation pairs seeded (250 — 5 per document)' })
  qaPairs: number;

  @ApiProperty({ description: 'Sample multi-turn demo conversations seeded' })
  conversations: number;

  @ApiProperty({ description: 'Sample per-user cost budgets seeded' })
  budgets: number;

  @ApiProperty({
    type: EvaluateResDto,
    description: 'Accuracy report from the post-seed evaluation run',
  })
  evaluation: EvaluateResDto;

  @ApiProperty({ description: 'Human-readable one-line summary of everything seeded' })
  summary: string;
}
