import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncStatusResDto {
  @ApiPropertyOptional({ description: 'Timestamp of the most recent successful sync' })
  lastSyncedAt?: Date;

  @ApiProperty()
  modelsCount: number;

  @ApiProperty()
  providersCount: number;
}
