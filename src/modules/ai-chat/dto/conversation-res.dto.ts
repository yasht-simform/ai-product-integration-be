import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationResDto {
  @ApiProperty()
  publicId: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  systemPrompt?: string;

  @ApiProperty()
  model: string;

  @ApiProperty()
  toolsEnabled: boolean;

  @ApiProperty()
  isArchived: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
