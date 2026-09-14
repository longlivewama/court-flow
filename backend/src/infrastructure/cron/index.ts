/**
 * Background Cron Jobs
 *
 * 1. expire-pending:    Auto-expire 'pending_deposit' bookings after configurable window (default 2h)
 * 2. noshow:            Mark 'confirmed'/'checked_in' bookings as 'no_show' after 15-min grace
 * 3. reminders:         Send 24h and 2h reminder emails for upcoming confirmed bookings
 * 4. expire-stalled:    Every 15 minutes, sweep and expire stalled 'draft' bookings (receptionist-
 *                       created, never finalized) plus a safety-net re-check of 'pending_deposit'
 *                       bookings, freeing up any court slots they held.
 */
import cron from 'node-cron';
import { db } from '../database/client';
import { auditLog, AUDIT_ACTIONS } from '../audit/audit.service';
import { emailService } from '../email/email.service';
import { logger } from '../../shared/logger';
import { runWithTenant } from '../../shared/tenant-context';

/**
 * Run `fn` only if this process wins a Postgres session-level advisory lock,
 * so exactly one replica executes the tick even when the API is scaled out.
 *
 * The lock and its release MUST run on the same connection — advisory locks are
 * session-scoped, so unlocking on a different pooled connection would silently
 * fail and leak the lock forever. We therefore hold one dedicated client for the
 * whole tick. If a previous tick is still running (lock held), we skip rather
 * than queue, which also prevents overlapping runs on a single instance.
 */
async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<void> {
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [key]
    );
    if (!rows[0].locked) return; // another replica (or the previous tick) holds it
    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

export function startCronJobs(): void {
  // Run every minute (distinct lock key from the 15-min sweep so they never
  // block each other).
  cron.schedule('* * * * *', () => {
    withAdvisoryLock(4021, async () => {
      await runExpirePendingJob();
      await runNoShowJob();
      await runReminderJob();
    }).catch((err) => logger.error({ err }, 'Cron minute tick failed'));
  });

  // Run every 15 minutes — sweeps for stalled 'draft' bookings (and re-checks
  // 'pending_deposit' as a safety net) to free up any abandoned court slots.
  cron.schedule('*/15 * * * *', () => {
    withAdvisoryLock(4022, async () => {
      await runExpireStalledBookingsJob();
    }).catch((err) => logger.error({ err }, 'Cron 15-min tick failed'));
  });

  logger.info('Cron jobs scheduled (every 1 minute + every 15 minutes, advisory-locked)');
}

// ── 1. Expire Pending Deposit bookings ────────────────────────
async function runExpirePendingJob(): Promise<void> {
  try {
    // Find clubs and their configured expiry windows
    const { rows: clubs } = await db.query<{
      id: string;
      pending_deposit_expiry_minutes: number;
    }>(`SELECT id, pending_deposit_expiry_minutes FROM clubs`);

    for (const club of clubs) {
      // Scopes every DB call in this iteration to `club.id` (CF-QA-005) —
      // cron already processes one club at a time, so this is a drop-in fit
      // for the RLS session variable, no cross-tenant bypass needed here.
      await runWithTenant(club.id, async () => {
      // expires_at is the per-booking deadline (prime-time bookings carry a
      // tighter 15-minute window — see create-booking.usecase.ts). Legacy
      // rows without one fall back to the club's static window.
      const { rows: expiredBookings } = await db.query<{
        id: string;
        customer_id: string;
        court_id: string;
      }>(
        `UPDATE bookings
         SET status = 'expired', expired_at = NOW(), updated_at = NOW()
         WHERE club_id = $1
           AND status = 'pending_deposit'
           AND COALESCE(expires_at, created_at + ($2 || ' minutes')::INTERVAL) < NOW()
         RETURNING id, customer_id, court_id`,
        [club.id, club.pending_deposit_expiry_minutes]
      );

      for (const booking of expiredBookings) {
        logger.info({ bookingId: booking.id }, 'Booking auto-expired (pending_deposit timeout)');
        await auditLog({
          clubId:     club.id,
          actionType: AUDIT_ACTIONS.BOOKING_EXPIRED,
          entityType: 'booking',
          entityId:   booking.id,
          newValues:  { status: 'expired', reason: 'Deposit not uploaded within time window' },
        });
      }
      });
    }
  } catch (err) {
    logger.error({ err }, 'Error in expire-pending cron job');
  }
}

