/**
 * Cancel Booking use case — core business logic coverage (Phase 15).
 *
 * Exercises the refund/forfeit policy decision, payment/ledger settlement,
 * authorization guards, idempotency (terminal-state guard), and the
 * prime-time waitlist routing side effect — all under a mocked PoolClient
 * dispatched by SQL shape, mirroring the style already established in
 * create-subscription.usecase.test.ts.
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { BOOKING_CANCELLED: 'BOOKING_CANCELLED', SLOT_HOLD_CREATED: 'SLOT_HOLD_CREATED' },
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: {
    sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
    sendWaitlistSlotOffer: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/infrastructure/whatsapp/whatsapp.service', () => ({
  whatsappService: { sendBookingCancelled: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/domain/booking/prime-time', () => ({
  isPrimeTime: jest.fn().mockReturnValue(false),
  WAITLIST_HOLD_MINUTES: 5,
}));

import { cancelBooking, CancelBookingInput } from '../src/application/booking/cancel-booking.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { emailService } from '../src/infrastructure/email/email.service';
import { whatsappService } from '../src/infrastructure/whatsapp/whatsapp.service';
import { isPrimeTime } from '../src/domain/booking/prime-time';
import { ForbiddenError, ValidationError, NotFoundError } from '../src/shared/errors';

interface RecordedCall { text: string; params: unknown[]; }

function futureDate(hours: number): Date { return new Date(Date.now() + hours * 3_600_000); }

function baseBookingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'booking-1', status: 'confirmed', customer_id: 'cust-1', court_id: 'court-1',
    start_time: futureDate(48), end_time: futureDate(49),
    total_price: '1000.00',
    deposit_amount: '500.00', deposit_method: 'CASH',
    remainder_amount: '0.00', remainder_method: 'NONE',
    deposit_status: 'approved', court_name: 'Court 1',
    ...overrides,
  };
}

/** Fake PoolClient dispatched by SQL shape. `payment` may be null (no payment on file). */
function makeClient(opts: {
  bookingRow?: Record<string, unknown> | null;
  deadlineHours?: number;
  payment?: { id: string; status: string } | null;
  waitlistEntry?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
} = {}) {
  const calls: RecordedCall[] = [];
  const bookingRow = opts.bookingRow === undefined ? baseBookingRow() : opts.bookingRow;
  const payment = opts.payment === undefined ? { id: 'payment-1', status: 'paid_in_full' } : opts.payment;

  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/SELECT b\.id, b\.status, b\.customer_id/i.test(text)) {
      return { rows: bookingRow ? [bookingRow] : [] };
    }
    if (/SELECT cancellation_deadline_hours FROM clubs/i.test(text)) {
      return { rows: [{ cancellation_deadline_hours: opts.deadlineHours ?? 24 }] };
    }
    if (/UPDATE bookings\s+SET status = 'cancelled'/i.test(text)) {
      return { rows: [] };
    }
    if (/SELECT id, status FROM payments WHERE booking_id/i.test(text)) {
      return { rows: payment ? [payment] : [] };
    }
    if (/UPDATE payments SET status/i.test(text)) {
      return { rows: [] };
    }
    if (/INSERT INTO ledger_entries/i.test(text)) {
      return { rows: [{ id: 'ledger-1' }] };
    }
    if (/FROM waitlist_entries w/i.test(text)) {
      return { rows: opts.waitlistEntry ? [opts.waitlistEntry] : [] };
    }
    if (/INSERT INTO slot_holds/i.test(text)) {
      return { rows: [{ id: 'hold-1' }] };
    }
    if (/UPDATE waitlist_entries SET fulfilled_at/i.test(text)) {
      return { rows: [] };
    }
    if (/SELECT email, first_name, phone FROM users WHERE id = \$1/i.test(text)) {
      return { rows: [opts.customer ?? { email: 'cust@x.com', first_name: 'Nour', phone: '0100' }] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseInput(overrides: Partial<CancelBookingInput> = {}): CancelBookingInput {
  return {
    bookingId: 'booking-1', clubId: 'club-1', actorId: 'cust-1', actorRole: 'customer',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (isPrimeTime as jest.Mock).mockReturnValue(false);
});

describe('cancelBooking — refund/forfeit policy', () => {
  test('cancelling well before the deadline refunds the full collected amount', async () => {
    const client = makeClient({ deadlineHours: 24 });
    wire(client);

    const result = await cancelBooking(baseInput());

    expect(result.refundStatus).toBe('REFUNDED');
    expect(result.refundAmount).toBe(500);
    expect(result.afterDeadline).toBe(false);

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status/i.test(c.text))!;
    expect(paymentUpdate.text).toMatch(/status = 'fully_refunded'/);
    // CF-QA-03: refunded_amount must be written alongside status, not left at
    // its default 0 — this used to be `['payment-1']` (the bug: status said
    // fully_refunded while refunded_amount silently stayed 0).
    expect(paymentUpdate.params).toEqual(['payment-1', 500]);
    const ledgerInsert = client.calls.find((c) => /INSERT INTO ledger_entries/i.test(c.text))!;
    expect(ledgerInsert.params[1]).toBe('REFUND');
    expect(ledgerInsert.params[2]).toBe('DEBIT');
    expect(ledgerInsert.params[3]).toBe(500);
  });

  test('CF-QA-03: refunded_amount always equals the actual refunded amount, never left at 0 while status says fully_refunded', async () => {
    const client = makeClient({
      bookingRow: baseBookingRow({ deposit_amount: '750.00' }),
      deadlineHours: 24,
    });
    wire(client);

    await cancelBooking(baseInput());

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status = 'fully_refunded'/i.test(c.text))!;
    expect(paymentUpdate).toBeDefined();
    expect(paymentUpdate.text).toMatch(/refunded_amount\s*=\s*\$2/);
    expect(paymentUpdate.params).toEqual(['payment-1', 750]);
  });

  test('cancelling after the deadline forfeits the deposit instead of refunding', async () => {
    const client = makeClient({
      bookingRow: baseBookingRow({ start_time: futureDate(1), end_time: futureDate(2) }),
      deadlineHours: 24, // deadline was 23h ago relative to a booking starting in 1h
    });
    wire(client);

    const result = await cancelBooking(baseInput());

    expect(result.refundStatus).toBe('FORFEITED');
    expect(result.refundAmount).toBe(0);
    expect(result.afterDeadline).toBe(true);

    const paymentUpdate = client.calls.find((c) => /UPDATE payments SET status/i.test(c.text))!;
    expect(paymentUpdate.text).toMatch(/status = 'forfeited'/);
    expect(paymentUpdate.params).toEqual(['payment-1']);
    const ledgerInsert = client.calls.find((c) => /INSERT INTO ledger_entries/i.test(c.text))!;
    expect(ledgerInsert.params[1]).toBe('FORFEIT_INCOME');
    expect(ledgerInsert.params[2]).toBe('CREDIT');
    expect(ledgerInsert.params[3]).toBe(500); // full collected amount retained
  });

  test('a booking with nothing collected settles as NOT_APPLICABLE with no payment/ledger writes', async () => {
    const client = makeClient({
      bookingRow: baseBookingRow({ deposit_method: 'NONE', deposit_amount: '0.00' }),
      payment: null,
    });
    wire(client);

    const result = await cancelBooking(baseInput());

    expect(result.refundStatus).toBe('NOT_APPLICABLE');
    expect(result.collectedAmount).toBe(0);
    expect(client.calls.some((c) => /UPDATE payments SET status/i.test(c.text))).toBe(false);
    expect(client.calls.some((c) => /INSERT INTO ledger_entries/i.test(c.text))).toBe(false);
  });

  test('staff override "refund" forces a refund even after the deadline', async () => {
    const client = makeClient({
      bookingRow: baseBookingRow({ start_time: futureDate(1), end_time: futureDate(2) }),
      deadlineHours: 24,
    });
    wire(client);

    const result = await cancelBooking(baseInput({
      actorId: 'staff-1', actorRole: 'owner', refundOverride: 'refund', reason: 'Goodwill',
    }));

    expect(result.refundStatus).toBe('REFUNDED');
  });

  test('staff override "forfeit" forces a forfeit even before the deadline', async () => {
    const client = makeClient({ deadlineHours: 24 });
    wire(client);

    const result = await cancelBooking(baseInput({
      actorId: 'staff-1', actorRole: 'owner', refundOverride: 'forfeit', reason: 'Policy exception',
    }));

    expect(result.refundStatus).toBe('FORFEITED');
  });

  test('a customer-supplied refundOverride is ignored — customers always follow the deadline policy', async () => {
    const client = makeClient({ deadlineHours: 24 }); // well before deadline → would normally refund
    wire(client);

    const result = await cancelBooking(baseInput({ refundOverride: 'forfeit' as any }));

    expect(result.refundStatus).toBe('REFUNDED'); // override silently ignored for customers
  });
});

