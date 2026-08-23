import { ApiProperty } from '@nestjs/swagger';

export class DocumentChunkResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  chunkIndex: number;

  @ApiProperty()
  content: string;

  @ApiProperty()
  tokenCount: number;

  @ApiProperty()
  startChar: number;

  @ApiProperty()
  endChar: number;

  @ApiProperty()
  embeddingStatus: string;

  @ApiProperty()
  createdAt: Date;
}
