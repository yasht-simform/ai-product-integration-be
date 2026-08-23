import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  sourceType: string;

  @ApiPropertyOptional()
  originalFilename?: string;

  @ApiPropertyOptional()
  fileSize?: number;

  @ApiProperty()
  totalChunks: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  embeddingModel: string;

  @ApiProperty()
  embeddingStatus: string;

  @ApiPropertyOptional()
  category?: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
