import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class DailyTrendQueryDto {
  @ApiPropertyOptional({
    description: 'Number of trailing days to include (service clamps to a 1–365 range)',
    default: 30,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
