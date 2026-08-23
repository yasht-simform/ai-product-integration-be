import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { SpendAnalyticsQueryDto } from './spend-analytics-query.dto';

export class SpendTimelineQueryDto extends SpendAnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Restrict the timeline to a single user' })
  @IsOptional()
  @IsString()
  userId?: string;
}
