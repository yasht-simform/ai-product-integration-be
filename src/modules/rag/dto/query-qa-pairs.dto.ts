import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { QaComplexity } from '../constants/qa-complexity.constant';

export class QueryQaPairsDto {
  @ApiPropertyOptional({ description: 'Filter by source document publicId' })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({
    enum: Object.values(QaComplexity),
    description: 'Filter by complexity tier',
  })
  @IsOptional()
  @IsIn(Object.values(QaComplexity))
  complexity?: string;

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
