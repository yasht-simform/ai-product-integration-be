import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBudgetDto } from '../dto/create-budget.dto';
import { DailyTrendQueryDto } from '../dto/daily-trend-query.dto';
import { QueryBudgetsDto } from '../dto/query-budgets.dto';
import { SpendAnalyticsQueryDto } from '../dto/spend-analytics-query.dto';
import { SpendByFeatureQueryDto } from '../dto/spend-by-feature-query.dto';
import { SpendByModelQueryDto } from '../dto/spend-by-model-query.dto';
import { SpendByUserQueryDto } from '../dto/spend-by-user-query.dto';
import { SpendTimelineQueryDto } from '../dto/spend-timeline-query.dto';
import { UpdateBudgetDto } from '../dto/update-budget.dto';
import { UpdateRetentionConfigDto } from '../dto/update-retention-config.dto';

describe('CreateBudgetDto validation', () => {
  it('rejects a payload missing userId', async () => {
    const dto = plainToInstance(CreateBudgetDto, { dailyLimitUsd: 10 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'userId')).toBe(true);
  });

  it('rejects a negative dailyLimitUsd and an out-of-range alertThreshold', async () => {
    const dto = plainToInstance(CreateBudgetDto, {
      userId: 'user-1',
      dailyLimitUsd: -5,
      alertThreshold: 1.5,
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'dailyLimitUsd')).toBe(true);
    expect(errors.some((e) => e.property === 'alertThreshold')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(CreateBudgetDto, {
      userId: 'user-1',
      dailyLimitUsd: 10,
      monthlyLimitUsd: 200,
      alertThreshold: 0.9,
      isActive: true,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateBudgetDto validation', () => {
  it('rejects userId — not part of the update surface', async () => {
    // Mirrors main.ts's ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) — plain
    // validate() ignores properties without decorators, so it needs these options to reproduce
    // the app's actual "unknown field" rejection.
    const dto = plainToInstance(UpdateBudgetDto, { userId: 'user-2' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'userId')).toBe(true);
  });

  it('accepts a partial dailyLimitUsd-only update', async () => {
    const dto = plainToInstance(UpdateBudgetDto, { dailyLimitUsd: 25 });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryBudgetsDto validation', () => {
  it('rejects a non-integer page', async () => {
    const dto = plainToInstance(QueryBudgetsDto, { page: 1.5 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(QueryBudgetsDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  // main.ts's global ValidationPipe sets `transformOptions: { enableImplicitConversion: true }` —
  // plain plainToInstance() without that option does NOT reproduce class-transformer's real
  // PLAIN_TO_CLASS ordering (implicit Boolean(value) coercion runs before any @Transform sees the
  // value), so these two tests pass it explicitly. Regression tests for AI-071's finding, fixed
  // here for isActive in AI-072 via the shared transformQueryBoolean util.
  it('coerces isActive=true from a query-string boolean', async () => {
    const dto = plainToInstance(
      QueryBudgetsDto,
      { isActive: 'true' },
      { enableImplicitConversion: true },
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(true);
  });

  it('coerces isActive=false correctly — naive Boolean("false") would wrongly be true', async () => {
    const dto = plainToInstance(
      QueryBudgetsDto,
      { isActive: 'false' },
      { enableImplicitConversion: true },
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
  });
});

describe('UpdateRetentionConfigDto validation (AI-073)', () => {
  it('rejects a cron field — not part of the update surface (AI-070)', async () => {
    // Mirrors main.ts's ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) — the DTO
    // declares no cron property at all, so a client-supplied cron key is rejected as unknown.
    const dto = plainToInstance(UpdateRetentionConfigDto, { cron: '*/5 * * * *' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'cron')).toBe(true);
  });

  it('rejects a non-positive-integer day field', async () => {
    const dto = plainToInstance(UpdateRetentionConfigDto, { auditDays: 0 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'auditDays')).toBe(true);
  });

  it('accepts a partial, fully valid payload', async () => {
    const dto = plainToInstance(UpdateRetentionConfigDto, {
      auditDays: 7,
      embeddingCacheDays: 60,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(UpdateRetentionConfigDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SpendAnalyticsQueryDto validation (AI-074 audit — previously uncovered)', () => {
  it('rejects a non-ISO startDate', async () => {
    const dto = plainToInstance(SpendAnalyticsQueryDto, { startDate: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('accepts a valid ISO date range', async () => {
    const dto = plainToInstance(SpendAnalyticsQueryDto, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SpendByUserQueryDto validation (AI-074 audit — previously uncovered)', () => {
  it('rejects an out-of-range limit and an invalid sortOrder', async () => {
    const dto = plainToInstance(SpendByUserQueryDto, { limit: 500, sortOrder: 'sideways' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'limit')).toBe(true);
    expect(errors.some((e) => e.property === 'sortOrder')).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(SpendByUserQueryDto, {
      page: 2,
      limit: 50,
      sortOrder: 'asc',
      startDate: '2026-01-01',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SpendByModelQueryDto validation (AI-074 audit — previously uncovered)', () => {
  it('rejects a non-ISO endDate (inherited from SpendAnalyticsQueryDto)', async () => {
    const dto = plainToInstance(SpendByModelQueryDto, { endDate: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'endDate')).toBe(true);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(SpendByModelQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SpendByFeatureQueryDto validation (AI-074 audit — previously uncovered)', () => {
  it('rejects a non-ISO startDate (inherited from SpendAnalyticsQueryDto)', async () => {
    const dto = plainToInstance(SpendByFeatureQueryDto, { startDate: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('accepts a valid date range', async () => {
    const dto = plainToInstance(SpendByFeatureQueryDto, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('SpendTimelineQueryDto validation (AI-074 audit — previously uncovered)', () => {
  it('rejects a non-string userId', async () => {
    const dto = plainToInstance(SpendTimelineQueryDto, { userId: 12345 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'userId')).toBe(true);
  });

  it('accepts a valid userId alongside a date range', async () => {
    const dto = plainToInstance(SpendTimelineQueryDto, {
      userId: 'user-1',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('DailyTrendQueryDto validation (AI-073)', () => {
  it('rejects a non-positive days value', async () => {
    const dto = plainToInstance(DailyTrendQueryDto, { days: 0 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'days')).toBe(true);
  });

  it('accepts an empty payload — days is optional, service applies the default', async () => {
    const dto = plainToInstance(DailyTrendQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a valid positive days value', async () => {
    const dto = plainToInstance(DailyTrendQueryDto, { days: 90 });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
