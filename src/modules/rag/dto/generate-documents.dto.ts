import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';

import { DocumentCategory } from '../constants/document-category.constant';

export class GenerateDocumentsDto {
  @ApiProperty({ description: 'Number of documents to generate' })
  @IsInt()
  @Min(1)
  count: number;

  @ApiPropertyOptional({
    enum: Object.values(DocumentCategory),
    isArray: true,
    description: 'Which categories to generate (default: all categories, round-robin)',
  })
  @IsOptional()
  @IsArray()
  @IsIn(Object.values(DocumentCategory), { each: true })
  categories?: DocumentCategory[];

  @ApiPropertyOptional({ description: 'Minimum words per document', default: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minWords?: number;

  @ApiPropertyOptional({ description: 'Maximum words per document', default: 2000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxWords?: number;
}
