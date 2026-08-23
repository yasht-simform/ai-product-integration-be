import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { UserCostBudget } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { BudgetPeriod } from '../constants/budget-period.constant';
import type { CreateBudgetDto } from '../dto/create-budget.dto';
import { CostBudgetService } from '../services/cost-budget.service';

function makeAggregate(estimatedCost: number | null) {
  return { _sum: { estimatedCost } } as never;
}

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
// by substituting an empty class for the DI token.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockConfig = { get: jest.fn() };

function makeBudget(overrides: Partial<UserCostBudget> = {}): UserCostBudget {
  return {
    id: BigInt(1),
    publicId: 'pub-uuid-001',
    userId: 'user-1',
    dailyLimitUsd: null,
    monthlyLimitUsd: null,
    isActive: true,
    alertThreshold: 0.8,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CostBudgetService', () => {
  let service: CostBudgetService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostBudgetService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<CostBudgetService>(CostBudgetService);
    jest.clearAllMocks();
  });

  describe('createBudget()', () => {
    it('calls db.userCostBudget.create() with defaults and returns entity without id', async () => {
      const dto: CreateBudgetDto = { userId: 'user-1', dailyLimitUsd: 10 };
      dbMock.userCostBudget.create.mockResolvedValue(makeBudget({ dailyLimitUsd: 10 }));

      const result = await service.createBudget(dto);

      expect(dbMock.userCostBudget.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dailyLimitUsd: 10,
          monthlyLimitUsd: undefined,
          alertThreshold: 0.8,
          isActive: true,
        },
      });
      expect(result).not.toHaveProperty('id');
      expect(result.publicId).toBe('pub-uuid-001');
    });

    it('throws ConflictException when Prisma returns P2002 (duplicate userId)', async () => {
      const dto: CreateBudgetDto = { userId: 'user-1' };
      const p2002 = Object.assign(new Error('Unique constraint failed on (userId)'), {
        code: 'P2002',
      });
      dbMock.userCostBudget.create.mockRejectedValue(p2002);

      await expect(service.createBudget(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllBudgets()', () => {
    it('calls findMany() with correct where/skip/take/orderBy', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([makeBudget()]);
      dbMock.userCostBudget.count.mockResolvedValue(1);

      await service.findAllBudgets({ page: 2, limit: 10 });

      expect(dbMock.userCostBudget.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies isActive filter when provided', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([]);
      dbMock.userCostBudget.count.mockResolvedValue(0);

      await service.findAllBudgets({ isActive: false });

      expect(dbMock.userCostBudget.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });

    it('returns { data, total, page, limit }', async () => {
      const budgets = [makeBudget(), makeBudget({ id: BigInt(2), publicId: 'pub-002' })];
      dbMock.userCostBudget.findMany.mockResolvedValue(budgets);
      dbMock.userCostBudget.count.mockResolvedValue(2);

      const result = await service.findAllBudgets({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('findBudgetByUserId()', () => {
    it('returns null when no budget exists for the user', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(null);

      const result = await service.findBudgetByUserId('unknown-user');

      expect(result).toBeNull();
    });

    it('returns the entity when a budget exists', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudget());

      const result = await service.findBudgetByUserId('user-1');

      expect(result?.userId).toBe('user-1');
      expect(result).not.toHaveProperty('id');
    });
  });

  describe('updateBudget()', () => {
    it('throws NotFoundException when budget does not exist', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(null);

      await expect(service.updateBudget('missing-id', { dailyLimitUsd: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls db.userCostBudget.update() with partial data after finding the budget', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudget());
      dbMock.userCostBudget.update.mockResolvedValue(makeBudget({ dailyLimitUsd: 5 }));

      const result = await service.updateBudget('pub-uuid-001', { dailyLimitUsd: 5 });

      expect(dbMock.userCostBudget.update).toHaveBeenCalledWith({
        where: { publicId: 'pub-uuid-001' },
        data: {
          dailyLimitUsd: 5,
          monthlyLimitUsd: undefined,
          alertThreshold: undefined,
          isActive: undefined,
        },
      });
      expect(result.dailyLimitUsd).toBe(5);
    });
  });

  describe('deleteBudget()', () => {
    it('throws NotFoundException when budget does not exist', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(null);

      await expect(service.deleteBudget('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('hard-deletes via db.userCostBudget.delete()', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudget());
      dbMock.userCostBudget.delete.mockResolvedValue(makeBudget());

      const result = await service.deleteBudget('pub-uuid-001');

      expect(dbMock.userCostBudget.delete).toHaveBeenCalledWith({
        where: { publicId: 'pub-uuid-001' },
      });
      expect(result).toBeUndefined();
    });
  });

  describe('getUserSpend()', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T10:30:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries with a midnight-UTC periodStart for the daily period and returns 0 for a null sum', async () => {
      dbMock.aiAuditLog.aggregate.mockResolvedValue(makeAggregate(null));

      const result = await service.getUserSpend('user-1', BudgetPeriod.DAILY);

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: AiAuditStatus.SUCCESS,
          createdAt: { gte: new Date('2026-07-15T00:00:00.000Z') },
        },
        _sum: { estimatedCost: true },
      });
      expect(result).toBe(0);
    });

    it('queries with a first-of-month-UTC periodStart for the monthly period', async () => {
      dbMock.aiAuditLog.aggregate.mockResolvedValue(makeAggregate(1.23));

      const result = await service.getUserSpend('user-1', BudgetPeriod.MONTHLY);

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date('2026-07-01T00:00:00.000Z') },
          }),
        }),
      );
      expect(result).toBe(1.23);
    });
  });

  describe('checkBudget()', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T10:30:00.000Z'));
      mockConfig.get.mockImplementation((key: string) =>
        key === 'costBudget.enabled' ? true : undefined,
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('short-circuits to an unrestricted result with zero aggregate queries when costBudget.enabled is false', async () => {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'costBudget.enabled' ? false : undefined,
      );

      const result = await service.checkBudget('user-1');

      expect(result).toEqual({
        allowed: true,
        dailySpend: 0,
        monthlySpend: 0,
        dailyLimit: null,
        monthlyLimit: null,
        dailyPercentage: 0,
        monthlyPercentage: 0,
      });
      expect(dbMock.userCostBudget.findUnique).not.toHaveBeenCalled();
      expect(dbMock.aiAuditLog.aggregate).not.toHaveBeenCalled();
    });

    it('short-circuits with zero aggregate queries when no budget row exists', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(null);

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(true);
      expect(dbMock.aiAuditLog.aggregate).not.toHaveBeenCalled();
    });

    it('short-circuits with zero aggregate queries when the budget is inactive', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudget({ isActive: false }));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(true);
      expect(dbMock.aiAuditLog.aggregate).not.toHaveBeenCalled();
    });

    it('allows and reports percentages when under both limits, with no warning', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(
        makeBudget({ dailyLimitUsd: 1.0, monthlyLimitUsd: 20 }),
      );
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(0.45))
        .mockResolvedValueOnce(makeAggregate(5));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(true);
      expect(result.dailyPercentage).toBe(45);
      expect(result.monthlySpend).toBe(5);
      expect(result.warning).toBeUndefined();
    });

    it('blocks when daily spend >= daily limit', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(
        makeBudget({ dailyLimitUsd: 1.0, monthlyLimitUsd: null }),
      );
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(1.0))
        .mockResolvedValueOnce(makeAggregate(0));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(false);
    });

    it('blocks when monthly spend >= monthly limit while daily is unlimited', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(
        makeBudget({ dailyLimitUsd: null, monthlyLimitUsd: 20 }),
      );
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(999))
        .mockResolvedValueOnce(makeAggregate(20));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(false);
      expect(result.dailyPercentage).toBe(0);
    });

    it('sets a warning when spend crosses the alert threshold but stays under the limit', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(
        makeBudget({ dailyLimitUsd: 1.0, monthlyLimitUsd: null, alertThreshold: 0.8 }),
      );
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(0.85))
        .mockResolvedValueOnce(makeAggregate(0));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(true);
      expect(result.warning).toBe('Approaching daily limit (85%)');
    });

    it('never sets a warning when the request is already blocked', async () => {
      dbMock.userCostBudget.findUnique.mockResolvedValue(makeBudget({ dailyLimitUsd: 1.0 }));
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(1.0))
        .mockResolvedValueOnce(makeAggregate(0));

      const result = await service.checkBudget('user-1');

      expect(result.allowed).toBe(false);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('spend cache', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T10:30:00.000Z'));
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'costBudget.enabled') return true;
        if (key === 'costBudget.cacheTtlMs') return 60000;
        return undefined;
      });
      dbMock.userCostBudget.findUnique.mockResolvedValue(
        makeBudget({ dailyLimitUsd: 1.0, monthlyLimitUsd: 20 }),
      );
      dbMock.aiAuditLog.aggregate.mockResolvedValue(makeAggregate(0.1));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reuses the cached spend within the TTL window — N checks produce one aggregate round', async () => {
      await service.checkBudget('user-1');
      await service.checkBudget('user-1');
      await service.checkBudget('user-1');

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledTimes(2);
    });

    it('refreshes with a new aggregate round once the TTL expires', async () => {
      await service.checkBudget('user-1');
      jest.advanceTimersByTime(60001);
      await service.checkBudget('user-1');

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledTimes(4);
    });

    it('invalidates the cache immediately on updateBudget()', async () => {
      await service.checkBudget('user-1');
      dbMock.userCostBudget.update.mockResolvedValue(makeBudget({ dailyLimitUsd: 2.0 }));

      await service.updateBudget('pub-uuid-001', { dailyLimitUsd: 2.0 });
      await service.checkBudget('user-1');

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledTimes(4);
    });

    it('invalidates the cache immediately on deleteBudget()', async () => {
      await service.checkBudget('user-1');
      dbMock.userCostBudget.delete.mockResolvedValue(makeBudget());

      await service.deleteBudget('pub-uuid-001');
      await service.checkBudget('user-1');

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledTimes(4);
    });

    it('invalidates the cache immediately on createBudget()', async () => {
      await service.checkBudget('user-1');
      dbMock.userCostBudget.create.mockResolvedValue(makeBudget());

      await service.createBudget({ userId: 'user-1' });
      await service.checkBudget('user-1');

      expect(dbMock.aiAuditLog.aggregate).toHaveBeenCalledTimes(4);
    });
  });

  describe('getUsersApproachingLimit()', () => {
    it('returns an empty array when no budgets have any limit set', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([]);

      const result = await service.getUsersApproachingLimit();

      expect(result).toEqual([]);
    });

    it('queries only active budgets with at least one non-null limit', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([]);

      await service.getUsersApproachingLimit();

      expect(dbMock.userCostBudget.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          OR: [{ dailyLimitUsd: { not: null } }, { monthlyLimitUsd: { not: null } }],
        },
      });
    });

    it('returns users at/above the alert threshold, tagged with the triggering dimension', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([
        makeBudget({
          userId: 'user-1',
          dailyLimitUsd: 1.0,
          monthlyLimitUsd: null,
          alertThreshold: 0.8,
        }),
        makeBudget({
          userId: 'user-2',
          dailyLimitUsd: null,
          monthlyLimitUsd: 20,
          alertThreshold: 0.8,
        }),
        makeBudget({
          userId: 'user-3',
          dailyLimitUsd: 1.0,
          monthlyLimitUsd: 20,
          alertThreshold: 0.5,
        }),
      ]);
      dbMock.aiAuditLog.aggregate
        // user-1: daily 90% (triggers), monthly n/a
        .mockResolvedValueOnce(makeAggregate(0.9))
        .mockResolvedValueOnce(makeAggregate(0))
        // user-2: daily n/a, monthly 90% (triggers)
        .mockResolvedValueOnce(makeAggregate(0))
        .mockResolvedValueOnce(makeAggregate(18))
        // user-3: daily 20%, monthly 25% — both under its 50% threshold
        .mockResolvedValueOnce(makeAggregate(0.2))
        .mockResolvedValueOnce(makeAggregate(5));

      const result = await service.getUsersApproachingLimit();

      expect(result).toHaveLength(2);
      expect(result.find((a) => a.userId === 'user-1')?.triggeredBy).toBe('daily');
      expect(result.find((a) => a.userId === 'user-2')?.triggeredBy).toBe('monthly');
    });

    it('honors an explicit threshold override instead of the budget alertThreshold', async () => {
      dbMock.userCostBudget.findMany.mockResolvedValue([
        makeBudget({
          userId: 'user-1',
          dailyLimitUsd: 1.0,
          monthlyLimitUsd: null,
          alertThreshold: 0.8,
        }),
      ]);
      dbMock.aiAuditLog.aggregate
        .mockResolvedValueOnce(makeAggregate(0.3))
        .mockResolvedValueOnce(makeAggregate(0));

      const result = await service.getUsersApproachingLimit(0.2);

      expect(result).toHaveLength(1);
    });
  });
});
