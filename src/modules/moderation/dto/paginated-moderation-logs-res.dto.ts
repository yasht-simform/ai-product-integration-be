import { ApiProperty } from '@nestjs/swagger';

import { ModerationLogResDto } from './moderation-log-res.dto';

export class PaginatedModerationLogsResDto {
  @ApiProperty({ type: () => [ModerationLogResDto] })
  data: ModerationLogResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
