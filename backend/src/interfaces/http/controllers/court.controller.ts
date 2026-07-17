/**
 * Court Controller – Court CRUD, availability checking, working hours, blocked periods, daily schedule.
 */
import { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { withTransaction } from '../../../infrastructure/database/client';
import { redis, CACHE_KEYS, CACHE_TTL } from '../../../infrastructure/cache/redis.client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError, ConflictError } from '../../../shared/errors';
import { addMinutes, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE  = 'Africa/Cairo';

// ── GET /api/courts ───────────────────────────────────────────
export async function listCourts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Cache court list for 30 seconds
    const cacheKey = CACHE_KEYS.courtList(clubIdOf(req));
    const cached   = await redis.get(cacheKey);
    if (cached) { res.json(JSON.parse(cached)); return; }

    const { rows } = await db.query(
      `SELECT *,
              number        AS court_number,
              price_per_slot AS price_per_hour,
              COALESCE(description, '') AS surface_type,
              FALSE AS is_indoor
       FROM courts WHERE club_id=$1 AND is_active=true ORDER BY number`,
      [clubIdOf(req)]
    );

    await redis.setex(cacheKey, CACHE_TTL.courtList, JSON.stringify(rows));
    res.json(rows);
  } catch (err) { next(err); }
}


// ── GET /api/courts/:id ───────────────────────────────────────
export async function getCourt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(`SELECT * FROM courts WHERE id=$1 AND club_id=$2`, [req.params.id, clubIdOf(req)]);
    if (!rows.length) throw new NotFoundError('Court', req.params.id);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── POST /api/courts (owner only) ────────────────────────────
