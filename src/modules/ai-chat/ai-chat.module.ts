import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { CostManagementModule } from '../cost-management/cost-management.module';
import { ModerationModule } from '../moderation/moderation.module';
import { OpenaiModule } from '../openai/openai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './services/chat.service';
import { StreamingService } from './services/streaming.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { WeatherTool } from './tools/weather.tool';

@Module({
  imports: [OpenaiModule, HttpModule, ModerationModule, CostManagementModule],
  controllers: [ChatController],
  providers: [ChatService, StreamingService, ToolRegistryService, ToolExecutorService, WeatherTool],
  exports: [ChatService],
})
export class AiChatModule {}
