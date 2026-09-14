/**
 * Delete Booking use case — core business logic coverage (Phase 15).
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { BOOKING_DELETED: 'BOOKING_DELETED' },
}));

import { deleteBooking, DeleteBookingInput } from '../src/application/booking/delete-booking.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { auditLogStrict } from '../src/infrastructure/audit/audit.service';
import { NotFoundError, ConflictError } from '../src/shared/errors';

interface RecordedCall { text: string; params: unknown[]; }

function makeClient(opts: { bookingRow?: Record<string, unknown> | null; refundCount?: number } = {}) {
  const calls: RecordedCall[] = [];
  const bookingRow = opts.bookingRow === undefined ? { id: 'booking-1', status: 'confirmed' } : opts.bookingRow;

  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM bookings b[\s\S]*FOR UPDATE OF b/i.test(text)) return { rows: bookingRow ? [bookingRow] : [] };
    if (/SELECT COUNT\(\*\) AS count FROM refunds/i.test(text)) return { rows: [{ count: String(opts.refundCount ?? 0) }] };
    if (/UPDATE bookings[\s\S]*SET deleted_at/i.test(text)) return { rows: [] };
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseInput(overrides: Partial<DeleteBookingInput> = {}): DeleteBookingInput {
  return { bookingId: 'booking-1', clubId: 'club-1', deletedBy: 'owner-1', deletedByRole: 'owner', reason: 'Duplicate entry', ...overrides };
}

beforeEach(() => jest.clearAllMocks());

test('soft-deletes the booking and writes an audit record with the pre-deletion snapshot', async () => {
  const client = makeClient();
  wire(client);

  await deleteBooking(baseInput());

  expect(auditLogStrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    actionType: 'BOOKING_DELETED',
    previousValues: expect.objectContaining({ id: 'booking-1' }),
    reason: 'Duplicate entry',
  }));
  const update = client.calls.find((c) => /UPDATE bookings[\s\S]*SET deleted_at/i.test(c.text))!;
  expect(update.params).toEqual(['booking-1', 'owner-1', 'Duplicate entry']);
});

test('an unknown or already-deleted booking is a 404', async () => {
  const client = makeClient({ bookingRow: null });
  wire(client);

  await expect(deleteBooking(baseInput())).rejects.toThrow(NotFoundError);
});

test('a booking with existing refund records cannot be deleted', async () => {
  const client = makeClient({ refundCount: 1 });
  wire(client);

  await expect(deleteBooking(baseInput())).rejects.toThrow(ConflictError);
  expect(auditLogStrict).not.toHaveBeenCalled();
  expect(client.calls.some((c) => /UPDATE bookings[\s\S]*SET deleted_at/i.test(c.text))).toBe(false);
});
