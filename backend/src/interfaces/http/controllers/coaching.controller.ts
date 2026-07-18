/**
 * Coaching Controller – coaches and the training-session financial ledger.
 *
 * Each session snapshots three numbers at creation time from the coach's
 * hourly rate and commission percentage (both overridable per session):
 *
 *   price       – what the client pays
 *   coach_share – the coach's commission payout
 *   club_share  – what the club keeps as profit
 *
 * Later rate/commission edits never rewrite past sessions, so the ledger and
 * the Finance dashboard always agree with what actually changed hands.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';


// ═══ Coaches ══════════════════════════════════════════════════

// ── GET /api/coaching/coaches ─────────────────────────────────
export async function listCoaches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeInactive = req.query.all === '1' && req.user!.role === 'owner';

    const { rows } = await db.query(
      `SELECT c.id, c.name, c.phone, c.specialty, c.hourly_rate, c.commission_pct,
              c.is_active, c.created_at, c.user_id,
              lu.email AS login_email,
              COUNT(ts.id) FILTER (WHERE ts.status <> 'cancelled')::int AS session_count,
              COALESCE(SUM(ts.coach_share) FILTER (WHERE ts.is_paid), 0)::numeric AS earned,
              COALESCE(SUM(ts.club_share)  FILTER (WHERE ts.is_paid), 0)::numeric AS club_profit
       FROM coaches c
       LEFT JOIN users lu ON lu.id = c.user_id
       LEFT JOIN training_sessions ts ON ts.coach_id = c.id
       WHERE c.club_id = $1 ${includeInactive ? '' : 'AND c.is_active = TRUE'}
       GROUP BY c.id, lu.email
       ORDER BY c.name`,
      [clubIdOf(req)]
    );

    res.json({
      data: rows.map((r) => ({
        ...r,
        hourly_rate:    Number(r.hourly_rate),
        commission_pct: Number(r.commission_pct),
        earned:         Number(r.earned),
        club_profit:    Number(r.club_profit),
      })),
    });
  } catch (err) { next(err); }
}

const coachSchema = z.object({
  name:          z.string().trim().min(2).max(100),
  phone:         z.string().trim().max(50).nullable().optional(),
  specialty:     z.string().trim().max(100).nullable().optional(),
  hourlyRate:    z.number().min(0),
  commissionPct: z.number().min(0).max(100),
  isActive:      z.boolean().optional(),
  /** Link/unlink a login account: member email in this club, or null to unlink */
  userEmail:     z.string().trim().toLowerCase().email().nullable().optional(),
});

/** Resolve a login email to a linkable, active user id inside this club. */
async function resolveCoachAccount(req: Request, email: string): Promise<{ userId: string; role: string }> {
  const { rows } = await db.query<{ id: string; role: string; is_active: boolean }>(
    `SELECT id, role, is_active FROM users WHERE club_id = $1 AND email = $2`,
    [clubIdOf(req), email]
  );
  if (!rows.length || !rows[0].is_active) {
    throw new ValidationError('No active member account with that email exists in this club');
  }
  return { userId: rows[0].id, role: rows[0].role };
}

/**
 * Bind a login account to a coach row. Customers are promoted to the
 * 'coach' role only AFTER the link lands (so a unique-violation on
 * coaches.user_id never leaves a stray promotion behind). Their live
 * sessions keep working; the wider viewport appears at next login.
 */
async function linkCoachAccount(req: Request, coachId: string, email: string): Promise<string> {
  const account = await resolveCoachAccount(req, email);
  try {
    await db.query(
      `UPDATE coaches SET user_id = $2, updated_at = NOW() WHERE id = $1 AND club_id = $3`,
      [coachId, account.userId, clubIdOf(req)]
    );
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      throw new ValidationError('That login is already linked to another coach profile');
    }
    throw err;
  }
  if (account.role === 'customer') {
    await db.query(`UPDATE users SET role = 'coach', updated_at = NOW() WHERE id = $1`, [account.userId]);
  }
  return account.userId;
}

