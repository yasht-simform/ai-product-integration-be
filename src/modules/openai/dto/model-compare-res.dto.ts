import { ApiProperty } from '@nestjs/swagger';

import { UsageDto } from './usage.dto';

export class ModelCompareItemDto {
  @ApiProperty()
  model: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ type: () => UsageDto })
  usage: UsageDto;

  @ApiProperty({ description: 'Estimated cost in USD' })
  estimatedCost: number;

  @ApiProperty({ description: 'End-to-end latency in milliseconds' })
  latencyMs: number;
}

export class ModelCompareResDto {
  @ApiProperty({ type: () => [ModelCompareItemDto] })
  results: ModelCompareItemDto[];
}
