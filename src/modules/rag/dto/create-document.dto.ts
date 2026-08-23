import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

import { DocumentCategory } from '../constants/document-category.constant';
import { DocumentSourceType } from '../constants/document-source-type.constant';

export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Document title (defaults to "Untitled Document")' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Optional description of the document' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: Object.values(DocumentSourceType), description: 'Source format' })
  @IsIn(Object.values(DocumentSourceType))
  sourceType: DocumentSourceType;

  @ApiPropertyOptional({ enum: Object.values(DocumentCategory), description: 'Document category' })
  @IsOptional()
  @IsIn(Object.values(DocumentCategory))
  category?: DocumentCategory;

  @ApiPropertyOptional({ type: [String], description: 'Searchable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
