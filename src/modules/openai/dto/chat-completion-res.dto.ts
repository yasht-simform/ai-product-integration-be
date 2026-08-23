import { ApiProperty } from '@nestjs/swagger';

import { UsageDto } from './usage.dto';

export class ChatCompletionResDto {
  @ApiProperty({ description: 'Model-generated text' })
  content: string;

  @ApiProperty({ description: 'Model that produced the response' })
  model: string;

  @ApiProperty({ type: () => UsageDto })
  usage: UsageDto;

  @ApiProperty({ description: 'Estimated cost in USD' })
  estimatedCost: number;

  @ApiProperty({ description: 'End-to-end latency in milliseconds' })
  latencyMs: number;
}
