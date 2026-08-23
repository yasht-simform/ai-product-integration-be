import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModerationLogResDto {
  @ApiProperty()
  publicId: string;

  @ApiPropertyOptional()
  requestId?: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiProperty()
  direction: string;

  @ApiProperty({ description: 'Truncated to 1000 characters at write time' })
  content: string;

  @ApiProperty()
  isFlagged: boolean;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  categories: Record<string, boolean>;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  categoryScores: Record<string, number>;

  @ApiProperty()
  action: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  createdAt: Date;
}