// ── POST /api/coaching/coaches (owner) ────────────────────────
export async function createCoach(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = coachSchema.parse(req.body);

    const { rows } = await db.query(
      `INSERT INTO coaches (club_id, name, phone, specialty, hourly_rate, commission_pct)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [clubIdOf(req), parsed.name, parsed.phone ?? null, parsed.specialty ?? null,
       parsed.hourlyRate, parsed.commissionPct]
    );

    if (parsed.userEmail) {
      await linkCoachAccount(req, rows[0].id, parsed.userEmail);
    }

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.COACH_CREATED,
      entityType: 'coach', entityId: rows[0].id,
      newValues: {
        name: parsed.name, hourlyRate: parsed.hourlyRate, commissionPct: parsed.commissionPct,
        ...(parsed.userEmail && { linkedLogin: parsed.userEmail }),
      },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── PATCH /api/coaching/coaches/:id (owner) ───────────────────
export async function updateCoach(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = coachSchema.partial().parse(req.body);

    const { rows: existingRows } = await db.query(
      `SELECT * FROM coaches WHERE id = $1 AND club_id = $2`,
      [req.params.id, clubIdOf(req)]
    );
    if (!existingRows.length) throw new NotFoundError('Coach', req.params.id);
    const existing = existingRows[0];

    const { rows } = await db.query(
      `UPDATE coaches
         SET name           = COALESCE($2, name),
             phone          = COALESCE($3, phone),
             specialty      = COALESCE($4, specialty),
             hourly_rate    = COALESCE($5, hourly_rate),
             commission_pct = COALESCE($6, commission_pct),
             is_active      = COALESCE($7, is_active),
             updated_at     = NOW()
       WHERE id = $1 AND club_id = $8
       RETURNING *`,
      [req.params.id, parsed.name ?? null, parsed.phone ?? null, parsed.specialty ?? null,
       parsed.hourlyRate ?? null, parsed.commissionPct ?? null, parsed.isActive ?? null, clubIdOf(req)]
    );

    // Login linking: explicit null unlinks, an email links/relinks
    if (parsed.userEmail === null) {
      await db.query(
        `UPDATE coaches SET user_id = NULL, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
        [req.params.id, clubIdOf(req)]
      );
    } else if (parsed.userEmail) {
      await linkCoachAccount(req, req.params.id, parsed.userEmail);
    }

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.COACH_UPDATED,
      entityType: 'coach', entityId: req.params.id,
      previousValues: {
        name: existing.name, hourlyRate: Number(existing.hourly_rate),
        commissionPct: Number(existing.commission_pct), isActive: existing.is_active,
      },
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── GET /api/coaching/me (coach) ──────────────────────────────
// The coach viewport: their own profile, allocated training sessions and
// personal commission summary. Deliberately excludes club_share and every
// other coach's ledger — a coach token never sees club-wide financials.
export async function getMyCoachingView(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '90', 10) || 90, 7), 365);

    const { rows: coachRows } = await db.query(
      `SELECT id, name, phone, specialty, hourly_rate, commission_pct, is_active
         FROM coaches
        WHERE club_id = $1 AND user_id = $2`,
      [clubIdOf(req), req.user!.sub]
    );
    if (!coachRows.length) {
      // Linkable but not yet linked — the viewport shows a guidance state
      res.json({ coach: null, data: [], summary: null });
      return;
    }
    const coach = coachRows[0];

    const { rows: sessions } = await db.query(
      `SELECT ts.id, ts.start_time, ts.end_time, ts.status, ts.coach_share,
              ts.is_paid, ts.paid_at, ts.notes,
              COALESCE(u.first_name || ' ' || u.last_name, ts.customer_name, 'Walk-in') AS client_name,
              ct.name AS court_name
         FROM training_sessions ts
         LEFT JOIN users  u  ON u.id  = ts.customer_id
         LEFT JOIN courts ct ON ct.id = ts.court_id
        WHERE ts.club_id = $1 AND ts.coach_id = $2
          AND ts.start_time >= NOW() - ($3 || ' days')::interval
        ORDER BY ts.start_time DESC`,
      [clubIdOf(req), coach.id, rangeDays]
    );

    const { rows: summaryRows } = await db.query(
      `SELECT
         COALESCE(SUM(coach_share) FILTER (WHERE is_paid), 0)::numeric AS earned_paid,
         COALESCE(SUM(coach_share) FILTER (WHERE NOT is_paid AND status <> 'cancelled'), 0)::numeric AS pending_share,
         COUNT(*) FILTER (WHERE status = 'scheduled' AND start_time >= NOW())::int AS upcoming_count,
         COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600)
           FILTER (WHERE status <> 'cancelled'
             AND start_time >= date_trunc('week', NOW())
             AND start_time <  date_trunc('week', NOW()) + interval '7 days'), 0)::numeric AS hours_this_week
       FROM training_sessions
       WHERE club_id = $1 AND coach_id = $2
         AND start_time >= NOW() - ($3 || ' days')::interval`,
      [clubIdOf(req), coach.id, rangeDays]
    );
    const s = summaryRows[0];

    res.json({
      coach: {
        ...coach,
        hourly_rate:    Number(coach.hourly_rate),
        commission_pct: Number(coach.commission_pct),
      },
      data: sessions.map((r) => ({ ...r, coach_share: Number(r.coach_share) })),
      summary: {
        earnedPaid:    Number(s.earned_paid),
        pendingShare:  Number(s.pending_share),
        upcomingCount: s.upcoming_count,
        hoursThisWeek: Number(s.hours_this_week),
      },
    });
  } catch (err) { next(err); }
}