export async function createCourt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, pricePerSlot, status } = req.body;
    let { number } = req.body;

    // Validate required fields up-front for a clean 400 error
    if (!name || name.trim() === '') {
      throw new ValidationError('Court name is required');
    }
    if (pricePerSlot === undefined || pricePerSlot === null || Number(pricePerSlot) <= 0) {
      throw new ValidationError('pricePerSlot must be a positive number');
    }

    // Auto-assign the next court number if the caller didn't provide one
    if (number === undefined || number === null) {
      const { rows: maxRows } = await db.query<{ max_number: number | null }>(
        `SELECT COALESCE(MAX(number), 0) AS max_number FROM courts WHERE club_id = $1`,
        [clubIdOf(req)]
      );
      number = (maxRows[0]?.max_number ?? 0) + 1;
    }

    const { rows } = await db.query(
      `INSERT INTO courts (club_id, name, number, description, price_per_slot, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [clubIdOf(req), name.trim(), number, description?.trim() ?? null, Number(pricePerSlot), status ?? 'available']
    );
    await redis.del(CACHE_KEYS.courtList(clubIdOf(req)));
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.COURT_CREATED,
      entityType: 'court', entityId: rows[0].id, newValues: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── PATCH /api/courts/:id (owner only) ────────────────────────
export async function updateCourt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, number, description, pricePerSlot, status } = req.body;
    const { rows: old } = await db.query(`SELECT * FROM courts WHERE id=$1 AND club_id=$2`, [req.params.id, clubIdOf(req)]);
    if (!old.length) throw new NotFoundError('Court', req.params.id);

    const { rows } = await db.query(
      `UPDATE courts SET name=COALESCE($2,name), number=COALESCE($3,number),
       description=COALESCE($4,description), price_per_slot=COALESCE($5,price_per_slot),
       status=COALESCE($6,status), updated_at=NOW()
       WHERE id=$1 AND club_id=$7 RETURNING *`,
      [req.params.id, name, number, description, pricePerSlot, status, clubIdOf(req)]
    );
    await redis.del(CACHE_KEYS.courtList(clubIdOf(req)));
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.COURT_UPDATED, entityType: 'court', entityId: req.params.id,
      previousValues: old[0], newValues: rows[0] });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── DELETE /api/courts/:id (owner only) ───────────────────────
export async function deleteCourt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `UPDATE courts SET is_active=false, updated_at=NOW() WHERE id=$1 AND club_id=$2 RETURNING *`,
      [req.params.id, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Court', req.params.id);
    await redis.del(CACHE_KEYS.courtList(clubIdOf(req)));
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.COURT_DELETED, entityType: 'court', entityId: req.params.id });
    res.json({ message: 'Court deactivated' });
  } catch (err) { next(err); }
}

// ── GET /api/courts/:id/availability?date=2026-07-10 ──────────
export async function getCourtAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { date } = req.query as { date?: string };
    if (!date) throw new ValidationError('date query parameter is required (YYYY-MM-DD)');

    // Convert date to UTC range based on Cairo timezone
    const dayStartCairo = fromZonedTime(`${date}T00:00:00`, TIMEZONE);
    const dayEndCairo   = fromZonedTime(`${date}T23:59:59`, TIMEZONE);

    // Get working hours for this day
    const cairoDay = toZonedTime(dayStartCairo, TIMEZONE);
    const dayOfWeek = cairoDay.getDay();
    const { rows: wh } = await db.query(
      `SELECT * FROM working_hours WHERE club_id=$1 AND day_of_week=$2`,
      [clubIdOf(req), dayOfWeek]
    );

    // Get existing confirmed bookings for this court on this day
    const { rows: existing } = await db.query(
      `SELECT start_time, end_time, status FROM bookings
       WHERE court_id=$1 AND club_id=$2
         AND status IN ('confirmed','checked_in','pending_verification','pending_deposit')
         AND start_time >= $3 AND start_time <= $4
       ORDER BY start_time`,
      [req.params.id, clubIdOf(req), dayStartCairo.toISOString(), dayEndCairo.toISOString()]
    );

    // Get blocked periods
    const { rows: blocked } = await db.query(
      `SELECT start_at, end_at, title, type FROM blocked_periods
       WHERE club_id=$1 AND (court_id=$2 OR court_id IS NULL)
         AND start_at <= $4 AND end_at >= $3`,
      [clubIdOf(req), req.params.id, dayStartCairo.toISOString(), dayEndCairo.toISOString()]
    );

    res.json({ workingHours: wh[0] ?? null, bookedSlots: existing, blockedPeriods: blocked });
  } catch (err) { next(err); }
}

// ── GET /api/courts/availability-grid?date=2026-07-10 ────────
// Customer-safe availability overview for ALL active courts over the
// operational business day (noon → 06:00 AM next day, Cairo — same window
// as getDailySchedule). Returns occupied intervals only, with NO customer
// PII, so it is safe to expose to any authenticated role.
export async function getAvailabilityGrid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const date = (req.query.date as string) ?? new Date().toLocaleDateString('sv', { timeZone: TIMEZONE });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ValidationError('date must be formatted YYYY-MM-DD');
    }

    const windowStart = fromZonedTime(`${date}T12:00:00`, TIMEZONE);
    const [y, m, d]   = date.split('-').map(Number);
    const nextDateStr = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const windowEnd   = fromZonedTime(`${nextDateStr}T06:00:00`, TIMEZONE);

    const [courtsResult, bookingsResult, blockedResult] = await Promise.all([
      db.query(
        `SELECT id, name, number AS court_number, price_per_slot AS price_per_hour
         FROM courts WHERE club_id = $1 AND is_active = true ORDER BY number`,
        [clubIdOf(req)]
      ),
      db.query(
        `SELECT court_id, start_time, end_time
         FROM bookings
         WHERE club_id = $1
           AND status IN ('confirmed','checked_in','pending_verification','pending_deposit','draft')
           AND start_time < $3 AND end_time > $2
         ORDER BY start_time`,
        [clubIdOf(req), windowStart.toISOString(), windowEnd.toISOString()]
      ),
      db.query(
        `SELECT court_id, type, title, start_at, end_at
         FROM blocked_periods
         WHERE club_id = $1 AND start_at < $3 AND end_at > $2
         ORDER BY start_at`,
        [clubIdOf(req), windowStart.toISOString(), windowEnd.toISOString()]
      ),
    ]);

    res.json({
      date,
      windowStart:    windowStart.toISOString(),
      windowEnd:      windowEnd.toISOString(),
      courts:         courtsResult.rows,
      bookedSlots:    bookingsResult.rows,
      blockedPeriods: blockedResult.rows,
    });
  } catch (err) { next(err); }
}

// ── GET /api/dashboard/schedule?date=2026-07-10 ──────────────
// The operational business day runs from 12:00 PM (noon) on the
// requested date to 06:00 AM the FOLLOWING calendar day (overnight
// shift). We therefore query a 18-hour UTC window anchored at noon
// Cairo time rather than the strict 00:00–23:59 calendar window.
export async function getDailySchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);

    // Business-day window: noon of the requested date → 06:00 AM next day (Cairo)
    const windowStart = fromZonedTime(`${date}T12:00:00`, TIMEZONE); // 12:00 PM → UTC
    // Next calendar date
    const [y, m, d]   = date.split('-').map(Number);
    const nextDate    = new Date(Date.UTC(y, m - 1, d + 1));
    const nextDateStr = nextDate.toISOString().slice(0, 10);
    const windowEnd   = fromZonedTime(`${nextDateStr}T06:00:00`, TIMEZONE); // 06:00 AM next day → UTC

    // Inverse map: DB lowercase → frontend uppercase enum key
    const DB_TO_REASON: Record<string, string> = {
      maintenance:  'MAINTENANCE',
      tournament:   'TOURNAMENT',
      private_event:'TRAINING',
      other:        'ADMIN_CLOSED',
      holiday:      'ADMIN_CLOSED',
    };

    const [bookingsResult, blockedResult] = await Promise.all([
      db.query(
        `SELECT b.*, c.name AS court_name, c.number AS court_number,
                u.first_name, u.last_name, u.email AS customer_email, u.phone AS customer_phone,
                p.status AS payment_status,
                b.total_price, b.deposit_amount, b.deposit_method, b.remainder_amount, b.remainder_method
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         JOIN users  u ON u.id = b.customer_id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.club_id=$1
           AND b.start_time >= $2
           AND b.start_time <  $3
           AND b.status NOT IN ('cancelled','expired')
         ORDER BY b.start_time, c.number`,
        [clubIdOf(req), windowStart.toISOString(), windowEnd.toISOString()]
      ),
      db.query(
        `SELECT bp.id, bp.court_id, bp.type AS reason_type, bp.title,
                bp.start_at, bp.end_at, bp.recurring
         FROM blocked_periods bp
         WHERE bp.club_id = $1
           AND bp.start_at <  $3
           AND bp.end_at   >  $2
         ORDER BY bp.start_at`,
        [clubIdOf(req), windowStart.toISOString(), windowEnd.toISOString()]
      ),
    ]);

    // Normalise blocked period reason_type to uppercase frontend enum keys
    const blockedPeriods = blockedResult.rows.map((bp: Record<string, unknown>) => ({
      ...bp,
      reason_type: DB_TO_REASON[bp.reason_type as string] ?? 'ADMIN_CLOSED',
    }));

    res.json({
      bookings:       bookingsResult.rows,
      blockedPeriods,
    });
  } catch (err) { next(err); }
}

// ── GET/PUT working hours ──────────────────────────────────────
export async function getWorkingHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(`SELECT * FROM working_hours WHERE club_id=$1 ORDER BY day_of_week`, [clubIdOf(req)]);
    res.json(rows);
  } catch (err) { next(err); }
}

import { workingHoursSchema } from '../../../shared/schemas';

export async function upsertWorkingHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = workingHoursSchema.parse(req.body);
    const { hours } = parsed;
    await withTransaction(async (client) => {
      for (const h of hours) {
        await client.query(
          `INSERT INTO working_hours (club_id,day_of_week,open_time,close_time,is_closed)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (club_id,day_of_week) DO UPDATE
             SET open_time=$3, close_time=$4, is_closed=$5, updated_at=NOW()`,
          [clubIdOf(req), h.dayOfWeek, h.openTime, h.closeTime, h.isClosed]
        );
      }
    });
    await redis.del(CACHE_KEYS.workingHours(clubIdOf(req)));
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.WORKING_HOURS_UPDATED, entityType: 'working_hours' });
    res.json({ message: 'Working hours updated' });
  } catch (err) { next(err); }
}

// ── Club settings ─────────────────────────────────────────────
export async function getClubSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(`SELECT * FROM clubs WHERE id=$1`, [clubIdOf(req)]);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateClubSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Accept both camelCase (API convention) and the admin settings page's
    // snake_case field names (club_name, contact_email, contact_phone,
    // cancellation_cutoff_hrs, deposit_percentage) — same dual-naming pattern
    // used for bookings in booking.controller.ts.
    const body = req.body;
    const depositPercent             = body.depositPercent             ?? body.deposit_percentage;
    const cancellationDeadlineHours  = body.cancellationDeadlineHours  ?? body.cancellation_cutoff_hrs;
    const pendingDepositExpiryMinutes = body.pendingDepositExpiryMinutes ?? body.pending_deposit_expiry_minutes;
    const noshowGraceMinutes         = body.noshowGraceMinutes         ?? body.noshow_grace_minutes;
    const reminder24hEnabled         = body.reminder24hEnabled         ?? body.reminder_24h_enabled;
    const reminder2hEnabled          = body.reminder2hEnabled          ?? body.reminder_2h_enabled;
    const name                       = body.name                       ?? body.club_name;
    const email                      = body.email                      ?? body.contact_email;
    const phone                      = body.phone                      ?? body.contact_phone;
    const address                    = body.address;

    const { rows: old } = await db.query(`SELECT * FROM clubs WHERE id=$1`, [clubIdOf(req)]);
    const { rows } = await db.query(
      `UPDATE clubs SET
         deposit_percent=COALESCE($2,deposit_percent),
         cancellation_deadline_hours=COALESCE($3,cancellation_deadline_hours),
         pending_deposit_expiry_minutes=COALESCE($4,pending_deposit_expiry_minutes),
         noshow_grace_minutes=COALESCE($5,noshow_grace_minutes),
         reminder_24h_enabled=COALESCE($6,reminder_24h_enabled),
         reminder_2h_enabled=COALESCE($7,reminder_2h_enabled),
         name=COALESCE($8,name), email=COALESCE($9,email),
         phone=COALESCE($10,phone), address=COALESCE($11,address),
         updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [clubIdOf(req), depositPercent, cancellationDeadlineHours, pendingDepositExpiryMinutes, noshowGraceMinutes,
       reminder24hEnabled, reminder2hEnabled, name, email, phone, address]
    );
    await redis.del(CACHE_KEYS.clubSettings(clubIdOf(req)));
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.SETTINGS_UPDATED, entityType: 'club',
      previousValues: old[0], newValues: rows[0] });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// Strict enum for blocked period reason types (frontend-facing uppercase)
