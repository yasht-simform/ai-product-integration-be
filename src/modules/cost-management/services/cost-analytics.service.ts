import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { OpenAIEndpoint } from '../../openai/constants/openai-endpoint.enum';
import type { SpendByFeatureQueryDto } from '../dto/spend-by-feature-query.dto';
import type { SpendByModelQueryDto } from '../dto/spend-by-model-query.dto';
import type { SpendByUserQueryDto } from '../dto/spend-by-user-query.dto';
import type { SpendTimelineQueryDto } from '../dto/spend-timeline-query.dto';
import type {
  ProjectedSpendResult,
  SpendByFeatureResult,
  SpendByModelResult,
  SpendByUserResult,
  SpendTimelinePoint,
  SpendTimelineResult,
} from '../types/cost-management.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TIMELINE_DAYS = 30;
const MAX_TREND_DAYS = 365;

// A single daily row from the raw timeline query. Postgres aggregates arrive as
// Decimal/bigint/number depending on driver — `toNumber()` normalizes all of them. `day` is
// pre-formatted to 'YYYY-MM-DD' text in the SQL itself (see queryTimeline()) rather than left as
// a `timestamp without time zone` — node-postgres parses that type assuming the Node process's
// *local* timezone, not UTC, which silently shifted every bucket by the local UTC offset in any
// non-UTC deployment (live-verified in AI-075: a deployment running in IST saw a day's real spend
// vanish from its own date bucket). A plain text column sidesteps Date parsing entirely.
interface RawTimelineRow {
  day: string;
  totalCost: unknown;
  totalTokens: unknown;
  callCount: unknown;
}

// Null/unattributed userId aggregates here rather than being dropped — unattributed spend is
// still spend (AI-067).
const ANONYMOUS_BUCKET = 'anonymous';

// endpoint → feature label. NOTE: chat completions serve BOTH plain chat and RAG answer
// generation, and the two are NOT distinguishable from ai_audit_logs columns alone (there is no
// feature/source column — a deliberate no-new-audit-column decision, PRD §16). RAG-driven spend
// is therefore folded into the 'chat' feature bucket here.
const FEATURE_LABELS: Record<string, string> = {
  [OpenAIEndpoint.CHAT_COMPLETIONS]: 'chat',
  [OpenAIEndpoint.EMBEDDINGS]: 'embeddings',
  [OpenAIEndpoint.MODERATIONS]: 'moderations',
};