// ═══ Training sessions ════════════════════════════════════════

// ── GET /api/coaching/sessions?range_days=90 ──────────────────
export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '90', 10) || 90, 7), 730);

    const { rows } = await db.query(
      `SELECT ts.id, ts.coach_id, ts.customer_id, ts.court_id, ts.start_time, ts.end_time,
              ts.status, ts.price, ts.coach_share, ts.club_share, ts.is_paid,
              ts.payment_method, ts.paid_at, ts.notes, ts.created_at,
              co.name AS coach_name,
              COALESCE(u.first_name || ' ' || u.last_name, ts.customer_name, 'Walk-in') AS client_name,
              ct.name AS court_name
       FROM training_sessions ts
       JOIN coaches co ON co.id = ts.coach_id
       LEFT JOIN users  u  ON u.id  = ts.customer_id
       LEFT JOIN courts ct ON ct.id = ts.court_id
       WHERE ts.club_id = $1
         AND ts.start_time >= NOW() - ($2 || ' days')::interval
       ORDER BY ts.start_time DESC`,
      [clubIdOf(req), rangeDays]
    );

    // Ledger headline: collected / coach payouts / club profit / uncollected
    const { rows: summaryRows } = await db.query(
      `SELECT
         COALESCE(SUM(price)       FILTER (WHERE is_paid), 0)::numeric AS collected,
         COALESCE(SUM(coach_share) FILTER (WHERE is_paid), 0)::numeric AS coach_payouts,
         COALESCE(SUM(club_share)  FILTER (WHERE is_paid), 0)::numeric AS club_profit,
         COALESCE(SUM(price) FILTER (WHERE NOT is_paid AND status <> 'cancelled'), 0)::numeric AS outstanding,
         COUNT(*) FILTER (WHERE NOT is_paid AND status <> 'cancelled')::int AS unpaid_count
       FROM training_sessions
       WHERE club_id = $1 AND start_time >= NOW() - ($2 || ' days')::interval`,
      [clubIdOf(req), rangeDays]
    );
    const s = summaryRows[0];

    res.json({
      data: rows.map((r) => ({
        ...r,
        price:       Number(r.price),
        coach_share: Number(r.coach_share),
        club_share:  Number(r.club_share),
      })),
      summary: {
        collected:    Number(s.collected),
        coachPayouts: Number(s.coach_payouts),
        clubProfit:   Number(s.club_profit),
        outstanding:  Number(s.outstanding),
        unpaidCount:  s.unpaid_count,
      },
    });
  } catch (err) { next(err); }
}

