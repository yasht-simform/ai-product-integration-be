import { Module } from '@nestjs/common';

import { AiChatModule } from '../ai-chat/ai-chat.module';
import { CostManagementModule } from '../cost-management/cost-management.module';
import { RagModule } from '../rag/rag.module';
import { CapstoneController } from './capstone.controller';
import { CapstoneService } from './services/capstone.service';

// CapstoneModule is not a new capability — it's a thin composition layer proving Phases 1-4 work
// together as one product (see docs/specs/Capstone_Knowledge_Base_QA_Specification.md §1). It
// imports every module whose exported services it composes and exports nothing itself, since
// nothing else in the app needs to depend on the capstone demo-seeding surface.
@Module({
  imports: [RagModule, AiChatModule, CostManagementModule],
  controllers: [CapstoneController],
  providers: [CapstoneService],
})
export class CapstoneModule {}
