/**
 * Phase 12 — error handling: a DB-level constraint violation must never
 * reach the client as a raw, opaque 500. createBooking() is protected by an
 * app-level FOR UPDATE lock + validateBookingSlot's conflict check, so this
 * exclusion-constraint/unique-violation path should be unreachable in normal
 * operation — but if migration 021's EXCLUDE constraint (or any unique index)
 * ever does trip as a last-resort backstop, it must surface as the same
 * clean ConflictError a normal slot-conflict rejection would give.
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/domain/booking/booking.validator', () => ({
  validateBookingSlot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {},
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: { sendBookingConfirmation: jest.fn() },
}));
jest.mock('../src/infrastructure/sheets/sheets.service', () => ({
  sheetsService: { syncLedgerRow: jest.fn() },
}));

import { createBooking, CreateBookingInput } from '../src/application/booking/create-booking.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { ConflictError } from '../src/shared/errors';

function baseInput(): CreateBookingInput {
  return {
    clubId: 'club-1', courtId: 'court-1', customerId: 'cust-1',
    createdBy: 'cust-1', createdByRole: 'customer',
    startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    durationMinutes: 60, processedById: null,
  };
}

beforeEach(() => jest.clearAllMocks());

test('an exclusion-violation (23P01) from the DB is translated into a clean ConflictError', async () => {
  (withTransaction as jest.Mock).mockRejectedValue(Object.assign(new Error('conflicting key value'), { code: '23P01' }));

  await expect(createBooking(baseInput())).rejects.toThrow(ConflictError);
  await expect(createBooking(baseInput())).rejects.toThrow(/already booked|just booked/i);
});

test('a unique-violation (23505) from the DB is also translated into a ConflictError', async () => {
  (withTransaction as jest.Mock).mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

  await expect(createBooking(baseInput())).rejects.toThrow(ConflictError);
});

test('an unrelated DB error is rethrown unchanged, not swallowed or misreported as a conflict', async () => {
  const original = Object.assign(new Error('connection terminated'), { code: '57P01' });
  (withTransaction as jest.Mock).mockRejectedValue(original);

  await expect(createBooking(baseInput())).rejects.toBe(original);
});
