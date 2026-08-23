import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckModerationDto {
  @ApiProperty({ description: 'Text to moderate' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({
    description: 'Where this check was triggered from',
    default: 'standalone',
  })
  @IsOptional()
  @IsString()
  source?: string;
}
