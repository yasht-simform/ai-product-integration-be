import { Test, type TestingModule } from '@nestjs/testing';

import { RetentionController } from '../retention.controller';
import { RetentionService } from '../services/retention.service';
import type {
  RetentionReport,
  RetentionRuntimeConfig,
  RetentionStatsResult,
} from '../types/cost-management.types';

// RetentionController imports RetentionService, which imports DatabaseService → the
// Prisma-generated ESM client (import.meta.url) — must be hoisted before any transitive import.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const makeConfig = (overrides: Partial<RetentionRuntimeConfig> = {}): RetentionRuntimeConfig => ({
  auditDays: 90,
  moderationDays: 90,
  archivedConversationDays: 30,
  embeddingCacheDays: 180,
  cron: '0 2 * * *',
  ...overrides,
});

describe('RetentionController (AI-073)', () => {
  let controller: RetentionController;
  let retentionMock: {
    getRetentionConfig: jest.Mock;
    updateRetentionConfig: jest.Mock;
    runFullCleanup: jest.Mock;
    getRetentionStats: jest.Mock;
  };

  beforeEach(async () => {
    retentionMock = {
      getRetentionConfig: jest.fn(),
      updateRetentionConfig: jest.fn(),
      runFullCleanup: jest.fn(),
      getRetentionStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RetentionController],
      providers: [{ provide: RetentionService, useValue: retentionMock }],
    }).compile();

    controller = module.get<RetentionController>(RetentionController);
  });

  describe('getRetentionConfig()', () => {
    it('delegates to RetentionService.getRetentionConfig()', () => {
      const config = makeConfig({ auditDays: 7 });
      retentionMock.getRetentionConfig.mockReturnValue(config);

      const result = controller.getRetentionConfig();

      expect(retentionMock.getRetentionConfig).toHaveBeenCalledWith();
      expect(result).toBe(config);
    });
  });

  describe('updateRetentionConfig()', () => {
    it('applies the update then returns the fresh effective config', () => {
      const updated = makeConfig({ auditDays: 14 });
      retentionMock.getRetentionConfig.mockReturnValue(updated);

      const result = controller.updateRetentionConfig({ auditDays: 14 });

      expect(retentionMock.updateRetentionConfig).toHaveBeenCalledWith({ auditDays: 14 });
      // Read-back happens strictly after the write.
      expect(retentionMock.updateRetentionConfig.mock.invocationCallOrder[0]).toBeLessThan(
        retentionMock.getRetentionConfig.mock.invocationCallOrder[0],
      );
      expect(result).toBe(updated);
    });

    it('propagates a validation error from the service without calling getRetentionConfig()', () => {
      retentionMock.updateRetentionConfig.mockImplementation(() => {
        throw new Error('cron cannot be changed at runtime');
      });

      expect(() => controller.updateRetentionConfig({ cron: '*/5 * * * *' } as never)).toThrow(
        'cron cannot be changed at runtime',
      );
      expect(retentionMock.getRetentionConfig).not.toHaveBeenCalled();
    });
  });

  describe('runFullCleanup()', () => {
    it('delegates to RetentionService.runFullCleanup() and returns the report as-is', async () => {
      const report: RetentionReport = {
        auditLogs: { deleted: 3, failed: false },
        moderationLogs: { deleted: 2, failed: false },
        archivedConversations: { deleted: 1, failed: false },
        embeddingCache: { deleted: 0, failed: false },
        totalDeleted: 6,
        ranAt: new Date('2026-07-11T02:00:00.000Z'),
        durationMs: 123,
      };
      retentionMock.runFullCleanup.mockResolvedValue(report);

      const result = await controller.runFullCleanup();

      expect(retentionMock.runFullCleanup).toHaveBeenCalledWith();
      expect(result).toBe(report);
    });
  });

  describe('getRetentionStats()', () => {
    it('delegates to RetentionService.getRetentionStats()', async () => {
      const stats: RetentionStatsResult = {
        lastReport: null,
        rowsDue: {
          auditLogs: 5,
          moderationLogs: 2,
          archivedConversations: 1,
          embeddingCache: 9,
        },
      };
      retentionMock.getRetentionStats.mockResolvedValue(stats);

      const result = await controller.getRetentionStats();

      expect(retentionMock.getRetentionStats).toHaveBeenCalledWith();
      expect(result).toBe(stats);
    });
  });
});
