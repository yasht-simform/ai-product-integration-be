import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { IsValidModel } from '../../openai/validators/is-valid-model.validator';
import { DocumentCategory } from '../constants/document-category.constant';

// Shared by both POST /rag/ask and POST /rag/ask/conversation/:publicId — spec §6.3 documents one
// request field table for both routes.
export class AskDto {
  @ApiProperty({ description: 'The question' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiPropertyOptional({ description: 'Chunks to retrieve', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;

  @ApiPropertyOptional({ description: 'Model for generation' })
  @IsOptional()
  @IsValidModel()
  model?: OpenAIModel;

  @ApiPropertyOptional({
    description: 'Generation temperature (low for factual answers)',
    default: 0.3,
    minimum: 0,
    maximum: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    enum: Object.values(DocumentCategory),
    description: 'Limit search to category',
  })
  @IsOptional()
  @IsIn(Object.values(DocumentCategory))
  category?: DocumentCategory;

  @ApiPropertyOptional({ description: 'Include raw source chunks in the response', default: true })
  @IsOptional()
  @IsBoolean()
  includeSourceChunks?: boolean;
}