// ── 1b. Expire Stalled Draft & Pending-Deposit bookings (every 15 min) ────
async function runExpireStalledBookingsJob(): Promise<void> {
  try {
    const { rows: clubs } = await db.query<{
      id: string;
      pending_deposit_expiry_minutes: number;
      draft_expiry_minutes: number;
    }>(`SELECT id, pending_deposit_expiry_minutes, draft_expiry_minutes FROM clubs`);

    for (const club of clubs) {
      await runWithTenant(club.id, async () => {
      // Pass 1: stale 'draft' bookings (receptionist-created, never finalized)
      const { rows: expiredDrafts } = await db.query<{
        id: string;
        customer_id: string;
        court_id: string;
      }>(
        `UPDATE bookings
         SET status = 'expired', expired_at = NOW(), updated_at = NOW()
         WHERE club_id = $1
           AND status = 'draft'
           AND created_at < NOW() - ($2 || ' minutes')::INTERVAL
         RETURNING id, customer_id, court_id`,
        [club.id, club.draft_expiry_minutes]
      );

      for (const booking of expiredDrafts) {
        logger.info({ bookingId: booking.id }, 'Draft booking auto-expired (stalled, never finalized)');
        await auditLog({
          clubId:     club.id,
          actionType: AUDIT_ACTIONS.BOOKING_EXPIRED,
          entityType: 'booking',
          entityId:   booking.id,
          newValues:  { status: 'expired', reason: 'Draft booking not finalized within time window' },
        });
      }

      // Pass 2: safety-net re-check of 'pending_deposit' bookings. The 1-minute
      // job (runExpirePendingJob) is the primary path; this catches anything
      // it may have missed if a tick failed.
      const { rows: expiredPending } = await db.query<{
        id: string;
        customer_id: string;
        court_id: string;
      }>(
        `UPDATE bookings
         SET status = 'expired', expired_at = NOW(), updated_at = NOW()
         WHERE club_id = $1
           AND status = 'pending_deposit'
           AND COALESCE(expires_at, created_at + ($2 || ' minutes')::INTERVAL) < NOW()
         RETURNING id, customer_id, court_id`,
        [club.id, club.pending_deposit_expiry_minutes]
      );

      for (const booking of expiredPending) {
        logger.warn(
          { bookingId: booking.id },
          'Pending-deposit booking expired by 15-min safety sweep (1-min job may have missed it)'
        );
        await auditLog({
          clubId:     club.id,
          actionType: AUDIT_ACTIONS.BOOKING_EXPIRED,
          entityType: 'booking',
          entityId:   booking.id,
          newValues:  { status: 'expired', reason: 'Deposit not uploaded within time window (15-min safety sweep)' },
        });
      }
      });
    }
  } catch (err) {
    logger.error({ err }, 'Error in expire-stalled-bookings cron job');
  }
}

// ── 2. No-Show detection ──────────────────────────────────────
async function runNoShowJob(): Promise<void> {
  try {
    const { rows: clubs } = await db.query<{
      id: string;
      noshow_grace_minutes: number;
    }>(`SELECT id, noshow_grace_minutes FROM clubs`);

    for (const club of clubs) {
      await runWithTenant(club.id, async () => {
      const { rows: noshowBookings } = await db.query<{
        id: string;
        customer_id: string;
        start_time: Date;
      }>(
        `UPDATE bookings
         SET status = 'no_show', noshow_at = NOW(), updated_at = NOW()
         WHERE club_id = $1
           AND status = 'confirmed'
           AND start_time < NOW() - ($2 || ' minutes')::INTERVAL
         RETURNING id, customer_id, start_time`,
        [club.id, club.noshow_grace_minutes]
      );

      for (const booking of noshowBookings) {
        // The bulk UPDATE above already committed the no-show status, so isolate
        // each booking's audit + notification side-effects: one customer's email
        // failure must not abort the remaining no-show notifications.
        try {
          logger.info({ bookingId: booking.id }, 'Booking marked as no-show');

          await auditLog({
            clubId:     club.id,
            actionType: AUDIT_ACTIONS.BOOKING_NO_SHOW,
            entityType: 'booking',
            entityId:   booking.id,
            newValues:  { status: 'no_show', detectedAt: new Date().toISOString() },
          });

          // Notify customer
          const { rows: custRows } = await db.query<{ email: string; first_name: string }>(
            `SELECT email, first_name FROM users WHERE id = $1`,
            [booking.customer_id]
          );
          if (custRows.length) {
            await emailService.sendNoShowNotice({
              to:        custRows[0].email,
              firstName: custRows[0].first_name,
              bookingId: booking.id,
              startTime: booking.start_time,
            });
          }
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Failed to finalize no-show notification');
        }
      }
      });
    }
  } catch (err) {
    logger.error({ err }, 'Error in no-show cron job');
  }
}

