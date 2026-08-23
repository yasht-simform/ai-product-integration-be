import { ApiProperty } from '@nestjs/swagger';

class PricingTableModelDto {
  @ApiProperty()
  modelId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  tier: string;

  @ApiProperty()
  inputPricePer1M: number;

  @ApiProperty()
  outputPricePer1M: number;
}

class PricingTableProviderGroupDto {
  @ApiProperty()
  provider: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ type: () => [PricingTableModelDto] })
  models: PricingTableModelDto[];
}

export class PricingTableResDto {
  @ApiProperty({ type: () => [PricingTableProviderGroupDto] })
  providers: PricingTableProviderGroupDto[];
}
