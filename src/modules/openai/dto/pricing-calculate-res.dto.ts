import { ApiProperty } from '@nestjs/swagger';

export class PricingCalculateResDto {
  @ApiProperty()
  model: string;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  tier: string;

  @ApiProperty()
  inputCost: number;

  @ApiProperty()
  outputCost: number;

  @ApiProperty()
  totalCost: number;

  @ApiProperty({ description: '"free" or "estimated cost"' })
  note: string;
}
