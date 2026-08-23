import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModelResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  providerPublicId: string;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  modelId: string;

  @ApiProperty()
  tier: string;

  @ApiProperty()
  inputPricePer1M: number;

  @ApiProperty()
  outputPricePer1M: number;

  @ApiPropertyOptional()
  contextWindow?: number;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ description: '"openrouter_sync" or "manual"' })
  source: string;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  lastSyncedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
