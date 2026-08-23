import { Module } from '@nestjs/common';

import { OpenaiModule } from '../openai/openai.module';
import { ModerationGuard } from './guards/moderation.guard';
import { OutputModerationInterceptor } from './interceptors/output-moderation.interceptor';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './services/moderation.service';

@Module({
  imports: [OpenaiModule],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationGuard, OutputModerationInterceptor],
  // ModerationService must be exported too, not just the guard/interceptor: NestJS resolves a
  // class referenced via @UseGuards()/@UseInterceptors() by constructing it within the *host*
  // module's own injector scope (AiChatModule/RagModule via AI-063), not by reusing the instance
  // already built inside ModerationModule. That construction needs ModerationService resolvable
  // from the host module's own import graph, so it must be visible here too.
  exports: [ModerationService, ModerationGuard, OutputModerationInterceptor],
})
export class ModerationModule {}
