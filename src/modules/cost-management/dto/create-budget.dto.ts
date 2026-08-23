import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBudgetDto {
  @ApiProperty({ description: 'User identifier this budget applies to' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({ description: 'Daily spend limit in USD; omit/null for unlimited' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyLimitUsd?: number;

  @ApiPropertyOptional({ description: 'Monthly spend limit in USD; omit/null for unlimited' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyLimitUsd?: number;

  @ApiPropertyOptional({
    description: 'Fraction of the limit at which to raise an alert',
    default: 0.8,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  alertThreshold?: number;

  @ApiPropertyOptional({ description: 'Whether the budget is enforced', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