const sessionSchema = z.object({
  coachId:       z.string().uuid(),
  customerId:    z.string().uuid().nullable().optional(),
  customerName:  z.string().trim().max(150).nullable().optional(),
  courtId:       z.string().uuid().nullable().optional(),
  startTime:     z.string().datetime({ offset: true }).or(z.string().datetime()),
  endTime:       z.string().datetime({ offset: true }).or(z.string().datetime()),
  price:         z.number().min(0).optional(),          // defaults to rate × hours
  commissionPct: z.number().min(0).max(100).optional(), // defaults to the coach's pct
  notes:         z.string().trim().max(1000).nullable().optional(),
});

// ── POST /api/coaching/sessions (staff) ───────────────────────
export async function createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = sessionSchema.parse(req.body);

    const start = new Date(parsed.startTime);
    const end   = new Date(parsed.endTime);
    if (!(end > start)) throw new ValidationError('endTime must be after startTime');
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    if (hours > 8) throw new ValidationError('Training sessions cannot exceed 8 hours');

    const { rows: coachRows } = await db.query(
      `SELECT * FROM coaches WHERE id = $1 AND club_id = $2 AND is_active = TRUE`,
      [parsed.coachId, clubIdOf(req)]
    );
    if (!coachRows.length) throw new NotFoundError('Coach', parsed.coachId);
    const coach = coachRows[0];

    const price = parsed.price ?? Math.round(Number(coach.hourly_rate) * hours * 100) / 100;
    const pct   = parsed.commissionPct ?? Number(coach.commission_pct);
    const coachShare = Math.round(price * pct) / 100;
    const clubShare  = Math.round((price - coachShare) * 100) / 100;

    const { rows } = await db.query(
      `INSERT INTO training_sessions
         (club_id, coach_id, customer_id, customer_name, court_id,
          start_time, end_time, price, coach_share, club_share, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [clubIdOf(req), parsed.coachId, parsed.customerId ?? null, parsed.customerName ?? null,
       parsed.courtId ?? null, parsed.startTime, parsed.endTime,
       price, coachShare, clubShare, parsed.notes ?? null, req.user!.sub]
    );

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TRAINING_SESSION_CREATED,
      entityType: 'training_session', entityId: rows[0].id,
      newValues: { coachId: parsed.coachId, price, coachShare, clubShare, startTime: parsed.startTime },
    });

    res.status(201).json({
      ...rows[0],
      price:       Number(rows[0].price),
      coach_share: Number(rows[0].coach_share),
      club_share:  Number(rows[0].club_share),
    });
  } catch (err) { next(err); }
}

const sessionPatchSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  notes:  z.string().trim().max(1000).nullable().optional(),
});

// ── PATCH /api/coaching/sessions/:id (staff) ──────────────────
export async function updateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = sessionPatchSchema.parse(req.body);

    const { rows } = await db.query(
      `UPDATE training_sessions
         SET status = COALESCE($2, status),
             notes  = COALESCE($3, notes),
             updated_at = NOW()
       WHERE id = $1 AND club_id = $4
       RETURNING *`,
      [req.params.id, parsed.status ?? null, parsed.notes ?? null, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Training session', req.params.id);

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TRAINING_SESSION_UPDATED,
      entityType: 'training_session', entityId: req.params.id,
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

const payMethodSchema = z.object({
  method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'ONLINE']).default('CASH'),
});

// ── POST /api/coaching/sessions/:id/pay (staff) ───────────────
export async function markSessionPaid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = payMethodSchema.parse(req.body);

    const { rows } = await db.query(
      `UPDATE training_sessions
         SET is_paid = TRUE, payment_method = $2, paid_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND club_id = $3 AND is_paid = FALSE
       RETURNING *`,
      [req.params.id, parsed.method, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Unpaid training session', req.params.id);

    await auditLog({
      clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TRAINING_SESSION_PAID,
      entityType: 'training_session', entityId: req.params.id,
      newValues: {
        method: parsed.method,
        price: Number(rows[0].price),
        coachShare: Number(rows[0].coach_share),
        clubShare: Number(rows[0].club_share),
      },
    });

    res.json({
      ...rows[0],
      price:       Number(rows[0].price),
      coach_share: Number(rows[0].coach_share),
      club_share:  Number(rows[0].club_share),
    });
  } catch (err) { next(err); }
}
