import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProviderResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiPropertyOptional()
  baseUrl?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'Number of models registered under this provider' })
  modelCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
