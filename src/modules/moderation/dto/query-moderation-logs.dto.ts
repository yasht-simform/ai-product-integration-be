import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { transformQueryBoolean } from '../../../common/utils/transform-query-boolean.util';
import { ModerationDirection } from '../constants/moderation-direction.constant';

export class QueryModerationLogsDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  // NOT `@Type(() => Boolean)` — that silently coerces the query string 'false' to true under
  // main.ts's enableImplicitConversion. See transform-query-boolean.util.ts (this issue's finding,
  // extracted to a shared util when AI-072 needed it a second time for QueryBudgetsDto.isActive).
  @ApiPropertyOptional({ description: 'Filter by whether the check was flagged' })
  @IsOptional()
  @Transform(transformQueryBoolean)
  @IsBoolean()
  isFlagged?: boolean;

  @ApiPropertyOptional({ enum: Object.values(ModerationDirection) })
  @IsOptional()
  @IsIn(Object.values(ModerationDirection))
  direction?: ModerationDirection;

  @ApiPropertyOptional({ description: 'Filter by the source that triggered the check' })
  @IsOptional()
  @IsString()
  source?: string;

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
