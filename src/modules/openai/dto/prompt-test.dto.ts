import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { ChatCompletionDto } from './chat-completion.dto';

export class PromptTestDto extends ChatCompletionDto {
  @ApiPropertyOptional({ description: 'Load system prompt from a saved template by name' })
  @IsOptional()
  @IsString()
  templateName?: string;
}
