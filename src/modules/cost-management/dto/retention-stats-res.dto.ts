import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RetentionReportResDto } from './retention-report-res.dto';

export class RetentionRowsDueResDto {
  @ApiProperty()
  auditLogs: number;

  @ApiProperty()
  moderationLogs: number;

  @ApiProperty()
  archivedConversations: number;

  @ApiProperty()
  embeddingCache: number;
}

export class RetentionStatsResDto {
  @ApiPropertyOptional({
    type: () => RetentionReportResDto,
    nullable: true,
    description: 'The most recent runFullCleanup() report, or null before any run has occurred',
  })
  lastReport: RetentionReportResDto | null;

  @ApiProperty({ type: () => RetentionRowsDueResDto })
  rowsDue: RetentionRowsDueResDto;
}
