import { ApiProperty } from '@nestjs/swagger';

export class SpendByUserRowResDto {
  @ApiProperty({ description: "The user's identifier, or 'anonymous' for unattributed spend" })
  userId: string;

  @ApiProperty()
  totalCost: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  callCount: number;
}

export class SpendByUserResDto {
  @ApiProperty({ type: () => [SpendByUserRowResDto] })
  data: SpendByUserRowResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
