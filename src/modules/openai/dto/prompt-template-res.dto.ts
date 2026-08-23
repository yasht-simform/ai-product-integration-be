import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class FewShotExampleResDto {
  @ApiProperty()
  input: string;

  @ApiProperty()
  output: string;
}

export class PromptTemplateResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  systemPrompt: string;

  @ApiPropertyOptional({ type: () => [FewShotExampleResDto] })
  fewShotExamples?: FewShotExampleResDto[];

  @ApiProperty()
  technique: string;

  @ApiProperty()
  recommendedModel: string;

  @ApiProperty()
  recommendedTemperature: number;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
