import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import { transformQueryBoolean } from '../../../common/utils/transform-query-boolean.util';

export class QueryBudgetsDto {
  // NOT `@Type(() => Boolean)` — that silently coerces the query string 'false' to true under
  // main.ts's enableImplicitConversion. See transform-query-boolean.util.ts (AI-071's finding).
  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(transformQueryBoolean)
  @IsBoolean()
  isActive?: boolean;

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
