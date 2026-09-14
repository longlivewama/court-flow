/**
 * Admin Settings data contract — getClubSettings / updateClubSettings.
 *
 * Guards the Phase 2 fix: GET and PATCH /api/settings must share one field
 * naming contract (the `clubs` table's own column names), numeric ranges
 * must mirror the DB CHECK constraints so a bad value gets a clean 400
 * instead of an unhandled 500, and every query must stay scoped to the
 * caller's own JWT-derived club — never a client-supplied id.
 */
import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { del: jest.fn().mockResolvedValue(undefined), get: jest.fn(), setex: jest.fn() },
  CACHE_KEYS: { clubSettings: (id: string) => `club:${id}:settings`, courtList: (id: string) => `club:${id}:courts`, workingHours: (id: string) => `club:${id}:working_hours` },
  CACHE_TTL: {},
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { SETTINGS_UPDATED: 'SETTINGS_UPDATED' },
}));

import { getClubSettings, updateClubSettings } from '../src/interfaces/http/controllers/court.controller';
import { db } from '../src/infrastructure/database/client';

interface RecordedCall { text: string; params: unknown[]; }

function makeReq(body: unknown, clubId = 'club-1'): Request {
  return {
    body,
    ip: '203.0.113.9',
    headers: {},
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

describe('getClubSettings', () => {
  test('returns the raw club row scoped to the caller\'s own club', async () => {
    const row = { id: 'club-1', name: 'Nile Padel', email: 'a@b.com', phone: '0100', deposit_percent: '40.00', cancellation_deadline_hours: 24 };
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

    const req = makeReq(undefined, 'club-1');
    const res = makeRes();
    const next = jest.fn();

    await getClubSettings(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(row);
    const [text, params] = (db.query as jest.Mock).mock.calls[0];
    expect(text).toMatch(/FROM clubs WHERE id=\$1/i);
    expect(params).toEqual(['club-1']);
  });

  test('a request for a nonexistent club is a 404, not an empty 200', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const req = makeReq(undefined, 'ghost-club');
    const res = makeRes();
    const next = jest.fn();

    await getClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('updateClubSettings', () => {
  function wireUpdate(existingRow: Record<string, unknown>, returnedRow: Record<string, unknown>) {
    const calls: RecordedCall[] = [];
    (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/SELECT \* FROM clubs WHERE id=\$1/i.test(text)) return { rows: [existingRow] };
      if (/UPDATE clubs SET/i.test(text)) return { rows: [returnedRow] };
      return { rows: [] };
    });
    return calls;
  }

  test('persists the full DTO and returns the updated row (round-trip via the same field names GET uses)', async () => {
    const existing = { id: 'club-1', name: 'Old Name', deposit_percent: '30.00' };
    const updated  = { id: 'club-1', name: 'Nile Padel', email: 'owner@nile.com', phone: '0100', deposit_percent: '40.00', cancellation_deadline_hours: 12 };
    const calls = wireUpdate(existing, updated);

    const req = makeReq({
      name: 'Nile Padel', email: 'owner@nile.com', phone: '0100',
      deposit_percent: 40, cancellation_deadline_hours: 12,
    });
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(updated);

    const updateCall = calls.find((c) => /UPDATE clubs SET/i.test(c.text))!;
    // [clubId, name, email, phone, address, deposit_percent, cancellation_deadline_hours, ...]
    expect(updateCall.params[0]).toBe('club-1');
    expect(updateCall.params[1]).toBe('Nile Padel');
    expect(updateCall.params[2]).toBe('owner@nile.com');
    expect(updateCall.params[3]).toBe('0100');
    expect(updateCall.params[5]).toBe(40);
    expect(updateCall.params[6]).toBe(12);
  });

  test('omitted fields are left as undefined (COALESCE keeps the current value) — never silently defaulted', async () => {
    const existing = { id: 'club-1', name: 'Nile Padel', deposit_percent: '40.00' };
    const calls = wireUpdate(existing, existing);

    const req = makeReq({ name: 'Nile Padel' }); // only the name changes
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const updateCall = calls.find((c) => /UPDATE clubs SET/i.test(c.text))!;
    expect(updateCall.params[1]).toBe('Nile Padel');
    // deposit_percent, cancellation_deadline_hours, etc. were never supplied.
    expect(updateCall.params.slice(4)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  test('an empty body is handled safely — a no-op update, not a crash or a reset to defaults', async () => {
    const existing = { id: 'club-1', name: 'Nile Padel' };
    wireUpdate(existing, existing);

    const req = makeReq({});
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(existing);
  });

  test('deposit_percent below the DB CHECK floor (10) is a clean 400, never reaches the database', async () => {
    const req = makeReq({ deposit_percent: 5 });
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('deposit_percent above 100 is rejected', async () => {
    const req = makeReq({ deposit_percent: 150 });
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a negative cancellation_deadline_hours is rejected', async () => {
    const req = makeReq({ cancellation_deadline_hours: -1 });
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a non-numeric deposit_percent is rejected instead of coercing to NaN', async () => {
    const req = makeReq({ deposit_percent: 'not-a-number' });
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(db.query).not.toHaveBeenCalled();
  });

  test('facility isolation: a club_id smuggled into the body is ignored — scope always comes from the JWT', async () => {
    const existing = { id: 'club-1', name: 'Nile Padel' };
    const calls = wireUpdate(existing, existing);

    const req = makeReq({ name: 'Nile Padel', club_id: 'someone-elses-club', id: 'someone-elses-club' }, 'club-1');
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    for (const call of calls) {
      expect(call.params[0]).toBe('club-1');
    }
  });

  test('a request scoped to a different (nonexistent) club 404s instead of updating anything', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // SELECT finds nothing for this club

    const req = makeReq({ name: 'Nile Padel' }, 'ghost-club');
    const res = makeRes();
    const next = jest.fn();

    await updateClubSettings(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect((db.query as jest.Mock).mock.calls).toHaveLength(1); // only the SELECT ran
  });
});
