import { ApiProperty } from '@nestjs/swagger';

export class SpendTimelinePointResDto {
  @ApiProperty({ description: 'UTC calendar day (YYYY-MM-DD)' })
  date: string;

  @ApiProperty()
  totalCost: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  callCount: number;
}

// Shared by both GET /cost/analytics/timeline and GET /cost/analytics/daily-trend — both
// service methods (getSpendTimeline() / getDailySpendTrend()) return the same daily-bucket shape.
export class SpendTimelineResDto {
  @ApiProperty({ type: () => [SpendTimelinePointResDto] })
  data: SpendTimelinePointResDto[];
}
