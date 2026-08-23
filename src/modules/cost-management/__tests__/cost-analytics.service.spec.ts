import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { CostAnalyticsService } from '../services/cost-analytics.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
// by substituting an empty class for the DI token.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

interface GroupRow {
  userId?: string | null;
  model?: string;
  endpoint?: string;
  estimatedCost: number | null;
  totalTokens: number | null;
  count: number;
}

function makeGroups(rows: GroupRow[]) {
  return rows.map((row) => ({
    ...(row.userId !== undefined ? { userId: row.userId } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.endpoint !== undefined ? { endpoint: row.endpoint } : {}),
    _sum: { estimatedCost: row.estimatedCost, totalTokens: row.totalTokens },
    _count: { _all: row.count },
  })) as never;
}

describe('CostAnalyticsService', () => {
  let service: CostAnalyticsService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostAnalyticsService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<CostAnalyticsService>(CostAnalyticsService);
    jest.clearAllMocks();
  });

  describe('getSpendByUser()', () => {
    it('groups by userId with status SUCCESS, spend-desc order, and pagination', async () => {
      dbMock.aiAuditLog.groupBy
        .mockResolvedValueOnce(
          makeGroups([{ userId: 'user-1', estimatedCost: 5.5, totalTokens: 1000, count: 3 }]),
        )
        .mockResolvedValueOnce(
          makeGroups([
            { userId: 'user-1', estimatedCost: 5.5, totalTokens: 1000, count: 3 },
            { userId: 'user-2', estimatedCost: 1, totalTokens: 200, count: 1 },
          ]),
        );

      const result = await service.getSpendByUser({ page: 2, limit: 10 });

      expect(dbMock.aiAuditLog.groupBy).toHaveBeenCalledTimes(2);
      expect(dbMock.aiAuditLog.groupBy).toHaveBeenNthCalledWith(1, {
        by: ['userId'],
        where: { status: AiAuditStatus.SUCCESS },
        _sum: { estimatedCost: true, totalTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { estimatedCost: 'desc' } },
        skip: 10,
        take: 10,
      });
      expect(result).toEqual({
        data: [{ userId: 'user-1', totalCost: 5.5, totalTokens: 1000, callCount: 3 }],
        total: 2,
        page: 2,
        limit: 10,
      });
    });

    it('maps a null userId to the anonymous bucket', async () => {
      dbMock.aiAuditLog.groupBy
        .mockResolvedValueOnce(
          makeGroups([{ userId: null, estimatedCost: 2, totalTokens: 50, count: 4 }]),
        )
        .mockResolvedValueOnce(
          makeGroups([{ userId: null, estimatedCost: 2, totalTokens: 50, count: 4 }]),
        );

      const result = await service.getSpendByUser({});

      expect(result.data[0]?.userId).toBe('anonymous');
    });

    it('honours ascending sort and default page/limit', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(makeGroups([]));

      await service.getSpendByUser({ sortOrder: 'asc' });

      expect(dbMock.aiAuditLog.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          orderBy: { _sum: { estimatedCost: 'asc' } },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('applies the startDate/endDate range filter', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(makeGroups([]));

      await service.getSpendByUser({
        startDate: '2026-07-01T00:00:00Z',
        endDate: '2026-07-31T23:59:59Z',
      });

      expect(dbMock.aiAuditLog.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            status: AiAuditStatus.SUCCESS,
            createdAt: {
              gte: new Date('2026-07-01T00:00:00Z'),
              lte: new Date('2026-07-31T23:59:59Z'),
            },
          },
        }),
      );
    });

    it('returns an empty page with zeroed total for an empty table (never NaN)', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(makeGroups([]));

      const result = await service.getSpendByUser({});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('coerces null aggregate sums to zero', async () => {
      dbMock.aiAuditLog.groupBy
        .mockResolvedValueOnce(
          makeGroups([{ userId: 'user-1', estimatedCost: null, totalTokens: null, count: 0 }]),
        )
        .mockResolvedValueOnce(
          makeGroups([{ userId: 'user-1', estimatedCost: null, totalTokens: null, count: 0 }]),
        );

      const result = await service.getSpendByUser({});

      expect(result.data[0]).toEqual({
        userId: 'user-1',
        totalCost: 0,
        totalTokens: 0,
        callCount: 0,
      });
    });
  });

  describe('getSpendByModel()', () => {
    it('groups by model with status SUCCESS and spend-desc order', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(
        makeGroups([{ model: 'gpt-4o', estimatedCost: 9, totalTokens: 3000, count: 5 }]),
      );

      const result = await service.getSpendByModel({});

      expect(dbMock.aiAuditLog.groupBy).toHaveBeenCalledWith({
        by: ['model'],
        where: { status: AiAuditStatus.SUCCESS },
        _sum: { estimatedCost: true, totalTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { estimatedCost: 'desc' } },
      });
      expect(result).toEqual({
        data: [{ model: 'gpt-4o', totalCost: 9, totalTokens: 3000, callCount: 5 }],
      });
    });

    it('returns an empty array for an empty table', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(makeGroups([]));

      const result = await service.getSpendByModel({});

      expect(result).toEqual({ data: [] });
    });
  });

  describe('getSpendByFeature()', () => {
    it('groups by endpoint and maps each endpoint to its feature label', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(
        makeGroups([
          { endpoint: 'chat.completions', estimatedCost: 8, totalTokens: 2000, count: 4 },
          { endpoint: 'embeddings', estimatedCost: 1, totalTokens: 500, count: 2 },
          { endpoint: 'moderations', estimatedCost: 0, totalTokens: 0, count: 6 },
        ]),
      );

      const result = await service.getSpendByFeature({});

      expect(dbMock.aiAuditLog.groupBy).toHaveBeenCalledWith({
        by: ['endpoint'],
        where: { status: AiAuditStatus.SUCCESS },
        _sum: { estimatedCost: true, totalTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { estimatedCost: 'desc' } },
      });
      expect(result.data).toEqual([
        {
          feature: 'chat',
          endpoint: 'chat.completions',
          totalCost: 8,
          totalTokens: 2000,
          callCount: 4,
        },
        {
          feature: 'embeddings',
          endpoint: 'embeddings',
          totalCost: 1,
          totalTokens: 500,
          callCount: 2,
        },
        {
          feature: 'moderations',
          endpoint: 'moderations',
          totalCost: 0,
          totalTokens: 0,
          callCount: 6,
        },
      ]);
    });

    it('falls back to the raw endpoint for an unmapped value', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(
        makeGroups([{ endpoint: 'responses', estimatedCost: 3, totalTokens: 100, count: 1 }]),
      );

      const result = await service.getSpendByFeature({});

      expect(result.data[0]?.feature).toBe('responses');
    });

    it('returns an empty array for an empty table', async () => {
      dbMock.aiAuditLog.groupBy.mockResolvedValue(makeGroups([]));

      const result = await service.getSpendByFeature({});

      expect(result).toEqual({ data: [] });
    });
  });

  describe('getSpendTimeline()', () => {
    it('zero-fills gap days and normalizes Decimal/bigint aggregates to numbers', async () => {
      // Rows for 07-01 and 07-03 — 07-02 is missing and must be filled as a zero bucket. `day` is
      // plain 'YYYY-MM-DD' text (to_char() in the real query), matching what Postgres actually
      // returns — see the timezone-safety test below for why this matters.
      dbMock.$queryRaw.mockResolvedValue([
        {
          day: '2026-07-01',
          totalCost: { toString: () => '2.5' }, // Decimal-like
          totalTokens: 100n, // bigint
          callCount: 3n,
        },
        {
          day: '2026-07-03',
          totalCost: 1,
          totalTokens: 20,
          callCount: 1,
        },
      ] as never);

      const result = await service.getSpendTimeline({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-03T00:00:00.000Z',
      });

      expect(result.data).toEqual([
        { date: '2026-07-01', totalCost: 2.5, totalTokens: 100, callCount: 3 },
        { date: '2026-07-02', totalCost: 0, totalTokens: 0, callCount: 0 },
        { date: '2026-07-03', totalCost: 1, totalTokens: 20, callCount: 1 },
      ]);
    });

    // AI-075 live finding: node-postgres parses a `timestamp without time zone` query result
    // assuming the Node process's *local* timezone, not UTC — a deployment running in a
    // non-UTC timezone (verified live in IST) saw a day's real spend silently vanish from its own
    // date bucket. Fixed by having the SQL itself return pre-formatted 'YYYY-MM-DD' text
    // (to_char()) instead of a raw timestamp, so no Date parsing (and therefore no timezone
    // ambiguity) is ever involved. This test's mock row deliberately looks nothing like a Date
    // object — it's the real shape a text column produces — so it can't silently regress back to
    // Date-based parsing without failing.
    it('buckets a text day value exactly, with no Date-parsing/timezone step involved', async () => {
      dbMock.$queryRaw.mockResolvedValue([
        { day: '2026-07-11', totalCost: 0.0109, totalTokens: 450, callCount: 3 },
      ] as never);

      const result = await service.getSpendTimeline({
        startDate: '2026-07-11T00:00:00.000Z',
        endDate: '2026-07-11T00:00:00.000Z',
      });

      expect(result.data).toEqual([
        { date: '2026-07-11', totalCost: 0.0109, totalTokens: 450, callCount: 3 },
      ]);
    });

    it('binds status + range as parameters and omits the user filter when no userId', async () => {
      dbMock.$queryRaw.mockResolvedValue([] as never);

      await service.getSpendTimeline({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-02T00:00:00.000Z',
      });

      const values = dbMock.$queryRaw.mock.calls[0]?.slice(1);
      expect(values).toEqual([
        AiAuditStatus.SUCCESS,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-02T00:00:00.000Z'),
      ]);
    });

    it('binds userId as a parameter when provided', async () => {
      dbMock.$queryRaw.mockResolvedValue([] as never);

      await service.getSpendTimeline({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-01T00:00:00.000Z',
        userId: 'user-9',
      });

      const values = dbMock.$queryRaw.mock.calls[0]?.slice(1);
      expect(values).toContain('user-9');
    });
  });

  describe('getDailySpendTrend()', () => {
    afterEach(() => jest.useRealTimers());

    it('produces one contiguous bucket per day for the requested window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
      dbMock.$queryRaw.mockResolvedValue([] as never);

      const result = await service.getDailySpendTrend(7);

      expect(result.data).toHaveLength(7);
      expect(result.data[0]?.date).toBe('2026-07-04');
      expect(result.data[6]?.date).toBe('2026-07-10');
      expect(result.data.every((point) => point.totalCost === 0)).toBe(true);
    });

    it('defaults to 30 days and clamps an over-large request to 365', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
      dbMock.$queryRaw.mockResolvedValue([] as never);

      expect((await service.getDailySpendTrend(0)).data).toHaveLength(30);
      expect((await service.getDailySpendTrend(10_000)).data).toHaveLength(365);
    });
  });

  describe('getProjectedMonthlySpend()', () => {
    afterEach(() => jest.useRealTimers());

    const stubMtd = (estimatedCost: number | null): void => {
      dbMock.aiAuditLog.aggregate.mockResolvedValue({ _sum: { estimatedCost } } as never);
    };

    it('projects MTD ÷ elapsed days × days-in-month (mid-month, 31-day month)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-10T09:00:00.000Z'));
      stubMtd(5);

      const result = await service.getProjectedMonthlySpend();

      expect(result).toEqual({
        monthToDate: 5,
        dailyAverage: 0.5,
        daysElapsed: 10,
        daysInMonth: 31,
        projected: 15.5,
      });
    });

    it('handles the first-of-month edge (1 day elapsed)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-01T00:30:00.000Z'));
      stubMtd(2);

      const result = await service.getProjectedMonthlySpend();

      expect(result.daysElapsed).toBe(1);
      expect(result.daysInMonth).toBe(31);
      expect(result.projected).toBe(62);
    });

    it('uses the correct day count for a 28-day month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-14T12:00:00.000Z'));
      stubMtd(7);

      const result = await service.getProjectedMonthlySpend();

      expect(result.daysElapsed).toBe(14);
      expect(result.daysInMonth).toBe(28);
      expect(result.projected).toBeCloseTo(14, 5);
    });

    it('returns projected 0 (never NaN) when there is no spend yet', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-10T09:00:00.000Z'));
      stubMtd(null);

      const result = await service.getProjectedMonthlySpend();

      expect(result.monthToDate).toBe(0);
      expect(result.dailyAverage).toBe(0);
      expect(result.projected).toBe(0);
      expect(Number.isNaN(result.projected)).toBe(false);
    });
  });
});
