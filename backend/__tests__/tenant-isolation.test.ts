/**
 * Multi-tenant / RBAC isolation (Phase 9).
 *
 * requireClubResource is the one guard standing between "my club's booking"
 * and "any club's booking, if you can guess the UUID" — these tests lock in
 * its cross-tenant behavior (404, never 403, so existence is never leaked)
 * and requirePermission's owner-bypass + live-permission-check behavior.
 */
import type { Request, Response, NextFunction } from 'express';
import { NotFoundError, ForbiddenError, UnauthorizedError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));
jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { get: jest.fn(), setex: jest.fn(), call: jest.fn() },
  CACHE_KEYS: {},
  CACHE_TTL: {},
}));

import { requireClubResource, requirePermission } from '../src/interfaces/http/middleware/tenant.middleware';
import { db } from '../src/infrastructure/database/client';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {}, headers: {}, ip: '203.0.113.9',
    user: { sub: 'user-1', role: 'receptionist', clubId: 'club-1', email: 'x@y.com', jti: 'jti-1' },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('requireClubResource — cross-tenant isolation', () => {
  test('a resource belonging to a DIFFERENT club is a 404, never a 403 or the real data', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ club_id: 'someone-elses-club' }] });

    const req = makeReq({ params: { id: '11111111-1111-1111-1111-111111111111' } });
    const next = jest.fn();
    await requireClubResource('bookings')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(next).not.toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  test('a resource belonging to MY club passes through', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ club_id: 'club-1' }] });

    const req = makeReq({ params: { id: '11111111-1111-1111-1111-111111111111' } });
    const next = jest.fn();
    await requireClubResource('bookings')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(); // no error arg
  });

  test('a nonexistent resource id is also a 404 (indistinguishable from cross-tenant)', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ params: { id: '11111111-1111-1111-1111-111111111111' } });
    const next = jest.fn();
    await requireClubResource('bookings')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });

  test('a malformed (non-UUID) id is rejected as not-found before any query runs — no SQL cast error leaks', async () => {
    const req = makeReq({ params: { id: "'; DROP TABLE bookings; --" } });
    const next = jest.fn();
    await requireClubResource('bookings')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a custom idParam (e.g. bpId) is honored', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ club_id: 'club-1' }] });

    const req = makeReq({ params: { bpId: '11111111-1111-1111-1111-111111111111' } });
    const next = jest.fn();
    await requireClubResource('blocked_periods', 'bpId')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  test('an unauthenticated request (no clubId on the JWT) never reaches the DB', async () => {
    const req = makeReq({ user: undefined, params: { id: '11111111-1111-1111-1111-111111111111' } });
    const next = jest.fn();
    await requireClubResource('bookings')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('requirePermission — granular staff permissions', () => {
  test('an owner bypasses the permission check entirely (no DB lookup)', async () => {
    const req = makeReq({ user: { sub: 'owner-1', role: 'owner', clubId: 'club-1', email: 'o@x.com', jti: 'j' } });
    const next = jest.fn();
    await requirePermission('can_view_finance')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a receptionist without the flag is forbidden', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ allowed: false }] });
    const req = makeReq();
    const next = jest.fn();
    await requirePermission('can_view_finance')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  test('a receptionist WITH the flag passes, scoped to their own club', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ allowed: true }] });
    const req = makeReq();
    const next = jest.fn();
    await requirePermission('can_view_finance')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
    const [, params] = (db.query as jest.Mock).mock.calls[0];
    expect(params).toEqual(['user-1', 'club-1']);
  });

  test('a staff account deactivated/removed mid-session (no matching row) is forbidden, not silently allowed', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const req = makeReq();
    const next = jest.fn();
    await requirePermission('can_view_finance')(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});
