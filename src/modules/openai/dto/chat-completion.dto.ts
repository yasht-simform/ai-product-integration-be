import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

import { OpenAIModel } from '../constants/openai-model.enum';
import { IsValidModel } from '../validators/is-valid-model.validator';

export class ChatCompletionDto {
  @ApiProperty({ description: 'User message prompt', minLength: 1 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  prompt: string;

  @ApiPropertyOptional({ description: 'System-level instructions' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description:
      'An OpenAIModel value, or an OpenRouter-style provider/model:variant string (e.g. nvidia/nemotron-3-ultra-550b-a55b:free). Falls back to OPENAI_DEFAULT_MODEL (a free model) when omitted.',
    default: 'meta-llama/llama-3.3-70b-instruct:free',
  })
  @IsOptional()
  @IsValidModel()
  model?: OpenAIModel;

  @ApiPropertyOptional({
    description: 'Sampling temperature',
    minimum: 0,
    maximum: 2,
    default: 0.7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Maximum tokens in the response',
    minimum: 1,
    maximum: 4096,
    default: 1024,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number;
}
