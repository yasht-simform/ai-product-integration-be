import { ApiProperty } from '@nestjs/swagger';

export class QaPairResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  question: string;

  @ApiProperty()
  expectedAnswer: string;

  @ApiProperty()
  sourceDocumentId: string;

  @ApiProperty()
  complexity: string;

  @ApiProperty()
  createdAt: Date;
}
