import { ApiProperty } from '@nestjs/swagger';

export class ProjectedSpendResDto {
  @ApiProperty({ description: 'Total spend so far this month (UTC)' })
  monthToDate: number;

  @ApiProperty({ description: 'monthToDate ÷ daysElapsed' })
  dailyAverage: number;

  @ApiProperty({ description: 'Days elapsed this month, counting today (UTC)' })
  daysElapsed: number;

  @ApiProperty({ description: 'Total number of days in the current month (UTC)' })
  daysInMonth: number;

  @ApiProperty({ description: 'dailyAverage × daysInMonth' })
  projected: number;
}
