import { ApiProperty } from '@nestjs/swagger';

export class SeedResultResDto {
  @ApiProperty({ description: 'Number of documents created' })
  documents: number;

  @ApiProperty({ description: 'Number of Q&A pairs created' })
  qaPairs: number;
}
