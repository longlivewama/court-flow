/**
 * Analytics Overview correctness (Analytics Dashboard V1).
 *
 * Covers: period-over-period KPI deltas (incl. the zero-previous-period
 * divide-by-zero guard), cancellation/no-show rate math, new-vs-returning
 * customer split, day-of-week/peak-hour dense-fill, payment-method mapping,
 * top-customers shaping, and two regression locks:
 *   1. bookingsPerDay/revenueByMonth must bucket by the 6 AM operational day
 *      (the bug: getAnalyticsOverview used a plain calendar date/month).
 *   2. peak hours must filter its date range by start_time, not created_at
 *      (the bug: the old /api/bookings/analytics-plots endpoint mixed the two).
 */
import type { Request, Response, NextFunction } from 'express';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));

import { getAnalyticsOverview } from '../src/interfaces/http/controllers/analytics.controller';
import { db } from '../src/infrastructure/database/client';

function makeReq(query: Record<string, string> = {}): Request {
  return {
    query, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId: 'club-1', email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: any } {
  const res = {} as Response & { body?: any };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

type Kpi = Partial<{
  revenue: string; revenue_prev: string;
  bookings: number; bookings_prev: number;
  unique_customers: number;
  cancellations: number; cancellations_prev: number;
  non_draft: number; non_draft_prev: number;
  no_shows: number; no_shows_prev: number;
  verified_eligible: number; verified_eligible_prev: number;
}>;

const KPI_DEFAULTS: Required<Kpi> = {
  revenue: '0', revenue_prev: '0',
  bookings: 0, bookings_prev: 0,
  unique_customers: 0,
  cancellations: 0, cancellations_prev: 0,
  non_draft: 0, non_draft_prev: 0,
  no_shows: 0, no_shows_prev: 0,
  verified_eligible: 0, verified_eligible_prev: 0,
};

interface WireOpts {
  kpi?: Kpi;
  sub?: { active?: number; mrr?: string };
  cohort?: { new_customers?: number; returning_customers?: number };
  daily?: Array<{ day: string; bookings: number; revenue: string }>;
  dow?: Array<{ dow: number; bookings: number }>;
  peak?: Array<{ hour_slot: number; bookings_count: number }>;
  dist?: { cash?: string; vodafone_cash?: string; instapay?: string };
  topCustomers?: Array<{ id: string; first_name: string; last_name: string; bookings: number; revenue: string }>;
}

/** Records every distinct query text so tests can assert on shape/SQL, plus routes each to a fixture response. */
function wireAnalytics(opts: WireOpts = {}): Array<{ text: string }> {
  const calls: Array<{ text: string }> = [];
  (db.query as jest.Mock).mockImplementation(async (text: string) => {
    calls.push({ text });
    if (/AS revenue_prev/.test(text)) return { rows: [{ ...KPI_DEFAULTS, ...(opts.kpi ?? {}) }] };
    if (/FROM subscriptions WHERE/.test(text)) return { rows: [{ active: opts.sub?.active ?? 0, mrr: opts.sub?.mrr ?? '0' }] };
    if (/WITH cohort AS/.test(text)) return { rows: [{ new_customers: opts.cohort?.new_customers ?? 0, returning_customers: opts.cohort?.returning_customers ?? 0 }] };
    if (/GROUP BY day ORDER BY day/.test(text)) return { rows: opts.daily ?? [] };
    if (/FROM courts c/.test(text)) return { rows: [] };
    if (/FROM working_hours WHERE club_id/.test(text)) return { rows: [] };
    if (/DATE_TRUNC\('month', NOW\(\)\) - INTERVAL '5 months'/.test(text)) return { rows: [] }; // month + growth
    if (/GROUP BY dow ORDER BY dow/.test(text)) return { rows: opts.dow ?? [] };
    if (/GROUP BY hour_slot ORDER BY hour_slot/.test(text)) return { rows: opts.peak ?? [] };
    if (/AS vodafone_cash/.test(text)) return { rows: [{ cash: opts.dist?.cash ?? '0', vodafone_cash: opts.dist?.vodafone_cash ?? '0', instapay: opts.dist?.instapay ?? '0' }] };
    if (/LIMIT 10/.test(text)) return { rows: opts.topCustomers ?? [] };
    return { rows: [] };
  });
  return calls;
}

beforeEach(() => jest.clearAllMocks());

describe('getAnalyticsOverview — KPI deltas', () => {
  test('revenue/bookings/avg-booking-value deltas compute correctly against the previous period', async () => {
    wireAnalytics({ kpi: { revenue: '1500', revenue_prev: '1000', bookings: 30, bookings_prev: 20 } });

    const res = makeRes();
    await getAnalyticsOverview(makeReq({ range_days: '30' }), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.revenue).toBe(1500);
    expect(res.body.kpis.revenuePrevPeriod).toBe(1000);
    expect(res.body.kpis.revenueDeltaPct).toBe(50);
    expect(res.body.kpis.bookingsDeltaPct).toBe(50);
    expect(res.body.kpis.avgBookingValue).toBe(50);
    expect(res.body.kpis.avgBookingValuePrevPeriod).toBe(50);
    expect(res.body.kpis.avgBookingValueDeltaPct).toBe(0);
  });

  test('a zero previous period omits the delta (%) instead of dividing by zero', async () => {
    wireAnalytics({ kpi: { revenue: '500', revenue_prev: '0', bookings: 10, bookings_prev: 0 } });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.revenueDeltaPct).toBeNull();
    expect(res.body.kpis.bookingsDeltaPct).toBeNull();
    expect(res.body.kpis.avgBookingValue).toBe(50);
    expect(res.body.kpis.avgBookingValuePrevPeriod).toBe(0);
    expect(res.body.kpis.avgBookingValueDeltaPct).toBeNull();
  });
});

describe('getAnalyticsOverview — cancellation & no-show rates', () => {
  test('rates and their period-over-period deltas', async () => {
    wireAnalytics({
      kpi: {
        cancellations: 5, cancellations_prev: 10, non_draft: 50, non_draft_prev: 40,
        no_shows: 2, no_shows_prev: 4, verified_eligible: 40, verified_eligible_prev: 40,
      },
    });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.cancellationRate).toBe(10);
    expect(res.body.kpis.cancellationRatePrevPeriod).toBe(25);
    expect(res.body.kpis.cancellationRateDeltaPct).toBe(-60);
    expect(res.body.kpis.noShowRate).toBe(5);
    expect(res.body.kpis.noShowRatePrevPeriod).toBe(10);
    expect(res.body.kpis.noShowRateDeltaPct).toBe(-50);
  });

  test('zero denominators produce a 0% rate, not NaN', async () => {
    const res = makeRes();
    wireAnalytics(); // all defaults are zero
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.cancellationRate).toBe(0);
    expect(res.body.kpis.noShowRate).toBe(0);
    expect(res.body.kpis.avgBookingValue).toBe(0);
  });
});

