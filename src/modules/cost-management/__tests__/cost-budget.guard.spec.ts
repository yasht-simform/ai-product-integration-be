import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { CostBudgetGuard } from '../guards/cost-budget.guard';
import type { CostBudgetService } from '../services/cost-budget.service';
import type { BudgetCheckResult } from '../types/cost-management.types';

// CostBudgetGuard imports CostBudgetService, which imports DatabaseService, which imports the
// Prisma-generated ESM client. Mocking DatabaseService prevents Jest (CommonJS) from loading
// import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

function makeContext(options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
}): { context: ExecutionContext; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const request = { body: options.body ?? {}, headers: options.headers ?? {} };
  const response = { setHeader };

  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => (): void => undefined,
    getClass: () => class Fake {},
  } as unknown as ExecutionContext;

  return { context, setHeader };
}

const allowedResult = (overrides: Partial<BudgetCheckResult> = {}): BudgetCheckResult => ({
  allowed: true,
  dailySpend: 0,
  monthlySpend: 0,
  dailyLimit: null,
  monthlyLimit: null,
  dailyPercentage: 0,
  monthlyPercentage: 0,
  ...overrides,
});

describe('CostBudgetGuard', () => {
  let guard: CostBudgetGuard;
  let costBudgetServiceMock: { checkBudget: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(() => {
    costBudgetServiceMock = { checkBudget: jest.fn().mockResolvedValue(allowedResult()) };
    configMock = {
      get: jest
        .fn()
        .mockImplementation((key: string) => (key === 'costBudget.enabled' ? true : undefined)),
    };

    guard = new CostBudgetGuard(
      costBudgetServiceMock as unknown as CostBudgetService,
      configMock as unknown as ConfigService,
    );
  });

  describe('kill switch and identity resolution', () => {
    it('passes with zero checkBudget() calls when costBudget.enabled is false', async () => {
      configMock.get.mockImplementation((key: string) =>
        key === 'costBudget.enabled' ? false : undefined,
      );
      const { context } = makeContext({ body: { userId: 'user-1' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(costBudgetServiceMock.checkBudget).not.toHaveBeenCalled();
    });

    it('passes with zero checkBudget() calls when no userId can be resolved', async () => {
      const { context } = makeContext({ body: {} });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(costBudgetServiceMock.checkBudget).not.toHaveBeenCalled();
    });

    it('resolves userId from the x-user-id header', async () => {
      const { context } = makeContext({ headers: { 'x-user-id': 'user-42' } });

      await guard.canActivate(context);

      expect(costBudgetServiceMock.checkBudget).toHaveBeenCalledWith('user-42');
    });

    it('falls back to body.userId when the header is absent', async () => {
      const { context } = makeContext({ body: { userId: 'user-7' } });

      await guard.canActivate(context);

      expect(costBudgetServiceMock.checkBudget).toHaveBeenCalledWith('user-7');
    });
  });

  describe('under-limit / no budget', () => {
    it('returns true and sets no warning header when allowed with no warning', async () => {
      const { context, setHeader } = makeContext({ body: { userId: 'user-1' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('threshold warning', () => {
    it('sets the X-Budget-Warning response header and still passes', async () => {
      costBudgetServiceMock.checkBudget.mockResolvedValue(
        allowedResult({ warning: 'Approaching daily limit (85%)' }),
      );
      const { context, setHeader } = makeContext({ body: { userId: 'user-1' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(setHeader).toHaveBeenCalledWith('X-Budget-Warning', 'Approaching daily limit (85%)');
    });
  });

  describe('over-limit blocking', () => {
    it('throws a 429 (never 403) when daily spend exceeds the daily limit', async () => {
      costBudgetServiceMock.checkBudget.mockResolvedValue({
        allowed: false,
        dailySpend: 1.02,
        monthlySpend: 3,
        dailyLimit: 1.0,
        monthlyLimit: 20,
        dailyPercentage: 102,
        monthlyPercentage: 15,
      });
      const { context } = makeContext({ body: { userId: 'user-1' } });

      let caught: unknown;
      try {
        await guard.canActivate(context);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HttpException);
      const exception = caught as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(exception.getResponse()).toBe('Daily budget exceeded ($1.02 of $1.00)');
    });

    it('throws a 429 naming the monthly dimension when only the monthly limit is exceeded', async () => {
      costBudgetServiceMock.checkBudget.mockResolvedValue({
        allowed: false,
        dailySpend: 0.1,
        monthlySpend: 20.5,
        dailyLimit: null,
        monthlyLimit: 20,
        dailyPercentage: 0,
        monthlyPercentage: 102.5,
      });
      const { context } = makeContext({ body: { userId: 'user-1' } });

      let caught: unknown;
      try {
        await guard.canActivate(context);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HttpException);
      const exception = caught as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(exception.getResponse()).toBe('Monthly budget exceeded ($20.50 of $20.00)');
    });

    it('never sets a warning header when blocked', async () => {
      costBudgetServiceMock.checkBudget.mockResolvedValue({
        allowed: false,
        dailySpend: 1.02,
        monthlySpend: 3,
        dailyLimit: 1.0,
        monthlyLimit: 20,
        dailyPercentage: 102,
        monthlyPercentage: 15,
      });
      const { context, setHeader } = makeContext({ body: { userId: 'user-1' } });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
