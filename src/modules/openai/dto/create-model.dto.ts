import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { ModelTier } from '../constants/model-tier.enum';

export class CreateModelDto {
  @ApiProperty({ description: 'publicId of the owning provider' })
  @IsUUID()
  providerId: string;

  @ApiProperty({ description: 'Display name', example: 'GPT-4o' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'API model identifier',
    example: 'google/gemma-3-27b-it:free',
  })
  @IsString()
  @IsNotEmpty()
  modelId: string;

  @ApiProperty({ enum: ModelTier })
  @IsEnum(ModelTier)
  tier: ModelTier;

  @ApiPropertyOptional({ description: 'USD price per 1M input tokens', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPricePer1M?: number;

  @ApiPropertyOptional({ description: 'USD price per 1M output tokens', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPricePer1M?: number;

  @ApiPropertyOptional({ description: 'Maximum context window in tokens' })
  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  @ApiPropertyOptional({ description: 'Human-readable description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the model is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
