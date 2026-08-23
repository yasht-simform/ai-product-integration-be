import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { AiAuditStatus } from '../constants/ai-audit-status.enum';

export class QueryAiAuditDto {
  @ApiPropertyOptional({ description: 'Filter by model name' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ enum: AiAuditStatus })
  @IsOptional()
  @IsEnum(AiAuditStatus)
  status?: AiAuditStatus;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 start date (inclusive)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date (inclusive)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