@Injectable()
export class CostAnalyticsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Spend grouped by user (spec §5.3) — paginated and sortable by total spend (descending
   * default). Rows with a null `userId` collapse into the `'anonymous'` bucket.
   */
  async getSpendByUser(query: SpendByUserQueryDto): Promise<SpendByUserResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder ?? 'desc';
    const where = this.buildWhere(query);

    const [groups, allGroups] = await Promise.all([
      this.databaseService.aiAuditLog.groupBy({
        by: ['userId'],
        where,
        _sum: { estimatedCost: true, totalTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { estimatedCost: sortOrder } },
        skip,
        take: limit,
      }),
      // Distinct-user count for pagination `total` — groupBy has no built-in total-groups count.
      this.databaseService.aiAuditLog.groupBy({ by: ['userId'], where }),
    ]);

    return {
      data: groups.map((group) => ({
        userId: group.userId ?? ANONYMOUS_BUCKET,
        totalCost: group._sum.estimatedCost ?? 0,
        totalTokens: group._sum.totalTokens ?? 0,
        callCount: group._count._all,
      })),
      total: allGroups.length,
      page,
      limit,
    };
  }

  /** Spend grouped by model (spec §5.3), spend-descending. */
  async getSpendByModel(query: SpendByModelQueryDto): Promise<SpendByModelResult> {
    const where = this.buildWhere(query);

    const groups = await this.databaseService.aiAuditLog.groupBy({
      by: ['model'],
      where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCost: 'desc' } },
    });

    return {
      data: groups.map((group) => ({
        model: group.model,
        totalCost: group._sum.estimatedCost ?? 0,
        totalTokens: group._sum.totalTokens ?? 0,
        callCount: group._count._all,
      })),
    };
  }

  /** Spend grouped by feature (spec §5.3) — `endpoint` mapped to a feature label. */
  async getSpendByFeature(query: SpendByFeatureQueryDto): Promise<SpendByFeatureResult> {
    const where = this.buildWhere(query);

    const groups = await this.databaseService.aiAuditLog.groupBy({
      by: ['endpoint'],
      where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCost: 'desc' } },
    });

    return {
      data: groups.map((group) => ({
        feature: FEATURE_LABELS[group.endpoint] ?? group.endpoint,
        endpoint: group.endpoint,
        totalCost: group._sum.estimatedCost ?? 0,
        totalTokens: group._sum.totalTokens ?? 0,
        callCount: group._count._all,
      })),
    };
  }

  /**
   * Daily spend buckets over a date range (spec §5.4) for charting. Uses `$queryRaw` with
   * `date_trunc('day', ...)` — Prisma `groupBy` cannot group by a date truncation. Days with no
   * spend inside the range are back-filled as zero buckets so charts get a contiguous axis.
   * Defaults to the trailing 30 days when the range is omitted.
   */
  async getSpendTimeline(query: SpendTimelineQueryDto): Promise<SpendTimelineResult> {
    const end = query.endDate ? new Date(query.endDate) : new Date();
    const start = query.startDate
      ? new Date(query.startDate)
      : new Date(end.getTime() - (DEFAULT_TIMELINE_DAYS - 1) * MS_PER_DAY);
    return { data: await this.buildTimeline(start, end, query.userId) };
  }

  /** Last N days of daily spend (spec §5.4) — delegates to the timeline logic (default 30, clamped 1–365). */
  async getDailySpendTrend(days: number = DEFAULT_TIMELINE_DAYS): Promise<SpendTimelineResult> {
    const clamped = Math.min(
      Math.max(Math.trunc(days) || DEFAULT_TIMELINE_DAYS, 1),
      MAX_TREND_DAYS,
    );
    const end = new Date();
    const start = new Date(end.getTime() - (clamped - 1) * MS_PER_DAY);
    return { data: await this.buildTimeline(start, end) };
  }

  /**
   * Projected month-end spend (FR-COST-004): month-to-date total ÷ elapsed days in the month
   * (UTC, counting today as elapsed) × total days in the month. Returns every input so the
   * arithmetic is auditable. Zero elapsed spend → projected 0, never NaN.
   */
  async getProjectedMonthlySpend(): Promise<ProjectedSpendResult> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    // Day 0 of the next month is the last day of this month.
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysElapsed = now.getUTCDate();

    const aggregate = await this.databaseService.aiAuditLog.aggregate({
      where: { status: AiAuditStatus.SUCCESS, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    });
    const monthToDate = aggregate._sum?.estimatedCost ?? 0;
    const dailyAverage = daysElapsed > 0 ? monthToDate / daysElapsed : 0;
    const projected = dailyAverage * daysInMonth;

    return { monthToDate, dailyAverage, daysElapsed, daysInMonth, projected };
  }

  private async buildTimeline(
    start: Date,
    end: Date,
    userId?: string,
  ): Promise<SpendTimelinePoint[]> {
    const rows = await this.queryTimeline(start, end, userId);
    return this.fillGapDays(rows, start, end);
  }

  /**
   * Raw daily-bucket query. Uses `$queryRaw`'s own tagged-template form (every `${}` is a bound
   * parameter — equivalent to `Prisma.sql`, never string concatenation), branching on `userId`
   * rather than composing a `Prisma.sql` fragment: value-importing `Prisma` from the generated
   * client would break Jest (the documented generated-client `.js`-extension load failure), so the
   * two branches keep parameterization safe without that import.
   */
  private queryTimeline(start: Date, end: Date, userId?: string): Promise<RawTimelineRow[]> {
    const status = AiAuditStatus.SUCCESS;
    // `to_char(..., 'YYYY-MM-DD')` — not a bare `date_trunc(...)` timestamp — so Postgres returns
    // plain text for `day`. node-postgres parses a `timestamp without time zone` result assuming
    // the Node process's *local* timezone, silently shifting every bucket by the local UTC offset
    // in a non-UTC deployment (AI-075 finding); a text column has no such ambiguity.
    if (userId !== undefined && userId !== '') {
      return this.databaseService.$queryRaw<RawTimelineRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               SUM("estimatedCost") AS "totalCost",
               SUM("totalTokens") AS "totalTokens",
               COUNT(*) AS "callCount"
        FROM "ai_audit_logs"
        WHERE "status" = ${status}
          AND "createdAt" >= ${start}
          AND "createdAt" <= ${end}
          AND "userId" = ${userId}
        GROUP BY day
        ORDER BY day ASC
      `;
    }
    return this.databaseService.$queryRaw<RawTimelineRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             SUM("estimatedCost") AS "totalCost",
             SUM("totalTokens") AS "totalTokens",
             COUNT(*) AS "callCount"
      FROM "ai_audit_logs"
      WHERE "status" = ${status}
        AND "createdAt" >= ${start}
        AND "createdAt" <= ${end}
      GROUP BY day
      ORDER BY day ASC
    `;
  }

  /** Back-fill every UTC day in [start, end] with the actual bucket or a zero bucket. */
  private fillGapDays(rows: RawTimelineRow[], start: Date, end: Date): SpendTimelinePoint[] {
    const byDay = new Map<string, RawTimelineRow>();
    for (const row of rows) byDay.set(this.dayKey(row.day), row);

    const points: SpendTimelinePoint[] = [];
    const cursor = this.utcMidnight(start);
    const last = this.utcMidnight(end).getTime();
    while (cursor.getTime() <= last) {
      const key = cursor.toISOString().slice(0, 10);
      const row = byDay.get(key);
      points.push({
        date: key,
        totalCost: this.toNumber(row?.totalCost),
        totalTokens: this.toNumber(row?.totalTokens),
        callCount: this.toNumber(row?.callCount),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
  }

  private dayKey(value: string): string {
    // `value` is already 'YYYY-MM-DD' text straight from Postgres's to_char() — matches
    // fillGapDays()'s own cursor-key format exactly, with no Date parsing (and therefore no
    // timezone ambiguity) involved.
    return value;
  }

  private utcMidnight(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  /** Normalize a raw SQL aggregate (Decimal | bigint | number | string | null) to a plain number. */
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') return this.parseFinite(value);
    // Prisma Decimal (and any numeric wrapper) exposes a value-preserving toString().
    if (typeof value === 'object') {
      return this.parseFinite((value as { toString(): string }).toString());
    }
    return 0;
  }

  private parseFinite(raw: string): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildWhere(query: { startDate?: string; endDate?: string }): Prisma.AiAuditLogWhereInput {
    const where: Prisma.AiAuditLogWhereInput = { status: AiAuditStatus.SUCCESS };
    if (query.startDate ?? query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    return where;
  }
}
