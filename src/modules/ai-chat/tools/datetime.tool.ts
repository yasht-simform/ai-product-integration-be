import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DatetimeArgs {
  timezone: string;
  operation?: 'now' | 'diff';
  date1?: string;
  date2?: string;
}

export function executeDatetime(args: DatetimeArgs): Record<string, unknown> {
  const { timezone: tz, operation = 'now', date1, date2 } = args;

  if (typeof tz !== 'string' || tz.trim().length === 0) {
    throw new Error('timezone is required');
  }

  if (operation === 'now') {
    return { datetime: nowInTimezone(tz), timezone: tz };
  }

  if (operation === 'diff') {
    return diffDates(tz, date1, date2);
  }

  throw new Error(`Unknown operation: ${String(operation)}`);
}

function nowInTimezone(tz: string): string {
  try {
    return dayjs().tz(tz).format();
  } catch {
    throw new Error(`Invalid timezone: ${tz}`);
  }
}

// Difference is expressed as whole days (dayjs' default truncation towards zero) plus the exact
// millisecond delta, so the model can read back either a coarse or a precise answer.
function diffDates(
  tz: string,
  date1: string | undefined,
  date2: string | undefined,
): Record<string, unknown> {
  if (!date1 || !date2) {
    throw new Error('date1 and date2 are required for the "diff" operation');
  }

  const d1 = dayjs(date1);
  const d2 = dayjs(date2);
  if (!d1.isValid()) throw new Error(`Invalid date1: ${date1}`);
  if (!d2.isValid()) throw new Error(`Invalid date2: ${date2}`);

  try {
    dayjs().tz(tz);
  } catch {
    throw new Error(`Invalid timezone: ${tz}`);
  }

  return {
    date1,
    date2,
    timezone: tz,
    diffDays: d2.diff(d1, 'day'),
    diffMs: d2.diff(d1),
  };
}
