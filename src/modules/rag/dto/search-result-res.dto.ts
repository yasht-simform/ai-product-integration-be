import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchResultResDto {
  @ApiProperty()
  chunkPublicId: string;

  @ApiProperty()
  documentPublicId: string;

  @ApiProperty()
  documentTitle: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  chunkIndex: number;

  @ApiProperty()
  score: number;

  @ApiPropertyOptional()
  category?: string;
}
