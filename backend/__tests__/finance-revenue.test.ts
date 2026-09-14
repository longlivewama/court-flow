/**
 * Finance revenue correctness (Phases 3 & 7).
 *
 * getFinancials() must report NET collected revenue: a manual refund
 * approved against a still-active (non-cancelled) booking has to be
 * deducted from court-booking revenue, because that booking's gross amount
 * is otherwise still counted in full. A cancellation refund must NOT be
 * deducted again — the cancelled booking is already excluded from the gross
 * figure, so subtracting its refund too would double-count the loss.
 */
import type { Request, Response, NextFunction } from 'express';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));

import { getFinancials } from '../src/interfaces/http/controllers/finance.controller';
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

/**
 * Wires db.query to answer every distinct query getFinancials() issues.
 * `ledger` supplies the row shape for the cancellation/refund ledger query;
 * everything else defaults to a harmless zero/empty result.
 */
function wireFinancials(opts: {
  bookingsCurrent?: number; bookingsPrevious?: number;
  ledger?: Partial<{
    forfeited_income: string; cancellation_refunds_out: string; active_booking_refunds_out: string;
    forfeit_count: string; cancellation_refund_count: string; active_booking_refund_count: string;
  }>;
}) {
  const ledgerDefaults = {
    forfeited_income: '0', cancellation_refunds_out: '0', active_booking_refunds_out: '0',
    forfeit_count: '0', cancellation_refund_count: '0', active_booking_refund_count: '0',
  };
  (db.query as jest.Mock).mockImplementation(async (text: string) => {
    if (/FROM ledger_entries le/i.test(text)) {
      return { rows: [{ ...ledgerDefaults, ...(opts.ledger ?? {}) }] };
    }
    if (/FROM booking_equipment be/i.test(text)) return { rows: [] };
    if (/FROM tournament_teams tt/i.test(text) && /unpaid_teams/i.test(text)) {
      return { rows: [{ collected: '0', outstanding: '0', unpaid_teams: 0 }] };
    }
    if (/FROM training_sessions ts/i.test(text) && /coach_payouts/i.test(text)) {
      return { rows: [{ collected: '0', coach_payouts: '0', club_share: '0', uncollected: '0', unpaid_sessions: 0 }] };
    }
    if (/FROM expenses\s+WHERE/i.test(text)) return { rows: [] };
    if (/UNION ALL/i.test(text)) return { rows: [] }; // monthlyRevenue / monthlyCosts
    if (/AS current/i.test(text) && /AS previous/i.test(text) && /FROM bookings b/i.test(text)) {
      return { rows: [{ current: String(opts.bookingsCurrent ?? 0), previous: String(opts.bookingsPrevious ?? 0) }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => jest.clearAllMocks());

describe('getFinancials — revenue nets out manual refunds against active bookings', () => {
  test('Payment=1000 gross booking revenue, 300 manually refunded on a still-active booking → net 700', async () => {
    wireFinancials({
      bookingsCurrent: 1000,
      ledger: { active_booking_refunds_out: '300', active_booking_refund_count: '1' },
    });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await getFinancials(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.totals.revenue.bookings).toBe(700);
    expect(res.body.totals.revenue.bookingsGross).toBe(1000);
    expect(res.body.totals.revenue.refundsDeductedFromBookings).toBe(300);
    expect(res.body.totals.revenue.total).toBe(700);
  });

  test('a cancellation refund is reported for transparency but NOT subtracted again (booking already excluded from gross)', async () => {
    wireFinancials({
      bookingsCurrent: 1000, // this gross already excludes the cancelled booking
      ledger: {
        cancellation_refunds_out: '500', cancellation_refund_count: '1',
        forfeited_income: '0',
      },
    });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await getFinancials(req, res, next as NextFunction);

    expect(res.body.totals.revenue.bookings).toBe(1000); // untouched
    expect(res.body.totals.revenue.refundsDeductedFromBookings).toBe(0);
    expect(res.body.totals.cancellations.refundsOut).toBe(500);
    expect(res.body.totals.cancellations.refundCount).toBe(1);
  });

  test('forfeited deposits are added back into total revenue', async () => {
    wireFinancials({
      bookingsCurrent: 1000,
      ledger: { forfeited_income: '150', forfeit_count: '1' },
    });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await getFinancials(req, res, next as NextFunction);

    expect(res.body.totals.revenue.forfeitedDeposits).toBe(150);
    expect(res.body.totals.revenue.total).toBe(1150);
    expect(res.body.totals.cancellations.netImpact).toBe(150); // forfeited - cancellation refunds (0)
  });

  test('the monthly P&L series buckets bookings by the 6 AM operational day, matching daily_revenue', async () => {
    const calls: Array<{ text: string }> = [];
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      calls.push({ text });
      if (/FROM ledger_entries le/i.test(text)) {
        return { rows: [{ forfeited_income: '0', cancellation_refunds_out: '0', active_booking_refunds_out: '0', forfeit_count: '0', cancellation_refund_count: '0', active_booking_refund_count: '0' }] };
      }
      if (/AS current/i.test(text) && /AS previous/i.test(text)) return { rows: [{ current: '0', previous: '0' }] };
      return { rows: [] };
    });

    await getFinancials(makeReq(), makeRes(), jest.fn() as unknown as NextFunction);

    const monthlyRevenueCall = calls.find((c) => /UNION ALL/i.test(c.text) && /FROM bookings b/i.test(c.text))!;
    expect(monthlyRevenueCall.text).toMatch(/\(b\.start_time AT TIME ZONE '[^']+'\) - INTERVAL '6 hours'/);
  });

  test('a full 1000 manual refund zeroes out net booking revenue without going negative from rounding', async () => {
    wireFinancials({
      bookingsCurrent: 1000,
      ledger: { active_booking_refunds_out: '1000', active_booking_refund_count: '1' },
    });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await getFinancials(req, res, next as NextFunction);

    expect(res.body.totals.revenue.bookings).toBe(0);
    expect(res.body.totals.revenue.total).toBe(0);
  });
});
