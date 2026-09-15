/**
 * CF-QA-08 (MEDIUM) — POST /api/bookings with a non-UUID courtId returned
 * HTTP 500 instead of a clean 400. createBookingSchema's `courtId`/
 * `court_id` fields were `z.string().optional()` — any non-empty string
 * passed validation and reached Postgres raw (via create-booking.usecase.ts
 * for courtId, or the club-membership check right in this handler for
 * customerId, or the per-line price lookup for equipment[].equipmentId),
 * where an invalid UUID literal raises the driver-level `22P02` error —
 * uncaught by the transaction's constraint-error translation (which only
 * maps 23P01/23505) — so it fell through to a generic 500.
 *
 * Fixed by adding `.uuid()` to every raw-FK-reference field in the schema:
 * courtId, court_id, customerId, customer_id, equipment[].equipmentId,
 * equipment[].equipment_id. waitlistToken is deliberately left alone — it's
 * an opaque single-use token, not a UUID FK reference.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/application/booking/create-booking.usecase', () => ({
  createBooking: jest.fn(),
}));

import { createBookingHandler } from '../src/interfaces/http/controllers/booking.controller';
import { createBooking } from '../src/application/booking/create-booking.usecase';
import { db } from '../src/infrastructure/database/client';

const VALID_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeReq(body: Record<string, unknown>, role = 'owner'): Request {
  return {
    body, params: {}, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role, clubId: 'club-1', email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; statusCode?: number } {
  const res = {} as Response & { body?: unknown; statusCode?: number };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    courtId: VALID_UUID,
    startTime: '2027-03-01T10:00:00Z',
    durationMinutes: 60,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (createBooking as jest.Mock).mockResolvedValue({ id: 'booking-1', status: 'confirmed' });
});

describe('createBookingHandler — UUID validation at the request boundary (CF-QA-08)', () => {
  test('a non-UUID courtId is rejected with a clean 400 (ZodError), never reaching the database', async () => {
    const req = makeReq(baseBody({ courtId: 'not-a-uuid' }));
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    expect(createBooking).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('the snake_case alias court_id is validated the same way', async () => {
    const req = makeReq({ court_id: 'still-not-a-uuid', startTime: '2027-03-01T10:00:00Z', durationMinutes: 60 });
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ZodError));
  });

  test('a non-UUID customerId (staff booking on behalf of someone) is rejected before the club-membership query runs', async () => {
    const req = makeReq(baseBody({ customerId: 'sql-injection-attempt-or-garbage' }), 'receptionist');
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a non-UUID equipment[].equipmentId is rejected before reaching the use case', async () => {
    const req = makeReq(baseBody({ equipment: [{ equipmentId: 'bogus', quantity: 1 }] }));
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    expect(createBooking).not.toHaveBeenCalled();
  });

  test('a valid UUID courtId, customerId, and equipment line all succeed exactly as before', async () => {
    const req = makeReq(baseBody({ customerId: VALID_UUID, equipment: [{ equipmentId: VALID_UUID, quantity: 2 }] }), 'receptionist');
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ '1': 1 }] }); // club-membership check passes
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ courtId: VALID_UUID }));
    expect(res.statusCode).toBe(201);
  });

  test('waitlistToken is NOT validated as a UUID — it is an opaque token, not a foreign-key reference', async () => {
    const req = makeReq(baseBody({ waitlistToken: 'not-a-uuid-and-thats-fine-123abc' }));
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ waitlistToken: 'not-a-uuid-and-thats-fine-123abc' }));
  });

  test('a missing courtId (not malformed, just absent) still surfaces the pre-existing clean "required" error, not a UUID complaint', async () => {
    const req = makeReq({ startTime: '2027-03-01T10:00:00Z', durationMinutes: 60 });
    const res = makeRes();
    const next = jest.fn();

    await createBookingHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).not.toBeInstanceOf(ZodError); // schema allows it absent; the runtime !courtId check catches it
    expect(err.message).toMatch(/courtId.*required/i);
  });
});
