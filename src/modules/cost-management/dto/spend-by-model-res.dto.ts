import { ApiProperty } from '@nestjs/swagger';

export class SpendByModelRowResDto {
  @ApiProperty()
  model: string;

  @ApiProperty()
  totalCost: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  callCount: number;
}

export class SpendByModelResDto {
  @ApiProperty({ type: () => [SpendByModelRowResDto] })
  data: SpendByModelRowResDto[];
}
