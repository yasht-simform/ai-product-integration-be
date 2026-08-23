import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class PricingCalculateDto {
  @ApiProperty({ description: 'API model identifier to price', example: 'gpt-4o' })
  @IsString()
  @IsNotEmpty()
  modelId: string;

  @ApiProperty({ description: 'Number of input tokens', minimum: 0 })
  @IsInt()
  @Min(0)
  inputTokens: number;

  @ApiProperty({ description: 'Number of output tokens', minimum: 0 })
  @IsInt()
  @Min(0)
  outputTokens: number;
}
