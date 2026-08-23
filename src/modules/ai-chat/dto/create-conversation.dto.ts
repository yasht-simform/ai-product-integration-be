import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { IsValidModel } from '../../openai/validators/is-valid-model.validator';

export class CreateConversationDto {
  @ApiPropertyOptional({ description: 'Conversation title (auto-generated from first message)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'System-level instructions for the conversation' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description:
      'An OpenAIModel value, or an OpenRouter-style provider/model:variant string. Falls back to OPENAI_DEFAULT_MODEL (a free model) when omitted.',
    default: 'meta-llama/llama-3.3-70b-instruct:free',
  })
  @IsOptional()
  @IsValidModel()
  model?: OpenAIModel;

  @ApiPropertyOptional({
    description: 'Enable function calling for this conversation',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  toolsEnabled?: boolean;
}
