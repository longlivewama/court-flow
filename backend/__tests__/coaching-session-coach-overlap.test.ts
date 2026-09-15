/**
 * CF-QA-04 (MEDIUM) — createSession had no overlap check scoped to the
 * coach: all three conflict queries (blocked periods, bookings, other
 * training sessions) lived inside `if (parsed.courtId)` and even then were
 * scoped by court_id, never coach_id. A club could double-book the same
 * human coach into two overlapping sessions — including two sessions with
 * NO court at all, since the entire check block was skipped in that case.
 *
 * Fixed by adding an unconditional coach-scoped overlap query (runs
 * regardless of courtId) plus `FOR UPDATE` on the coach row lookup so two
 * concurrent creation requests for the same coach serialize against each
 * other instead of both passing the check before either commits.
 */
import type { Request, Response, NextFunction } from 'express';
import { ConflictError } from '../src/shared/errors';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { TRAINING_SESSION_CREATED: 'TRAINING_SESSION_CREATED' },
}));

import { createSession } from '../src/interfaces/http/controllers/coaching.controller';
import { withTransaction } from '../src/infrastructure/database/client';

function makeReq(body: Record<string, unknown>): Request {
  return {
    body, params: {}, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId: 'club-1', email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; statusCode?: number } {
  const res = {} as Response & { body?: unknown; statusCode?: number };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

const COACH_ROW = { id: '11111111-1111-1111-1111-111111111111', hourly_rate: '200.00', commission_pct: '60' };

interface RecordedCall { text: string; params: unknown[]; }

/** Fake PoolClient dispatched by SQL shape. `existingCoachSessions` controls whether the new coach-overlap query finds a conflict. */
function makeClient(opts: {
  existingCoachSessions?: unknown[];
  existingCourtSessions?: unknown[];
  bookingConflicts?: unknown[];
  blockedPeriods?: unknown[];
} = {}) {
  const calls: RecordedCall[] = [];
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM coaches WHERE id = \$1/i.test(text)) return { rows: [COACH_ROW] };
    if (/FROM courts WHERE id = \$1/i.test(text)) return { rows: [{ id: params[0] }] };
    if (/FROM blocked_periods/i.test(text)) return { rows: opts.blockedPeriods ?? [] };
    if (/FROM bookings\s+WHERE court_id/i.test(text)) return { rows: opts.bookingConflicts ?? [] };
    // Order matters: the coach-scoped query (WHERE coach_id = $1 AND club_id = $2)
    // must be distinguished from the court-scoped one (WHERE court_id = $1).
    if (/FROM training_sessions\s+WHERE coach_id = \$1/i.test(text)) {
      return { rows: opts.existingCoachSessions ?? [] };
    }
    if (/FROM training_sessions\s+WHERE court_id = \$1/i.test(text)) {
      return { rows: opts.existingCourtSessions ?? [] };
    }
    if (/INSERT INTO training_sessions/i.test(text)) {
      return { rows: [{ id: 'session-new', coach_id: params[1], court_id: params[4], start_time: params[5], end_time: params[6], price: params[7], coach_share: params[8], club_share: params[9] }] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    coachId: '11111111-1111-1111-1111-111111111111',
    startTime: '2027-01-10T10:00:00Z',
    endTime: '2027-01-10T11:00:00Z',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('createSession — coach-level overlap protection (CF-QA-04)', () => {
  test('same coach, overlapping time, NO court on either session — rejected (this was the exact unprotected gap)', async () => {
    const client = makeClient({ existingCoachSessions: [{ id: 'session-existing' }] });
    wire(client);

    const req = makeReq(sessionBody({ startTime: '2027-01-10T10:30:00Z', endTime: '2027-01-10T11:30:00Z' }));
    const res = makeRes();
    const next = jest.fn();

    await createSession(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    expect(client.calls.some((c) => /INSERT INTO training_sessions/i.test(c.text))).toBe(false);
  });

  test('same coach, adjacent (touching, non-overlapping) time — allowed', async () => {
    const client = makeClient({ existingCoachSessions: [] });
    wire(client);

    // Existing session ends exactly when the new one starts (11:00) — the
    // query's own params carry the NEW session's window; an empty result
    // here models "no row in the DB overlaps [11:00, 12:00)".
    const req = makeReq(sessionBody({ startTime: '2027-01-10T11:00:00Z', endTime: '2027-01-10T12:00:00Z' }));
    const res = makeRes();
    const next = jest.fn();

    await createSession(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  test('different coach, same time window — allowed (the coach-scoped query itself returns no rows for a different coach)', async () => {
    const client = makeClient({ existingCoachSessions: [] }); // this coach has nothing booked
    wire(client);

    const req = makeReq(sessionBody());
    const res = makeRes();
    const next = jest.fn();

    await createSession(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    const coachOverlapQuery = client.calls.find((c) => /FROM training_sessions\s+WHERE coach_id = \$1/i.test(c.text))!;
    expect(coachOverlapQuery.params[0]).toBe('11111111-1111-1111-1111-111111111111'); // scoped to THIS coach, not global
  });

  test('same coach, different court, overlapping time — still rejected (coach check is independent of court)', async () => {
    const client = makeClient({
      existingCoachSessions: [{ id: 'session-existing' }],
      existingCourtSessions: [], // the court-scoped check alone would have missed this
    });
    wire(client);

    const req = makeReq(sessionBody({ courtId: '99999999-9999-9999-9999-999999999999', startTime: '2027-01-10T10:15:00Z', endTime: '2027-01-10T11:15:00Z' }));
    const res = makeRes();
    const next = jest.fn();

    await createSession(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
  });

  test('the coach row lookup takes FOR UPDATE (concurrency safety, mirrors the existing court lock)', async () => {
    const client = makeClient();
    wire(client);

    await createSession(makeReq(sessionBody()), makeRes(), jest.fn() as unknown as NextFunction);

    const coachLookup = client.calls.find((c) => /FROM coaches WHERE id = \$1/i.test(c.text))!;
    expect(coachLookup.text).toMatch(/FOR UPDATE/i);
  });

  test('a cancelled session for the same coach at an overlapping time does not block a new one', async () => {
    // The mock's coach-conflict branch is only hit when the SQL's own status
    // filter would have matched — modeling "no non-cancelled row overlaps"
    // by returning an empty set is the correct simulation of the real
    // `status <> 'cancelled'` clause in the query itself.
    const client = makeClient({ existingCoachSessions: [] });
    wire(client);

    const req = makeReq(sessionBody());
    const res = makeRes();
    const next = jest.fn();

    await createSession(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const coachOverlapQuery = client.calls.find((c) => /FROM training_sessions\s+WHERE coach_id = \$1/i.test(c.text))!;
    expect(coachOverlapQuery.text).toMatch(/status\s*<>\s*'cancelled'/i);
  });
});
