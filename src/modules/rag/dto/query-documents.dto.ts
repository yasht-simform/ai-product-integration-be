import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { DocumentCategory } from '../constants/document-category.constant';
import { EmbeddingStatus } from '../constants/embedding-status.constant';

export class QueryDocumentsDto {
  @ApiPropertyOptional({ enum: Object.values(DocumentCategory), description: 'Filter by category' })
  @IsOptional()
  @IsIn(Object.values(DocumentCategory))
  category?: DocumentCategory;

  @ApiPropertyOptional({
    enum: Object.values(EmbeddingStatus),
    description: 'Filter by embedding status',
  })
  @IsOptional()
  @IsIn(Object.values(EmbeddingStatus))
  status?: EmbeddingStatus;

  @ApiPropertyOptional({ description: 'Comma-separated list of tags to filter by (any match)' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({ description: 'Search by title/description substring' })
  @IsOptional()
  @IsString()
  search?: string;

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