const REASON_TYPES = ['MAINTENANCE', 'TOURNAMENT', 'TRAINING', 'ADMIN_CLOSED'] as const;
type ReasonType = typeof REASON_TYPES[number];

/**
 * Maps the frontend's display enum to the Postgres `blocked_period_type` enum.
 * DB allowed values: maintenance | private_event | holiday | tournament | other
 */
const DB_REASON_MAP: Record<ReasonType, string> = {
  MAINTENANCE:  'maintenance',
  TOURNAMENT:   'tournament',
  TRAINING:     'private_event',  // closest DB enum value
  ADMIN_CLOSED: 'other',
};

/**
 * Inverse map: DB lowercase string → frontend uppercase TS union key.
 * Used when returning the inserted row so the modal receives a value
 * that resolves correctly in the REASON_CONFIG dictionary.
 */
const DB_TO_REASON_TYPE: Record<string, ReasonType> = {
  maintenance:   'MAINTENANCE',
  tournament:    'TOURNAMENT',
  private_event: 'TRAINING',
  other:         'ADMIN_CLOSED',
  holiday:       'ADMIN_CLOSED',
};

/**
 * Reject a blocked period that would overlap an existing reservation on the same
 * court, mirroring the guard `validateBookingSlot` applies in the other direction
 * (a new booking cannot land on a block). Together they make the two schedule
 * writers symmetric, so neither can create a court double-booking.
 *
 * Overlap is the half-open interval test: existing.start < new.end AND
 * existing.end > new.start.
 *
 * Court scoping:
 *   • A court-specific block (courtId set) conflicts with bookings on that court,
 *     and with blocks on that court OR club-wide blocks (court_id IS NULL).
 *   • A club-wide block (courtId = null) conflicts with ANY booking or block in
 *     the club, on any court.
 * The `$2::uuid IS NULL OR …` clauses collapse to "match everything" when the new
 * block is club-wide, so $2 stays referenced and Postgres never sees a stray bind.
 */