describe('cancelBooking — authorization', () => {
  test('a customer cannot cancel another customer\'s booking', async () => {
    const client = makeClient({ bookingRow: baseBookingRow({ customer_id: 'someone-else' }) });
    wire(client);

    await expect(cancelBooking(baseInput())).rejects.toThrow(ForbiddenError);
  });

  test('a coach can never cancel a court booking', async () => {
    const client = makeClient();
    wire(client);

    await expect(cancelBooking(baseInput({ actorId: 'coach-1', actorRole: 'coach' }))).rejects.toThrow(ForbiddenError);
  });

  test('staff (receptionist) can cancel any booking in their club', async () => {
    const client = makeClient();
    wire(client);

    const result = await cancelBooking(baseInput({ actorId: 'staff-1', actorRole: 'receptionist' }));
    expect(result.status).toBe('cancelled');
  });
});

describe('cancelBooking — idempotency and not-found', () => {
  test('a booking that is already cancelled cannot be cancelled again', async () => {
    const client = makeClient({ bookingRow: baseBookingRow({ status: 'cancelled' }) });
    wire(client);

    await expect(cancelBooking(baseInput())).rejects.toThrow(ValidationError);
  });

  test.each(['completed', 'no_show', 'expired'])('a terminal-status booking (%s) cannot be cancelled', async (status) => {
    const client = makeClient({ bookingRow: baseBookingRow({ status }) });
    wire(client);

    await expect(cancelBooking(baseInput())).rejects.toThrow(ValidationError);
  });

  test('an unknown or cross-club booking id is a 404', async () => {
    const client = makeClient({ bookingRow: null });
    wire(client);

    await expect(cancelBooking(baseInput())).rejects.toThrow(NotFoundError);
  });
});

