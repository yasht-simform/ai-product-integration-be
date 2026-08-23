import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { RetentionService } from '../services/retention.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
// by substituting an empty class for the DI token.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FROZEN_NOW = new Date('2026-07-11T12:00:00.000Z');

const RETENTION_CFG = {
  auditDays: 90,
  moderationDays: 90,
  archivedConversationDays: 30,
  embeddingCacheDays: 180,
  cron: '0 2 * * *',
};

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockConfig = { get: jest.fn() };

const cutoff = (days: number): Date => new Date(FROZEN_NOW.getTime() - days * MS_PER_DAY);

const idRows = (count: number): Array<{ id: bigint }> =>
  Array.from({ length: count }, (_, index) => ({ id: BigInt(index + 1) }));

function stubAllFindManyEmpty(db: DeepMockProxy<DatabaseService>): void {
  db.aiAuditLog.findMany.mockResolvedValue([] as never);
  db.moderationLog.findMany.mockResolvedValue([] as never);
  db.chatConversation.findMany.mockResolvedValue([] as never);
  db.embeddingCache.findMany.mockResolvedValue([] as never);
}

describe('RetentionService', () => {
  let service: RetentionService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let schedulerRegistry: SchedulerRegistry;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);

    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AppLoggerService, useValue: mockLogger },
        // A real instance — SchedulerRegistry is a plain in-memory registry, no mocking needed
        // (per this issue's own Testing Notes).
        SchedulerRegistry,
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
    schedulerRegistry = module.get<SchedulerRegistry>(SchedulerRegistry);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(RETENTION_CFG);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cutoff math (strict `<`, UTC)', () => {
    it('deletes audit logs strictly older than now - retentionDays', async () => {
      dbMock.aiAuditLog.findMany.mockResolvedValue([] as never);

      await service.cleanupAuditLogs(90);

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { lt: cutoff(90) } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 1000,
        }),
      );
    });

    it('filters archived conversations on isArchived + updatedAt, never touching messages', async () => {
      dbMock.chatConversation.findMany.mockResolvedValue([] as never);

      await service.cleanupArchivedConversations(30);

      expect(dbMock.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isArchived: true, updatedAt: { lt: cutoff(30) } },
        }),
      );
      expect(dbMock.chatMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('cleans embedding cache on a plain createdAt cutoff', async () => {
      dbMock.embeddingCache.findMany.mockResolvedValue([] as never);

      await service.cleanupStaleEmbeddingCache(180);

      expect(dbMock.embeddingCache.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { lt: cutoff(180) } } }),
      );
    });

    it('returns deleted: 0 and issues no deleteMany when nothing is stale', async () => {
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);

      const result = await service.cleanupModerationLogs(90);

      expect(result).toEqual({ deleted: 0 });
      expect(dbMock.moderationLog.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('batched deletes (NFR-RET-001)', () => {
    it('pages a 2.5-batch backlog into 3 deleteMany calls and sums the counts', async () => {
      dbMock.aiAuditLog.findMany
        .mockResolvedValueOnce(idRows(1000) as never)
        .mockResolvedValueOnce(idRows(1000) as never)
        .mockResolvedValueOnce(idRows(500) as never);
      dbMock.aiAuditLog.deleteMany
        .mockResolvedValueOnce({ count: 1000 })
        .mockResolvedValueOnce({ count: 1000 })
        .mockResolvedValueOnce({ count: 500 });

      const result = await service.cleanupAuditLogs(90);

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledTimes(3);
      expect(dbMock.aiAuditLog.deleteMany).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ deleted: 2500 });
      // First page deletes exactly one full batch of ids.
      const firstDeleteArg = dbMock.aiAuditLog.deleteMany.mock.calls[0]?.[0] as {
        where: { id: { in: bigint[] } };
      };
      expect(firstDeleteArg.where.id.in).toHaveLength(1000);
    });

    it('stops after a single full batch when the next page is empty', async () => {
      dbMock.aiAuditLog.findMany
        .mockResolvedValueOnce(idRows(1000) as never)
        .mockResolvedValueOnce([] as never);
      dbMock.aiAuditLog.deleteMany.mockResolvedValue({ count: 1000 });

      const result = await service.cleanupAuditLogs(90);

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledTimes(2);
      expect(dbMock.aiAuditLog.deleteMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ deleted: 1000 });
    });
  });

  describe('runFullCleanup()', () => {
    it('aggregates all four categories, uses config cutoffs, and logs the summary line', async () => {
      dbMock.aiAuditLog.findMany.mockResolvedValueOnce(idRows(3) as never);
      dbMock.aiAuditLog.deleteMany.mockResolvedValue({ count: 3 });
      dbMock.moderationLog.findMany.mockResolvedValueOnce(idRows(2) as never);
      dbMock.moderationLog.deleteMany.mockResolvedValue({ count: 2 });
      dbMock.chatConversation.findMany.mockResolvedValueOnce(idRows(4) as never);
      dbMock.chatConversation.deleteMany.mockResolvedValue({ count: 4 });
      dbMock.embeddingCache.findMany.mockResolvedValueOnce(idRows(1) as never);
      dbMock.embeddingCache.deleteMany.mockResolvedValue({ count: 1 });

      const report = await service.runFullCleanup();

      expect(report.auditLogs).toEqual({ deleted: 3, failed: false });
      expect(report.moderationLogs).toEqual({ deleted: 2, failed: false });
      expect(report.archivedConversations).toEqual({ deleted: 4, failed: false });
      expect(report.embeddingCache).toEqual({ deleted: 1, failed: false });
      expect(report.totalDeleted).toBe(10);
      expect(report.ranAt).toEqual(FROZEN_NOW);
      expect(typeof report.durationMs).toBe('number');

      // Config-derived cutoffs actually applied.
      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { lt: cutoff(90) } } }),
      );
      expect(dbMock.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isArchived: true, updatedAt: { lt: cutoff(30) } } }),
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Retention cleanup: deleted 3 audit logs, 2 moderation logs, 4 conversations, 1 cache entries',
        ),
      );
    });

    it('falls back to RETENTION_CONFIG defaults when the config namespace is unset', async () => {
      mockConfig.get.mockReturnValue(undefined);
      stubAllFindManyEmpty(dbMock);

      await service.runFullCleanup();

      expect(dbMock.embeddingCache.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { lt: cutoff(180) } } }),
      );
    });

    it('continues past a single-category failure and marks it in the report', async () => {
      stubAllFindManyEmpty(dbMock);
      dbMock.moderationLog.findMany.mockRejectedValue(new Error('db down'));
      dbMock.aiAuditLog.deleteMany.mockResolvedValue({ count: 0 });

      const report = await service.runFullCleanup();

      expect(report.moderationLogs).toEqual({ deleted: 0, failed: true, error: 'db down' });
      expect(report.auditLogs.failed).toBe(false);
      // A category that runs AFTER the failure still executes — proves continuation.
      expect(report.embeddingCache.failed).toBe(false);
      expect(report.totalDeleted).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
      expect(mockLogger.log).toHaveBeenCalled();
    });

    it('never deletes documents, chunks, or messages during a full run (FR-RET-002)', async () => {
      stubAllFindManyEmpty(dbMock);

      await service.runFullCleanup();

      expect(dbMock.document.deleteMany).not.toHaveBeenCalled();
      expect(dbMock.documentChunk.deleteMany).not.toHaveBeenCalled();
      expect(dbMock.chatMessage.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('public surface safety (FR-RET-002)', () => {
    it('exposes no method that references documents, chunks, or active conversations', () => {
      const names = Object.getOwnPropertyNames(RetentionService.prototype).filter(
        (name) => name !== 'constructor',
      );

      expect(names.some((name) => /document|chunk/i.test(name))).toBe(false);
      expect(names.some((name) => /active/i.test(name))).toBe(false);
      expect(names).toContain('cleanupArchivedConversations');
    });
  });

  describe('onModuleInit() — cron registration (AI-070)', () => {
    it('registers a cron job named retention-cleanup with the configured expression', () => {
      service.onModuleInit();

      expect(schedulerRegistry.doesExist('cron', 'retention-cleanup')).toBe(true);
      const job = schedulerRegistry.getCronJob('retention-cleanup');
      expect(job.cronTime.source).toBe('0 2 * * *');
      expect(job.isActive).toBe(true);
    });

    it('guards against double-registration on a second onModuleInit() call', () => {
      service.onModuleInit();
      service.onModuleInit();

      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('already registered'));
      // Still exactly one job under the name — no throw, no duplicate.
      expect(schedulerRegistry.getCronJobs().size).toBe(1);
    });

    it('logs and skips registration for an invalid cron expression, without crashing boot', () => {
      mockConfig.get.mockReturnValue({ ...RETENTION_CFG, cron: 'not-a-cron-expression' });

      expect(() => service.onModuleInit()).not.toThrow();

      expect(schedulerRegistry.doesExist('cron', 'retention-cleanup')).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid RETENTION_CRON'),
      );
    });

    it('invokes runFullCleanup() on tick and catches a rejection without throwing', async () => {
      service.onModuleInit();
      const job = schedulerRegistry.getCronJob('retention-cleanup');
      const runFullCleanupSpy = jest
        .spyOn(service, 'runFullCleanup')
        .mockRejectedValue(new Error('tick boom'));

      await job.fireOnTick();
      // fireOnTick() doesn't await the onTick callback's own promise chain when it's fire-and-forget;
      // flush microtasks so the internal .catch() has a chance to run.
      await Promise.resolve();
      await Promise.resolve();

      expect(runFullCleanupSpy).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('tick boom'));
    });
  });

  describe('getRetentionConfig() / updateRetentionConfig()', () => {
    it('reflects env-namespaced config values including cron', () => {
      const config = service.getRetentionConfig();

      expect(config).toEqual(RETENTION_CFG);
    });

    it('reflects RETENTION_CONFIG fallbacks when the namespace is unset', () => {
      mockConfig.get.mockReturnValue(undefined);

      const config = service.getRetentionConfig();

      expect(config).toEqual({
        auditDays: 90,
        moderationDays: 90,
        archivedConversationDays: 30,
        embeddingCacheDays: 180,
        cron: '0 2 * * *',
      });
    });

    it('merges a validated day-field override and reflects it in getRetentionConfig()', () => {
      service.updateRetentionConfig({ auditDays: 7 });

      expect(service.getRetentionConfig().auditDays).toBe(7);
      // Untouched fields keep their config-derived values.
      expect(service.getRetentionConfig().moderationDays).toBe(90);
    });

    it('applies an override to the very next cleanup run', async () => {
      service.updateRetentionConfig({ auditDays: 7 });
      stubAllFindManyEmpty(dbMock);

      await service.runFullCleanup();

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { lt: cutoff(7) } } }),
      );
    });

    it('rejects a cron key in the update', () => {
      expect(() => service.updateRetentionConfig({ cron: '*/5 * * * *' })).toThrow(
        BadRequestException,
      );
      // Unaffected — still the original configured value.
      expect(service.getRetentionConfig().cron).toBe('0 2 * * *');
    });

    it.each([0, -1, 1.5])('rejects a non-positive-integer day override (%s)', (value) => {
      expect(() => service.updateRetentionConfig({ auditDays: value })).toThrow(
        BadRequestException,
      );
    });

    it('accumulates overrides across multiple calls', () => {
      service.updateRetentionConfig({ auditDays: 7 });
      service.updateRetentionConfig({ moderationDays: 14 });

      const config = service.getRetentionConfig();
      expect(config.auditDays).toBe(7);
      expect(config.moderationDays).toBe(14);
    });
  });

  describe('getRetentionStats()', () => {
    it('returns lastReport: null before any cleanup run', async () => {
      const stats = await service.getRetentionStats();

      expect(stats.lastReport).toBeNull();
    });

    it('returns the most recent runFullCleanup() report after a run', async () => {
      stubAllFindManyEmpty(dbMock);
      const report = await service.runFullCleanup();

      const stats = await service.getRetentionStats();

      expect(stats.lastReport).toEqual(report);
    });

    it('returns per-category rows-due counts using the current effective config', async () => {
      dbMock.aiAuditLog.count.mockResolvedValue(5);
      dbMock.moderationLog.count.mockResolvedValue(2);
      dbMock.chatConversation.count.mockResolvedValue(1);
      dbMock.embeddingCache.count.mockResolvedValue(9);

      const stats = await service.getRetentionStats();

      expect(stats.rowsDue).toEqual({
        auditLogs: 5,
        moderationLogs: 2,
        archivedConversations: 1,
        embeddingCache: 9,
      });
      expect(dbMock.aiAuditLog.count).toHaveBeenCalledWith({
        where: { createdAt: { lt: cutoff(90) } },
      });
      expect(dbMock.chatConversation.count).toHaveBeenCalledWith({
        where: { isArchived: true, updatedAt: { lt: cutoff(30) } },
      });
    });
  });
});
