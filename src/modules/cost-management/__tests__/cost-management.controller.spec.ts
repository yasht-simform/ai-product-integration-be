import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { CostManagementController } from '../cost-management.controller';
import { CostAnalyticsService } from '../services/cost-analytics.service';
import { CostBudgetService } from '../services/cost-budget.service';
import type {
  BudgetAlertDto,
  BudgetCheckResult,
  BudgetEntity,
  ProjectedSpendResult,
  SpendByFeatureResult,
  SpendByModelResult,
  SpendByUserResult,
  SpendTimelineResult,
} from '../types/cost-management.types';

// CostManagementController imports CostAnalyticsService/CostBudgetService, which import
// DatabaseService → the Prisma-generated ESM client (import.meta.url) — must be hoisted before
// any transitive import of it.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

function makeBudgetEntity(overrides: Partial<BudgetEntity> = {}): BudgetEntity {
  return {
    publicId: 'budget-pub-1',
    userId: 'user-1',
    dailyLimitUsd: 1,
    monthlyLimitUsd: 20,
    alertThreshold: 0.8,
    isActive: true,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCheckResult(overrides: Partial<BudgetCheckResult> = {}): BudgetCheckResult {
  return {
    allowed: true,
    dailySpend: 0.45,
    monthlySpend: 8.75,
    dailyLimit: 1,
    monthlyLimit: 20,
    dailyPercentage: 45,
    monthlyPercentage: 43.75,
    ...overrides,
  };
}

describe('CostManagementController (budget routes AI-072, analytics routes AI-073)', () => {
  let controller: CostManagementController;
  let budgetMock: {
    createBudget: jest.Mock;
    findAllBudgets: jest.Mock;
    findBudgetByUserId: jest.Mock;
    checkBudget: jest.Mock;
    updateBudget: jest.Mock;
    deleteBudget: jest.Mock;
    getUsersApproachingLimit: jest.Mock;
  };
  let analyticsMock: {
    getSpendByUser: jest.Mock;
    getSpendByModel: jest.Mock;
    getSpendByFeature: jest.Mock;
    getSpendTimeline: jest.Mock;
    getDailySpendTrend: jest.Mock;
    getProjectedMonthlySpend: jest.Mock;
  };

  beforeEach(async () => {
    budgetMock = {
      createBudget: jest.fn(),
      findAllBudgets: jest.fn(),
      findBudgetByUserId: jest.fn(),
      checkBudget: jest.fn(),
      updateBudget: jest.fn(),
      deleteBudget: jest.fn(),
      getUsersApproachingLimit: jest.fn(),
    };
    analyticsMock = {
      getSpendByUser: jest.fn(),
      getSpendByModel: jest.fn(),
      getSpendByFeature: jest.fn(),
      getSpendTimeline: jest.fn(),
      getDailySpendTrend: jest.fn(),
      getProjectedMonthlySpend: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CostManagementController],
      providers: [
        { provide: CostAnalyticsService, useValue: analyticsMock },
        { provide: CostBudgetService, useValue: budgetMock },
      ],
    }).compile();

    controller = module.get<CostManagementController>(CostManagementController);
  });

  describe('route ordering (AI-072)', () => {
    it('declares budgets/alerts before budgets/:userId so "alerts" never matches as a userId', () => {
      const proto = CostManagementController.prototype;

      // NestJS registers routes in method-declaration order; Object.getOwnPropertyNames()
      // preserves that order for string-keyed prototype members. This test must fail if
      // someone reorders the methods.
      const methodNames = Object.getOwnPropertyNames(proto);
      const alertsIndex = methodNames.indexOf('getBudgetAlerts');
      const statusIndex = methodNames.indexOf('getBudgetStatus');
      expect(alertsIndex).toBeGreaterThan(-1);
      expect(statusIndex).toBeGreaterThan(-1);
      expect(alertsIndex).toBeLessThan(statusIndex);

      // Pin the actual paths too, so a rename doesn't silently vacate the ordering assertion.
      expect(Reflect.getMetadata('path', proto.getBudgetAlerts)).toBe('budgets/alerts');
      expect(Reflect.getMetadata('path', proto.getBudgetStatus)).toBe('budgets/:userId');
    });

    it('routes an "alerts" path segment to the alerts service method, never the budget lookup', async () => {
      budgetMock.getUsersApproachingLimit.mockResolvedValue([]);

      await controller.getBudgetAlerts();

      expect(budgetMock.getUsersApproachingLimit).toHaveBeenCalledTimes(1);
      expect(budgetMock.findBudgetByUserId).not.toHaveBeenCalled();
      expect(budgetMock.checkBudget).not.toHaveBeenCalled();
    });
  });

  describe('createBudget()', () => {
    it('delegates the DTO and maps the entity to the response shape', async () => {
      budgetMock.createBudget.mockResolvedValue(makeBudgetEntity());
      const dto = { userId: 'user-1', dailyLimitUsd: 1, monthlyLimitUsd: 20 };

      const response = await controller.createBudget(dto);

      expect(budgetMock.createBudget).toHaveBeenCalledWith(dto);
      expect(response).toEqual(
        expect.objectContaining({ publicId: 'budget-pub-1', userId: 'user-1', dailyLimitUsd: 1 }),
      );
    });

    it('maps null limits to undefined (unlimited budget)', async () => {
      budgetMock.createBudget.mockResolvedValue(
        makeBudgetEntity({ dailyLimitUsd: null, monthlyLimitUsd: null }),
      );

      const response = await controller.createBudget({ userId: 'user-1' });

      expect(response.dailyLimitUsd).toBeUndefined();
      expect(response.monthlyLimitUsd).toBeUndefined();
    });
  });

  describe('findAllBudgets()', () => {
    it('delegates the query and maps every row', async () => {
      budgetMock.findAllBudgets.mockResolvedValue({
        data: [makeBudgetEntity({ monthlyLimitUsd: null })],
        total: 1,
        page: 1,
        limit: 20,
      });

      const response = await controller.findAllBudgets({ isActive: true });

      expect(budgetMock.findAllBudgets).toHaveBeenCalledWith({ isActive: true });
      expect(response.total).toBe(1);
      expect(response.data[0]?.monthlyLimitUsd).toBeUndefined();
    });
  });

  describe('getBudgetAlerts()', () => {
    it('maps alert rows, converting null limits to undefined', async () => {
      const alert: BudgetAlertDto = {
        userId: 'user-1',
        dailySpend: 0.9,
        monthlySpend: 5,
        dailyLimit: 1,
        monthlyLimit: null,
        dailyPercentage: 90,
        monthlyPercentage: 0,
        triggeredBy: 'daily',
      };
      budgetMock.getUsersApproachingLimit.mockResolvedValue([alert]);

      const response = await controller.getBudgetAlerts();

      expect(response).toHaveLength(1);
      expect(response[0]).toEqual(
        expect.objectContaining({ userId: 'user-1', triggeredBy: 'daily', dailyPercentage: 90 }),
      );
      expect(response[0]?.monthlyLimit).toBeUndefined();
    });
  });

  describe('getBudgetStatus()', () => {
    it('composes budget + spend into the status shape (within_budget)', async () => {
      budgetMock.findBudgetByUserId.mockResolvedValue(makeBudgetEntity());
      budgetMock.checkBudget.mockResolvedValue(makeCheckResult());

      const response = await controller.getBudgetStatus('user-1');

      expect(budgetMock.findBudgetByUserId).toHaveBeenCalledWith('user-1');
      expect(budgetMock.checkBudget).toHaveBeenCalledWith('user-1');
      expect(response).toEqual({
        userId: 'user-1',
        dailySpend: 0.45,
        monthlySpend: 8.75,
        dailyLimit: 1,
        monthlyLimit: 20,
        dailyPercentage: 45,
        monthlyPercentage: 43.75,
        status: 'within_budget',
        warning: undefined,
      });
    });

    it('derives approaching_limit when the check carries a warning', async () => {
      budgetMock.findBudgetByUserId.mockResolvedValue(makeBudgetEntity());
      budgetMock.checkBudget.mockResolvedValue(
        makeCheckResult({
          dailySpend: 0.85,
          dailyPercentage: 85,
          warning: 'Approaching daily limit (85%)',
        }),
      );

      const response = await controller.getBudgetStatus('user-1');

      expect(response.status).toBe('approaching_limit');
      expect(response.warning).toBe('Approaching daily limit (85%)');
    });

    it('derives exceeded when the check is not allowed', async () => {
      budgetMock.findBudgetByUserId.mockResolvedValue(makeBudgetEntity());
      budgetMock.checkBudget.mockResolvedValue(
        makeCheckResult({ allowed: false, dailySpend: 1.2, dailyPercentage: 120 }),
      );

      const response = await controller.getBudgetStatus('user-1');

      expect(response.status).toBe('exceeded');
    });

    it('shows the configured limits even when checkBudget() reports null (enforcement disabled)', async () => {
      budgetMock.findBudgetByUserId.mockResolvedValue(makeBudgetEntity({ isActive: false }));
      budgetMock.checkBudget.mockResolvedValue(
        makeCheckResult({ dailySpend: 0, monthlySpend: 0, dailyLimit: null, monthlyLimit: null }),
      );

      const response = await controller.getBudgetStatus('user-1');

      expect(response.dailyLimit).toBe(1);
      expect(response.monthlyLimit).toBe(20);
    });

    it('throws NotFoundException (and never calls checkBudget) when no budget exists', async () => {
      budgetMock.findBudgetByUserId.mockResolvedValue(null);

      await expect(controller.getBudgetStatus('nobody')).rejects.toThrow(NotFoundException);
      expect(budgetMock.checkBudget).not.toHaveBeenCalled();
    });
  });

  describe('updateBudget()', () => {
    it('delegates publicId + DTO and maps the updated entity', async () => {
      budgetMock.updateBudget.mockResolvedValue(makeBudgetEntity({ dailyLimitUsd: 5 }));

      const response = await controller.updateBudget('budget-pub-1', { dailyLimitUsd: 5 });

      expect(budgetMock.updateBudget).toHaveBeenCalledWith('budget-pub-1', { dailyLimitUsd: 5 });
      expect(response.dailyLimitUsd).toBe(5);
    });

    it('propagates NotFoundException from the service', async () => {
      budgetMock.updateBudget.mockRejectedValue(new NotFoundException());

      await expect(controller.updateBudget('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteBudget()', () => {
    it('delegates the publicId and resolves to void', async () => {
      budgetMock.deleteBudget.mockResolvedValue(undefined);

      await expect(controller.deleteBudget('budget-pub-1')).resolves.toBeUndefined();
      expect(budgetMock.deleteBudget).toHaveBeenCalledWith('budget-pub-1');
    });
  });

  describe('getSpendByUser()', () => {
    it('delegates the query DTO to CostAnalyticsService.getSpendByUser() verbatim', async () => {
      const result: SpendByUserResult = {
        data: [{ userId: 'user-1', totalCost: 5, totalTokens: 100, callCount: 2 }],
        total: 1,
        page: 1,
        limit: 20,
      };
      analyticsMock.getSpendByUser.mockResolvedValue(result);

      const response = await controller.getSpendByUser({ page: 2, limit: 10, sortOrder: 'asc' });

      expect(analyticsMock.getSpendByUser).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        sortOrder: 'asc',
      });
      expect(response).toBe(result);
    });
  });

  describe('getSpendByModel()', () => {
    it('delegates to CostAnalyticsService.getSpendByModel()', async () => {
      const result: SpendByModelResult = { data: [] };
      analyticsMock.getSpendByModel.mockResolvedValue(result);

      const response = await controller.getSpendByModel({});

      expect(analyticsMock.getSpendByModel).toHaveBeenCalledWith({});
      expect(response).toBe(result);
    });
  });

  describe('getSpendByFeature()', () => {
    it('delegates to CostAnalyticsService.getSpendByFeature()', async () => {
      const result: SpendByFeatureResult = { data: [] };
      analyticsMock.getSpendByFeature.mockResolvedValue(result);

      const response = await controller.getSpendByFeature({});

      expect(analyticsMock.getSpendByFeature).toHaveBeenCalledWith({});
      expect(response).toBe(result);
    });
  });

  describe('getSpendTimeline()', () => {
    it('delegates the date-range query to CostAnalyticsService.getSpendTimeline()', async () => {
      const result: SpendTimelineResult = { data: [] };
      analyticsMock.getSpendTimeline.mockResolvedValue(result);
      const query = { startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-07-02T00:00:00.000Z' };

      const response = await controller.getSpendTimeline(query);

      expect(analyticsMock.getSpendTimeline).toHaveBeenCalledWith(query);
      expect(response).toBe(result);
    });
  });

  describe('getDailySpendTrend()', () => {
    it('passes query.days through as a positional argument', async () => {
      const result: SpendTimelineResult = { data: [] };
      analyticsMock.getDailySpendTrend.mockResolvedValue(result);

      const response = await controller.getDailySpendTrend({ days: 7 });

      expect(analyticsMock.getDailySpendTrend).toHaveBeenCalledWith(7);
      expect(response).toBe(result);
    });

    it('passes undefined through when days is omitted, letting the service apply its own default', async () => {
      const result: SpendTimelineResult = { data: [] };
      analyticsMock.getDailySpendTrend.mockResolvedValue(result);

      await controller.getDailySpendTrend({});

      expect(analyticsMock.getDailySpendTrend).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getProjectedMonthlySpend()', () => {
    it('delegates to CostAnalyticsService.getProjectedMonthlySpend() with no arguments', async () => {
      const result: ProjectedSpendResult = {
        monthToDate: 5,
        dailyAverage: 0.5,
        daysElapsed: 10,
        daysInMonth: 31,
        projected: 15.5,
      };
      analyticsMock.getProjectedMonthlySpend.mockResolvedValue(result);

      const response = await controller.getProjectedMonthlySpend();

      expect(analyticsMock.getProjectedMonthlySpend).toHaveBeenCalledWith();
      expect(response).toBe(result);
    });
  });
});
