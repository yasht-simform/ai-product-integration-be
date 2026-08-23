import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma, UserCostBudget } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { BudgetPeriod } from '../constants/budget-period.constant';
import type { CreateBudgetDto } from '../dto/create-budget.dto';
import type { UpdateBudgetDto } from '../dto/update-budget.dto';
import type {
  BudgetAlertDto,
  BudgetCheckResult,
  BudgetEntity,
  PaginatedBudgetsResult,
  QueryBudgetsParams,
} from '../types/cost-management.types';

const DEFAULT_CACHE_TTL_MS = 60000;

interface SpendSnapshot {
  dailySpend: number;
  monthlySpend: number;
}

@Injectable()
export class CostBudgetService {
  // Per-user in-memory cache of the two spend aggregates (NFR-COST-001) — avoids a per-request
  // DB round trip on every AI call. TTL-based, not a single shared expiry like TokenService's
  // pricing cache, since each user's entry is populated (and should expire) independently.
  private readonly spendCache = new Map<string, { entry: SpendSnapshot; expiresAt: number }>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async createBudget(dto: CreateBudgetDto): Promise<BudgetEntity> {
    try {
      const budget = await this.databaseService.userCostBudget.create({
        data: {
          userId: dto.userId,
          dailyLimitUsd: dto.dailyLimitUsd,
          monthlyLimitUsd: dto.monthlyLimitUsd,
          alertThreshold: dto.alertThreshold ?? 0.8,
          isActive: dto.isActive ?? true,
        },
      });
      this.invalidateSpendCache(dto.userId);
      return this.toEntity(budget);
    } catch (error) {
      if (this.isP2002(error)) {
        throw new ConflictException(`Budget for userId "${dto.userId}" already exists`);
      }
      throw error;
    }
  }

  async findAllBudgets(query: QueryBudgetsParams): Promise<PaginatedBudgetsResult> {
    const { page = 1, limit = 20, isActive } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.UserCostBudgetWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;

    const [budgets, total] = await Promise.all([
      this.databaseService.userCostBudget.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.databaseService.userCostBudget.count({ where }),
    ]);

    return { data: budgets.map((b) => this.toEntity(b)), total, page, limit: take };
  }

  async findBudgetByUserId(userId: string): Promise<BudgetEntity | null> {
    const budget = await this.databaseService.userCostBudget.findUnique({ where: { userId } });
    return budget ? this.toEntity(budget) : null;
  }

  async updateBudget(publicId: string, dto: UpdateBudgetDto): Promise<BudgetEntity> {
    const existing = await this.findBudgetOrThrow(publicId);

    const budget = await this.databaseService.userCostBudget.update({
      where: { publicId },
      data: {
        dailyLimitUsd: dto.dailyLimitUsd,
        monthlyLimitUsd: dto.monthlyLimitUsd,
        alertThreshold: dto.alertThreshold,
        isActive: dto.isActive,
      },
    });
    this.invalidateSpendCache(existing.userId);
    return this.toEntity(budget);
  }

  async deleteBudget(publicId: string): Promise<void> {
    const existing = await this.findBudgetOrThrow(publicId);
    await this.databaseService.userCostBudget.delete({ where: { publicId } });
    this.invalidateSpendCache(existing.userId);
  }

  /**
   * Raw, uncached spend aggregate for a single period (spec §5.2/§8.2) — `checkBudget()` wraps
   * both periods behind the in-memory cache below; this method is the direct DB read either
   * caller (or an admin/analytics consumer) can use when a fresh number is required.
   */
  async getUserSpend(userId: string, period: BudgetPeriod): Promise<number> {
    const result = await this.databaseService.aiAuditLog.aggregate({
      where: {
        userId,
        status: AiAuditStatus.SUCCESS,
        createdAt: { gte: this.getPeriodStart(period) },
      },
      _sum: { estimatedCost: true },
    });
    return result._sum?.estimatedCost ?? 0;
  }

