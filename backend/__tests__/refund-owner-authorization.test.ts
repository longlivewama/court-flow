/**
 * CF-QA-02 (HIGH) — POST /api/refunds was gated `requireRole('receptionist')`
 * with no owner bypass, so a single-owner club with no hired receptionist
 * had no way to request a refund at all (and no frontend screen called the
 * endpoint either way, for any role). Fixed by adding 'owner' to the route's
 * requireRole allowlist (routes.ts) and, in the same code path, fixing a
 * latent bug this exposed: createRefundRequest's audit-log call hardcoded
 * `userRole: 'receptionist'` regardless of who actually called it — hidden
 * "PII" while nothing but receptionists could ever reach it, but wrong the
 * moment owners could too.
 *
 * Preserves: receptionist can still create requests; coach and customer
 * remain blocked; the approval step (PATCH /api/refunds/:id) stays
 * owner-only, unaffected by this change; tenant scoping and the financial
 * validation already covered by refund-approval-sync.test.ts are untouched.
 */
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { ForbiddenError } from '../src/shared/errors';

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

import { createRefundRequest } from '../src/interfaces/http/controllers/refund.controller';
import { withTransaction } from '../src/infrastructure/database/client';
import { auditLogStrict } from '../src/infrastructure/audit/audit.service';
import { requireRole } from '../src/interfaces/http/middleware/auth.middleware';

function makeReq(role: string, body: Record<string, unknown>): Request {
  return {
    body, params: {}, ip: '203.0.113.9', headers: {},
    user: { sub: `${role}-1`, role, clubId: 'club-1', email: `${role}@x.com`, jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; statusCode?: number } {
  const res = {} as Response & { body?: unknown; statusCode?: number };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

interface RecordedCall { text: string; params: unknown[]; }

function makeClient() {
  const calls: RecordedCall[] = [];
  const bookingRow = {
    id: 'booking-1', total_price: '1000.00', deposit_amount: '1000.00', deposit_method: 'CASH',
    remainder_amount: '0.00', remainder_method: 'NONE',
    payment_id: 'payment-1', payment_status: 'paid_in_full',
  };
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM bookings b JOIN payments p/is.test(text)) return { rows: [{ ...bookingRow, id: params[0] }] };
    if (/SELECT COALESCE\(SUM\(amount\), 0\)::numeric AS total\s+FROM refunds/i.test(text)) {
      return { rows: [{ total: '0' }] };
    }
    if (/INSERT INTO refunds/i.test(text)) {
      return { rows: [{ id: 'refund-1', booking_id: 'booking-1', payment_id: 'payment-1', status: 'pending', amount: params[3] }] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

beforeEach(() => jest.clearAllMocks());

describe('routes.ts wiring — POST /api/refunds', () => {
  test('binds requireRole with both owner and receptionist (the actual CF-QA-02 fix)', () => {
    const routesSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/interfaces/http/routes.ts'),
      'utf8'
    );
    const line = routesSrc.split('\n').find((l) => l.includes("refunds.post('/'"));
    expect(line).toBeDefined();
    expect(line).toMatch(/requireRole\(\s*['"]owner['"]\s*,\s*['"]receptionist['"]\s*\)/);
  });
});

describe('requireRole(\'owner\', \'receptionist\') — direct middleware behavior', () => {
  const middleware = requireRole('owner', 'receptionist');

  test.each(['owner', 'receptionist'])('allows role=%s through', (role) => {
    const req = { user: { role } } as unknown as Request;
    const next = jest.fn();
    middleware(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith(); // called with no error
  });

  test.each(['coach', 'customer'])('rejects role=%s with a 403 ForbiddenError', (role) => {
    const req = { user: { role } } as unknown as Request;
    const next = jest.fn();
    middleware(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

describe('createRefundRequest — owner and receptionist both succeed, with the correct role recorded', () => {
  test('owner can create a refund request (previously a 403 before this fix)', async () => {
    const client = makeClient();
    wire(client);

    const req = makeReq('owner', { bookingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 300, reason: 'Owner-issued goodwill refund' });
    const res = makeRes();
    const next = jest.fn();

    await createRefundRequest(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect((res.body as { status: string }).status).toBe('pending');

    // The bug this fix also had to close: userRole must reflect who actually
    // called it, not a hardcoded 'receptionist' string.
    expect(auditLogStrict).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userRole: 'owner', userId: 'owner-1' })
    );
  });

  test('receptionist can still create a refund request (pre-existing access, unaffected)', async () => {
    const client = makeClient();
    wire(client);

    const req = makeReq('receptionist', { bookingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 300, reason: 'Customer complaint' });
    const res = makeRes();
    const next = jest.fn();

    await createRefundRequest(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(auditLogStrict).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userRole: 'receptionist', userId: 'receptionist-1' })
    );
  });
});
