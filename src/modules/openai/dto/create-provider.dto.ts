import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateProviderDto {
  @ApiProperty({ description: 'Display name', example: 'OpenAI' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'URL-safe unique identifier', example: 'openai' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug: string;

  @ApiPropertyOptional({ description: 'Provider-specific API base URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'Human-readable description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the provider is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
