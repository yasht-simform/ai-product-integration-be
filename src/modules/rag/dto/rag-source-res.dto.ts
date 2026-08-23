import { ApiProperty } from '@nestjs/swagger';

export class RagSourceResDto {
  @ApiProperty()
  documentTitle: string;

  @ApiProperty()
  documentPublicId: string;

  @ApiProperty()
  chunkContent: string;

  @ApiProperty()
  chunkIndex: number;

  @ApiProperty()
  similarityScore: number;
}
