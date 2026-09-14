/**
 * Booking ownership IDOR check (Phase 9).
 *
 * requireClubResource('bookings') only proves a booking belongs to the
 * caller's CLUB — within that same club, a customer must still be blocked
 * from reading another customer's booking. getBooking() enforces that with
 * its own customer_id === userId check.
 */
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, NotFoundError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {},
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: { sendBookingCancellation: jest.fn() },
}));
jest.mock('../src/infrastructure/auth/encryption.service', () => ({
  decryptFile: jest.fn(),
}));

import { getBooking } from '../src/interfaces/http/controllers/booking.controller';
import { db } from '../src/infrastructure/database/client';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: 'booking-1' }, headers: {}, ip: '203.0.113.9',
    user: { sub: 'customer-A', role: 'customer', clubId: 'club-1', email: 'a@x.com', jti: 'j' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown } {
  const res = {} as Response & { body?: unknown };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('getBooking — same-club, different-customer isolation', () => {
  test('a customer cannot read another customer\'s booking in the same club', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'booking-1', club_id: 'club-1', customer_id: 'customer-B', admin_notes: 'secret' }],
    });

    const req = makeReq(); // authenticated as customer-A
    const res = makeRes();
    const next = jest.fn();
    await getBooking(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(res.json).not.toHaveBeenCalled();
  });

  test('a customer CAN read their own booking, with admin_notes stripped', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1', club_id: 'club-1', customer_id: 'customer-A', admin_notes: 'secret' }] })
      .mockResolvedValueOnce({ rows: [] }); // booking_equipment lookup

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await getBooking(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.body).not.toHaveProperty('admin_notes');
  });

  test('staff (receptionist) can read any booking in their club, admin_notes included', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1', club_id: 'club-1', customer_id: 'customer-B', admin_notes: 'secret' }] })
      .mockResolvedValueOnce({ rows: [] }); // booking_equipment lookup

    const req = makeReq({ user: { sub: 'staff-1', role: 'receptionist', clubId: 'club-1', email: 's@x.com', jti: 'j' } });
    const res = makeRes();
    const next = jest.fn();
    await getBooking(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res.body as any).admin_notes).toBe('secret');
  });

  test('a booking from another club never reaches the ownership check (query itself is club-scoped)', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // club_id=$2 filter already excludes it

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await getBooking(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });
});
