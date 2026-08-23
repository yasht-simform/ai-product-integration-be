import { ApiProperty } from '@nestjs/swagger';

import { AiAuditLogResDto } from './ai-audit-log-res.dto';

export class PaginatedAiAuditResDto {
  @ApiProperty({ type: () => [AiAuditLogResDto] })
  data: AiAuditLogResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
