import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateConversationDto } from './create-conversation.dto';

// Spec §6.1 lists only title/systemPrompt/model as PATCH-able — toolsEnabled is fixed at
// conversation-creation time.
export class UpdateConversationDto extends PartialType(
  OmitType(CreateConversationDto, ['toolsEnabled'] as const),
) {}
