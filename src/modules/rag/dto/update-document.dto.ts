import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateDocumentDto } from './create-document.dto';

// sourceType/originalFilename/fileSize/embeddingStatus are pipeline-derived, not client-editable
// through this endpoint — only title/description/category/tags may be patched (spec §6.1).
export class UpdateDocumentDto extends PartialType(
  OmitType(CreateDocumentDto, ['sourceType'] as const),
) {}
