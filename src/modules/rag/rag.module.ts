import { Module } from '@nestjs/common';

import { AiChatModule } from '../ai-chat/ai-chat.module';
import { CostManagementModule } from '../cost-management/cost-management.module';
import { ModerationModule } from '../moderation/moderation.module';
import { OpenaiModule } from '../openai/openai.module';
import { RagController } from './rag.controller';
import { DocumentService } from './services/document.service';
import { EmbeddingCacheService } from './services/embedding-cache.service';
import { EmbeddingService } from './services/embedding.service';
import { MockDataService } from './services/mock-data.service';
import { PineconeService } from './services/pinecone.service';
import { RagService } from './services/rag.service';
import { SearchService } from './services/search.service';

@Module({
  imports: [OpenaiModule, AiChatModule, ModerationModule, CostManagementModule],
  controllers: [RagController],
  providers: [
    EmbeddingService,
    EmbeddingCacheService,
    DocumentService,
    PineconeService,
    SearchService,
    RagService,
    MockDataService,
  ],
  // MockDataService/DocumentService/PineconeService are exported for CapstoneModule
  // (src/modules/capstone/), which composes them into the demo-dataset seed/reset/status
  // endpoints — the same "only export what's needed externally" convention AiChatModule and
  // CostManagementModule already follow.
  exports: [MockDataService, DocumentService, PineconeService],
})
export class RagModule {}
