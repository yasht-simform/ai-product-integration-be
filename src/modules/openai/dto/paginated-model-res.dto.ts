import { ApiProperty } from '@nestjs/swagger';

import { ModelResDto } from './model-res.dto';

export class PaginatedModelResDto {
  @ApiProperty({ type: () => [ModelResDto] })
  data: ModelResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
