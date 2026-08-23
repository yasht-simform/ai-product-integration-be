import { ApiProperty } from '@nestjs/swagger';

export class RetentionConfigResDto {
  @ApiProperty()
  auditDays: number;

  @ApiProperty()
  moderationDays: number;

  @ApiProperty()
  archivedConversationDays: number;

  @ApiProperty()
  embeddingCacheDays: number;

  @ApiProperty({ description: 'Cron schedule for the cleanup job — not runtime-updatable' })
  cron: string;
}
