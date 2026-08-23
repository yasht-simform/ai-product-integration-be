import { ApiProperty } from '@nestjs/swagger';

import { DocumentResDto } from './document-res.dto';

export class PaginatedDocumentsResDto {
  @ApiProperty({ type: () => [DocumentResDto] })
  data: DocumentResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
