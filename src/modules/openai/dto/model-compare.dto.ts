import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { OpenAIModel } from '../constants/openai-model.enum';
import { IsValidModel } from '../validators/is-valid-model.validator';

export class ModelCompareDto {
  @ApiProperty({ description: 'Prompt to compare across models', minLength: 1 })
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @ApiPropertyOptional({ description: 'System-level instructions' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description:
      'OpenAIModel values, or OpenRouter-style provider/model:variant strings, to compare. Falls back to OPENAI_DEFAULT_MODEL (a free model) when omitted.',
    isArray: true,
    default: ['meta-llama/llama-3.3-70b-instruct:free'],
  })
  @IsOptional()
  @IsArray()
  @IsValidModel({ each: true })
  models?: OpenAIModel[];

  @ApiPropertyOptional({ description: 'Sampling temperature', minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
