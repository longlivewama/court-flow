/**
 * Create Booking use case — core business logic coverage (Phase 15).
 *
 * Covers the financial snapshot (deposit/discount/equipment math), the
 * auto-verify-eligible staff shortcut through the booking+payment state
 * machine, the anti-lockout single-pending-booking cap, past-dated booking
 * guards, equipment stock/locking validation, and prime-time waitlist-hold
 * claiming — under a mocked PoolClient dispatched by SQL shape.
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/domain/booking/booking.validator', () => ({
  validateBookingSlot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLogStrict: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    BOOKING_CREATED: 'BOOKING_CREATED', DEPOSIT_APPROVED: 'DEPOSIT_APPROVED', SLOT_HOLD_CLAIMED: 'SLOT_HOLD_CLAIMED',
  },
}));
jest.mock('../src/infrastructure/sheets/sheets.service', () => ({
  sheetsService: { syncPendingBooking: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/domain/booking/prime-time', () => ({
  isPrimeTime: jest.fn().mockReturnValue(false),
  PRIME_TIME_EXPIRY_MINUTES: 15,
}));

import { createBooking, CreateBookingInput } from '../src/application/booking/create-booking.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { validateBookingSlot } from '../src/domain/booking/booking.validator';
import { isPrimeTime } from '../src/domain/booking/prime-time';
import { sheetsService } from '../src/infrastructure/sheets/sheets.service';
import { ValidationError, ConflictError, ForbiddenError } from '../src/shared/errors';

interface RecordedCall { text: string; params: unknown[]; }

function futureDate(hours: number): Date { return new Date(Date.now() + hours * 3_600_000); }

interface ClientOpts {
  depositPercent?: number;
  expiryMinutes?: number;
  pricePerSlot?: number;
  pendingCount?: number;
  holdRow?: Record<string, unknown> | null;
  equipmentRow?: Record<string, unknown> | null;
  reservedQty?: number;
}

function makeClient(opts: ClientOpts = {}) {
  const calls: RecordedCall[] = [];
  let bookingSeq = 0;

  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });

    if (/FROM courts WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: [{ id: 'court-1' }] };
    if (/SELECT deposit_percent, pending_deposit_expiry_minutes FROM clubs/i.test(text)) {
      return { rows: [{ deposit_percent: opts.depositPercent ?? 50, pending_deposit_expiry_minutes: opts.expiryMinutes ?? 120 }] };
    }
    if (/SELECT name, price_per_slot FROM courts WHERE id = \$1 AND club_id = \$2/i.test(text)) {
      return { rows: [{ name: 'Court 1', price_per_slot: opts.pricePerSlot ?? 200 }] };
    }
    if (/pg_advisory_xact_lock/i.test(text)) return { rows: [] };
    if (/SELECT COUNT\(\*\)::int AS count\s+FROM bookings/i.test(text)) return { rows: [{ count: opts.pendingCount ?? 0 }] };
    if (/FROM slot_holds/i.test(text) && /SELECT id, user_id, token_hash/i.test(text)) {
      return { rows: opts.holdRow ? [opts.holdRow] : [] };
    }
    if (/SELECT id, name, hourly_price, stock_qty, is_active\s+FROM equipment/i.test(text)) {
      return { rows: opts.equipmentRow === null ? [] : [opts.equipmentRow ?? { id: 'eq-1', name: 'Racket', hourly_price: '20.00', stock_qty: 10, is_active: true }] };
    }
    if (/SELECT COALESCE\(SUM\(be\.quantity\)/i.test(text)) return { rows: [{ reserved: opts.reservedQty ?? 0 }] };
    if (/INSERT INTO bookings/i.test(text)) { bookingSeq += 1; return { rows: [{ id: `booking-${bookingSeq}` }] }; }
    if (/UPDATE slot_holds SET claimed_at/i.test(text)) return { rows: [] };
    if (/INSERT INTO booking_equipment/i.test(text)) return { rows: [] };
    if (/INSERT INTO payments/i.test(text)) return { rows: [] };
    if (/SELECT first_name, phone FROM users WHERE id = \$1/i.test(text)) return { rows: [{ first_name: 'Nour', phone: '0100' }] };
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseInput(overrides: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    clubId: 'club-1', courtId: 'court-1', customerId: 'cust-1',
    createdBy: 'cust-1', createdByRole: 'customer',
    startTime: futureDate(24), durationMinutes: 60,
    processedById: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (validateBookingSlot as jest.Mock).mockResolvedValue(undefined);
  (isPrimeTime as jest.Mock).mockReturnValue(false);
});

describe('createBooking — financial snapshot', () => {
  test('a customer booking with no payment method is pending_deposit, deposit computed from club %', async () => {
    const client = makeClient({ depositPercent: 50, pricePerSlot: 200 });
    wire(client);

    const result = await createBooking(baseInput());

    expect(result.status).toBe('pending_deposit');
    expect(result.totalPrice).toBe(200);
    expect(result.depositAmount).toBe(100); // 50% of 200
    expect(result.remainingBalance).toBe(200); // nothing actually collected yet
  });

  test('a discount reduces the price the deposit percentage is applied to', async () => {
    const client = makeClient({ depositPercent: 50, pricePerSlot: 200 });
    wire(client);

    const result = await createBooking(baseInput({ discountAmount: 50 }));

    expect(result.totalPrice).toBe(200); // gross total_price is unaffected
    expect(result.depositAmount).toBe(75); // 50% of (200 - 50)
  });

  test('a 2-hour duration doubles the price', async () => {
    const client = makeClient({ pricePerSlot: 200 });
    wire(client);

    const result = await createBooking(baseInput({ durationMinutes: 120 }));
    expect(result.totalPrice).toBe(400);
  });
});

describe('createBooking — staff auto-verify shortcut', () => {
  test('owner recording a full cash payment upfront auto-confirms and marks paid_in_full', async () => {
    const client = makeClient({ pricePerSlot: 200 });
    wire(client);

    const result = await createBooking(baseInput({
      createdBy: 'owner-1', createdByRole: 'owner',
      depositMethod: 'CASH', depositAmount: 200, remainderMethod: 'CASH', remainderAmount: 0,
    }));

    expect(result.status).toBe('confirmed');
    const paymentInsert = client.calls.find((c) => /INSERT INTO payments/i.test(c.text))!;
    expect(paymentInsert.params[3]).toBe('paid_in_full');
  });

  test('receptionist recording just the required deposit auto-confirms as deposit_approved', async () => {
    const client = makeClient({ pricePerSlot: 200, depositPercent: 50 });
    wire(client);

    const result = await createBooking(baseInput({
      createdBy: 'staff-1', createdByRole: 'receptionist',
      depositMethod: 'CASH', depositAmount: 100,
    }));

    expect(result.status).toBe('confirmed');
    const paymentInsert = client.calls.find((c) => /INSERT INTO payments/i.test(c.text))!;
    expect(paymentInsert.params[3]).toBe('deposit_approved');
  });

  test('a customer paying online is NEVER auto-verified — still needs staff verification', async () => {
    const client = makeClient({ pricePerSlot: 200, depositPercent: 50 });
    wire(client);

    const result = await createBooking(baseInput({
      depositMethod: 'INSTAPAY', depositAmount: 200, // even a full, "self-reported" payment
    }));

    expect(result.status).toBe('pending_deposit');
  });

  test('receptionist with no payment collected creates a draft, not pending_deposit', async () => {
    const client = makeClient();
    wire(client);

    const result = await createBooking(baseInput({ createdBy: 'staff-1', createdByRole: 'receptionist' }));
    expect(result.status).toBe('draft');
  });

  test('a partial cash deposit below the required amount does NOT auto-verify', async () => {
    const client = makeClient({ pricePerSlot: 200, depositPercent: 50 });
    wire(client);

    const result = await createBooking(baseInput({
      createdBy: 'owner-1', createdByRole: 'owner',
      depositMethod: 'CASH', depositAmount: 50, // required is 100
    }));

    expect(result.status).toBe('pending_deposit');
  });
});

describe('createBooking — anti-lockout guards', () => {
  test('a customer with an existing unpaid pending booking is rejected', async () => {
    const client = makeClient({ pendingCount: 1 });
    wire(client);

    await expect(createBooking(baseInput())).rejects.toThrow(ConflictError);
  });

  test('a customer cannot self-book a slot already in the past', async () => {
    const client = makeClient();
    wire(client);

    await expect(
      createBooking(baseInput({ startTime: new Date(Date.now() - 3_600_000) }))
    ).rejects.toThrow(ValidationError);
  });

  test('staff CAN record a walk-in booking for a past time slot', async () => {
    const client = makeClient();
    wire(client);

    const result = await createBooking(baseInput({
      createdBy: 'staff-1', createdByRole: 'receptionist',
      startTime: new Date(Date.now() - 3_600_000),
    }));
    expect(result.status).toBe('draft');
  });

  test('the pending-booking cap check is skipped entirely for staff-created bookings (no advisory lock taken)', async () => {
    const client = makeClient();
    wire(client);

    await createBooking(baseInput({ createdBy: 'staff-1', createdByRole: 'receptionist' }));
    expect(client.calls.some((c) => /pg_advisory_xact_lock/i.test(c.text))).toBe(false);
  });
});

describe('createBooking — equipment rental', () => {
  test('a valid equipment line is inserted with the correct snapshotted subtotal', async () => {
    const client = makeClient({
      pricePerSlot: 200,
      equipmentRow: { id: 'eq-1', name: 'Racket', hourly_price: '20.00', stock_qty: 10, is_active: true },
      reservedQty: 0,
    });
    wire(client);

    const result = await createBooking(baseInput({
      durationMinutes: 120,
      equipment: [{ equipmentId: 'eq-1', quantity: 2 }],
    }));

    // 20/hr * 2 rackets * 2 hours = 80
    expect(result.equipmentTotal).toBe(80);
    expect(result.totalPrice).toBe(400 + 80); // court price + equipment
    const eqInsert = client.calls.find((c) => /INSERT INTO booking_equipment/i.test(c.text))!;
    expect(eqInsert.params).toEqual(['booking-1', 'eq-1', 2, 20, 2, 80]);
  });

  test('requesting more than the available stock is rejected', async () => {
    const client = makeClient({
      equipmentRow: { id: 'eq-1', name: 'Racket', hourly_price: '20.00', stock_qty: 5, is_active: true },
      reservedQty: 4, // only 1 left
    });
    wire(client);

    await expect(
      createBooking(baseInput({ equipment: [{ equipmentId: 'eq-1', quantity: 2 }] }))
    ).rejects.toThrow(ValidationError);
  });

  test('a zero or negative equipment quantity is rejected', async () => {
    const client = makeClient();
    wire(client);

    await expect(
      createBooking(baseInput({ equipment: [{ equipmentId: 'eq-1', quantity: 0 }] }))
    ).rejects.toThrow(ValidationError);
  });

  test('inactive/nonexistent equipment is rejected', async () => {
    const client = makeClient({ equipmentRow: null });
    wire(client);

    await expect(
      createBooking(baseInput({ equipment: [{ equipmentId: 'eq-ghost', quantity: 1 }] }))
    ).rejects.toThrow(ValidationError);
  });

  test('multiple lines are locked in ascending equipment-id order (deadlock prevention), regardless of request order', async () => {
    const equipmentById: Record<string, Record<string, unknown>> = {
      'eq-b': { id: 'eq-b', name: 'Balls', hourly_price: '10.00', stock_qty: 10, is_active: true },
      'eq-a': { id: 'eq-a', name: 'Racket', hourly_price: '20.00', stock_qty: 10, is_active: true },
    };
    const client = makeClient();
    (client.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      client.calls.push({ text, params });
      if (/FROM courts WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: [{ id: 'court-1' }] };
      if (/SELECT deposit_percent/i.test(text)) return { rows: [{ deposit_percent: 50, pending_deposit_expiry_minutes: 120 }] };
      if (/SELECT name, price_per_slot FROM courts/i.test(text)) return { rows: [{ name: 'Court 1', price_per_slot: 200 }] };
      if (/pg_advisory_xact_lock/i.test(text)) return { rows: [] };
      if (/SELECT COUNT\(\*\)::int AS count\s+FROM bookings/i.test(text)) return { rows: [{ count: 0 }] };
      if (/SELECT id, name, hourly_price, stock_qty, is_active\s+FROM equipment/i.test(text)) {
        return { rows: [equipmentById[params[0] as string]] };
      }
      if (/SELECT COALESCE\(SUM\(be\.quantity\)/i.test(text)) return { rows: [{ reserved: 0 }] };
      if (/INSERT INTO bookings/i.test(text)) return { rows: [{ id: 'booking-1' }] };
      if (/SELECT first_name, phone FROM users/i.test(text)) return { rows: [{ first_name: 'Nour', phone: '0100' }] };
      return { rows: [] };
    });
    wire(client);

    // Requested out of ascending order: 'eq-b' before 'eq-a'.
    await createBooking(baseInput({
      equipment: [{ equipmentId: 'eq-b', quantity: 1 }, { equipmentId: 'eq-a', quantity: 1 }],
    }));

    const equipmentLockCalls = client.calls.filter((c) => /FROM equipment WHERE id = \$1/i.test(c.text));
    expect(equipmentLockCalls.map((c) => c.params[0])).toEqual(['eq-a', 'eq-b']);
  });
});

describe('createBooking — fail-safe ledger sync (best-effort, after commit)', () => {
  test('a Sheets sync failure after commit does not throw or affect the returned booking', async () => {
    (sheetsService.syncPendingBooking as jest.Mock).mockRejectedValueOnce(new Error('Sheets API down'));
    const client = makeClient();
    wire(client);

    const result = await createBooking(baseInput());
    expect(result.status).toBe('pending_deposit');
  });
});

describe('createBooking — prime-time waitlist hold claiming', () => {
  test('the held customer presenting the correct token claims the hold', async () => {
    const crypto = require('crypto');
    const token = 'my-secret-token';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const client = makeClient({
      holdRow: { id: 'hold-1', user_id: 'cust-1', token_hash: tokenHash },
    });
    wire(client);

    await createBooking(baseInput({ waitlistToken: token }));

    const claimUpdate = client.calls.find((c) => /UPDATE slot_holds SET claimed_at/i.test(c.text))!;
    expect(claimUpdate.params).toEqual(['hold-1', 'booking-1']);
  });

  test('a different customer without the token is rejected while the hold is active', async () => {
    const client = makeClient({
      holdRow: { id: 'hold-1', user_id: 'cust-OTHER', token_hash: 'somehash' },
    });
    wire(client);

    await expect(createBooking(baseInput())).rejects.toThrow(ForbiddenError);
  });

  test('the held customer WITHOUT presenting a token is still rejected (token proves ownership, not just user id)', async () => {
    const client = makeClient({
      holdRow: { id: 'hold-1', user_id: 'cust-1', token_hash: 'somehash' },
    });
    wire(client);

    await expect(createBooking(baseInput())).rejects.toThrow(ForbiddenError);
  });

  test('staff can override an active hold without any token', async () => {
    const client = makeClient({
      holdRow: { id: 'hold-1', user_id: 'cust-OTHER', token_hash: 'somehash' },
    });
    wire(client);

    const result = await createBooking(baseInput({ createdBy: 'staff-1', createdByRole: 'receptionist' }));
    expect(result.status).toBe('draft');
    // Staff overriding does not claim/consume the hold on someone else's behalf.
    expect(client.calls.some((c) => /UPDATE slot_holds SET claimed_at/i.test(c.text))).toBe(false);
  });

  test('with no active hold, booking proceeds normally', async () => {
    const client = makeClient({ holdRow: null });
    wire(client);

    const result = await createBooking(baseInput());
    expect(result.status).toBe('pending_deposit');
  });
});

describe('createBooking — not-found guards', () => {
  test('a nonexistent club fails fast', async () => {
    const client = {
      query: jest.fn(async (text: string) => {
        if (/FROM courts WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: [{ id: 'court-1' }] };
        if (/SELECT deposit_percent/i.test(text)) return { rows: [] };
        return { rows: [] };
      }),
    };
    wire(client);

    await expect(createBooking(baseInput())).rejects.toThrow('Club not found');
  });

  test('a cross-tenant/nonexistent court fails with a clean ValidationError', async () => {
    const client = makeClient();
    (client.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      if (/FROM courts WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: [{ id: 'court-1' }] };
      if (/SELECT deposit_percent/i.test(text)) return { rows: [{ deposit_percent: 50, pending_deposit_expiry_minutes: 120 }] };
      if (/SELECT name, price_per_slot FROM courts WHERE id = \$1 AND club_id = \$2/i.test(text)) return { rows: [] };
      return { rows: [] };
    });
    wire(client);

    await expect(createBooking(baseInput())).rejects.toThrow(ValidationError);
  });
});
