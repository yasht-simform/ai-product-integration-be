import { ApiProperty } from '@nestjs/swagger';

import { DocumentChunkResDto } from './document-chunk-res.dto';

export class PaginatedDocumentChunksResDto {
  @ApiProperty({ type: () => [DocumentChunkResDto] })
  data: DocumentChunkResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
