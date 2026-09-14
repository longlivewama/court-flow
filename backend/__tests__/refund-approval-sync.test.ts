/**
 * Refund approval — payment/ledger synchronization (Phase 3).
 *
 * Approving a refund must, atomically:
 *   - flip refunds.status to 'approved'
 *   - update payments.status to 'partially_refunded' or 'fully_refunded'
 *   - record payments.refunded_amount as the running total actually refunded
 *   - append one immutable REFUND ledger entry
 * and must never let the running refunded total exceed what was collected.
 */
import type { Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    REFUND_REQUESTED: 'REFUND_REQUESTED',
    REFUND_APPROVED: 'REFUND_APPROVED',
    REFUND_REJECTED: 'REFUND_REJECTED',
  },
}));

import { approveOrRejectRefund } from '../src/interfaces/http/controllers/refund.controller';
import { withTransaction } from '../src/infrastructure/database/client';

interface RecordedCall { text: string; params: unknown[]; }

function makeReq(body: unknown, clubId = 'club-1'): Request {
  return {
    body, params: { id: 'refund-1' }, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId, email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown } {
  const res = {} as Response & { body?: unknown };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

/** A fake PoolClient whose query() responds based on the SQL shape, mirroring create-subscription.usecase.test.ts. */
function makeClient(refundRow: Record<string, unknown>, opts: { otherApproved?: number } = {}) {
  const calls: RecordedCall[] = [];
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/SELECT r\.\*.*FROM refunds r/is.test(text)) return { rows: [refundRow] };
    if (/SELECT COALESCE\(SUM\(amount\), 0\)::numeric AS total\s+FROM refunds/i.test(text)) {
      return { rows: [{ total: String(opts.otherApproved ?? 0) }] };
    }
    if (/UPDATE refunds SET status/i.test(text)) return { rowCount: 1 };
    if (/UPDATE payments SET status/i.test(text)) return { rowCount: 1 };
    if (/INSERT INTO ledger_entries/i.test(text)) return { rows: [{ id: 'ledger-1' }] };
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseRefundRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'refund-1', booking_id: 'booking-1', payment_id: 'payment-1', status: 'pending',
    amount: '300.00', reason: 'Customer complaint',
    total_price: '1000.00',
    deposit_amount: '1000.00', deposit_method: 'CASH',
    remainder_amount: '0.00', remainder_method: 'NONE',
    court_name: 'Court 1', payment_status: 'paid_in_full',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('approveOrRejectRefund — payment/ledger sync', () => {
  test('approving a 300 refund on a 1000 payment: partially_refunded, refunded_amount=300, one ledger entry', async () => {
    const client = makeClient(baseRefundRow());
    wire(client);

    const req = makeReq({ action: 'approve' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status/i.test(c.text))!;
    expect(paymentUpdate.params).toEqual(['payment-1', 'partially_refunded', 300]);

    const ledgerInsert = client.calls.find((c) => /INSERT INTO ledger_entries/i.test(c.text))!;
    // (club_id, entry_type, direction, amount, booking_id, payment_id, ...)
    expect(ledgerInsert.params[1]).toBe('REFUND');
    expect(ledgerInsert.params[2]).toBe('DEBIT');
    expect(ledgerInsert.params[3]).toBe(300);
    expect(ledgerInsert.params[4]).toBe('booking-1');
    expect(ledgerInsert.params[5]).toBe('payment-1');

    const refundUpdate = client.calls.find((c) => /UPDATE refunds SET status/i.test(c.text))!;
    expect(refundUpdate.params[1]).toBe('approved');
  });

  test('a second 700 refund on the same 1000 payment (300 already approved) completes it: fully_refunded, refunded_amount=1000', async () => {
    const client = makeClient(baseRefundRow({ id: 'refund-2', amount: '700.00' }), { otherApproved: 300 });
    wire(client);

    const req = makeReq({ action: 'approve' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status/i.test(c.text))!;
    expect(paymentUpdate.params).toEqual(['payment-1', 'fully_refunded', 1000]);
  });

  test('approving a refund that would exceed the collected amount is rejected and touches neither payment nor ledger', async () => {
    // 300 already approved, this one asks for 800 more (total 1100 > 1000 collected).
    const client = makeClient(baseRefundRow({ amount: '800.00' }), { otherApproved: 300 });
    wire(client);

    const req = makeReq({ action: 'approve' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ details: { code: 'REFUND_EXCEEDS_COLLECTED_AMOUNT' } }));
    expect(client.calls.some((c) => /UPDATE refunds SET status/i.test(c.text))).toBe(false);
    expect(client.calls.some((c) => /UPDATE payments SET status/i.test(c.text))).toBe(false);
    expect(client.calls.some((c) => /INSERT INTO ledger_entries/i.test(c.text))).toBe(false);
  });

  test('a non-pending refund (already approved/rejected) cannot be processed again — no duplicate ledger entry', async () => {
    const client = makeClient(baseRefundRow({ status: 'approved' }));
    wire(client);

    const req = makeReq({ action: 'approve' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(client.calls.some((c) => /INSERT INTO ledger_entries/i.test(c.text))).toBe(false);
  });

  test('rejecting a refund never touches payments or the ledger', async () => {
    const client = makeClient(baseRefundRow());
    wire(client);

    const req = makeReq({ action: 'reject', internalNotes: 'Not eligible' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const refundUpdate = client.calls.find((c) => /UPDATE refunds SET status/i.test(c.text))!;
    expect(refundUpdate.params[1]).toBe('rejected');
    expect(client.calls.some((c) => /UPDATE payments SET status/i.test(c.text))).toBe(false);
    expect(client.calls.some((c) => /INSERT INTO ledger_entries/i.test(c.text))).toBe(false);
  });

  test('an unknown refund id is a 404, scoped to the caller\'s own club', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    wire(client);

    const req = makeReq({ action: 'approve' }, 'club-1');
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });

  test('a malformed action is rejected before opening a transaction', async () => {
    const req = makeReq({ action: 'delete-everything' });
    const res = makeRes();
    const next = jest.fn();

    await approveOrRejectRefund(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
