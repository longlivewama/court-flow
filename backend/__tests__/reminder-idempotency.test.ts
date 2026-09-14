/**
 * Cron reminder idempotency (Phase 5).
 *
 * sendReminders() used to match bookings with a 2-minute-wide sliding window
 * re-evaluated every single minute with no memory of who'd already been
 * notified, so a booking sitting in that window across consecutive ticks got
 * the same reminder sent 2-3 times. It now gates on a durable
 * reminder_<type>_sent_at column: the SELECT excludes already-sent bookings,
 * and the column is only set after a real send succeeds.
 */
import { sendReminders } from '../src/infrastructure/cron/index';
import { db } from '../src/infrastructure/database/client';
import { emailService } from '../src/infrastructure/email/email.service';
import { logger } from '../src/shared/logger';

jest.mock('../src/infrastructure/database/client', () => ({
  db: { query: jest.fn() },
}));
jest.mock('../src/infrastructure/email/email.service', () => ({
  emailService: { sendBookingReminder: jest.fn() },
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { BOOKING_EXPIRED: 'BOOKING_EXPIRED', BOOKING_NO_SHOW: 'BOOKING_NO_SHOW' },
}));
jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
jest.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
jest.spyOn(logger, 'info').mockImplementation(() => undefined as never);

interface RecordedCall { text: string; params: unknown[]; }

const BOOKING = { id: 'booking-1', customer_id: 'cust-1', start_time: new Date(), court_id: 'court-1' };
const CUSTOMER = { email: 'nour@example.com', first_name: 'Nour' };

/** Wires db.query to answer the SELECT (bookings due), the customer lookup, and the mark-sent UPDATE. */
function wireDb(opts: { dueBookings?: typeof BOOKING[] } = {}) {
  const calls: RecordedCall[] = [];
  (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/SELECT b\.id, b\.customer_id, b\.start_time, b\.court_id/i.test(text)) {
      return { rows: opts.dueBookings ?? [BOOKING] };
    }
    if (/SELECT email, first_name FROM users/i.test(text)) return { rows: [CUSTOMER] };
    if (/UPDATE bookings SET reminder_.*_sent_at = NOW\(\)/i.test(text)) return { rowCount: 1 };
    return { rows: [] };
  });
  return calls;
}

beforeEach(() => jest.clearAllMocks());

