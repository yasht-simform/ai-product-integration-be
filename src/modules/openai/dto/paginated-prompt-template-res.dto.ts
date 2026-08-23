import { ApiProperty } from '@nestjs/swagger';

import { PromptTemplateResDto } from './prompt-template-res.dto';

export class PaginatedPromptTemplateResDto {
  @ApiProperty({ type: () => [PromptTemplateResDto] })
  data: PromptTemplateResDto[];

  @ApiProperty()
  total: number;
}
