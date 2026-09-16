/**
 * Shared analytics helpers (domain/analytics/revenue.ts) — the canonical
 * VERIFIED/COLLECTED definitions and the operational-day SQL shift that
 * analytics, finance, financial-summary, and reports all now import from a
 * single place instead of copy-pasting.
 */
import { fromZonedTime } from 'date-fns-tz';
import {
  VERIFIED_STATUSES_SQL,
  COLLECTED_SQL,
  operationalDayExpr,
  operationalDateKey,
} from '../src/domain/analytics/revenue';

// Egypt's DST rules have changed repeatedly in recent years, so Africa/Cairo
// isn't a fixed UTC+2 offset year-round — use fromZonedTime (same helper
// prime-time.test.ts uses) to turn a Cairo wall-clock time into the correct
// real UTC instant, regardless of which DST rule is in effect for that date.
function cairoLocal(isoDateNoTz: string): Date {
  return fromZonedTime(isoDateNoTz, 'Africa/Cairo');
}

describe('VERIFIED_STATUSES_SQL', () => {
  test('lists exactly the four staff-verified booking statuses', () => {
    expect(VERIFIED_STATUSES_SQL).toBe(`('confirmed','checked_in','completed','no_show')`);
  });
});

describe('COLLECTED_SQL', () => {
  test('references deposit and remainder amount/method columns on alias b', () => {
    expect(COLLECTED_SQL).toContain('b.deposit_amount');
    expect(COLLECTED_SQL).toContain('b.deposit_method');
    expect(COLLECTED_SQL).toContain('b.remainder_amount');
    expect(COLLECTED_SQL).toContain('b.remainder_method');
    expect(COLLECTED_SQL).toContain(`<> 'NONE'`);
  });
});

describe('operationalDayExpr', () => {
  test('defaults to Africa/Cairo and matches the established 6-hour-shift pattern', () => {
    const expr = operationalDayExpr('b.start_time');
    expect(expr).toBe(`(b.start_time AT TIME ZONE 'Africa/Cairo') - INTERVAL '6 hours'`);
    // Must stay compatible with the regex every existing regression test
    // (revenue-operational-day.test.ts, finance-revenue.test.ts) matches on.
    expect(expr).toMatch(/\(b\.start_time AT TIME ZONE '[^']+'\) - INTERVAL '6 hours'/);
  });

  test('accepts an explicit timezone and an arbitrary column expression', () => {
    expect(operationalDayExpr('created_at', 'Europe/London')).toBe(
      `(created_at AT TIME ZONE 'Europe/London') - INTERVAL '6 hours'`
    );
  });
});

describe('operationalDateKey', () => {
  // Same worked examples as revenue-operational-day.test.ts's operationalDate(),
  // confirming the JS side agrees with the SQL side on the same boundary cases.
  test('a 02:00 Cairo instant belongs to the previous operational day', () => {
    expect(operationalDateKey(cairoLocal('2026-09-15T02:00:00'))).toBe('2026-09-14');
  });

  test('exactly 06:00 Cairo belongs to the new operational day', () => {
    expect(operationalDateKey(cairoLocal('2026-09-15T06:00:00'))).toBe('2026-09-15');
  });

  test('05:59:59 Cairo still belongs to the previous operational day', () => {
    expect(operationalDateKey(cairoLocal('2026-09-15T05:59:59'))).toBe('2026-09-14');
  });

  test('a daytime instant (14:00 Cairo) is unaffected by the shift', () => {
    expect(operationalDateKey(cairoLocal('2026-09-15T14:00:00'))).toBe('2026-09-15');
  });
});
