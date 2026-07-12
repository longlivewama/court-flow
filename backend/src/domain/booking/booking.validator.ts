/**
 * Booking Validator
 * Server-side validation algorithm as specified in SRS §8.4, §10, and §14.
 *
 * Checks (in order):
 *   1. Duration is allowed (60, 90, or 120 min)
 *   2. Court exists and status is 'available'
 *   3. Slot fits within the club's configured working hours (clients only)
 *      → SKIPPED for Admin / Staff / Receptionist (bypassWorkingHours = true)
 *   4. No blocked period overlaps the slot
 *   5. No confirmed/checked_in booking overlaps the slot
 *
 * Working hours are read live from the `working_hours` table and support
 * arbitrary schedules — including 24-hour operation and shifts that cross
 * midnight — rather than any hardcoded closing time. See
 * assertWithinWorkingHours below for the windowing model.
 *
 * Pessimistic locking is handled at the use-case level via SELECT … FOR UPDATE.
 */
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { getDay, addMinutes, addDays, startOfDay } from 'date-fns';
import { PoolClient } from 'pg';
import { ValidationError, ConflictError } from '../../shared/errors';

const CLUB_TIMEZONE = 'Africa/Cairo';
const ALLOWED_DURATIONS = [60, 90, 120] as const;
const MINUTES_PER_DAY = 24 * 60;

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
  // Overlap is computed on absolute UTC timestamps (start_time / end_time),
  // and end_time is persisted as start + duration. A booking that crosses
  // midnight therefore has an end_time on the next calendar day, and this
  // half-open interval test (existing.start < new.end AND existing.end > new.start)
  // stays correct across the day boundary with no special-casing.
  const excludeClause = excludeBookingId ? `AND id != '${excludeBookingId}'` : '';
  const { rows: conflictRows } = await client.query(
    `SELECT id FROM bookings
     WHERE court_id = $1::uuid
       AND deleted_at IS NULL
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

interface WorkingHourRow {
  day_of_week: number;
  open_time:   string;   // 'HH:MM:SS'
  close_time:  string;   // 'HH:MM:SS'
  is_closed:   boolean;
}

/** Absolute open window as an epoch-millisecond half-open interval [open, close). */
interface OpenInterval {
  open:  number;
  close: number;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Resolve one configured day into an absolute UTC open interval, or null when
 * the club is closed that day.
 *
 * `cairoMidnight` is the Cairo-local midnight (wall-clock Date) of the calendar
 * day being resolved. Interpretation of (open_time, close_time):
 *
 *   • is_closed              → closed (null)
 *   • open === close         → 24-hour operation: [open, open + 24h)
 *   • close === 23:59        → end-of-day sentinel treated as 24:00, so a
 *                              full-day 00:00–23:59 config is continuous
 *                              (the `time` column cannot store 24:00)
 *   • close  <= open         → overnight shift: close rolls to the next day
 *   • otherwise              → same-day window [open, close)
 *
 * Wall-clock minutes are converted to true UTC instants via fromZonedTime, so
 * the result is correct across DST transitions.
 */
function resolveDayWindow(cairoMidnight: Date, wh: WorkingHourRow): OpenInterval | null {
  if (wh.is_closed) return null;

  const openMin = timeToMinutes(wh.open_time);
  let closeMin  = timeToMinutes(wh.close_time);

  let startMin: number;
  let endMin:   number;

  if (openMin === closeMin) {
    // Canonical 24-hour operation.
    startMin = openMin;
    endMin   = openMin + MINUTES_PER_DAY;
  } else {
    if (closeMin === MINUTES_PER_DAY - 1) closeMin = MINUTES_PER_DAY; // 23:59 → midnight
    startMin = openMin;
    endMin   = closeMin <= openMin ? closeMin + MINUTES_PER_DAY : closeMin;
  }

  const openWall  = addMinutes(cairoMidnight, startMin);
  const closeWall = addMinutes(cairoMidnight, endMin);
  return {
    open:  fromZonedTime(openWall,  CLUB_TIMEZONE).getTime(),
    close: fromZonedTime(closeWall, CLUB_TIMEZONE).getTime(),
  };
}

/** Merge intervals that overlap or touch, so adjacent day-windows form one span. */
function mergeIntervals(intervals: OpenInterval[]): OpenInterval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.open - b.open);
  const merged: OpenInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].open <= last.close) {
      last.close = Math.max(last.close, sorted[i].close);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/**
 * Assert the booking [startTime, endTime) lies fully within the club's
 * configured operating hours. Handles 24-hour clubs and midnight-spanning
 * shifts by evaluating the windows of the surrounding calendar days as
 * absolute UTC intervals and merging any that meet at the day boundary.
 */
async function assertWithinWorkingHours(
  client: PoolClient,
  clubId: string,
  startTime: Date,
  endTime: Date
): Promise<void> {
  const { rows } = await client.query<WorkingHourRow>(
    `SELECT day_of_week, open_time, close_time, is_closed
     FROM working_hours
     WHERE club_id = $1`,
    [clubId]
  );

  if (!rows.length) {
    throw new ValidationError('Club working hours are not configured');
  }

  const byDay = new Map<number, WorkingHourRow>(rows.map((r) => [r.day_of_week, r]));

  const startCairo   = toZonedTime(startTime, CLUB_TIMEZONE);
  const baseMidnight = startOfDay(startCairo);

  // A slot can fall under the window of the day it starts on, the PREVIOUS day
  // (an overnight shift that ran past midnight), or extend into the NEXT day.
  const intervals: OpenInterval[] = [];
  for (const offset of [-1, 0, 1]) {
    const dayMidnight = addDays(baseMidnight, offset);
    const wh = byDay.get(getDay(dayMidnight));
    if (!wh) continue;
    const window = resolveDayWindow(dayMidnight, wh);
    if (window) intervals.push(window);
  }

  const startMs = startTime.getTime();
  const endMs   = endTime.getTime();
  const isOpen  = mergeIntervals(intervals).some(
    (iv) => startMs >= iv.open && endMs <= iv.close
  );
  if (isOpen) return;

  // Not open — surface a message based on the start day's configuration.
  const startDay = byDay.get(getDay(startCairo));
  if (!startDay || startDay.is_closed) {
    throw new ValidationError('The club is closed at the selected time.');
  }
  throw new ValidationError(
    `Booking must fall within the club's working hours ` +
    `(${startDay.open_time.slice(0, 5)}–${startDay.close_time.slice(0, 5)}).`
  );
}
