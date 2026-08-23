import { ApiProperty } from '@nestjs/swagger';

import { UsageDto } from '../../openai/dto/usage.dto';
import { RagSourceResDto } from './rag-source-res.dto';

export class AskResDto {
  @ApiProperty()
  answer: string;

  @ApiProperty()
  model: string;

  @ApiProperty({ type: () => [RagSourceResDto] })
  sources: RagSourceResDto[];

  @ApiProperty({ type: () => UsageDto })
  usage: UsageDto;

  @ApiProperty()
  estimatedCost: number;

  @ApiProperty()
  latencyMs: number;

  @ApiProperty()
  chunksRetrieved: number;

  @ApiProperty()
  searchLatencyMs: number;

  @ApiProperty()
  generationLatencyMs: number;
}
