import { ApiProperty } from '@nestjs/swagger';

export class ModelPricingItemDto {
  @ApiProperty({ description: 'Cost per 1M input tokens in USD' })
  input: number;

  @ApiProperty({ description: 'Cost per 1M output tokens in USD' })
  output: number;
}

export class ModelPricingResDto {
  @ApiProperty({
    type: 'object',
    description: 'Per-model pricing (cost per 1M tokens in USD)',
    additionalProperties: {
      type: 'object',
      properties: {
        input: { type: 'number' },
        output: { type: 'number' },
      },
    },
  })
  pricing: Record<string, ModelPricingItemDto>;
}
