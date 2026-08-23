import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { OpenAIModel } from '../constants/openai-model.enum';
import { IsValidModel } from '../validators/is-valid-model.validator';

export class TokenCountDto {
  @ApiProperty({ description: 'Text to count tokens for' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({
    description:
      'Model whose tokenizer to use — an OpenAIModel value, or an OpenRouter-style provider/model:variant string',
  })
  @IsOptional()
  @IsValidModel()
  model?: OpenAIModel;
}