describe('cancelBooking — prime-time waitlist routing', () => {
  test('cancelling a prime-time slot with a waiting customer creates a slot hold and offers it', async () => {
    (isPrimeTime as jest.Mock).mockReturnValue(true);
    const client = makeClient({
      waitlistEntry: { id: 'wl-1', user_id: 'cust-2', email: 'waiter@x.com', first_name: 'Waiter' },
    });
    wire(client);

    await cancelBooking(baseInput());

    expect(client.calls.some((c) => /INSERT INTO slot_holds/i.test(c.text))).toBe(true);
    expect(client.calls.some((c) => /UPDATE waitlist_entries SET fulfilled_at/i.test(c.text))).toBe(true);
    expect(emailService.sendWaitlistSlotOffer).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'waiter@x.com', firstName: 'Waiter' })
    );
  });

  test('a non-prime-time cancellation never touches the waitlist', async () => {
    (isPrimeTime as jest.Mock).mockReturnValue(false);
    const client = makeClient({
      waitlistEntry: { id: 'wl-1', user_id: 'cust-2', email: 'waiter@x.com', first_name: 'Waiter' },
    });
    wire(client);

    await cancelBooking(baseInput());

    expect(client.calls.some((c) => /FROM waitlist_entries w/i.test(c.text))).toBe(false);
    expect(emailService.sendWaitlistSlotOffer).not.toHaveBeenCalled();
  });

  test('a prime-time slot with no one waiting creates no hold', async () => {
    (isPrimeTime as jest.Mock).mockReturnValue(true);
    const client = makeClient({ waitlistEntry: null });
    wire(client);

    await cancelBooking(baseInput());

    expect(client.calls.some((c) => /INSERT INTO slot_holds/i.test(c.text))).toBe(false);
  });

  test('cancelling a slot already in the past never routes to the waitlist even if prime-time', async () => {
    (isPrimeTime as jest.Mock).mockReturnValue(true);
    const client = makeClient({
      bookingRow: baseBookingRow({ start_time: new Date(Date.now() - 3_600_000), end_time: new Date(Date.now() - 1_800_000) }),
      waitlistEntry: { id: 'wl-1', user_id: 'cust-2', email: 'waiter@x.com', first_name: 'Waiter' },
    });
    wire(client);

    await cancelBooking(baseInput({ actorId: 'staff-1', actorRole: 'owner' }));

    expect(client.calls.some((c) => /FROM waitlist_entries w/i.test(c.text))).toBe(false);
  });
});

describe('cancelBooking — notifications are best-effort and never block the result', () => {
  test('a WhatsApp send failure after commit does not throw or affect the returned result', async () => {
    (whatsappService.sendBookingCancelled as jest.Mock).mockRejectedValueOnce(new Error('WA down'));
    const client = makeClient();
    wire(client);

    const result = await cancelBooking(baseInput());
    expect(result.status).toBe('cancelled');
  });

  test('an email failure after commit does not throw or affect the returned result', async () => {
    (emailService.sendBookingCancellation as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'));
    const client = makeClient();
    wire(client);

    const result = await cancelBooking(baseInput());
    expect(result.status).toBe('cancelled');
  });
});
