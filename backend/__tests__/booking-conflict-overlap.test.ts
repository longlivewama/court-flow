/**
 * Booking conflict detection — half-open interval overlap (Phase 6).
 *
 * validateBookingSlot's existing-booking conflict check already uses correct
 * half-open semantics (existing.start < new.end AND existing.end >
 * new.start); these are regression tests locking that in, since it's the
 * one code path where getting this wrong would double-book a court.
 */
import { validateBookingSlot } from '../src/domain/booking/booking.validator';
import { ConflictError } from '../src/shared/errors';

interface RecordedCall { text: string; params: unknown[]; }

/** A fake PoolClient; conflictRows controls what the final overlap check "finds". */
function makeClient(conflictRows: Array<{ id: string }>) {
  const calls: RecordedCall[] = [];
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM courts WHERE id = \$1/i.test(text)) {
      return { rows: [{ id: 'court-1', status: 'available', is_active: true }] };
    }
    if (/FROM blocked_periods/i.test(text)) return { rows: [] };
    if (/FROM bookings\s+WHERE court_id/i.test(text)) return { rows: conflictRows };
    return { rows: [] };
  });
  return { query, calls } as any;
}

function baseParams(overrides: Partial<Parameters<typeof validateBookingSlot>[1]> = {}) {
  return {
    clubId: 'club-1', courtId: 'court-1',
    startTime: new Date('2026-09-15T10:00:00.000Z'),
    durationMinutes: 60,
    bypassWorkingHours: true, // isolates the conflict-check logic under test
    ...overrides,
  };
}

describe('validateBookingSlot — conflict query shape', () => {
  test('uses strict < / > (half-open), never <=/>= which would reject touching-but-not-overlapping slots', async () => {
    const client = makeClient([]);
    await validateBookingSlot(client, baseParams());

    const conflictCall = client.calls.find((c: RecordedCall) => /FROM bookings\s+WHERE court_id/i.test(c.text))!;
    expect(conflictCall.text).toMatch(/start_time\s*<\s*\$3/);
    expect(conflictCall.text).toMatch(/end_time\s*>\s*\$2/);
    expect(conflictCall.text).not.toMatch(/start_time\s*<=/);
    expect(conflictCall.text).not.toMatch(/end_time\s*>=/);
  });

  test('an overnight existing booking (23:00→01:00) conflicts with a request starting at 00:30', async () => {
    // The DB is the source of truth for the actual overlap decision; this
    // simulates Postgres correctly finding the overnight row under the
    // half-open predicate, and asserts the params bound to that query are
    // the exact requested-slot boundaries (client-supplied, not mangled).
    const client = makeClient([{ id: 'overnight-booking' }]);

    await expect(
      validateBookingSlot(client, baseParams({ startTime: new Date('2026-09-15T00:30:00.000Z'), durationMinutes: 60 }))
    ).rejects.toThrow(ConflictError);

    const conflictCall = client.calls.find((c: RecordedCall) => /FROM bookings\s+WHERE court_id/i.test(c.text))!;
    expect(conflictCall.params[1]).toBe('2026-09-15T00:30:00.000Z');
    expect(conflictCall.params[2]).toBe('2026-09-15T01:30:00.000Z');
  });

  test('excludeBookingId is bound as a parameter, appended to the conflict query', async () => {
    const client = makeClient([]);
    await validateBookingSlot(client, baseParams({ excludeBookingId: 'booking-99' }));

    const conflictCall = client.calls.find((c: RecordedCall) => /FROM bookings\s+WHERE court_id/i.test(c.text))!;
    expect(conflictCall.text).toMatch(/id <> \$4/);
    expect(conflictCall.params[3]).toBe('booking-99');
  });

  test('a genuine conflict throws ConflictError with no other side effects', async () => {
    const client = makeClient([{ id: 'existing-booking' }]);
    await expect(validateBookingSlot(client, baseParams())).rejects.toThrow(ConflictError);
  });

  test('an unavailable court is rejected before the conflict check ever runs', async () => {
    const calls: RecordedCall[] = [];
    const client = {
      query: jest.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (/FROM courts WHERE id = \$1/i.test(text)) {
          return { rows: [{ id: 'court-1', status: 'maintenance', is_active: true }] };
        }
        return { rows: [] };
      }),
    } as any;

    await expect(validateBookingSlot(client, baseParams())).rejects.toThrow(/not available/i);
    expect(calls.some((c) => /FROM bookings\s+WHERE court_id/i.test(c.text))).toBe(false);
  });
});
