/**
 * End-to-end wiring check for the Phase 11 pagination/date fix: listAuditLogs
 * is the simplest of the three fixed controllers (audit/booking/payment).
 */
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));

import { listAuditLogs } from '../src/interfaces/http/controllers/audit.controller';
import { db } from '../src/infrastructure/database/client';

function makeReq(query: Record<string, string>): Request {
  return {
    query, headers: {}, ip: '203.0.113.9',
    user: { sub: 'owner-1', role: 'owner', clubId: 'club-1', email: 'o@x.com', jti: 'j' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown } {
  const res = {} as Response & { body?: unknown };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

beforeEach(() => jest.clearAllMocks());

test('a non-numeric page value is rejected with a clean 400 before any query runs', async () => {
  const req = makeReq({ page: 'abc' });
  const res = makeRes();
  const next = jest.fn();

  await listAuditLogs(req, res, next as NextFunction);

  expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  expect(db.query).not.toHaveBeenCalled();
});

test('a malformed "from" date is rejected with a clean 400', async () => {
  const req = makeReq({ from: 'not-a-date' });
  const res = makeRes();
  const next = jest.fn();

  await listAuditLogs(req, res, next as NextFunction);

  expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  expect(db.query).not.toHaveBeenCalled();
});

test('valid pagination binds real numbers to LIMIT/OFFSET, never the string "NaN"', async () => {
  (db.query as jest.Mock)
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total: '0' }] });

  const req = makeReq({ page: '2', limit: '10' });
  const res = makeRes();
  const next = jest.fn();

  await listAuditLogs(req, res, next as NextFunction);

  expect(next).not.toHaveBeenCalled();
  const [, listParams] = (db.query as jest.Mock).mock.calls[0];
  expect(listParams).toEqual(['club-1', 10, 10]); // limit=10, offset=(2-1)*10
  expect(res.body).toEqual(expect.objectContaining({ page: 2, limit: 10 }));
});
