/**
 * Booking Validator
 * Server-side validation algorithm as specified in SRS §8.4, §10, and §14.
 *
 * Checks (in order):
 *   1. Club is open (working hours, Africa/Cairo timezone)
 *      → SKIPPED for Admin / Staff / Receptionist (bypassWorkingHours = true)
 *   2. Duration is allowed (60, 90, or 120 min)
 *   3. Slot fits within working hours for that day (clients only)
 *   4. Court exists and status is 'available'
 *   5. No blocked period overlaps the slot
 *   6. No confirmed/checked_in booking overlaps the slot
 *
 * Pessimistic locking is handled at the use-case level via SELECT … FOR UPDATE.
 */
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { getDay, getHours, getMinutes, addMinutes } from 'date-fns';
import { PoolClient } from 'pg';
import { ValidationError, ConflictError } from '../../shared/errors';

const CLUB_TIMEZONE = 'Africa/Cairo';
const ALLOWED_DURATIONS = [60, 90, 120] as const;

export interface ValidateBookingParams {
  clubId:             string;
  courtId:            string;
  startTime:          Date;   // UTC
  durationMinutes:    60 | 90 | 120;
  excludeBookingId?:  string;   // for rescheduling
  /**
   * When true the working-hours gate is completely skipped.
   * Set this for Admin, Receptionist, and Staff roles so they can
   * create bookings at any hour without the venue's operational window
   * blocking them.
   */
  bypassWorkingHours?: boolean;
}

export async function validateBookingSlot(
  client: PoolClient,
  params: ValidateBookingParams
): Promise<void> {
  const { clubId, courtId, startTime, durationMinutes, excludeBookingId } = params;
  const endTime = addMinutes(startTime, durationMinutes);

  // ── 1. Duration check ─────────────────────────────────────
  if (!(ALLOWED_DURATIONS as readonly number[]).includes(durationMinutes)) {
    throw new ValidationError(
      `Duration must be one of: ${ALLOWED_DURATIONS.join(', ')} minutes`
    );
  }

  // ── 2. Court existence and status ─────────────────────────
  const { rows: courtRows } = await client.query<{
    id: string;
    status: string;
    is_active: boolean;
  }>(
    `SELECT id, status, is_active FROM courts WHERE id = $1 AND club_id = $2`,
    [courtId, clubId]
  );

  if (!courtRows.length) {
    throw new ValidationError('Court not found');
  }
  const court = courtRows[0];
  if (!court.is_active || court.status !== 'available') {
    throw new ValidationError(
      `Court is not available (status: ${court.status})`
    );
  }

  // ── 3. Working hours check (client-facing only) ───────────
  // Admins, receptionists, and staff pass bypassWorkingHours = true
  // so they can schedule bookings at any time of day.
  if (!params.bypassWorkingHours) {
    await assertWithinWorkingHours(client, clubId, startTime, endTime);
  }

  // ── 4. Blocked periods check ──────────────────────────────
  const { rows: blockedRows } = await client.query(
    `SELECT id, title, type FROM blocked_periods
     WHERE club_id = $1::uuid
       AND (court_id IS NULL OR court_id = $2::uuid)
       AND start_at < $4::timestamptz
       AND end_at   > $3::timestamptz`,
    [clubId, courtId, startTime.toISOString(), endTime.toISOString()]
  );

  if (blockedRows.length > 0) {
    const b = blockedRows[0];
    throw new ConflictError(
      `Court is blocked during this period: "${b.title}" (${b.type})`
    );
  }

  // ── 5. Existing confirmed booking overlap ─────────────────
  const excludeClause = excludeBookingId ? `AND id != '${excludeBookingId}'` : '';
  const { rows: conflictRows } = await client.query(
    `SELECT id FROM bookings
     WHERE court_id = $1::uuid
       AND status IN ('confirmed', 'checked_in', 'pending_verification', 'pending_deposit')
       AND start_time < $3::timestamptz
       AND end_time   > $2::timestamptz
       ${excludeClause}`,
    [courtId, startTime.toISOString(), endTime.toISOString()]
  );

  if (conflictRows.length > 0) {
    throw new ConflictError(
      'This time slot is already booked. Please choose a different time.'
    );
  }
}

