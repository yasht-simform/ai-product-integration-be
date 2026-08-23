import { ApiProperty } from '@nestjs/swagger';

import { QaPairResDto } from './qa-pair-res.dto';

export class PaginatedQaPairsResDto {
  @ApiProperty({ type: () => [QaPairResDto] })
  data: QaPairResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
