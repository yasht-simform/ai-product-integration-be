import { executeDatetime } from '../tools/datetime.tool';

describe('executeDatetime()', () => {
  describe('operation: now (default)', () => {
    it('returns the current datetime and timezone for a valid IANA timezone', () => {
      const result = executeDatetime({ timezone: 'Asia/Kolkata' });

      expect(result.timezone).toBe('Asia/Kolkata');
      expect(typeof result.datetime).toBe('string');
      expect(result.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('defaults to "now" when operation is omitted', () => {
      const result = executeDatetime({ timezone: 'UTC' });
      expect(result.timezone).toBe('UTC');
    });

    it('throws a clear error for an invalid timezone', () => {
      expect(() => executeDatetime({ timezone: 'Not/AZone' })).toThrow(/Invalid timezone/);
    });

    it('throws when timezone is missing', () => {
      expect(() => executeDatetime({ timezone: '' })).toThrow('timezone is required');
    });
  });

  describe('operation: diff', () => {
    it('returns the correct day and millisecond difference for two ISO dates', () => {
      const result = executeDatetime({
        timezone: 'UTC',
        operation: 'diff',
        date1: '2026-01-01T00:00:00Z',
        date2: '2026-01-10T00:00:00Z',
      });

      expect(result).toMatchObject({ diffDays: 9, diffMs: 9 * 24 * 60 * 60 * 1000 });
    });

    it('throws when date1 or date2 is missing', () => {
      expect(() =>
        executeDatetime({ timezone: 'UTC', operation: 'diff', date1: '2026-01-01' }),
      ).toThrow(/date1 and date2 are required/);
    });

    it('throws a clear error for an unparseable date1', () => {
      expect(() =>
        executeDatetime({
          timezone: 'UTC',
          operation: 'diff',
          date1: 'not-a-date',
          date2: '2026-01-10T00:00:00Z',
        }),
      ).toThrow(/Invalid date1/);
    });

    it('throws a clear error for an unparseable date2', () => {
      expect(() =>
        executeDatetime({
          timezone: 'UTC',
          operation: 'diff',
          date1: '2026-01-01T00:00:00Z',
          date2: 'not-a-date',
        }),
      ).toThrow(/Invalid date2/);
    });

    it('throws a clear error for an invalid timezone', () => {
      expect(() =>
        executeDatetime({
          timezone: 'Not/AZone',
          operation: 'diff',
          date1: '2026-01-01T00:00:00Z',
          date2: '2026-01-10T00:00:00Z',
        }),
      ).toThrow(/Invalid timezone/);
    });
  });

  it('throws for an unknown operation', () => {
    expect(() => executeDatetime({ timezone: 'UTC', operation: 'bogus' as never })).toThrow(
      /Unknown operation/,
    );
  });
});
