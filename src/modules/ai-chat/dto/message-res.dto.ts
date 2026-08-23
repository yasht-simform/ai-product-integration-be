import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty({ description: '"system" | "user" | "assistant" | "tool"' })
  role: string;

  @ApiPropertyOptional()
  content?: string;

  @ApiPropertyOptional({ description: 'Tool calls requested by the model on an assistant message' })
  toolCalls?: unknown;

  @ApiPropertyOptional({ description: 'The tool_call_id this message answers, for role: "tool"' })
  toolCallId?: string;

  @ApiPropertyOptional()
  toolName?: string;

  @ApiPropertyOptional()
  tokenCount?: number;

  @ApiPropertyOptional()
  cost?: number;

  @ApiPropertyOptional()
  latencyMs?: number;

  @ApiPropertyOptional()
  model?: string;

  @ApiProperty()
  createdAt: Date;
}
