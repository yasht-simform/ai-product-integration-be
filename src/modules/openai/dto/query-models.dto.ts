import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import { ModelSource } from '../constants/model-source.enum';
import { ModelTier } from '../constants/model-tier.enum';

export class QueryModelsDto {
  @ApiPropertyOptional({ enum: ModelTier })
  @IsOptional()
  @IsEnum(ModelTier)
  tier?: ModelTier;

  @ApiPropertyOptional({ description: 'Filter by provider publicId' })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ description: 'Search by model name or modelId' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ModelSource })
  @IsOptional()
  @IsEnum(ModelSource)
  source?: ModelSource;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
