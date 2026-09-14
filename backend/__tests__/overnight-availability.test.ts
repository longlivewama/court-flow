/**
 * Overnight / midnight availability (Phase 6).
 *
 * getCourtAvailability and getDailySchedule used to filter bookings by
 * start_time alone (e.g. `start_time >= dayStart AND start_time <= dayEnd`,
 * or `start_time >= windowStart`), which misses a booking that started
 * BEFORE the requested window but is still running when it begins — e.g. a
 * 23:00→01:00 overnight booking querying the day it ends on, or an 11:00
 * booking still running when a noon-anchored staff schedule window opens.
 * Both now use half-open interval overlap: existing.start < window.end AND
 * existing.end > window.start — the same semantics the conflict check in
 * booking.validator.ts and the already-correct getAvailabilityGrid used.
 */
import type { Request, Response, NextFunction } from 'express';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));
jest.mock('../src/infrastructure/cache/redis.client', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), del: jest.fn(), setex: jest.fn() },
  CACHE_KEYS: { courtList: (id: string) => `club:${id}:courts` },
  CACHE_TTL: {},
}));

import { getCourtAvailability, getDailySchedule } from '../src/interfaces/http/controllers/court.controller';
import { db } from '../src/infrastructure/database/client';

interface RecordedCall { text: string; params: unknown[]; }

function makeReq(query: Record<string, string>, params: Record<string, string> = {}): Request {
  return {
    query, params, ip: '203.0.113.9', headers: {},
    user: { sub: 'owner-1', role: 'owner', clubId: 'club-1', email: 'o@x.com', jti: 'jti-1' },
  } as unknown as Request;
}

function makeRes(): Response & { body?: any } {
  const res = {} as Response & { body?: any };
  res.status = jest.fn(() => res) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => { res.body = body; return res; }) as unknown as Response['json'];
  return res;
}

/** Half-open interval overlap — the rule under test, applied to captured SQL params. */
function overlaps(existingStart: Date, existingEnd: Date, windowStart: Date, windowEnd: Date): boolean {
  return existingStart.getTime() < windowEnd.getTime() && existingEnd.getTime() > windowStart.getTime();
}

beforeEach(() => jest.clearAllMocks());

describe('getCourtAvailability — half-open overlap', () => {
  test('query uses start < windowEnd AND end > windowStart, not a start_time-only filter', async () => {
    const calls: RecordedCall[] = [];
    (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: [] };
    });

    const req = makeReq({ date: '2026-09-15' }, { id: 'court-1' });
    const res = makeRes();
    const next = jest.fn();
    await getCourtAvailability(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const bookingsCall = calls.find((c) => /FROM bookings/i.test(c.text))!;
    expect(bookingsCall.text).toMatch(/start_time\s*<\s*\$4/i);
    expect(bookingsCall.text).toMatch(/end_time\s*>\s*\$3/i);
    expect(bookingsCall.text).not.toMatch(/start_time\s*>=/i);

    // The requested day's [dayStart, dayEnd] window, as actually bound.
    const [, , dayStartIso, dayEndIso] = bookingsCall.params as string[];
    const windowStart = new Date(dayStartIso);
    const windowEnd   = new Date(dayEndIso);

    // A booking that started the PREVIOUS day at 23:00 and runs to 01:00 this
    // day must overlap this window — this is exactly what the old
    // start_time-only filter missed.
    const overnightStart = new Date(windowStart.getTime() - 60 * 60 * 1000); // 23:00 prev day
    const overnightEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000); // 01:00 this day
    expect(overlaps(overnightStart, overnightEnd, windowStart, windowEnd)).toBe(true);
  });
});

describe('getDailySchedule — half-open overlap', () => {
  test('bookings query uses interval overlap against the noon→6am window, not start_time-only', async () => {
    const calls: RecordedCall[] = [];
    (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: [] };
    });

    const req = makeReq({ date: '2026-09-15' });
    const res = makeRes();
    const next = jest.fn();
    await getDailySchedule(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    const bookingsCall = calls.find((c) => /FROM bookings b/i.test(c.text))!;
    expect(bookingsCall.text).toMatch(/b\.start_time\s*<\s*\$3/i);
    expect(bookingsCall.text).toMatch(/b\.end_time\s*>\s*\$2/i);
    expect(bookingsCall.text).not.toMatch(/b\.start_time\s*>=\s*\$2/i);

    const [, windowStartIso, windowEndIso] = bookingsCall.params as string[];
    const windowStart = new Date(windowStartIso); // noon Cairo
    const windowEnd   = new Date(windowEndIso);   // 6am next day Cairo

    // A booking starting an hour before noon and running two hours (ending
    // an hour into the window) must still show on the schedule.
    const earlyStart = new Date(windowStart.getTime() - 60 * 60 * 1000);
    const earlyEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    expect(overlaps(earlyStart, earlyEnd, windowStart, windowEnd)).toBe(true);

    // Symmetry check: the sibling blocked_periods query in the same handler
    // already used this exact shape — bookings must now match it.
    const blockedCall = calls.find((c) => /FROM blocked_periods/i.test(c.text))!;
    expect(blockedCall.text).toMatch(/start_at\s*<\s*\$3/i);
    expect(blockedCall.text).toMatch(/end_at\s*>\s*\$2/i);
  });
});

describe('half-open interval overlap rule — boundary cases (documents the shared semantics)', () => {
  const t = (iso: string) => new Date(iso);

  test('adjacent bookings that only touch at the boundary do NOT overlap', () => {
    // existing ends exactly when the new one starts
    expect(overlaps(t('2026-09-15T10:00:00Z'), t('2026-09-15T11:00:00Z'), t('2026-09-15T11:00:00Z'), t('2026-09-15T12:00:00Z'))).toBe(false);
  });

  test('same start instant counts as overlapping', () => {
    expect(overlaps(t('2026-09-15T10:00:00Z'), t('2026-09-15T11:00:00Z'), t('2026-09-15T10:00:00Z'), t('2026-09-15T10:30:00Z'))).toBe(true);
  });

  test('same end instant counts as overlapping', () => {
    expect(overlaps(t('2026-09-15T10:00:00Z'), t('2026-09-15T11:00:00Z'), t('2026-09-15T10:30:00Z'), t('2026-09-15T11:00:00Z'))).toBe(true);
  });

  test('fully contained interval overlaps', () => {
    expect(overlaps(t('2026-09-15T10:00:00Z'), t('2026-09-15T12:00:00Z'), t('2026-09-15T10:30:00Z'), t('2026-09-15T11:00:00Z'))).toBe(true);
  });

  test('completely disjoint intervals do not overlap', () => {
    expect(overlaps(t('2026-09-15T08:00:00Z'), t('2026-09-15T09:00:00Z'), t('2026-09-15T10:00:00Z'), t('2026-09-15T11:00:00Z'))).toBe(false);
  });
});
