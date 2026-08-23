import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AiAuditLogResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  requestId: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiProperty()
  model: string;

  @ApiProperty()
  endpoint: string;

  @ApiPropertyOptional()
  systemPrompt?: string;

  @ApiProperty()
  userMessage: string;

  @ApiPropertyOptional()
  assistantResponse?: string;

  @ApiProperty()
  inputTokens: number;

  @ApiProperty()
  outputTokens: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  estimatedCost: number;

  @ApiProperty()
  latencyMs: number;

  @ApiPropertyOptional()
  temperature?: number;

  @ApiPropertyOptional()
  maxTokens?: number;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  errorCode?: string;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  retryCount: number;

  @ApiProperty()
  createdAt: Date;
}