async function assertBlockedPeriodFree(
  client: PoolClient,
  clubId: string,
  courtId: string | null,
  startAt: Date,
  endAt: Date,
): Promise<void> {
  const startISO = startAt.toISOString();
  const endISO   = endAt.toISOString();

  // ── Conflicting active customer bookings ─────────────────────
  // Soft-deleted bookings carry status 'cancelled', so both the status filter and
  // the explicit deleted_at guard exclude them.
  const { rows: bookingRows } = await client.query(
    `SELECT id FROM bookings
      WHERE club_id = $1::uuid
        AND deleted_at IS NULL
        AND status IN ('draft', 'pending_deposit', 'pending_verification', 'confirmed', 'checked_in')
        AND ($2::uuid IS NULL OR court_id = $2::uuid)
        AND start_time < $4::timestamptz
        AND end_time   > $3::timestamptz
      LIMIT 1`,
    [clubId, courtId, startISO, endISO],
  );
  if (bookingRows.length > 0) {
    throw new ConflictError(
      'This time slot conflicts with an existing customer booking on this court.',
    );
  }

  // ── Conflicting existing blocks (maintenance / tournament / etc.) ──
  const { rows: blockRows } = await client.query<{ title: string; type: string }>(
    `SELECT title, type FROM blocked_periods
      WHERE club_id = $1::uuid
        AND ($2::uuid IS NULL OR court_id = $2::uuid OR court_id IS NULL)
        AND start_at < $4::timestamptz
        AND end_at   > $3::timestamptz
      LIMIT 1`,
    [clubId, courtId, startISO, endISO],
  );
  if (blockRows.length > 0) {
    const b = blockRows[0];
    throw new ConflictError(
      `This time slot conflicts with a scheduled ${b.type} block on this court: "${b.title}".`,
    );
  }
}

