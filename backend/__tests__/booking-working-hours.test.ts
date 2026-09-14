/**
 * validateBookingSlot's working-hours gate (Phase 6/15) — the
 * assertWithinWorkingHours / resolveDayWindow / mergeIntervals logic that
 * handles 24-hour clubs and overnight (midnight-crossing) shifts. Not
 * exported directly, so exercised through validateBookingSlot with
 * bypassWorkingHours: false and a full week of working_hours rows.
 */
import { fromZonedTime } from 'date-fns-tz';
import { validateBookingSlot } from '../src/domain/booking/booking.validator';
import { ValidationError } from '../src/shared/errors';

function cairoLocal(isoDateNoTz: string): Date {
  return fromZonedTime(isoDateNoTz, 'Africa/Cairo');
}

interface WH { day_of_week: number; open_time: string; close_time: string; is_closed: boolean; }

/** Uniform week: every day gets the same open/close config unless overridden. */
function uniformWeek(open: string, close: string, isClosed = false): WH[] {
  return Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, open_time: open, close_time: close, is_closed: isClosed }));
}

function makeClient(workingHours: WH[]) {
  return {
    query: jest.fn(async (text: string) => {
      if (/FROM courts WHERE id = \$1 AND club_id = \$2/i.test(text)) {
        return { rows: [{ id: 'court-1', status: 'available', is_active: true }] };
      }
      if (/FROM working_hours/i.test(text)) return { rows: workingHours };
      if (/FROM blocked_periods/i.test(text)) return { rows: [] };
      if (/FROM bookings\s+WHERE court_id/i.test(text)) return { rows: [] };
      return { rows: [] };
    }),
  } as any;
}

function params(startTime: Date, durationMinutes = 60) {
  return { clubId: 'club-1', courtId: 'court-1', startTime, durationMinutes, bypassWorkingHours: false };
}

describe('validateBookingSlot — working hours: same-day window', () => {
  const client = makeClient(uniformWeek('08:00', '23:00'));

  test('a booking inside the window passes', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T10:00:00')))).resolves.toBeUndefined();
  });

  test('a booking starting exactly at open time passes', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T08:00:00')))).resolves.toBeUndefined();
  });

  test('a booking ending exactly at close time passes', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T22:00:00'), 60))).resolves.toBeUndefined();
  });

  test('a booking that would end after close time is rejected', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T22:30:00'), 60))).rejects.toThrow(ValidationError);
  });

  test('a booking before opening time is rejected', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T06:00:00'), 60))).rejects.toThrow(ValidationError);
  });
});

describe('validateBookingSlot — 24-hour clubs', () => {
  test('open === close means 24-hour operation — any time is valid', async () => {
    const client = makeClient(uniformWeek('00:00', '00:00'));
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T03:00:00'), 60))).resolves.toBeUndefined();
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T23:30:00'), 60))).resolves.toBeUndefined();
  });

  test('00:00–23:59 (the end-of-day sentinel) is treated as continuous 24-hour operation', async () => {
    const client = makeClient(uniformWeek('00:00', '23:59'));
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T23:30:00'), 60))).resolves.toBeUndefined();
  });
});

describe('validateBookingSlot — overnight (midnight-crossing) shifts', () => {
  // Every day: open 20:00, close 02:00 the following morning.
  const client = makeClient(uniformWeek('20:00', '02:00'));

  test('a booking that starts before midnight and ends after it, within the shift, passes', async () => {
    // 2026-09-14 23:00 -> 01:00 on the 15th
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T23:00:00'), 120))).resolves.toBeUndefined();
  });

  test('a booking starting in the early morning falls under the PREVIOUS day\'s overnight window', async () => {
    // 01:00-02:00 on the 15th belongs to the 14th's 20:00->02:00 shift.
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-15T01:00:00'), 60))).resolves.toBeUndefined();
  });

  test('a booking at exactly the overnight close boundary (02:00) is rejected', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-15T02:00:00'), 60))).rejects.toThrow(ValidationError);
  });

  test('a booking in the middle of the day (outside the overnight shift entirely) is rejected', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T12:00:00'), 60))).rejects.toThrow(ValidationError);
  });

  test('a booking starting right at the overnight open time (20:00) passes', async () => {
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T20:00:00'), 60))).resolves.toBeUndefined();
  });
});

describe('validateBookingSlot — closed days and missing config', () => {
  test('a day marked is_closed rejects every booking on it, with a clear message', async () => {
    const hours = uniformWeek('08:00', '23:00');
    hours[1] = { ...hours[1], is_closed: true }; // Monday closed
    const client = makeClient(hours);

    // 2026-09-14 is a Monday
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T10:00:00'), 60)))
      .rejects.toThrow(/closed/i);
  });

  test('no working_hours rows configured at all is a clean ValidationError, not a crash', async () => {
    const client = makeClient([]);
    await expect(validateBookingSlot(client, params(cairoLocal('2026-09-14T10:00:00'), 60)))
      .rejects.toThrow(/not configured/i);
  });
});

describe('validateBookingSlot — bypassWorkingHours (staff)', () => {
  test('staff bookings skip the working-hours gate entirely, even outside any configured window', async () => {
    const client = makeClient(uniformWeek('08:00', '23:00'));
    await expect(
      validateBookingSlot(client, { ...params(cairoLocal('2026-09-14T03:00:00'), 60), bypassWorkingHours: true })
    ).resolves.toBeUndefined();
  });
});
