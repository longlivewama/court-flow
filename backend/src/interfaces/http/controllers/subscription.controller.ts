/**
 * Subscription Controller – fixed long-term (VIP) weekly bookings.
 *
 *   POST   /api/subscriptions          create (customer books self; staff can book anyone)
 *   GET    /api/subscriptions          owner/receptionist: all + MRR · customer: own
 *   PATCH  /api/subscriptions/:id/revoke   owner: cancel subscription + future occurrences
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createSubscription } from '../../../application/booking/create-subscription.usecase';
import { db, withTransaction } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';

const WEEKS_PER_MONTH = 4;

const createSchema = z.object({
  courtId:          z.string().optional(),
  court_id:         z.string().optional(),
  customerId:       z.string().optional(),
  customer_id:      z.string().optional(),
  startTime:        z.string().optional(),
  start_time:       z.string().optional(),
  durationMinutes:  z.number().int().positive().optional(),
  duration_minutes: z.number().int().positive().optional(),
  termMonths:       z.union([z.literal(1), z.literal(3)]).optional(),
  term_months:      z.union([z.literal(1), z.literal(3)]).optional(),
  notes:            z.string().optional(),
});

// ── POST /api/subscriptions ───────────────────────────────────
export async function createSubscriptionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createSchema.parse(req.body);
    const courtId         = parsed.courtId ?? parsed.court_id;
    const startTime       = parsed.startTime ?? parsed.start_time;
    const durationMinutes = parsed.durationMinutes ?? parsed.duration_minutes;
    const termMonths      = parsed.termMonths ?? parsed.term_months;

    const { sub: userId, role } = req.user!;

    if (!courtId)         throw new ValidationError('courtId is required');
    if (!startTime)       throw new ValidationError('startTime is required');
    if (!durationMinutes) throw new ValidationError('durationMinutes is required');
    if (!termMonths)      throw new ValidationError('termMonths (1 or 3) is required');

    // Customers always subscribe for themselves
    const customerId = role === 'customer'
      ? userId
      : (parsed.customerId ?? parsed.customer_id ?? userId);

    const result = await createSubscription({
      clubId:          clubIdOf(req),
      courtId,
      customerId,
      createdBy:       userId,
      createdByRole:   role,
      firstStartTime:  new Date(startTime),
      durationMinutes,
      termMonths,
      notes:           parsed.notes,
      ipAddress:       req.ip,
      deviceInfo:      req.headers['user-agent'],
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
}

// ── GET /api/subscriptions ────────────────────────────────────
export async function listSubscriptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, sub: userId } = req.user!;
    const { status } = req.query as Record<string, string>;

    const params: unknown[] = [clubIdOf(req)];
    const conditions: string[] = ['s.club_id = $1'];

    if (role === 'customer') {
      params.push(userId);
      conditions.push(`s.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT s.*,
              COALESCE(c.name, 'Deleted Court')  AS court_name,
              COALESCE(c.number, 0)              AS court_number,
              COALESCE(u.first_name, 'Unknown')  AS first_name,
              COALESCE(u.last_name, 'User')      AS last_name,
              COALESCE(u.email, '')              AS customer_email,
              (SELECT MIN(b.start_time) FROM bookings b
                WHERE b.subscription_id = s.id
                  AND b.deleted_at IS NULL
                  AND b.status NOT IN ('cancelled','expired')
                  AND b.start_time > NOW())      AS next_occurrence,
              (SELECT COUNT(*)::int FROM bookings b
                WHERE b.subscription_id = s.id
                  AND b.deleted_at IS NULL
                  AND b.status NOT IN ('cancelled','expired')
                  AND b.start_time > NOW())      AS remaining_sessions
       FROM subscriptions s
       LEFT JOIN courts c ON c.id = s.court_id
       LEFT JOIN users  u ON u.id = s.customer_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY (s.status = 'active') DESC, s.created_at DESC`,
      params
    );

    // Monthly Recurring Revenue = Σ weekly_price × 4 across active subscriptions
    const mrr = rows
      .filter((r) => r.status === 'active')
      .reduce((sum, r) => sum + Number(r.weekly_price) * WEEKS_PER_MONTH, 0);

    res.json({
      data: rows,
      mrr:  Math.round(mrr * 100) / 100,
      activeCount: rows.filter((r) => r.status === 'active').length,
    });
  } catch (err) { next(err); }
}

// ── PATCH /api/subscriptions/:id/revoke (owner) ───────────────
// Cancels the subscription and every future, non-terminal occurrence.
// Past/completed sessions are preserved for financial history.
export async function revokeSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { reason } = (req.body ?? {}) as { reason?: string };

    let cancelledSessions = 0;

    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM subscriptions WHERE id = $1 AND club_id = $2 FOR UPDATE`,
        [req.params.id, clubIdOf(req)]
      );
      if (!rows.length) throw new NotFoundError('Subscription', req.params.id);
      if (rows[0].status !== 'active') {
        throw new ValidationError(`Subscription is already ${rows[0].status}`);
      }

      await client.query(
        `UPDATE subscriptions
           SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, updated_at = NOW()
         WHERE id = $1`,
        [req.params.id, req.user!.sub]
      );

      const { rowCount } = await client.query(
        `UPDATE bookings
           SET status = 'cancelled',
               cancellation_reason = $2,
               cancelled_at = NOW(),
               updated_at = NOW()
         WHERE subscription_id = $1
           AND deleted_at IS NULL
           AND start_time > NOW()
           AND status IN ('draft','pending_deposit','pending_verification','confirmed')`,
        [req.params.id, reason ?? 'Subscription revoked by owner']
      );
      cancelledSessions = rowCount ?? 0;

      await auditLog({
        clubId: clubIdOf(req), userId: req.user!.sub, userRole: req.user!.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.SUBSCRIPTION_REVOKED,
        entityType: 'subscription', entityId: req.params.id,
        newValues: { status: 'cancelled', cancelledSessions },
        reason,
      });
    });

    res.json({
      message: `Subscription revoked. ${cancelledSessions} upcoming session(s) cancelled.`,
      cancelledSessions,
    });
  } catch (err) { next(err); }
}
