/**
 * Verify Deposit use case — core business logic coverage (Phase 15).
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { DEPOSIT_APPROVED: 'DEPOSIT_APPROVED', DEPOSIT_REJECTED: 'DEPOSIT_REJECTED' },
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPaymentRejected: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/infrastructure/whatsapp/whatsapp.service', () => ({
  whatsappService: { sendOwnerConfirmedBooking: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../src/infrastructure/sheets/sheets.service', () => ({
  sheetsService: { syncOwnerConfirmedBooking: jest.fn().mockResolvedValue(undefined) },
}));

import { verifyDeposit, VerifyDepositInput } from '../src/application/booking/verify-deposit.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { auditLogStrict } from '../src/infrastructure/audit/audit.service';
import { emailService } from '../src/infrastructure/email/email.service';
import { whatsappService } from '../src/infrastructure/whatsapp/whatsapp.service';
import { sheetsService } from '../src/infrastructure/sheets/sheets.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../src/shared/errors';

interface RecordedCall { text: string; params: unknown[]; }

function baseBookingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'booking-1', status: 'pending_verification', customer_id: 'cust-1', court_id: 'court-1',
    start_time: new Date(), end_time: new Date(), total_price: 200, deposit_amount: 100,
    ...overrides,
  };
}

function makeClient(opts: {
  bookingRow?: Record<string, unknown> | null;
  paymentRow?: { id: string } | null;
  customer?: Record<string, unknown> | null;
} = {}) {
  const calls: RecordedCall[] = [];
  const bookingRow = opts.bookingRow === undefined ? baseBookingRow() : opts.bookingRow;
  const paymentRow = opts.paymentRow === undefined ? { id: 'payment-1' } : opts.paymentRow;
  const customer = opts.customer === undefined ? { email: 'cust@x.com', first_name: 'Nour', phone: '0100' } : opts.customer;

  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM bookings WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: bookingRow ? [bookingRow] : [] };
    if (/SELECT id FROM payments WHERE booking_id/i.test(text)) return { rows: paymentRow ? [paymentRow] : [] };
    if (/SELECT email, first_name, phone FROM users/i.test(text)) return { rows: customer ? [customer] : [] };
    if (/SELECT name FROM courts WHERE id = \$1/i.test(text)) return { rows: [{ name: 'Court 1' }] };
    if (/UPDATE bookings SET status = 'confirmed'/i.test(text)) return { rows: [] };
    if (/UPDATE payments SET status = 'deposit_approved'/i.test(text)) return { rows: [] };
    if (/UPDATE payments SET status = 'deposit_rejected'/i.test(text)) return { rows: [] };
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseInput(overrides: Partial<VerifyDepositInput> = {}): VerifyDepositInput {
  return { bookingId: 'booking-1', receptionistId: 'staff-1', clubId: 'club-1', action: 'approve', ...overrides };
}

beforeEach(() => jest.clearAllMocks());

describe('verifyDeposit — approve', () => {
  test('confirms the booking and marks the payment deposit_approved', async () => {
    const client = makeClient();
    wire(client);

    await verifyDeposit(baseInput());

    expect(client.calls.some((c) => /UPDATE bookings SET status = 'confirmed'/i.test(c.text))).toBe(true);
    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status = 'deposit_approved'/i.test(c.text))!;
    expect(paymentUpdate.params).toEqual(['payment-1', 'staff-1']);
    expect(auditLogStrict).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionType: 'DEPOSIT_APPROVED' }));
  });

  test('sends the confirmation email and WhatsApp message after commit', async () => {
    const client = makeClient();
    wire(client);

    await verifyDeposit(baseInput());

    expect(emailService.sendBookingConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'cust@x.com', firstName: 'Nour', bookingId: 'booking-1' })
    );
    expect(whatsappService.sendOwnerConfirmedBooking).toHaveBeenCalled();
    expect(sheetsService.syncOwnerConfirmedBooking).toHaveBeenCalledWith(
      'club-1', 'booking-1', expect.objectContaining({ channel: 'WhatsApp ✓' })
    );
  });

  test('an email failure does not throw and does not block WhatsApp/Sheets', async () => {
    (emailService.sendBookingConfirmation as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'));
    const client = makeClient();
    wire(client);

    await expect(verifyDeposit(baseInput())).resolves.toBeUndefined();
    expect(whatsappService.sendOwnerConfirmedBooking).toHaveBeenCalled();
  });

  test('a WhatsApp failure is reflected in the Sheets channel column, not thrown', async () => {
    (whatsappService.sendOwnerConfirmedBooking as jest.Mock).mockRejectedValueOnce(new Error('WA down'));
    const client = makeClient();
    wire(client);

    await verifyDeposit(baseInput());

    expect(sheetsService.syncOwnerConfirmedBooking).toHaveBeenCalledWith(
      'club-1', 'booking-1', expect.objectContaining({ channel: 'WhatsApp failed' })
    );
  });

  test('no customer record on file means no notification is attempted, but approval still succeeds', async () => {
    const client = makeClient({ customer: null });
    wire(client);

    await verifyDeposit(baseInput());

    expect(emailService.sendBookingConfirmation).not.toHaveBeenCalled();
  });
});

describe('verifyDeposit — reject', () => {
  test('marks the payment deposit_rejected with the given reason and notifies the customer', async () => {
    const client = makeClient();
    wire(client);

    await verifyDeposit(baseInput({ action: 'reject', rejectionReason: 'Blurry receipt' }));

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status = 'deposit_rejected'/i.test(c.text))!;
    expect(paymentUpdate.params).toEqual(['payment-1', 'Blurry receipt', 'staff-1']);
    expect(client.calls.some((c) => /UPDATE bookings SET status = 'confirmed'/i.test(c.text))).toBe(false);
    expect(emailService.sendPaymentRejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Blurry receipt' })
    );
  });

  test('a missing rejection reason falls back to a default message', async () => {
    const client = makeClient();
    wire(client);

    await verifyDeposit(baseInput({ action: 'reject' }));

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status = 'deposit_rejected'/i.test(c.text))!;
    expect(paymentUpdate.params[1]).toBe('Receipt rejected by receptionist');
  });
});

describe('verifyDeposit — guards', () => {
  test('an unknown booking id is a 404', async () => {
    const client = makeClient({ bookingRow: null });
    wire(client);

    await expect(verifyDeposit(baseInput())).rejects.toThrow(NotFoundError);
  });

  test('a booking not in pending_verification cannot be verified', async () => {
    const client = makeClient({ bookingRow: baseBookingRow({ status: 'confirmed' }) });
    wire(client);

    await expect(verifyDeposit(baseInput())).rejects.toThrow(ForbiddenError);
  });

  test('a booking with no payment on file cannot be verified', async () => {
    const client = makeClient({ paymentRow: null });
    wire(client);

    await expect(verifyDeposit(baseInput())).rejects.toThrow(ValidationError);
  });
});
