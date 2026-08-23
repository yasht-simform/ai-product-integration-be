import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CheckBatchModerationDto } from '../dto/check-batch-moderation.dto';
import { CheckModerationDto } from '../dto/check-moderation.dto';
import { ModerationStatsQueryDto } from '../dto/moderation-stats-query.dto';
import { QueryModerationLogsDto } from '../dto/query-moderation-logs.dto';

describe('CheckModerationDto validation', () => {
  it('rejects a missing text field', async () => {
    const dto = plainToInstance(CheckModerationDto, {});

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'text')).toBe(true);
  });

  it('rejects an empty-string text field', async () => {
    const dto = plainToInstance(CheckModerationDto, { text: '' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'text')).toBe(true);
  });

  it('accepts a valid payload with an optional source', async () => {
    const dto = plainToInstance(CheckModerationDto, { text: 'hello', source: 'chat' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('CheckBatchModerationDto validation', () => {
  it('rejects an empty texts array', async () => {
    const dto = plainToInstance(CheckBatchModerationDto, { texts: [] });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'texts')).toBe(true);
  });

  it('rejects a texts array over the 50-item cap', async () => {
    const dto = plainToInstance(CheckBatchModerationDto, {
      texts: Array.from({ length: 51 }, (_, i) => `text-${i}`),
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'texts')).toBe(true);
  });

  it('rejects a non-string entry', async () => {
    const dto = plainToInstance(CheckBatchModerationDto, { texts: ['a', 123] });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'texts')).toBe(true);
  });

  it('accepts a valid non-empty array within the cap', async () => {
    const dto = plainToInstance(CheckBatchModerationDto, { texts: ['a', 'b', 'c'] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryModerationLogsDto validation', () => {
  it('rejects an invalid direction', async () => {
    const dto = plainToInstance(QueryModerationLogsDto, { direction: 'sideways' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'direction')).toBe(true);
  });

  it('rejects a non-integer page', async () => {
    const dto = plainToInstance(QueryModerationLogsDto, { page: 1.5 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  // main.ts's global ValidationPipe sets `transformOptions: { enableImplicitConversion: true }` —
  // plain plainToInstance() without that option does NOT reproduce class-transformer's real
  // PLAIN_TO_CLASS ordering (implicit Boolean(value) coercion runs before any @Transform sees the
  // value), so these two tests pass it explicitly to match the app's actual runtime behavior.
  it('coerces isFlagged=true from a query-string boolean', async () => {
    const dto = plainToInstance(
      QueryModerationLogsDto,
      { isFlagged: 'true' },
      { enableImplicitConversion: true },
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isFlagged).toBe(true);
  });

  it('coerces isFlagged=false correctly — naive Boolean("false") would wrongly be true', async () => {
    const dto = plainToInstance(
      QueryModerationLogsDto,
      { isFlagged: 'false' },
      { enableImplicitConversion: true },
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.isFlagged).toBe(false);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(QueryModerationLogsDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('ModerationStatsQueryDto validation', () => {
  it('rejects a non-ISO-8601 startDate', async () => {
    const dto = plainToInstance(ModerationStatsQueryDto, { startDate: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(ModerationStatsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
