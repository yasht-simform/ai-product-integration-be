import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { DocumentCategory } from '../constants/document-category.constant';

// Multipart *non-file* form field metadata for POST /rag/documents (spec §6.1) — validated via
// @Body(). The binary `file` field is intentionally NOT declared here: under this project's
// ES2023 target, an undecorated class field becomes a real own-property on every instance (TC39
// class-fields semantics), which the global ValidationPipe's `forbidNonWhitelisted: true` would
// then reject as an unrecognized property. The binary field is documented separately via an
// inline `@ApiBody({ schema: {...} })` in the controller and bound at runtime via
// `@UploadedFile()`, never through this class.
export class UploadDocumentDto {
  @ApiPropertyOptional({ description: 'Override title (default: filename)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Document description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(DocumentCategory), description: 'Document category' })
  @IsOptional()
  @IsIn(Object.values(DocumentCategory))
  category?: DocumentCategory;

  @ApiPropertyOptional({ description: 'Comma-separated tags' })
  @IsOptional()
  @IsString()
  tags?: string;
}
