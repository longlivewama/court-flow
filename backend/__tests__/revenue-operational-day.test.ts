/**
 * Revenue report operational-day boundary (Phase 7).
 *
 * CourtFlow's operational day runs 06:00 → 05:59:59 the next morning
 * (Cairo), matching the 6 AM boundary already used for the staff schedule
 * window (getDailySchedule/getAvailabilityGrid). daily/weekly/monthly
 * revenue reports used to bucket by the plain Cairo calendar date, so a
 * 02:00 booking counted toward the WRONG (new) day/month instead of the
 * operational day it actually belongs to (the one still running from the
 * night before).
 */
import { fetchReportData } from '../src/interfaces/http/controllers/report.controller';
import { db } from '../src/infrastructure/database/client';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));

/**
 * Mirrors the SQL: treats the input as a naive Cairo wall-clock timestamp
 * (no timezone conversion — that's what `AT TIME ZONE` already produced),
 * shifts it back 6 hours, then truncates to a date. Uses UTC-based Date
 * arithmetic purely as a calendar calculator so the test isn't sensitive to
 * the machine's own local timezone.
 */
function operationalDate(cairoLocalIso: string): string {
  const shifted = new Date(new Date(`${cairoLocalIso}Z`).getTime() - 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

beforeEach(() => jest.clearAllMocks());

describe('fetchReportData — operational-day bucketing', () => {
  test('daily_revenue groups by the 6 AM operational day, not the plain calendar date', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await fetchReportData('club-1', 'daily_revenue', {});

    const [sql] = (db.query as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/DATE\(\(b\.start_time AT TIME ZONE 'Africa\/Cairo'\) - INTERVAL '6 hours'\)/);
    // The WHERE filter must stay a plain, sargable range on the raw column —
    // only the grouping key shifts (see the Phase 14 index-friendliness note).
    expect(sql).toMatch(/b\.start_time BETWEEN \$2 AND \$3/);
  });

  test('weekly_revenue and monthly_revenue apply the same 6-hour shift', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });

    await fetchReportData('club-1', 'weekly_revenue', {});
    await fetchReportData('club-1', 'monthly_revenue', {});

    const [weeklySql] = (db.query as jest.Mock).mock.calls[0];
    const [monthlySql] = (db.query as jest.Mock).mock.calls[1];
    expect(weeklySql).toMatch(/DATE_TRUNC\('week', \(b\.start_time AT TIME ZONE 'Africa\/Cairo'\) - INTERVAL '6 hours'\)/);
    expect(monthlySql).toMatch(/\(b\.start_time AT TIME ZONE 'Africa\/Cairo'\) - INTERVAL '6 hours','MM\/YYYY'/);
  });

  test('a 02:00 booking belongs to the previous operational day (worked example from the spec)', () => {
    // Booking at 2026-09-15 02:00 Cairo-local should bucket as 2026-09-14.
    expect(operationalDate('2026-09-15T02:00:00')).toBe('2026-09-14');
  });

  test('a booking at exactly 06:00 belongs to the NEW operational day', () => {
    expect(operationalDate('2026-09-15T06:00:00')).toBe('2026-09-15');
  });

  test('a booking at 05:59:59 still belongs to the previous operational day', () => {
    expect(operationalDate('2026-09-15T05:59:59')).toBe('2026-09-14');
  });

  test('a daytime booking (14:00) is unaffected by the shift', () => {
    expect(operationalDate('2026-09-15T14:00:00')).toBe('2026-09-15');
  });
});
