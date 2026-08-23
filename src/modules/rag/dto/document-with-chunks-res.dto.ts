import { ApiProperty } from '@nestjs/swagger';

import { DocumentChunkResDto } from './document-chunk-res.dto';
import { DocumentResDto } from './document-res.dto';

export class DocumentWithChunksResDto extends DocumentResDto {
  @ApiProperty({ type: () => [DocumentChunkResDto] })
  chunks: DocumentChunkResDto[];
}
