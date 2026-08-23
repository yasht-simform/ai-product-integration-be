import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

// Shared date-range base for all cost-analytics queries (AI-067). All analytics reads filter
// `status: 'SUCCESS'` server-side (the same spend definition budgets use) plus this optional range.
export class SpendAnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601 start date (inclusive)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date (inclusive)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
