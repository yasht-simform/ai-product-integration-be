import { ApiProperty } from '@nestjs/swagger';

export class ModerationDirectionSplitResDto {
  @ApiProperty()
  input: number;

  @ApiProperty()
  output: number;
}

export class TopFlaggedCategoryResDto {
  @ApiProperty()
  category: string;

  @ApiProperty()
  count: number;
}

export class ModerationStatsResDto {
  @ApiProperty()
  totalChecks: number;

  @ApiProperty()
  flaggedCount: number;

  @ApiProperty({ description: 'flaggedCount ÷ totalChecks (0 when totalChecks is 0)' })
  violationRate: number;

  @ApiProperty({ type: () => ModerationDirectionSplitResDto })
  byDirection: ModerationDirectionSplitResDto;

  @ApiProperty({ type: () => [TopFlaggedCategoryResDto] })
  topCategories: TopFlaggedCategoryResDto[];
}
