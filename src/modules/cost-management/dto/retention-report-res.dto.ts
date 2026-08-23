import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetentionCategoryResDto {
  @ApiProperty()
  deleted: number;

  @ApiProperty()
  failed: boolean;

  @ApiPropertyOptional({ description: 'Error message when failed is true' })
  error?: string;
}

export class RetentionReportResDto {
  @ApiProperty({ type: () => RetentionCategoryResDto })
  auditLogs: RetentionCategoryResDto;

  @ApiProperty({ type: () => RetentionCategoryResDto })
  moderationLogs: RetentionCategoryResDto;

  @ApiProperty({ type: () => RetentionCategoryResDto })
  archivedConversations: RetentionCategoryResDto;

  @ApiProperty({ type: () => RetentionCategoryResDto })
  embeddingCache: RetentionCategoryResDto;

  @ApiProperty()
  totalDeleted: number;

  @ApiProperty()
  ranAt: Date;

  @ApiProperty()
  durationMs: number;
}
