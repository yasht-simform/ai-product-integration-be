import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class ModerationStatsQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601 start date (inclusive)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date (inclusive)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
