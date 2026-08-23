import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { IsValidModel } from '../../openai/validators/is-valid-model.validator';

export class SendMessageDto {
  @ApiProperty({ description: 'User message text' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Override model for this message only' })
  @IsOptional()
  @IsValidModel()
  model?: OpenAIModel;

  @ApiPropertyOptional({
    description: 'Override sampling temperature for this message only',
    minimum: 0,
    maximum: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Override maximum response tokens for this message only',
    minimum: 1,
    maximum: 4096,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number;
}
