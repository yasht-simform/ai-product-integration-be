import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { PromptTechnique } from '../constants/prompt-technique.enum';

export class QueryPromptTemplateDto {
  @ApiPropertyOptional({ enum: PromptTechnique, description: 'Filter by prompting technique' })
  @IsOptional()
  @IsEnum(PromptTechnique)
  technique?: PromptTechnique;

  @ApiPropertyOptional({ description: 'Comma-separated list of tags to filter by (any match)' })
  @IsOptional()
  @IsString()
  tags?: string;

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
