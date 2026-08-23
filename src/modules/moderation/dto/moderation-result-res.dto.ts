import { ApiProperty } from '@nestjs/swagger';

export class HighestScoreResDto {
  @ApiProperty()
  category: string;

  @ApiProperty()
  score: number;
}

export class ModerationResultResDto {
  @ApiProperty()
  isFlagged: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Per-category flagged/not-flagged',
  })
  categories: Record<string, boolean>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Per-category confidence score',
  })
  categoryScores: Record<string, number>;

  @ApiProperty({ type: [String], description: 'Only the categories that were flagged' })
  flaggedCategories: string[];

  @ApiProperty({ type: () => HighestScoreResDto })
  highestScore: HighestScoreResDto;
}