// ── 3. Reminder emails ────────────────────────────────────────
export async function runReminderJob(): Promise<void> {
  try {
    const { rows: clubs } = await db.query<{
      id: string;
      reminder_24h_enabled: boolean;
      reminder_2h_enabled:  boolean;
    }>(`SELECT id, reminder_24h_enabled, reminder_2h_enabled FROM clubs`);

    for (const club of clubs) {
      // 24-hour reminders
      if (club.reminder_24h_enabled) {
        await sendReminders(club.id, 24 * 60, '24h');
      }
      // 2-hour reminders
      if (club.reminder_2h_enabled) {
        await sendReminders(club.id, 2 * 60, '2h');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in reminder cron job');
  }
}

// Maps each reminder type to its durable "already sent" column. Built as an
// explicit allowlist (never string-interpolating the caller's label directly
// into SQL) even though today's two call sites are both internal literals.
const REMINDER_SENT_COLUMN = {
  '24h': 'reminder_24h_sent_at',
  '2h':  'reminder_2h_sent_at',
} as const;
type ReminderLabel = keyof typeof REMINDER_SENT_COLUMN;

export async function sendReminders(
  clubId: string,
  minutesBefore: number,
  label: ReminderLabel
): Promise<void> {
  return runWithTenant(clubId, () => sendRemindersScoped(clubId, minutesBefore, label));
}

async function sendRemindersScoped(
  clubId: string,
  minutesBefore: number,
  label: ReminderLabel
): Promise<void> {
  const sentColumn = REMINDER_SENT_COLUMN[label];

  // Same ±1-minute window as before the idempotency fix (cron runs every
  // minute) — the fix is NOT widening this window, it's that a booking sitting
  // in it across 2-3 consecutive ticks used to get emailed every single time.
  // The `${sentColumn} IS NULL` guard means a booking already reminded is never
  // even selected again, and the same guard on the UPDATE below means marking
  // "sent" only ever happens once, atomically, and only after a real send
  // succeeds — a failed attempt leaves it eligible for the very next tick.
  const { rows: bookings } = await db.query<{
    id: string;
    customer_id: string;
    start_time: Date;
    court_id: string;
  }>(
    `SELECT b.id, b.customer_id, b.start_time, b.court_id
     FROM bookings b
     WHERE b.club_id = $1
       AND b.status = 'confirmed'
       AND b.start_time BETWEEN NOW() + ($2 - 1 || ' minutes')::INTERVAL
                             AND NOW() + ($2 + 1 || ' minutes')::INTERVAL
       AND b.${sentColumn} IS NULL`,
    [clubId, minutesBefore]
  );

  for (const booking of bookings) {
    // Isolate each booking: one failed/slow send must not block the rest of
    // this tick's reminders, and must not falsely mark itself as sent.
    try {
      const { rows: custRows } = await db.query<{ email: string; first_name: string }>(
        `SELECT email, first_name FROM users WHERE id = $1`,
        [booking.customer_id]
      );
      if (!custRows.length) continue;

      await emailService.sendBookingReminder({
        to:        custRows[0].email,
        firstName: custRows[0].first_name,
        bookingId: booking.id,
        startTime: booking.start_time,
        reminderType: label,
      });

      // Mark sent only after the send itself succeeded, and only if nothing
      // else has already marked it (defence in depth alongside the
      // cluster-wide advisory lock that already serialises cron ticks).
      await db.query(
        `UPDATE bookings SET ${sentColumn} = NOW() WHERE id = $1 AND ${sentColumn} IS NULL`,
        [booking.id]
      );
    } catch (err) {
      logger.error({ err, bookingId: booking.id, reminderType: label }, 'Failed to send booking reminder; will retry next tick');
    }
  }
}
