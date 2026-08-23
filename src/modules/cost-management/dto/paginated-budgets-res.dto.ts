import { ApiProperty } from '@nestjs/swagger';

import { BudgetResDto } from './budget-res.dto';

export class PaginatedBudgetsResDto {
  @ApiProperty({ type: () => [BudgetResDto] })
  data: BudgetResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
