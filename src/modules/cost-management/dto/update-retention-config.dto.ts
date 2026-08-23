import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

// Deliberately has NO cron/cleanupCron field — the schedule is not runtime-updatable (AI-070).
// The global ValidationPipe's `forbidNonWhitelisted: true` rejects a client-supplied cron key with
// a 400 before this DTO (or RetentionService.updateRetentionConfig()) ever sees it.
export class UpdateRetentionConfigDto {
  @ApiPropertyOptional({ description: 'Audit log retention period in days', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  auditDays?: number;

  @ApiPropertyOptional({ description: 'Moderation log retention period in days', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  moderationDays?: number;

  @ApiPropertyOptional({
    description: 'Archived conversation retention period in days',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  archivedConversationDays?: number;

  @ApiPropertyOptional({
    description: 'Stale embedding cache retention period in days',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  embeddingCacheDays?: number;
}
