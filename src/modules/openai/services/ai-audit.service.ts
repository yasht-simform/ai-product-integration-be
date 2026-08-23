import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import type {
  AiAuditLogEvent,
  CostSummaryQueryDto,
  CostSummaryResult,
  PaginatedAiAuditResult,
  QueryAiAuditDto,
} from '../types/ai-audit.types';

@Injectable()
export class AiAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: AppLoggerService,
  ) {}

  async log(event: AiAuditLogEvent): Promise<void> {
    try {
      await this.db.aiAuditLog.create({
        data: {
          requestId: event.requestId,
          userId: event.userId,
          model: event.model,
          endpoint: event.endpoint,
          systemPrompt: event.systemPrompt,
          userMessage: event.userMessage,
          assistantResponse: event.assistantResponse,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
          estimatedCost: event.estimatedCost,
          latencyMs: event.latencyMs,
          temperature: event.temperature,
          maxTokens: event.maxTokens,
          status: event.status,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage,
          retryCount: event.retryCount,
          metadata: event.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error('AiAuditService: failed to write audit log', String(error));
    }
  }

  async findAll(query: QueryAiAuditDto): Promise<PaginatedAiAuditResult> {
    const { page = 1, limit = 20, model, status, userId, startDate, endDate } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where = this.buildWhereClause({ userId, model, startDate, endDate });
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.db.aiAuditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.aiAuditLog.count({ where }),
    ]);

    return { data, total, page, limit: take };
  }

  async getCostSummary(query: CostSummaryQueryDto): Promise<CostSummaryResult> {
    const where = this.buildWhereClause(query);

    const [aggregate, breakdown] = await Promise.all([
      this.db.aiAuditLog.aggregate({
        where,
        _count: true,
        _sum: { estimatedCost: true, inputTokens: true, outputTokens: true, totalTokens: true },
        _avg: { latencyMs: true },
      }),
      this.db.aiAuditLog.groupBy({
        by: ['model'],
        where,
        _count: { _all: true },
        _sum: { estimatedCost: true },
      }),
    ]);

    return {
      totalCost: aggregate._sum?.estimatedCost ?? 0,
      totalTokens: aggregate._sum?.totalTokens ?? 0,
      totalInputTokens: aggregate._sum?.inputTokens ?? 0,
      totalOutputTokens: aggregate._sum?.outputTokens ?? 0,
      callCount: aggregate._count,
      averageLatencyMs: aggregate._avg?.latencyMs ?? 0,
      perModelBreakdown: breakdown.map((b) => ({
        model: b.model,
        cost: b._sum?.estimatedCost ?? 0,
        callCount: b._count._all,
      })),
    };
  }

  private buildWhereClause(query: CostSummaryQueryDto): Prisma.AiAuditLogWhereInput {
    const { userId, model, startDate, endDate } = query;
    const where: Prisma.AiAuditLogWhereInput = {};
    if (userId) where.userId = userId;
    if (model) where.model = model;
    if (startDate ?? endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }
    return where;
  }
}
