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

export function startCronJobs(): void {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    await runExpirePendingJob();
    await runNoShowJob();
    await runReminderJob();
  });

  // Run every 15 minutes — sweeps for stalled 'draft' bookings (and re-checks
  // 'pending_deposit' as a safety net) to free up any abandoned court slots.
  cron.schedule('*/15 * * * *', async () => {
    await runExpireStalledBookingsJob();
  });

  logger.info('Cron jobs scheduled (every 1 minute + every 15 minutes)');
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
      const { rows: expiredBookings } = await db.query<{
        id: string;
        customer_id: string;
        court_id: string;
      }>(
        `UPDATE bookings
         SET status = 'expired', expired_at = NOW(), updated_at = NOW()
         WHERE club_id = $1
           AND status = 'pending_deposit'
           AND created_at < NOW() - ($2 || ' minutes')::INTERVAL
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
           AND created_at < NOW() - ($2 || ' minutes')::INTERVAL
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
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in no-show cron job');
  }
}

// ── 3. Reminder emails ────────────────────────────────────────
async function runReminderJob(): Promise<void> {
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

async function sendReminders(
  clubId: string,
  minutesBefore: number,
  label: string
): Promise<void> {
  // Find confirmed bookings starting in [minutesBefore-1, minutesBefore+1] minute window
  // (cron runs every minute, so we check ±1min tolerance)
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
                             AND NOW() + ($2 + 1 || ' minutes')::INTERVAL`,
    [clubId, minutesBefore]
  );

  for (const booking of bookings) {
    const { rows: custRows } = await db.query<{ email: string; first_name: string }>(
      `SELECT email, first_name FROM users WHERE id = $1`,
      [booking.customer_id]
    );
    if (custRows.length) {
      await emailService.sendBookingReminder({
        to:        custRows[0].email,
        firstName: custRows[0].first_name,
        bookingId: booking.id,
        startTime: booking.start_time,
        reminderType: label,
      });
    }
  }
}
