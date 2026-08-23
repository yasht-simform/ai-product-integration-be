import { Module } from '@nestjs/common';

import { CostManagementController } from './cost-management.controller';
import { CostBudgetGuard } from './guards/cost-budget.guard';
import { RetentionController } from './retention.controller';
import { CostAnalyticsService } from './services/cost-analytics.service';
import { CostBudgetService } from './services/cost-budget.service';
import { RetentionService } from './services/retention.service';

@Module({
  controllers: [CostManagementController, RetentionController],
  providers: [CostBudgetService, CostAnalyticsService, RetentionService, CostBudgetGuard],
  // CostBudgetService must be exported too, not just the guard: NestJS resolves a class
  // referenced via @UseGuards() by constructing it within the *host* module's own injector
  // scope (AiChatModule/RagModule, AI-066), not by reusing the instance built here — the same
  // gotcha AI-063 hit with ModerationModule/ModerationService.
  exports: [CostBudgetService, CostBudgetGuard],
})
export class CostManagementModule {}