describe('getAnalyticsOverview — new vs. returning customers', () => {
  test('surfaces both counts from the cohort query', async () => {
    wireAnalytics({ cohort: { new_customers: 3, returning_customers: 7 } });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.newCustomers).toBe(3);
    expect(res.body.kpis.returningCustomers).toBe(7);
  });
});

describe('getAnalyticsOverview — day-of-week demand', () => {
  test('dense-fills all 7 weekdays, Mon first, zero where no rows', async () => {
    wireAnalytics({ dow: [{ dow: 1, bookings: 5 }, { dow: 5, bookings: 9 }] });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.dayOfWeekDemand).toEqual([
      { day: 'Mon', bookings: 5 },
      { day: 'Tue', bookings: 0 },
      { day: 'Wed', bookings: 0 },
      { day: 'Thu', bookings: 0 },
      { day: 'Fri', bookings: 9 },
      { day: 'Sat', bookings: 0 },
      { day: 'Sun', bookings: 0 },
    ]);
  });
});

describe('getAnalyticsOverview — peak hours', () => {
  test('dense-fills 06:00–22:00 (17 slots) around sparse rows', async () => {
    wireAnalytics({ peak: [{ hour_slot: 6, bookings_count: 2 }, { hour_slot: 22, bookings_count: 1 }] });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.peakHours).toHaveLength(17);
    expect(res.body.peakHours[0]).toEqual({ hour: '06:00', bookingsCount: 2 });
    expect(res.body.peakHours[16]).toEqual({ hour: '22:00', bookingsCount: 1 });
    expect(res.body.peakHours[1]).toEqual({ hour: '07:00', bookingsCount: 0 });
  });

  test('REGRESSION: the range filter keys off start_time, not created_at (the old analytics-plots bug)', async () => {
    const calls = wireAnalytics();
    await getAnalyticsOverview(makeReq(), makeRes(), jest.fn() as unknown as NextFunction);

    const peakCall = calls.find((c) => /GROUP BY hour_slot ORDER BY hour_slot/.test(c.text))!;
    expect(peakCall.text).toMatch(/b\.start_time >= NOW\(\) - \(\$2 \|\| ' days'\)::interval/);
    expect(peakCall.text).not.toMatch(/created_at/);
  });
});

