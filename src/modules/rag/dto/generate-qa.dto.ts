import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GenerateQaDto {
  @ApiProperty({ description: 'Number of Q&A pairs to generate' })
  @IsInt()
  @Min(1)
  count: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Limit generation to these document publicIds (default: all documents)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];
}
