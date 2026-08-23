import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { DocumentCategory } from '../constants/document-category.constant';

export class SearchDto {
  @ApiProperty({ description: 'Search question' })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiPropertyOptional({ description: 'Results count', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;

  @ApiPropertyOptional({ description: 'Min score 0-1', default: 0.7, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityThreshold?: number;

  @ApiPropertyOptional({ enum: Object.values(DocumentCategory), description: 'Filter by category' })
  @IsOptional()
  @IsIn(Object.values(DocumentCategory))
  category?: DocumentCategory;

  @ApiPropertyOptional({ type: [String], description: 'Limit to specific documents' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];
}
