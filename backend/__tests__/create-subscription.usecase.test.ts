/**
 * Create Subscription Use Case – regression tests for the staff-only
 * authorization control (audit finding #1: a subscription mints confirmed,
 * club-billed court inventory, so customers must never be able to create one),
 * plus the surrounding precondition/validation guards.
 *
 * The DB client, slot validator, and audit sink are mocked so the test runs
 * offline and asserts purely on the SQL the use case emits.
 */
import { ForbiddenError, ValidationError, ConflictError } from '../src/shared/errors';

// ── Mocks ──────────────────────────────────────────────────────
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/domain/booking/booking.validator', () => ({
  validateBookingSlot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED' },
}));

import { createSubscription, CreateSubscriptionInput } from '../src/application/booking/create-subscription.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { validateBookingSlot } from '../src/domain/booking/booking.validator';

interface RecordedCall { text: string; params: unknown[]; }

/** A fake PoolClient whose query() returns shapes keyed off the SQL text. */
function makeClient() {
  const calls: RecordedCall[] = [];
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/INSERT INTO subscriptions/i.test(text)) return { rows: [{ id: 'sub-1' }] };
    if (/INSERT INTO bookings/i.test(text)) return { rows: [{ id: `bk-${calls.length}` }] };
    if (/INSERT INTO payments/i.test(text)) return { rows: [] };
    if (/price_per_slot,\s*name\s+FROM\s+courts/i.test(text)) return { rows: [{ price_per_slot: '100', name: 'Court 1' }] };
    if (/deposit_percent\s+FROM\s+clubs/i.test(text)) return { rows: [{ deposit_percent: 50 }] };
    return { rows: [] }; // court FOR UPDATE lock, etc.
  });
  return { query, calls };
}

function baseInput(overrides: Partial<CreateSubscriptionInput> = {}): CreateSubscriptionInput {
  return {
    clubId: 'club-1',
    courtId: 'court-1',
    customerId: 'cust-1',
    createdBy: 'user-1',
    createdByRole: 'owner',
    firstStartTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    durationMinutes: 60,
    termMonths: 1,
    ...overrides,
  };
}

function bookingInserts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => /INSERT INTO bookings/i.test(c.text));
}

/** Wire withTransaction to run the use case's body against `client`. */
function runAgainst(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

beforeEach(() => {
  jest.clearAllMocks();
  (validateBookingSlot as jest.Mock).mockResolvedValue(undefined);
});

describe('createSubscription — staff-only authorization', () => {
  test.each(['customer', 'coach', 'guest'])(
    'rejects non-staff role "%s" with ForbiddenError and touches no DB',
    async (role) => {
      const client = makeClient();
      runAgainst(client);

      await expect(createSubscription(baseInput({ createdByRole: role }))).rejects.toThrow(ForbiddenError);

      // The guard runs before the transaction opens, so nothing is queried.
      expect(withTransaction).not.toHaveBeenCalled();
      expect(client.calls).toHaveLength(0);
    }
  );
});

describe('createSubscription — staff occurrences', () => {
  test.each(['owner', 'receptionist'])(
    'staff role "%s" materialises 4 confirmed weekly occurrences',
    async (role) => {
      const client = makeClient();
      runAgainst(client);

      const result = await createSubscription(baseInput({ createdByRole: role }));

      const inserts = bookingInserts(client.calls);
      expect(inserts).toHaveLength(4); // 1 month × 4 weeks
      for (const ins of inserts) {
        // Status is a SQL literal on the staff-only path.
        expect(ins.text).toMatch(/VALUES\s*\(\s*\$1,\s*\$2,\s*\$3,\s*\$4,\s*'confirmed'/);
      }
      expect(result.occurrences).toBe(4);
      expect(result.bookingIds).toHaveLength(4);
    }
  );
});

describe('createSubscription — precondition guards', () => {
  test('rejects an invalid term with ValidationError', async () => {
    const client = makeClient();
    runAgainst(client);
    await expect(
      createSubscription(baseInput({ termMonths: 2 as unknown as 1 | 3 }))
    ).rejects.toThrow(ValidationError);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('rejects a first session in the past with ValidationError', async () => {
    const client = makeClient();
    runAgainst(client);
    await expect(
      createSubscription(baseInput({ firstStartTime: new Date(Date.now() - 60_000) }))
    ).rejects.toThrow(ValidationError);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('remaps an unavailable week to a ConflictError naming the offending date', async () => {
    const client = makeClient();
    runAgainst(client);
    (validateBookingSlot as jest.Mock).mockRejectedValueOnce(new ConflictError('slot already booked'));

    await expect(createSubscription(baseInput())).rejects.toThrow(ConflictError);
    // Rejected before any booking row is written.
    expect(bookingInserts(client.calls)).toHaveLength(0);
  });
});
