import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UsageDto } from '../../openai/dto/usage.dto';

export class AssistantMessageResDto {
  @ApiProperty()
  messageId: string;

  @ApiProperty({ description: '"assistant"' })
  role: string;

  @ApiPropertyOptional()
  content?: string;

  @ApiProperty()
  model: string;

  @ApiPropertyOptional({ description: 'Tool calls requested by the model, if any' })
  toolCalls?: unknown;

  @ApiProperty({ type: () => UsageDto })
  usage: UsageDto;

  @ApiProperty()
  estimatedCost: number;

  @ApiProperty()
  latencyMs: number;
}
