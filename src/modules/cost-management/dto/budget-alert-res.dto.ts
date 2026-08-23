import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BudgetAlertResDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ description: 'Spend since UTC midnight (USD)' })
  dailySpend: number;

  @ApiProperty({ description: 'Spend since the UTC first of the month (USD)' })
  monthlySpend: number;

  @ApiPropertyOptional({ description: 'Configured daily limit (USD); absent means unlimited' })
  dailyLimit?: number;

  @ApiPropertyOptional({ description: 'Configured monthly limit (USD); absent means unlimited' })
  monthlyLimit?: number;

  @ApiProperty({ description: 'Daily spend as a percentage of the daily limit (0 when unlimited)' })
  dailyPercentage: number;

  @ApiProperty({
    description: 'Monthly spend as a percentage of the monthly limit (0 when unlimited)',
  })
  monthlyPercentage: number;

  @ApiProperty({
    enum: ['daily', 'monthly', 'both'],
    description: 'Which limit dimension(s) crossed the alert threshold',
  })
  triggeredBy: 'daily' | 'monthly' | 'both';
}
