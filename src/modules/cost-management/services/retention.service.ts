import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import type { RetentionConfig } from '../../../config/app.config';
import { DatabaseService } from '../../../database/database.service';
import { RETENTION_CONFIG } from '../constants/retention-config.constant';
import type {
  RetentionCategoryResult,
  RetentionConfigOverrides,
  RetentionReport,
  RetentionRowsDue,
  RetentionRuntimeConfig,
  RetentionStatsResult,
} from '../types/cost-management.types';

// Fixed delete batch size (NFR-RET-001) — never issue one unbounded deleteMany over a potentially
// 100K-row backlog. Each cleanup pages the cutoff set by id and deletes in bounded chunks.
const RETENTION_BATCH_SIZE = 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Distinct, stable name so `SchedulerRegistry.doesExist()` can guard re-registration on
// `npm run dev`'s file-watch module re-init (AI-070).
const CRON_JOB_NAME = 'retention-cleanup';

const DAY_OVERRIDE_FIELDS = [
  'auditDays',
  'moderationDays',
  'archivedConversationDays',
  'embeddingCacheDays',
] as const;

interface EffectiveRetentionConfig {
  auditDays: number;
  moderationDays: number;
  archivedConversationDays: number;
  embeddingCacheDays: number;
}

@Injectable()
export class RetentionService implements OnModuleInit {
  private lastReport: RetentionReport | null = null;
  private configOverrides: RetentionConfigOverrides = {};

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * Registers the daily cleanup cron dynamically (a static `@Cron()` can't read `retention.cron`
   * from config). Guards against double-registration — `npm run dev`'s file-watch re-runs module
   * init, and `SchedulerRegistry.addCronJob()` throws on a duplicate name. An invalid cron
   * expression is caught, logged, and skipped rather than crashing boot.
   */
  onModuleInit(): void {
    if (this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
      this.logger.log(`Retention cron '${CRON_JOB_NAME}' already registered — skipping`);
      return;
    }

    const cronExpression = this.getRetentionConfig().cron;
    let job: CronJob;
    try {
      job = new CronJob(cronExpression, () => {
        this.runFullCleanup().catch((error: unknown) => {
          this.logger.error(
            `Retention cron tick failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });
    } catch (error) {
      this.logger.error(
        `Invalid RETENTION_CRON expression '${cronExpression}' — cron not registered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Retention cleanup cron registered: '${cronExpression}'`);
  }

  /**
   * Effective retention settings (spec §5.4): the four day fields reflect runtime overrides →
   * env-namespaced config → `RETENTION_CONFIG` fallback, in that order. `cron` is always the
   * configured/fallback value — it is never overridable at runtime (see `updateRetentionConfig()`).
   */
  getRetentionConfig(): RetentionRuntimeConfig {
    const config = this.configService.get<RetentionConfig>('retention');
    return {
      ...this.getEffectiveConfig(),
      cron: config?.cron ?? RETENTION_CONFIG.cleanupCron,
    };
  }

  /**
   * Merges validated overrides for the four retention-day fields into memory only (PRD decision —
   * reset on restart, no persistence). Overrides take effect on the *next* `runFullCleanup()` call,
   * since `getEffectiveConfig()` is re-read at the start of every run. `cron` is rejected outright:
   * changing the schedule at runtime would require re-registering (or replacing) the live
   * `SchedulerRegistry` job, which adds complexity this phase doesn't need — restart with a new
   * `RETENTION_CRON` env var instead.
   */
  updateRetentionConfig(partial: Partial<RetentionRuntimeConfig>): void {
    if ('cron' in partial) {
      throw new BadRequestException(
        'cron cannot be changed at runtime — restart the app with a new RETENTION_CRON to change the schedule',
      );
    }

    const validated: RetentionConfigOverrides = {};
    for (const field of DAY_OVERRIDE_FIELDS) {
      const value = partial[field];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value <= 0) {
        throw new BadRequestException(`${field} must be a positive integer`);
      }
      validated[field] = value;
    }

    this.configOverrides = { ...this.configOverrides, ...validated };
  }

  /**
   * Seam for AI-073's `GET /retention/stats` (spec §6.4): the last `runFullCleanup()` report (null
   * before any run has occurred) plus a cheap per-category count of rows currently past their
   * cutoff, computed from the *current* effective config.
   */
  async getRetentionStats(): Promise<RetentionStatsResult> {
    const config = this.getEffectiveConfig();

    const [auditLogs, moderationLogs, archivedConversations, embeddingCache] = await Promise.all([
      this.databaseService.aiAuditLog.count({
        where: { createdAt: { lt: this.computeCutoff(config.auditDays) } },
      }),
      this.databaseService.moderationLog.count({
        where: { createdAt: { lt: this.computeCutoff(config.moderationDays) } },
      }),
      this.databaseService.chatConversation.count({
        where: {
          isArchived: true,
          updatedAt: { lt: this.computeCutoff(config.archivedConversationDays) },
        },
      }),
      this.databaseService.embeddingCache.count({
        where: { createdAt: { lt: this.computeCutoff(config.embeddingCacheDays) } },
      }),
    ]);

    const rowsDue: RetentionRowsDue = {
      auditLogs,
      moderationLogs,
      archivedConversations,
      embeddingCache,
    };

    return { lastReport: this.lastReport, rowsDue };
  }

  /** Delete `ai_audit_logs` rows older than the retention cutoff (spec §9.1). */
  async cleanupAuditLogs(retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = this.computeCutoff(retentionDays);
    const deleted = await this.runBatchedDelete(
      (take) =>
        this.databaseService.aiAuditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (ids) =>
        this.databaseService.aiAuditLog
          .deleteMany({ where: { id: { in: ids } } })
          .then((result) => result.count),
    );
    return { deleted };
  }

  /** Delete `moderation_logs` rows older than the retention cutoff (spec §9.1). */
  async cleanupModerationLogs(retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = this.computeCutoff(retentionDays);
    const deleted = await this.runBatchedDelete(
      (take) =>
        this.databaseService.moderationLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (ids) =>
        this.databaseService.moderationLog
          .deleteMany({ where: { id: { in: ids } } })
          .then((result) => result.count),
    );
    return { deleted };
  }

  /**
   * Delete archived conversations idle past the retention cutoff (spec §9.1): only
   * `isArchived: true` rows whose `updatedAt` is older than the cutoff. Messages are removed by the
   * schema's `onDelete: Cascade` — never deleted manually (FR-RET-002). Active (non-archived)
   * conversations are structurally untouchable: there is no method that deletes them.
   */
  async cleanupArchivedConversations(retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = this.computeCutoff(retentionDays);
    const deleted = await this.runBatchedDelete(
      (take) =>
        this.databaseService.chatConversation.findMany({
          where: { isArchived: true, updatedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (ids) =>
        this.databaseService.chatConversation
          .deleteMany({ where: { id: { in: ids } } })
          .then((result) => result.count),
    );
    return { deleted };
  }

  /**
   * Delete `embedding_cache` rows older than the retention cutoff (spec §9.1). Purely time-based:
   * cache rows carry no chunk reference, so the spec's "not referenced by an active chunk"
   * condition is unenforceable here. The only cost of over-deleting a still-referenced entry is one
   * re-embedding on the next cache miss (PRD decision), so a plain age cutoff is acceptable.
   */
  async cleanupStaleEmbeddingCache(retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = this.computeCutoff(retentionDays);
    const deleted = await this.runBatchedDelete(
      (take) =>
        this.databaseService.embeddingCache.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (ids) =>
        this.databaseService.embeddingCache
          .deleteMany({ where: { id: { in: ids } } })
          .then((result) => result.count),
    );
    return { deleted };
  }

  /**
   * Run all four cleanups sequentially using the currently effective retention config, returning a
   * per-category `RetentionReport` and logging the spec §9.2 summary line. A single category
   * failing is logged and the run continues — a partial cleanup beats an aborted one; the failed
   * category is marked in the report.
   */
  async runFullCleanup(): Promise<RetentionReport> {
    const ranAt = new Date();
    const start = Date.now();
    const config = this.getEffectiveConfig();

    const auditLogs = await this.runCategory('audit logs', () =>
      this.cleanupAuditLogs(config.auditDays),
    );
    const moderationLogs = await this.runCategory('moderation logs', () =>
      this.cleanupModerationLogs(config.moderationDays),
    );
    const archivedConversations = await this.runCategory('archived conversations', () =>
      this.cleanupArchivedConversations(config.archivedConversationDays),
    );
    const embeddingCache = await this.runCategory('embedding cache', () =>
      this.cleanupStaleEmbeddingCache(config.embeddingCacheDays),
    );

    const totalDeleted =
      auditLogs.deleted +
      moderationLogs.deleted +
      archivedConversations.deleted +
      embeddingCache.deleted;
    const durationMs = Date.now() - start;

    this.logger.log(
      `Retention cleanup: deleted ${auditLogs.deleted} audit logs, ${moderationLogs.deleted} moderation logs, ${archivedConversations.deleted} conversations, ${embeddingCache.deleted} cache entries (${durationMs}ms)`,
    );

    const report: RetentionReport = {
      auditLogs,
      moderationLogs,
      archivedConversations,
      embeddingCache,
      totalDeleted,
      ranAt,
      durationMs,
    };
    this.lastReport = report;
    return report;
  }

  /**
   * UTC-based cutoff (ms arithmetic is timezone-agnostic). Callers filter with a strict `lt`, so a
   * row aged exactly `retentionDays` is kept, not deleted.
   */
  private computeCutoff(retentionDays: number): Date {
    return new Date(Date.now() - retentionDays * MS_PER_DAY);
  }

  /**
   * Delete a cutoff set in fixed-size batches: page ids ascending, delete each page by id, sum the
   * counts. Stops when a page comes back empty or short — bounding both the query and the delete
   * regardless of backlog size (NFR-RET-001).
   */
  private async runBatchedDelete(
    fetchIds: (take: number) => Promise<Array<{ id: bigint }>>,
    deleteByIds: (ids: bigint[]) => Promise<number>,
  ): Promise<number> {
    let deleted = 0;
    let hasMore = true;
    while (hasMore) {
      const rows = await fetchIds(RETENTION_BATCH_SIZE);
      if (rows.length === 0) break;
      deleted += await deleteByIds(rows.map((row) => row.id));
      hasMore = rows.length === RETENTION_BATCH_SIZE;
    }
    return deleted;
  }

  private async runCategory(
    label: string,
    run: () => Promise<{ deleted: number }>,
  ): Promise<RetentionCategoryResult> {
    try {
      const { deleted } = await run();
      return { deleted, failed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Retention cleanup: '${label}' failed — ${message}`);
      return { deleted: 0, failed: true, error: message };
    }
  }

  /**
   * Runtime overrides (`updateRetentionConfig()`) win first, then env-namespaced config, then the
   * `RETENTION_CONFIG` hardcoded fallback — the same three-tier chain this codebase already uses
   * for `chatConfig`/`ragConfig` reads elsewhere.
   */
  private getEffectiveConfig(): EffectiveRetentionConfig {
    const config = this.configService.get<RetentionConfig>('retention');
    return {
      auditDays:
        this.configOverrides.auditDays ??
        config?.auditDays ??
        RETENTION_CONFIG.auditLogRetentionDays,
      moderationDays:
        this.configOverrides.moderationDays ??
        config?.moderationDays ??
        RETENTION_CONFIG.moderationLogRetentionDays,
      archivedConversationDays:
        this.configOverrides.archivedConversationDays ??
        config?.archivedConversationDays ??
        RETENTION_CONFIG.archivedConversationRetentionDays,
      embeddingCacheDays:
        this.configOverrides.embeddingCacheDays ??
        config?.embeddingCacheDays ??
        RETENTION_CONFIG.embeddingCacheRetentionDays,
    };
  }
}
