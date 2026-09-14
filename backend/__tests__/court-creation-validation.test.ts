/**
 * Court creation validation (Phase 4).
 *
 * createCourt used to destructure req.body directly and validate with loose
 * `Number(x) <= 0` checks, which let a non-numeric string like "NaN" or an
 * overflow literal like 1e400 (JS Infinity) slip past `<= 0` (any comparison
 * with NaN is false, and Infinity > 0), so it could reach Postgres and
 * corrupt price_per_slot, or hit a raw integer-parse error on `number` that
 * surfaced as an unhandled 500. createCourt now shares a zod schema with
 * updateCourt that explicitly rejects NaN/Infinity/decimals/negatives.
 */
import type { Request, Response, NextFunction } from 'express';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { del: jest.fn().mockResolvedValue(undefined), get: jest.fn(), setex: jest.fn() },
  CACHE_KEYS: { courtList: (id: string) => `club:${id}:courts` },
  CACHE_TTL: {},
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { COURT_CREATED: 'COURT_CREATED' },
}));

import { createCourt } from '../src/interfaces/http/controllers/court.controller';
import { db } from '../src/infrastructure/database/client';
import { ConflictError } from '../src/shared/errors';

function makeReq(body: unknown, clubId = 'club-1'): Request {
  return {
    body, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId, email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown } {
  const res = {} as Response & { body?: unknown };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

beforeEach(() => jest.clearAllMocks());

function expectRejectedBeforeInsert(next: jest.Mock) {
  expect(next).toHaveBeenCalledWith(expect.any(Object));
  const err = next.mock.calls[0][0];
  // Never a 500: this must resolve as a ZodError (→ 400 VALIDATION_ERROR in
  // the global error handler), not an uncaught exception.
  expect(err.name).not.toBe('Error');
  expect((db.query as jest.Mock)).not.toHaveBeenCalled();
}

describe('createCourt — numeric validation', () => {
  test('empty pricePerSlot is rejected, not silently coerced to NaN/null', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: '' });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a literal "NaN" string for pricePerSlot is rejected outright (previously slipped past `<= 0`)', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 'NaN' });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('an overflow literal that parses to Infinity is rejected', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 1e400 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a negative price is rejected', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: -50 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('zero price is rejected', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 0 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a decimal court number is rejected', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 100, number: 2.5 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a negative court number is rejected', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 100, number: -1 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a non-numeric court-number string is rejected instead of reaching Postgres', async () => {
    const req = makeReq({ name: 'Court 1', pricePerSlot: 100, number: 'NaN' });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a blank/missing name is rejected', async () => {
    const req = makeReq({ name: '   ', pricePerSlot: 100 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);
    expectRejectedBeforeInsert(next);
  });

  test('a valid payload with an explicit number is accepted and inserted as given', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'court-1', name: 'Court 1', number: 3, price_per_slot: '150.00', status: 'available' }],
    });

    const req = makeReq({ name: 'Court 1', pricePerSlot: 150, number: 3 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const [, params] = (db.query as jest.Mock).mock.calls[0];
    expect(params).toEqual(['club-1', 'Court 1', 3, null, 150, 'available']);
  });

  test('an omitted number auto-assigns the next one (very large existing number handled too)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ max_number: 9999 }] }) // MAX(number) lookup
      .mockResolvedValueOnce({ rows: [{ id: 'court-2', name: 'Court X', number: 10000, price_per_slot: '200.00', status: 'available' }] });

    const req = makeReq({ name: 'Court X', pricePerSlot: 200 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const [, insertParams] = (db.query as jest.Mock).mock.calls[1];
    expect(insertParams[2]).toBe(10000);
  });

  test('a duplicate court number (courts_club_id_number_key 23505) is translated to a clean ConflictError, not a raw 500', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint "courts_club_id_number_key"'), {
        code: '23505',
      })
    );

    const req = makeReq({ name: 'Dup Court', pricePerSlot: 100, number: 7 });
    const res = makeRes();
    const next = jest.fn();
    await createCourt(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    const err = next.mock.calls[0][0] as ConflictError;
    expect(err.statusCode).toBe(409);
  });
});