export async function createBlockedPeriod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { z } = await import('zod');
    const schema = z.object({
      courtId:     z.string().uuid().nullable().optional(),
      reasonType:  z.enum(REASON_TYPES),
      reason_type: z.enum(REASON_TYPES).optional(),
      title:       z.string().min(1).max(120),
      startAt:     z.string(),
      endAt:       z.string(),
      recurring:   z.boolean().optional().default(false),
    });

    const body = schema.parse(req.body);
    const reasonType: ReasonType = body.reasonType ?? (body.reason_type as ReasonType);
    const startAt = new Date(body.startAt);
    const endAt   = new Date(body.endAt);

    if (startAt >= endAt) {
      throw new ValidationError('startAt must be before endAt');
    }

    // Only sanity-check that the range is non-empty; admins are NOT restricted
    // by business hours – the operational window check has been removed so that
    // Tournaments, Maintenance windows, etc. can span any hours of the day.

    const courtId = body.courtId ?? null;

    // Lock + validate + insert atomically so a booking can't slip into the same
    // slot between the overlap check and the insert. The FOR UPDATE below locks the
    // same court row(s) createBooking locks, serializing the two schedule writers.
    const rows = await withTransaction(async (client) => {
      await client.query(
        `SELECT id FROM courts
          WHERE club_id = $1::uuid AND ($2::uuid IS NULL OR id = $2::uuid)
          FOR UPDATE`,
        [clubIdOf(req), courtId],
      );

      await assertBlockedPeriodFree(client, clubIdOf(req), courtId, startAt, endAt);

      const { rows } = await client.query(
        `INSERT INTO blocked_periods (club_id, court_id, type, title, start_at, end_at, recurring, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [clubIdOf(req), courtId, DB_REASON_MAP[reasonType], body.title, body.startAt, body.endAt, body.recurring ?? false, req.user!.sub]
      );

      await auditLog({
        clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
        actionType: AUDIT_ACTIONS.BLOCKED_PERIOD_CREATED,
        entityType: 'blocked_period', entityId: rows[0].id, newValues: rows[0]
      });

      return rows;
    });

    // Return the row with reason_type normalised back to the frontend uppercase
    // enum key so the schedule modal never receives a raw lowercase DB string.
    const normalizedReasonType: ReasonType =
      DB_TO_REASON_TYPE[rows[0].type as string] ?? 'ADMIN_CLOSED';

    res.status(201).json({ ...rows[0], reason_type: normalizedReasonType });
  } catch (err) { next(err); }
}

export async function deleteBlockedPeriod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `DELETE FROM blocked_periods WHERE id=$1 AND club_id=$2 RETURNING *`,
      [req.params.bpId, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Blocked period', req.params.bpId);
    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.BLOCKED_PERIOD_DELETED, entityType: 'blocked_period', entityId: req.params.bpId });
    res.json({ message: 'Blocked period removed' });
  } catch (err) { next(err); }
}