describe('getAnalyticsOverview — payment method distribution', () => {
  test('maps the three methods with numeric values', async () => {
    wireAnalytics({ dist: { cash: '100', vodafone_cash: '50', instapay: '25' } });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.paymentMethodDistribution).toEqual([
      { name: 'CASH', value: 100 },
      { name: 'VODAFONE_CASH', value: 50 },
      { name: 'INSTAPAY', value: 25 },
    ]);
  });
});

describe('getAnalyticsOverview — top customers', () => {
  test('shapes rows into {customerId, name, bookings, revenue} and the query orders/limits correctly', async () => {
    const calls = wireAnalytics({
      topCustomers: [
        { id: 'cust-1', first_name: 'Nour', last_name: 'Hassan', bookings: 12, revenue: '4500' },
        { id: 'cust-2', first_name: 'Karim', last_name: 'Adel', bookings: 8, revenue: '2100' },
      ],
    });

    const res = makeRes();
    await getAnalyticsOverview(makeReq(), res, jest.fn() as unknown as NextFunction);

    expect(res.body.topCustomers).toEqual([
      { customerId: 'cust-1', name: 'Nour Hassan', bookings: 12, revenue: 4500 },
      { customerId: 'cust-2', name: 'Karim Adel', bookings: 8, revenue: 2100 },
    ]);

    const topCustomersCall = calls.find((c) => /LIMIT 10/.test(c.text))!;
    expect(topCustomersCall.text).toMatch(/ORDER BY revenue DESC/);
  });
});

describe('getAnalyticsOverview — operational-day bucketing (REGRESSION)', () => {
  test('bookingsPerDay groups by the 6 AM operational day, not the plain calendar date', async () => {
    const calls = wireAnalytics();
    await getAnalyticsOverview(makeReq(), makeRes(), jest.fn() as unknown as NextFunction);

    const dailyCall = calls.find((c) => /GROUP BY day ORDER BY day/.test(c.text))!;
    expect(dailyCall.text).toMatch(/\(b\.start_time AT TIME ZONE '[^']+'\) - INTERVAL '6 hours'/);
  });

  test('revenueByMonth groups by the same 6-hour-shifted operational month', async () => {
    const calls = wireAnalytics();
    await getAnalyticsOverview(makeReq(), makeRes(), jest.fn() as unknown as NextFunction);

    const monthCall = calls.find((c) =>
      /DATE_TRUNC\('month', NOW\(\)\) - INTERVAL '5 months'/.test(c.text) && /FROM bookings b/.test(c.text)
    )!;
    expect(monthCall.text).toMatch(/DATE_TRUNC\('month', \(b\.start_time AT TIME ZONE '[^']+'\) - INTERVAL '6 hours'\)/);
  });
});

describe('getAnalyticsOverview — zero-activity edge case', () => {
  test('an empty club produces zero-filled series, not NaN/undefined, across every new metric', async () => {
    wireAnalytics();

    const res = makeRes();
    await getAnalyticsOverview(makeReq({ range_days: '7' }), res, jest.fn() as unknown as NextFunction);

    expect(res.body.kpis.avgBookingValue).toBe(0);
    expect(res.body.kpis.cancellationRate).toBe(0);
    expect(res.body.kpis.noShowRate).toBe(0);
    expect(res.body.kpis.newCustomers).toBe(0);
    expect(res.body.kpis.returningCustomers).toBe(0);
    expect(res.body.dayOfWeekDemand.every((d: { bookings: number }) => d.bookings === 0)).toBe(true);
    expect(res.body.peakHours.every((h: { bookingsCount: number }) => h.bookingsCount === 0)).toBe(true);
    expect(res.body.paymentMethodDistribution.every((p: { value: number }) => p.value === 0)).toBe(true);
    expect(res.body.topCustomers).toEqual([]);
    expect(res.body.bookingsPerDay).toHaveLength(7);
    expect(res.body.bookingsPerDay.every((d: { bookings: number; revenue: number }) => d.bookings === 0 && d.revenue === 0)).toBe(true);
  });
});
