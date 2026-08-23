import { ApiProperty } from '@nestjs/swagger';

import { ConversationResDto } from './conversation-res.dto';
import { MessageResDto } from './message-res.dto';

export class ConversationWithMessagesResDto extends ConversationResDto {
  @ApiProperty({ type: () => [MessageResDto] })
  messages: MessageResDto[];
}
