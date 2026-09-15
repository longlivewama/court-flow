/**
 * CF-QA-05 (MEDIUM) — deactivating a court was a one-way trap: `PATCH
 * {isActive:false}` was silently ignored (zod stripped the unrecognized
 * key, no error, 200, nothing changed); the only real deactivation path was
 * DELETE (soft-delete), which had no reverse endpoint at all; and the
 * global UNIQUE(club_id, number) constraint meant a deactivated court's
 * number could never be reused by a NEW court either, active or not.
 *
 * Fixed by: (1) adding `isActive` to courtUpdateSchema and wiring it into
 * updateCourt's UPDATE statement, so PATCH can now flip it both ways;
 * (2) migration 025 replacing the global unique constraint with a partial
 * unique index scoped to `WHERE is_active = true`.
 */
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

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
  AUDIT_ACTIONS: { COURT_UPDATED: 'COURT_UPDATED', COURT_STATUS_CHANGED: 'COURT_STATUS_CHANGED' },
}));

import { updateCourt } from '../src/interfaces/http/controllers/court.controller';
import { db } from '../src/infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../src/infrastructure/audit/audit.service';
import { ConflictError } from '../src/shared/errors';

function makeReq(id: string, body: unknown, clubId = 'club-1'): Request {
  return {
    params: { id }, body, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId, email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown } {
  const res = {} as Response & { body?: unknown };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

const EXISTING_COURT = { id: 'court-1', name: 'Court 1', number: 5, is_active: false, price_per_slot: '200.00', status: 'closed' };

beforeEach(() => jest.clearAllMocks());

describe('updateCourt — isActive is now a real, wired field (CF-QA-05)', () => {
  test('PATCH {isActive:true} reactivates a deactivated court', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [EXISTING_COURT] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [{ ...EXISTING_COURT, is_active: true }] }); // UPDATE

    const req = makeReq('court-1', { isActive: true });
    const res = makeRes();
    const next = jest.fn();

    await updateCourt(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const updateCall = (db.query as jest.Mock).mock.calls[1];
    expect(updateCall[0]).toMatch(/is_active\s*=\s*COALESCE\(\$8,is_active\)/);
    expect(updateCall[1]).toEqual(['court-1', undefined, undefined, undefined, undefined, undefined, 'club-1', true]);
    expect((res.body as { is_active: boolean }).is_active).toBe(true);
  });

  test('reactivating into a number already taken by another active court is a clean 409, not a 500', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [EXISTING_COURT] })
      .mockRejectedValueOnce({ code: '23505' }); // migration 025's partial unique index violation

    const req = makeReq('court-1', { isActive: true });
    const res = makeRes();
    const next = jest.fn();

    await updateCourt(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.message).toMatch(/already in use by another active court/i);
  });

  test('PATCH {isActive:false} still works too (symmetric field, not a one-way door)', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ ...EXISTING_COURT, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ ...EXISTING_COURT, is_active: false }] });

    const req = makeReq('court-1', { isActive: false });
    const res = makeRes();
    const next = jest.fn();

    await updateCourt(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res.body as { is_active: boolean }).is_active).toBe(false);
  });

  test('an isActive change is audited as COURT_STATUS_CHANGED, distinct from a plain field edit', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [EXISTING_COURT] })
      .mockResolvedValueOnce({ rows: [{ ...EXISTING_COURT, is_active: true }] });

    await updateCourt(makeReq('court-1', { isActive: true }), makeRes(), jest.fn() as unknown as NextFunction);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: AUDIT_ACTIONS.COURT_STATUS_CHANGED })
    );
  });

  test('a plain field edit (no isActive) is still audited as COURT_UPDATED, unaffected', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [EXISTING_COURT] })
      .mockResolvedValueOnce({ rows: [{ ...EXISTING_COURT, name: 'Renamed' }] });

    await updateCourt(makeReq('court-1', { name: 'Renamed' }), makeRes(), jest.fn() as unknown as NextFunction);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: AUDIT_ACTIONS.COURT_UPDATED })
    );
  });
});

describe('migration 025 — court numbers unique among active courts only', () => {
  test('drops the old global unique constraint and adds a partial index scoped to is_active = true', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/025_court_number_active_only_unique.sql'),
      'utf8'
    );
    expect(sql).toMatch(/DROP CONSTRAINT courts_club_id_number_key/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*courts_club_id_number_active_key[\s\S]*ON courts \(club_id, number\)[\s\S]*WHERE is_active = true/i);
  });
});
