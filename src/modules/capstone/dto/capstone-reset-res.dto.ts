import { ApiProperty } from '@nestjs/swagger';

export class CapstoneResetResDto {
  @ApiProperty({
    description:
      'Demo documents deleted (tagged "realistic-seed") — cascades their chunks, Q&A pairs, and Pinecone vectors',
  })
  documentsDeleted: number;

  @ApiProperty({
    description: 'Demo conversations deleted (titled with the "[Capstone Demo]" prefix)',
  })
  conversationsDeleted: number;

  @ApiProperty({ description: 'Demo cost budgets deleted (the 3 fixed capstone-demo-* userIds)' })
  budgetsDeleted: number;

  @ApiProperty({ description: 'Human-readable one-line summary of everything removed' })
  summary: string;
}
