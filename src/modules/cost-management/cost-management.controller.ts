import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { BudgetStatus } from './constants/budget-status.constant';
import {
  BudgetAlertResDto,
  BudgetResDto,
  BudgetStatusResDto,
  CreateBudgetDto,
  DailyTrendQueryDto,
  PaginatedBudgetsResDto,
  ProjectedSpendResDto,
  QueryBudgetsDto,
  SpendByFeatureQueryDto,
  SpendByFeatureResDto,
  SpendByModelQueryDto,
  SpendByModelResDto,
  SpendByUserQueryDto,
  SpendByUserResDto,
  SpendTimelineQueryDto,
  SpendTimelineResDto,
  UpdateBudgetDto,
} from './dto';
import { CostAnalyticsService } from './services/cost-analytics.service';
import { CostBudgetService } from './services/cost-budget.service';
import type {
  BudgetAlertDto,
  BudgetCheckResult,
  BudgetEntity,
} from './types/cost-management.types';

// Budget routes (AI-072) + analytics routes (AI-073). Mounted at /cost/... (spec §6.2/§6.3).
// Retention lives in its own RetentionController (/retention/...) — see that file for why.
@ApiTags('cost-management')
@Controller('cost')
export class CostManagementController {
  constructor(
    private readonly costBudgetService: CostBudgetService,
    private readonly costAnalyticsService: CostAnalyticsService,
  ) {}

