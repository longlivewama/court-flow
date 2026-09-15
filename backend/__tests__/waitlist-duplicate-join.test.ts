/**
 * CF-QA-09 (LOW) — the same customer could join the identical
 * club/court/time-window waitlist any number of times; no uniqueness check
 * existed at all. Fixed with a defense-in-depth pair: migration 026 adds a
 * partial unique index on (club_id, user_id, COALESCE(court_id, sentinel),
 * desired_start, desired_end) WHERE fulfilled_at IS NULL (the sentinel
 * COALESCE matters because court_id is nullable for "any court" entries,
 * and Postgres never treats two NULLs as equal in a unique index); this
 * suite covers the application half — catching that index's 23505 and
 * translating it to a clean ConflictError, matching the existing pattern
 * used for courts/refunds elsewhere in this codebase.
 */
import type { Request, Response, NextFunction } from 'express';
import { ConflictError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { WAITLIST_JOINED: 'WAITLIST_JOINED' },
}));

import { joinWaitlist } from '../src/interfaces/http/controllers/waitlist.controller';
import { db } from '../src/infrastructure/database/client';

function makeReq(body: Record<string, unknown>): Request {
  return {
    body, params: {}, ip: '203.0.113.9', headers: {},
    user: { sub: 'customer-1', role: 'customer', clubId: 'club-1', email: 'c@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; statusCode?: number } {
  const res = {} as Response & { body?: unknown; statusCode?: number };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

function futureWindow() {
  const start = new Date(Date.now() + 48 * 3_600_000).toISOString();
  const end = new Date(Date.now() + 49 * 3_600_000).toISOString();
  return { desiredStart: start, desiredEnd: end };
}

beforeEach(() => jest.clearAllMocks());

describe('joinWaitlist — duplicate active join protection (CF-QA-09)', () => {
  test('a second identical join request → clean 409, not a raw 500', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce({ code: '23505' }); // migration 026's index violation

    const req = makeReq(futureWindow());
    const res = makeRes();
    const next = jest.fn();

    await joinWaitlist(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.message).toMatch(/already on the waitlist/i);
  });

  test('a fresh join (no conflict) still succeeds exactly as before', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'entry-1', club_id: 'club-1', user_id: 'customer-1' }] });

    const req = makeReq(futureWindow());
    const res = makeRes();
    const next = jest.fn();

    await joinWaitlist(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  test('an unrelated database error is NOT swallowed as a duplicate-join conflict', async () => {
    (db.query as jest.Mock).mockRejectedValueOnce(new Error('connection reset'));

    const req = makeReq(futureWindow());
    const res = makeRes();
    const next = jest.fn();

    await joinWaitlist(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.not.objectContaining({ code: 'CONFLICT' }));
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.message).toBe('connection reset');
  });

  test('a specific-court join and an "any court" join for the same window are independent (courtId provided passes the court-ownership check first)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // court ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'entry-2' }] }); // insert succeeds

    const req = makeReq({ ...futureWindow(), courtId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const res = makeRes();
    const next = jest.fn();

    await joinWaitlist(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });
});
