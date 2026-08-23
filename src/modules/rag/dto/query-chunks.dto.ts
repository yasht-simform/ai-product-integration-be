import { PickType } from '@nestjs/swagger';

import { QueryDocumentsDto } from './query-documents.dto';

export class QueryChunksDto extends PickType(QueryDocumentsDto, ['page', 'limit'] as const) {}
