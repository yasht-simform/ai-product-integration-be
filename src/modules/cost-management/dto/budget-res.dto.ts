import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BudgetResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  userId: string;

  @ApiPropertyOptional()
  dailyLimitUsd?: number;

  @ApiPropertyOptional()
  monthlyLimitUsd?: number;

  @ApiProperty()
  alertThreshold: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
