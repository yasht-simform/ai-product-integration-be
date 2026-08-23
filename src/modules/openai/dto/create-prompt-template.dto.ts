import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { PromptTechnique } from '../constants/prompt-technique.enum';

export class FewShotExampleDto {
  @ApiProperty({ description: 'Example input message' })
  @IsString()
  @IsNotEmpty()
  input: string;

  @ApiProperty({ description: 'Expected output for the input' })
  @IsString()
  @IsNotEmpty()
  output: string;
}

export class CreatePromptTemplateDto {
  @ApiProperty({ description: 'Unique template name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Human-readable description of what the template does' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'System prompt text injected before the user message' })
  @IsString()
  @IsNotEmpty()
  systemPrompt: string;

  @ApiPropertyOptional({ type: () => [FewShotExampleDto], description: 'Few-shot examples' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FewShotExampleDto)
  fewShotExamples?: FewShotExampleDto[];

  @ApiProperty({ enum: PromptTechnique, description: 'Prompting technique used' })
  @IsEnum(PromptTechnique)
  technique: PromptTechnique;

  @ApiPropertyOptional({ description: 'Suggested model for this template', default: 'gpt-4o' })
  @IsOptional()
  @IsString()
  recommendedModel?: string;

  @ApiPropertyOptional({
    description: 'Suggested temperature',
    minimum: 0,
    maximum: 2,
    default: 0.7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  recommendedTemperature?: number;

  @ApiPropertyOptional({ type: [String], description: 'Searchable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Whether the template is available for use', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