  // ── Budgets (AI-064/AI-065) ────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Create a per-user cost budget',
    type: BudgetResDto,
    successStatus: 201,
    isPublic: true,
  })
  @ApiConflictResponse({ description: 'A budget for this userId already exists' })
  @Post('budgets')
  async createBudget(@Body() dto: CreateBudgetDto): Promise<BudgetResDto> {
    const budget = await this.costBudgetService.createBudget(dto);
    return this.toBudgetRes(budget);
  }

  @ApiEndpoint({
    summary: 'List budgets (filterable by active status, paginated)',
    type: PaginatedBudgetsResDto,
    isPublic: true,
  })
  @Get('budgets')
  async findAllBudgets(@Query() query: QueryBudgetsDto): Promise<PaginatedBudgetsResDto> {
    const result = await this.costBudgetService.findAllBudgets(query);
    return { ...result, data: result.data.map((budget) => this.toBudgetRes(budget)) };
  }

  // MUST stay declared before `budgets/:userId` — NestJS matches routes in declaration order, so
  // a later position would match the literal path segment `alerts` as a userId. Pinned by a
  // structural test in cost-management.controller.spec.ts.
  @ApiEndpoint({
    summary: 'Users approaching their budget limits',
    type: [BudgetAlertResDto],
    isPublic: true,
  })
  @Get('budgets/alerts')
  async getBudgetAlerts(): Promise<BudgetAlertResDto[]> {
    const alerts = await this.costBudgetService.getUsersApproachingLimit();
    return alerts.map((alert) => this.toAlertRes(alert));
  }

  @ApiEndpoint({
    summary: "A user's budget combined with their current spend and a derived status",
    type: BudgetStatusResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'No budget exists for this userId' })
  @Get('budgets/:userId')
  async getBudgetStatus(@Param('userId') userId: string): Promise<BudgetStatusResDto> {
    const budget = await this.costBudgetService.findBudgetByUserId(userId);
    if (!budget) throw new NotFoundException(`No budget found for userId "${userId}"`);

    const check = await this.costBudgetService.checkBudget(userId);
    return {
      userId,
      dailySpend: check.dailySpend,
      monthlySpend: check.monthlySpend,
      // The budget row's configured limits, not check's — checkBudget() reports null limits when
      // enforcement is disabled or the budget is inactive, but a direct status lookup should
      // still show what is configured.
      dailyLimit: budget.dailyLimitUsd ?? undefined,
      monthlyLimit: budget.monthlyLimitUsd ?? undefined,
      dailyPercentage: check.dailyPercentage,
      monthlyPercentage: check.monthlyPercentage,
      status: this.deriveStatus(check),
      warning: check.warning,
    };
  }

  @ApiEndpoint({
    summary: "Update a budget's limits, threshold, or active flag",
    type: BudgetResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Budget not found' })
  @Patch('budgets/:publicId')
  async updateBudget(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetResDto> {
    const budget = await this.costBudgetService.updateBudget(publicId, dto);
    return this.toBudgetRes(budget);
  }

  @ApiEndpoint({ summary: 'Delete a budget (removes enforcement entirely)', isPublic: true })
  @ApiNoContentResponse({ description: 'Budget deleted' })
  @ApiNotFoundResponse({ description: 'Budget not found' })
  @Delete('budgets/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBudget(@Param('publicId') publicId: string): Promise<void> {
    await this.costBudgetService.deleteBudget(publicId);
  }

  // ── Analytics (AI-067/AI-068) ──────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Spend per user (paginated, sortable by total spend)',
    type: SpendByUserResDto,
    isPublic: true,
  })
  @Get('analytics/by-user')
  async getSpendByUser(@Query() query: SpendByUserQueryDto): Promise<SpendByUserResDto> {
    return this.costAnalyticsService.getSpendByUser(query);
  }

  @ApiEndpoint({
    summary: 'Spend per model',
    type: SpendByModelResDto,
    isPublic: true,
  })
  @Get('analytics/by-model')
  async getSpendByModel(@Query() query: SpendByModelQueryDto): Promise<SpendByModelResDto> {
    return this.costAnalyticsService.getSpendByModel(query);
  }

  @ApiEndpoint({
    summary: "Spend per feature (chat, embeddings, moderations — RAG folds into 'chat')",
    type: SpendByFeatureResDto,
    isPublic: true,
  })
  @Get('analytics/by-feature')
  async getSpendByFeature(@Query() query: SpendByFeatureQueryDto): Promise<SpendByFeatureResDto> {
    return this.costAnalyticsService.getSpendByFeature(query);
  }

  @ApiEndpoint({
    summary: 'Daily spend buckets over a date range (for charts)',
    type: SpendTimelineResDto,
    isPublic: true,
  })
  @Get('analytics/timeline')
  async getSpendTimeline(@Query() query: SpendTimelineQueryDto): Promise<SpendTimelineResDto> {
    return this.costAnalyticsService.getSpendTimeline(query);
  }

  @ApiEndpoint({
    summary: 'Last N days of daily spend (default 30, clamped 1–365)',
    type: SpendTimelineResDto,
    isPublic: true,
  })
  @Get('analytics/daily-trend')
  async getDailySpendTrend(@Query() query: DailyTrendQueryDto): Promise<SpendTimelineResDto> {
    return this.costAnalyticsService.getDailySpendTrend(query.days);
  }

  @ApiEndpoint({
    summary: 'Projected monthly spend from the current daily average',
    type: ProjectedSpendResDto,
    isPublic: true,
  })
  @Get('analytics/projected')
  async getProjectedMonthlySpend(): Promise<ProjectedSpendResDto> {
    return this.costAnalyticsService.getProjectedMonthlySpend();
  }

  // ── Private mappers ────────────────────────────────────────────────────────

  private deriveStatus(check: BudgetCheckResult): BudgetStatus {
    if (!check.allowed) return BudgetStatus.EXCEEDED;
    if (check.warning !== undefined) return BudgetStatus.APPROACHING_LIMIT;
    return BudgetStatus.WITHIN_BUDGET;
  }

  private toBudgetRes(budget: BudgetEntity): BudgetResDto {
    return {
      publicId: budget.publicId,
      userId: budget.userId,
      dailyLimitUsd: budget.dailyLimitUsd ?? undefined,
      monthlyLimitUsd: budget.monthlyLimitUsd ?? undefined,
      alertThreshold: budget.alertThreshold,
      isActive: budget.isActive,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  private toAlertRes(alert: BudgetAlertDto): BudgetAlertResDto {
    return {
      userId: alert.userId,
      dailySpend: alert.dailySpend,
      monthlySpend: alert.monthlySpend,
      dailyLimit: alert.dailyLimit ?? undefined,
      monthlyLimit: alert.monthlyLimit ?? undefined,
      dailyPercentage: alert.dailyPercentage,
      monthlyPercentage: alert.monthlyPercentage,
      triggeredBy: alert.triggeredBy,
    };
  }
}
