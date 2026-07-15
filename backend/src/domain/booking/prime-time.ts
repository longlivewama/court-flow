/**
 * Prime-time classification — shared by the anti-lockout expiry override
 * (create-booking) and the anti-scalping waitlist interceptor (cancel).
 *
 * A slot is prime time when, in the club's local timezone, it starts on a
 * weekend day (Friday/Saturday — the Egyptian weekend) or on a weekday at
 * 17:00 or later. Prime-time slots are the club's most contested and most
 * valuable inventory, so they get the tightest anti-abuse windows.
 */
import { toZonedTime } from 'date-fns-tz';

const CLUB_TIMEZONE = 'Africa/Cairo';

/** Max minutes a prime-time slot may sit unpaid before auto-expiring. */
export const PRIME_TIME_EXPIRY_MINUTES = 15;

/** Minutes the top waitlist user has to claim a cancelled prime-time slot. */
export const WAITLIST_HOLD_MINUTES = 5;

export function isPrimeTime(startTime: Date): boolean {
  const local = toZonedTime(startTime, CLUB_TIMEZONE);
  const day = local.getDay();          // 0=Sun … 5=Fri, 6=Sat
  const isWeekend = day === 5 || day === 6;
  return isWeekend || local.getHours() >= 17;
}
