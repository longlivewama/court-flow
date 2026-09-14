/**
 * Prime-time classification (Phase 15) — Friday/Saturday (Egyptian weekend)
 * or 17:00+ on a weekday, evaluated in Africa/Cairo local time.
 */
import { fromZonedTime } from 'date-fns-tz';
import { isPrimeTime } from '../src/domain/booking/prime-time';

// Egypt has observed DST on and off in recent years, so Africa/Cairo isn't a
// fixed UTC+2 offset year-round — use fromZonedTime (the same conversion
// prime-time.ts's own toZonedTime inverts) to correctly turn a wall-clock
// Cairo time into the real UTC instant, regardless of the DST rules in
// effect for that date.
function cairoLocal(isoDateNoTz: string): Date {
  return fromZonedTime(isoDateNoTz, 'Africa/Cairo');
}

describe('isPrimeTime', () => {
  test('a weekday morning is not prime time', () => {
    // 2026-09-14 is a Monday
    expect(isPrimeTime(cairoLocal('2026-09-14T10:00:00'))).toBe(false);
  });

  test('a weekday at exactly 17:00 is prime time', () => {
    expect(isPrimeTime(cairoLocal('2026-09-14T17:00:00'))).toBe(true);
  });

  test('a weekday one minute before 17:00 is not prime time', () => {
    expect(isPrimeTime(cairoLocal('2026-09-14T16:59:00'))).toBe(false);
  });

  test('Friday is always prime time, even in the morning', () => {
    // 2026-09-18 is a Friday
    expect(isPrimeTime(cairoLocal('2026-09-18T08:00:00'))).toBe(true);
  });

  test('Saturday is always prime time', () => {
    // 2026-09-19 is a Saturday
    expect(isPrimeTime(cairoLocal('2026-09-19T08:00:00'))).toBe(true);
  });

  test('Sunday is a regular weekday for this policy (not prime time in the morning)', () => {
    // 2026-09-20 is a Sunday — the Egyptian work week starts Sunday
    expect(isPrimeTime(cairoLocal('2026-09-20T10:00:00'))).toBe(false);
  });

  test('late night (23:00) on a weekday is prime time', () => {
    expect(isPrimeTime(cairoLocal('2026-09-14T23:00:00'))).toBe(true);
  });
});