// Overnight cut-off: slots between 00:00 and before this hour belong
// to the *previous* calendar day's business shift (e.g. a shift that
// opened at 12:00 PM and closes at 06:00 AM the following morning).
const OVERNIGHT_CUTOFF_HOUR = 6;

async function assertWithinWorkingHours(
  client: PoolClient,
  clubId: string,
  startTime: Date,
  endTime: Date
): Promise<void> {
  // Convert UTC times to Cairo timezone for working-hours validation
  const startCairo = toZonedTime(startTime, CLUB_TIMEZONE);
  const endCairo   = toZonedTime(endTime,   CLUB_TIMEZONE);

  const startHourCairo = getHours(startCairo);

  // ── Overnight shift correction ────────────────────────────────
  // If the local hour is before the overnight cutoff (00:00–05:59) the
  // slot belongs to the PREVIOUS calendar day's business window.
  // Shift dayOfWeek back by 1 and add 1 440 min so the arithmetic is
  // continuous (e.g. 01:00 AM becomes minute 1 500 relative to a
  // 12:00 PM open rather than minute 60, which would wrongly pass the
  // open-time check).
  const isPostMidnight = startHourCairo < OVERNIGHT_CUTOFF_HOUR;

  // Logical day-of-week (0=Sunday … 6=Saturday), shifted back when post-midnight
  const rawDay    = getDay(startCairo);
  const dayOfWeek = isPostMidnight ? (rawDay + 6) % 7 : rawDay;

  // Slot minutes in continuous arithmetic (post-midnight slots get +1 440)
  const rawStartMin = startHourCairo * 60 + getMinutes(startCairo);
  const rawEndMin   = getHours(endCairo) * 60 + getMinutes(endCairo);

  const slotStartMinutes = isPostMidnight ? rawStartMin + 24 * 60 : rawStartMin;
  const slotEndMinutes   = isPostMidnight ? rawEndMin   + 24 * 60 : rawEndMin;

  const { rows } = await client.query<{
    open_time:  string; // HH:MM:SS
    close_time: string;
    is_closed:  boolean;
  }>(
    `SELECT open_time, close_time, is_closed
     FROM working_hours
     WHERE club_id = $1 AND day_of_week = $2`,
    [clubId, dayOfWeek]
  );

  if (!rows.length) {
    throw new ValidationError('Club working hours are not configured for this day');
  }

  const wh = rows[0];
  if (wh.is_closed) {
    throw new ValidationError('The club is closed on this day');
  }

  // Parse HH:MM into minutes-since-midnight
  const [openH,  openM]  = wh.open_time.split(':').map(Number);
  const [closeH, closeM] = wh.close_time.split(':').map(Number);

  const openMinutes  = openH  * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  // Normalise after-midnight close time into the continuous window
  // (e.g. 06:00 close on a shift opened at 12:00 = 1 800 min)
  const effectiveClose =
    closeMinutes <= openMinutes ? closeMinutes + 24 * 60 : closeMinutes;

  // Normalise slot end the same way (only when NOT already shifted by +1 440)
  const effectiveEnd =
    !isPostMidnight && slotEndMinutes < slotStartMinutes
      ? slotEndMinutes + 24 * 60
      : slotEndMinutes;

  if (slotStartMinutes < openMinutes) {
    throw new ValidationError(
      `Booking must start at or after ${wh.open_time} (club opening time)`
    );
  }
  if (effectiveEnd > effectiveClose) {
    throw new ValidationError(
      `Booking must end by ${wh.close_time} (club closing time)`
    );
  }
}
