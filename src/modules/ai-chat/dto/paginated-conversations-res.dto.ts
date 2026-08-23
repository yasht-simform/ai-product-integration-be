import { ApiProperty } from '@nestjs/swagger';

import { ConversationResDto } from './conversation-res.dto';

export class PaginatedConversationsResDto {
  @ApiProperty({ type: () => [ConversationResDto] })
  data: ConversationResDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
