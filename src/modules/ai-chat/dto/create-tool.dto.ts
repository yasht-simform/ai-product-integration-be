import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

import { ToolHandlerType } from '../constants/tool-handler-type.enum';

export class CreateToolDto {
  @ApiProperty({ description: 'Unique tool name, referenced in OpenAI tool-call requests' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Human-readable display name' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({ description: 'Description shown to the model to decide when to call this tool' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'JSON Schema describing the tool arguments' })
  @IsObject()
  parameters: Record<string, unknown>;

  @ApiProperty({ enum: ToolHandlerType })
  @IsEnum(ToolHandlerType)
  handlerType: ToolHandlerType;

  @ApiPropertyOptional({
    description: 'Handler-specific config, e.g. the target URL for an "http" handler',
  })
  @IsOptional()
  @IsObject()
  handlerConfig?: Record<string, unknown>;
}