  async checkBudget(userId: string): Promise<BudgetCheckResult> {
    if (!this.isEnabled()) return this.unrestrictedResult();

    const budget = await this.databaseService.userCostBudget.findUnique({ where: { userId } });
    if (!budget || !budget.isActive) return this.unrestrictedResult();

    const { dailySpend, monthlySpend } = await this.getCachedSpend(userId);
    const { dailyLimitUsd: dailyLimit, monthlyLimitUsd: monthlyLimit, alertThreshold } = budget;

    const dailyPercentage = dailyLimit ? (dailySpend / dailyLimit) * 100 : 0;
    const monthlyPercentage = monthlyLimit ? (monthlySpend / monthlyLimit) * 100 : 0;
    const dailyExceeded = dailyLimit !== null && dailySpend >= dailyLimit;
    const monthlyExceeded = monthlyLimit !== null && monthlySpend >= monthlyLimit;
    const allowed = !dailyExceeded && !monthlyExceeded;

    let warning: string | undefined;
    if (allowed) {
      if (dailyLimit !== null && dailySpend >= alertThreshold * dailyLimit) {
        warning = `Approaching daily limit (${Math.round(dailyPercentage)}%)`;
      } else if (monthlyLimit !== null && monthlySpend >= alertThreshold * monthlyLimit) {
        warning = `Approaching monthly limit (${Math.round(monthlyPercentage)}%)`;
      }
    }

    return {
      allowed,
      dailySpend,
      monthlySpend,
      dailyLimit,
      monthlyLimit,
      dailyPercentage,
      monthlyPercentage,
      warning,
    };
  }

  async getUsersApproachingLimit(threshold?: number): Promise<BudgetAlertDto[]> {
    const budgets = await this.databaseService.userCostBudget.findMany({
      where: {
        isActive: true,
        OR: [{ dailyLimitUsd: { not: null } }, { monthlyLimitUsd: { not: null } }],
      },
    });

    const alerts = await Promise.all(
      budgets.map((budget) => this.buildAlertIfApproaching(budget, threshold)),
    );
    return alerts.filter((alert): alert is BudgetAlertDto => alert !== null);
  }

  private async buildAlertIfApproaching(
    budget: UserCostBudget,
    threshold: number | undefined,
  ): Promise<BudgetAlertDto | null> {
    const [dailySpend, monthlySpend] = await Promise.all([
      this.getUserSpend(budget.userId, BudgetPeriod.DAILY),
      this.getUserSpend(budget.userId, BudgetPeriod.MONTHLY),
    ]);

    const effectiveThreshold = threshold ?? budget.alertThreshold;
    const { dailyLimitUsd: dailyLimit, monthlyLimitUsd: monthlyLimit } = budget;
    const dailyTriggered = dailyLimit !== null && dailySpend >= effectiveThreshold * dailyLimit;
    const monthlyTriggered =
      monthlyLimit !== null && monthlySpend >= effectiveThreshold * monthlyLimit;

    if (!dailyTriggered && !monthlyTriggered) return null;

    return {
      userId: budget.userId,
      dailySpend,
      monthlySpend,
      dailyLimit,
      monthlyLimit,
      dailyPercentage: dailyLimit ? (dailySpend / dailyLimit) * 100 : 0,
      monthlyPercentage: monthlyLimit ? (monthlySpend / monthlyLimit) * 100 : 0,
      triggeredBy:
        dailyTriggered && monthlyTriggered ? 'both' : dailyTriggered ? 'daily' : 'monthly',
    };
  }

  private async getCachedSpend(userId: string): Promise<SpendSnapshot> {
    const cached = this.spendCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) return cached.entry;

    const [dailySpend, monthlySpend] = await Promise.all([
      this.getUserSpend(userId, BudgetPeriod.DAILY),
      this.getUserSpend(userId, BudgetPeriod.MONTHLY),
    ]);
    const entry: SpendSnapshot = { dailySpend, monthlySpend };
    this.spendCache.set(userId, { entry, expiresAt: Date.now() + this.getCacheTtlMs() });
    return entry;
  }

  private invalidateSpendCache(userId: string): void {
    this.spendCache.delete(userId);
  }

  private getPeriodStart(period: BudgetPeriod): Date {
    const now = new Date();
    return period === BudgetPeriod.DAILY
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private unrestrictedResult(): BudgetCheckResult {
    return {
      allowed: true,
      dailySpend: 0,
      monthlySpend: 0,
      dailyLimit: null,
      monthlyLimit: null,
      dailyPercentage: 0,
      monthlyPercentage: 0,
    };
  }

  private isEnabled(): boolean {
    return this.configService.get<boolean>('costBudget.enabled') ?? true;
  }

  private getCacheTtlMs(): number {
    return this.configService.get<number>('costBudget.cacheTtlMs') ?? DEFAULT_CACHE_TTL_MS;
  }

  private async findBudgetOrThrow(publicId: string): Promise<UserCostBudget> {
    const budget = await this.databaseService.userCostBudget.findUnique({ where: { publicId } });
    if (!budget) throw new NotFoundException(`Budget "${publicId}" not found`);
    return budget;
  }

  private toEntity(budget: UserCostBudget): BudgetEntity {
    return {
      publicId: budget.publicId,
      userId: budget.userId,
      dailyLimitUsd: budget.dailyLimitUsd,
      monthlyLimitUsd: budget.monthlyLimitUsd,
      alertThreshold: budget.alertThreshold,
      isActive: budget.isActive,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  private isP2002(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
