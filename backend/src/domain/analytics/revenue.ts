/**
 * Canonical "collected revenue" definition and operational-day bucketing —
 * shared by every controller that reports booking revenue (analytics,
 * finance, financial-summary, reports) so all screens agree on the numbers.
 *
 * A dollar only counts once a staff member has verified it: the booking must
 * have reached a VERIFIED status, and only the deposit/remainder legs whose
 * payment method was actually recorded (method <> 'NONE') count. no_show is
 * included because a forfeited deposit on a no-show is genuinely retained
 * income, not a refund.
 */

/** Booking statuses whose money is real, staff-verified income. */
export const VERIFIED_BOOKING_STATUSES = ['confirmed', 'checked_in', 'completed', 'no_show'] as const;

/** SQL fragment form of VERIFIED_BOOKING_STATUSES, for `status IN (...)`. */
export const VERIFIED_STATUSES_SQL = `('confirmed','checked_in','completed','no_show')`;

/**
 * SQL fragment: deposit + remainder actually collected on a booking row
 * aliased `b`. Assumes `b.deposit_amount`, `b.deposit_method`,
 * `b.remainder_amount`, `b.remainder_method` are in scope.
 */
export const COLLECTED_SQL = `(
  COALESCE(b.deposit_amount,0)  * (b.deposit_method   IS NOT NULL AND b.deposit_method   <> 'NONE')::int +
  COALESCE(b.remainder_amount,0)* (b.remainder_method IS NOT NULL AND b.remainder_method <> 'NONE')::int
)`;

const OPERATIONAL_DAY_SHIFT = `INTERVAL '6 hours'`;

/**
 * CourtFlow's operational day runs 06:00 → 05:59:59 the next morning in
 * club-local time (matching the staff schedule window), not the plain
 * calendar date. A booking at 02:00 belongs to the PREVIOUS operational day.
 * Shifting the local wall-clock time back 6 hours before truncating/grouping
 * achieves this. Callers wrap the result in `::date`, `DATE_TRUNC(...)`, or
 * `TO_CHAR(...)` as needed — this only produces the shifted timestamp.
 */
export function operationalDayExpr(columnExpr: string, tz = 'Africa/Cairo'): string {
  return `(${columnExpr} AT TIME ZONE '${tz}') - ${OPERATIONAL_DAY_SHIFT}`;
}

/**
 * JS-side counterpart to operationalDayExpr, for building dense day-series
 * labels that must line up with rows the SQL grouped by the same shift.
 * Reads the instant's tz wall-clock time, treats it as a bare calendar
 * timestamp (matching what `AT TIME ZONE tz` produces in Postgres), shifts it
 * back 6 hours, and returns the resulting YYYY-MM-DD.
 */
export function operationalDateKey(instant: Date, tz = 'Africa/Cairo'): string {
  const wallClock = instant.toLocaleString('sv', { timeZone: tz }); // 'YYYY-MM-DD HH:mm:ss'
  const shifted = new Date(`${wallClock.replace(' ', 'T')}Z`);
  shifted.setUTCHours(shifted.getUTCHours() - 6);
  return shifted.toISOString().slice(0, 10);
}
