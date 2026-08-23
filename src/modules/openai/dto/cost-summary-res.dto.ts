import { ApiProperty } from '@nestjs/swagger';

export class ModelCostBreakdownDto {
  @ApiProperty()
  model: string;

  @ApiProperty({ description: 'Total cost for this model in USD' })
  cost: number;

  @ApiProperty({ description: 'Number of API calls' })
  callCount: number;
}

export class CostSummaryResDto {
  @ApiProperty({ description: 'Total cost across all calls in USD' })
  totalCost: number;

  @ApiProperty({ description: 'Total tokens consumed' })
  totalTokens: number;

  @ApiProperty()
  totalInputTokens: number;

  @ApiProperty()
  totalOutputTokens: number;

  @ApiProperty({ description: 'Total number of API calls' })
  callCount: number;

  @ApiProperty({ description: 'Average latency in milliseconds' })
  averageLatencyMs: number;

  @ApiProperty({ type: () => [ModelCostBreakdownDto] })
  perModelBreakdown: ModelCostBreakdownDto[];
}