describe('sendReminders — idempotency', () => {
  test('the SELECT excludes bookings that already have reminder_24h_sent_at set', async () => {
    const calls = wireDb({ dueBookings: [] });
    (emailService.sendBookingReminder as jest.Mock).mockResolvedValue(undefined);

    await sendReminders('club-1', 24 * 60, '24h');

    const selectCall = calls.find((c) => /SELECT b\.id/i.test(c.text))!;
    expect(selectCall.text).toMatch(/reminder_24h_sent_at IS NULL/);
    expect(emailService.sendBookingReminder).not.toHaveBeenCalled();
  });

  test('a successful send marks reminder_24h_sent_at exactly once', async () => {
    const calls = wireDb();
    (emailService.sendBookingReminder as jest.Mock).mockResolvedValue(undefined);

    await sendReminders('club-1', 24 * 60, '24h');

    expect(emailService.sendBookingReminder).toHaveBeenCalledTimes(1);
    const markSent = calls.filter((c) => /UPDATE bookings SET reminder_24h_sent_at = NOW\(\)/i.test(c.text));
    expect(markSent).toHaveLength(1);
    expect(markSent[0].params).toEqual(['booking-1']);
    expect(markSent[0].text).toMatch(/reminder_24h_sent_at IS NULL/);
  });

  test('2h and 24h reminders use independent columns and never cross-mark each other', async () => {
    const calls = wireDb();
    (emailService.sendBookingReminder as jest.Mock).mockResolvedValue(undefined);

    await sendReminders('club-1', 2 * 60, '2h');

    const selectCall = calls.find((c) => /SELECT b\.id/i.test(c.text))!;
    expect(selectCall.text).toMatch(/reminder_2h_sent_at IS NULL/);
    expect(selectCall.text).not.toMatch(/reminder_24h_sent_at/);
    const markSent = calls.find((c) => /UPDATE bookings SET/i.test(c.text))!;
    expect(markSent.text).toMatch(/reminder_2h_sent_at/);
  });

  test('cron running twice in a row (simulating two consecutive ticks) sends the reminder only once', async () => {
    // Tick 1: booking is due and unsent.
    let sentAt: string | null = null;
    (db.query as jest.Mock).mockImplementation(async (text: string, params: unknown[] = []) => {
      if (/SELECT b\.id, b\.customer_id/i.test(text)) {
        return { rows: sentAt ? [] : [BOOKING] }; // once "sent", the next SELECT excludes it
      }
      if (/SELECT email, first_name FROM users/i.test(text)) return { rows: [CUSTOMER] };
      if (/UPDATE bookings SET reminder_24h_sent_at = NOW\(\)/i.test(text)) {
        sentAt = new Date().toISOString();
        return { rowCount: 1 };
      }
      return { rows: [] };
    });
    (emailService.sendBookingReminder as jest.Mock).mockResolvedValue(undefined);

    await sendReminders('club-1', 24 * 60, '24h'); // tick 1
    await sendReminders('club-1', 24 * 60, '24h'); // tick 2, one minute later in reality

    expect(emailService.sendBookingReminder).toHaveBeenCalledTimes(1);
  });

  test('a notification failure does not mark the booking as sent, and is retried on the next tick', async () => {
    let attempt = 0;
    let sentAt: string | null = null;
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (/SELECT b\.id, b\.customer_id/i.test(text)) return { rows: sentAt ? [] : [BOOKING] };
      if (/SELECT email, first_name FROM users/i.test(text)) return { rows: [CUSTOMER] };
      if (/UPDATE bookings SET reminder_24h_sent_at = NOW\(\)/i.test(text)) {
        sentAt = new Date().toISOString();
        return { rowCount: 1 };
      }
      return { rows: [] };
    });
    (emailService.sendBookingReminder as jest.Mock).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('SMTP timeout');
    });

    await sendReminders('club-1', 24 * 60, '24h'); // fails — must not mark sent
    expect(sentAt).toBeNull();

    await sendReminders('club-1', 24 * 60, '24h'); // retried and succeeds
    expect(sentAt).not.toBeNull();
    expect(emailService.sendBookingReminder).toHaveBeenCalledTimes(2);
  });

  test('two overlapping calls (simulating concurrent cron workers) each only see rows not yet marked sent', async () => {
    // Worker A's SELECT happens, then commits its mark-sent update, before
    // worker B's SELECT runs — the IS NULL guard means B sees nothing to do.
    let sentAt: string | null = null;
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (/SELECT b\.id, b\.customer_id/i.test(text)) return { rows: sentAt ? [] : [BOOKING] };
      if (/SELECT email, first_name FROM users/i.test(text)) return { rows: [CUSTOMER] };
      if (/UPDATE bookings SET reminder_24h_sent_at = NOW\(\)/i.test(text)) {
        sentAt = new Date().toISOString();
        return { rowCount: 1 };
      }
      return { rows: [] };
    });
    (emailService.sendBookingReminder as jest.Mock).mockResolvedValue(undefined);

    const workerA = sendReminders('club-1', 24 * 60, '24h');
    await workerA;
    const workerB = sendReminders('club-1', 24 * 60, '24h');
    await workerB;

    expect(emailService.sendBookingReminder).toHaveBeenCalledTimes(1);
  });

  test('a missing customer record is skipped without crashing the loop', async () => {
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (/SELECT b\.id, b\.customer_id/i.test(text)) return { rows: [BOOKING] };
      if (/SELECT email, first_name FROM users/i.test(text)) return { rows: [] }; // deleted user
      return { rows: [] };
    });

    await expect(sendReminders('club-1', 24 * 60, '24h')).resolves.toBeUndefined();
    expect(emailService.sendBookingReminder).not.toHaveBeenCalled();
  });
});
