import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { requestContext } from '../../../common/logger/request-context';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import type { ModerationResult as OpenAiModerationResult } from '../../openai/types/openai.types';
import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import type {
  ModerationLogEntity,
  ModerationOptions,
  ModerationResult,
  ModerationStatsQueryParams,
  ModerationStatsResult,
  PaginatedModerationLogsResult,
  QueryModerationLogsParams,
  TopFlaggedCategory,
} from '../types/moderation.types';

const MAX_LOG_CONTENT_LENGTH = 1000;
const DEFAULT_BLOCK_THRESHOLD = 0.7;
const DEFAULT_SOURCE = 'standalone';
const DEFAULT_TOP_CATEGORIES_LIMIT = 5;

@Injectable()
export class ModerationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly openaiService: OpenaiService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async moderateText(text: string, options: ModerationOptions = {}): Promise<ModerationResult> {
    if (!this.isEnabled()) {
      return this.cleanResult();
    }

    const direction = options.direction ?? ModerationDirection.INPUT;
    const source = options.source ?? DEFAULT_SOURCE;
    const requestId = options.requestId ?? requestContext.getStore()?.requestId;

    try {
      const moderation = await this.openaiService.moderateText(text);
      const result = this.buildResult(moderation);
      const action = result.isFlagged
        ? (options.action ?? ModerationAction.BLOCKED)
        : ModerationAction.ALLOWED;

      void this.logModeration({
        direction,
        content: text,
        result,
        source,
        userId: options.userId,
        requestId,
        action,
      });

      return result;
    } catch (error) {
      this.logger.error(
        'ModerationService: moderation API call failed — failing open',
        String(error),
      );

      const result = this.cleanResult();
      void this.logModeration({
        direction,
        content: text,
        result,
        source,
        userId: options.userId,
        requestId,
        action: ModerationAction.ALLOWED,
        metadata: { failedOpen: true },
      });

      return result;
    }
  }

  async moderateBatch(texts: string[]): Promise<ModerationResult[]> {
    if (!this.isEnabled()) {
      return texts.map(() => this.cleanResult());
    }

    const requestId = requestContext.getStore()?.requestId;

    try {
      const moderations = await this.openaiService.moderateBatch(texts);

      return moderations.map((moderation, index) => {
        const result = this.buildResult(moderation);
        const action = result.isFlagged ? ModerationAction.BLOCKED : ModerationAction.ALLOWED;

        void this.logModeration({
          direction: ModerationDirection.INPUT,
          content: texts[index] ?? '',
          result,
          source: DEFAULT_SOURCE,
          requestId,
          action,
        });

        return result;
      });
    } catch (error) {
      this.logger.error(
        'ModerationService: batch moderation API call failed — failing open',
        String(error),
      );

      return texts.map((text) => {
        const result = this.cleanResult();
        void this.logModeration({
          direction: ModerationDirection.INPUT,
          content: text,
          result,
          source: DEFAULT_SOURCE,
          requestId,
          action: ModerationAction.ALLOWED,
          metadata: { failedOpen: true },
        });
        return result;
      });
    }
  }

  /** Paginated, filterable read over `moderation_logs` (spec §5.1) — publicId only, never id. */
  async getModerationLogs(
    query: QueryModerationLogsParams,
  ): Promise<PaginatedModerationLogsResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where = this.buildLogsWhere(query);

    const [rows, total] = await Promise.all([
      this.databaseService.moderationLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.databaseService.moderationLog.count({ where }),
    ]);

    return { data: rows.map((row) => this.toLogEntity(row)), total, page, limit };
  }

  /**
   * Aggregate moderation stats over an optional date range (spec §5.1): totals, flagged count,
   * violation rate, per-direction split, and the top flagged categories. The category tally is a
   * small in-application pass over only the *flagged* rows' JSONB `categories` within the range —
   * bounded by the same range filter as everything else here, never a full-table scan.
   */
  async getModerationStats(query: ModerationStatsQueryParams): Promise<ModerationStatsResult> {
    const where = this.buildDateRangeWhere(query);

    const [totalChecks, flaggedCount, inputCount, outputCount, flaggedRows] = await Promise.all([
      this.databaseService.moderationLog.count({ where }),
      this.databaseService.moderationLog.count({ where: { ...where, isFlagged: true } }),
      this.databaseService.moderationLog.count({
        where: { ...where, direction: ModerationDirection.INPUT },
      }),
      this.databaseService.moderationLog.count({
        where: { ...where, direction: ModerationDirection.OUTPUT },
      }),
      this.databaseService.moderationLog.findMany({
        where: { ...where, isFlagged: true },
        select: { categories: true },
      }),
    ]);

    return {
      totalChecks,
      flaggedCount,
      violationRate: totalChecks > 0 ? flaggedCount / totalChecks : 0,
      byDirection: { input: inputCount, output: outputCount },
      topCategories: this.tallyTopCategories(flaggedRows),
    };
  }

  private buildLogsWhere(query: QueryModerationLogsParams): Prisma.ModerationLogWhereInput {
    const where: Prisma.ModerationLogWhereInput = this.buildDateRangeWhere(query);
    if (query.userId) where.userId = query.userId;
    if (query.isFlagged !== undefined) where.isFlagged = query.isFlagged;
    if (query.direction) where.direction = query.direction;
    if (query.source) where.source = query.source;
    return where;
  }

  private buildDateRangeWhere(query: {
    startDate?: string;
    endDate?: string;
  }): Prisma.ModerationLogWhereInput {
    const where: Prisma.ModerationLogWhereInput = {};
    if (query.startDate ?? query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    return where;
  }

  private tallyTopCategories(
    rows: Array<{ categories: unknown }>,
    limit = DEFAULT_TOP_CATEGORIES_LIMIT,
  ): TopFlaggedCategory[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const categories = row.categories as Record<string, boolean>;
      for (const [category, flagged] of Object.entries(categories)) {
        if (flagged) counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([category, count]) => ({ category, count }));
  }

  private toLogEntity(row: {
    publicId: string;
    requestId: string | null;
    userId: string | null;
    direction: string;
    content: string;
    isFlagged: boolean;
    categories: unknown;
    categoryScores: unknown;
    action: string;
    source: string;
    createdAt: Date;
  }): ModerationLogEntity {
    return {
      publicId: row.publicId,
      requestId: row.requestId,
      userId: row.userId,
      direction: row.direction,
      content: row.content,
      isFlagged: row.isFlagged,
      categories: row.categories as Record<string, boolean>,
      categoryScores: row.categoryScores as Record<string, number>,
      action: row.action,
      source: row.source,
      createdAt: row.createdAt,
    };
  }

  private isEnabled(): boolean {
    return this.configService.get<boolean>('moderation.enabled') ?? true;
  }

  private buildResult(moderation: OpenAiModerationResult): ModerationResult {
    const threshold =
      this.configService.get<number>('moderation.blockThreshold') ?? DEFAULT_BLOCK_THRESHOLD;

    const categories: Record<string, boolean> = {};
    const flaggedCategories: string[] = [];
    let highest = { category: '', score: 0 };
    let highestScoreSeen = -Infinity;

    for (const [category, score] of Object.entries(moderation.categoryScores)) {
      const flagged = (moderation.categories[category] ?? false) || score >= threshold;
      categories[category] = flagged;
      if (flagged) flaggedCategories.push(category);
      if (score > highestScoreSeen) {
        highestScoreSeen = score;
        highest = { category, score };
      }
    }

    return {
      isFlagged: flaggedCategories.length > 0,
      categories,
      categoryScores: moderation.categoryScores,
      flaggedCategories,
      highestScore: highest,
    };
  }

  private cleanResult(): ModerationResult {
    return {
      isFlagged: false,
      categories: {},
      categoryScores: {},
      flaggedCategories: [],
      highestScore: { category: '', score: 0 },
    };
  }

  private truncateContent(content: string): string {
    return content.length > MAX_LOG_CONTENT_LENGTH
      ? content.slice(0, MAX_LOG_CONTENT_LENGTH)
      : content;
  }

  private async logModeration(params: {
    direction: ModerationDirection;
    content: string;
    result: ModerationResult;
    source: string;
    userId?: string;
    requestId?: string;
    action: ModerationAction;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.databaseService.moderationLog.create({
        data: {
          requestId: params.requestId,
          userId: params.userId,
          direction: params.direction,
          content: this.truncateContent(params.content),
          isFlagged: params.result.isFlagged,
          categories: params.result.categories,
          categoryScores: params.result.categoryScores,
          action: params.action,
          source: params.source,
          metadata: params.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error('ModerationService: failed to write moderation log', String(error));
    }
  }
}
