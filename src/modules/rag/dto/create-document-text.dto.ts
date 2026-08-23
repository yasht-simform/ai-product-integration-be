import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

import { CreateDocumentDto } from './create-document.dto';

// sourceType is fixed to 'txt' by DocumentService.createFromText() — spec §6.1's JSON-body
// endpoint takes raw text directly, so there's no file to derive a source format from.
export class CreateDocumentTextDto extends OmitType(CreateDocumentDto, ['sourceType'] as const) {
  @ApiProperty({ description: 'Raw text content to chunk and embed' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
