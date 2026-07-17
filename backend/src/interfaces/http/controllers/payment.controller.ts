/**
 * Payment Controller – the payments ledger.
 *
 * GET /api/payments (receptionist/owner) returns one ledger row per payment
 * record joined to its booking and customer, with a derived `ledger_status`
 * suitable for badge display:
 *
 *   paid      → paid_in_full
 *   partial   → deposit_approved / remaining_balance_pending
 *   pending   → deposit_pending
 *   rejected  → deposit_rejected
 *   refunded  → partially_refunded / fully_refunded
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';


const LEDGER_STATUS_SQL = `
  CASE
    WHEN p.status IN ('partially_refunded','fully_refunded') THEN 'refunded'
    WHEN p.status = 'paid_in_full'                           THEN 'paid'
    WHEN p.status IN ('deposit_approved','remaining_balance_pending') THEN 'partial'
    WHEN p.status = 'deposit_rejected'                       THEN 'rejected'
    ELSE 'pending'
  END`;

export async function listPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, from, to, search, page = '1', limit = '25' } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const params: unknown[] = [clubIdOf(req)];
    const conditions: string[] = ['p.club_id = $1', 'b.deleted_at IS NULL'];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`(${LEDGER_STATUS_SQL}) = $${params.length}`);
    }
    if (from) { params.push(from); conditions.push(`p.created_at >= $${params.length}`); }
    if (to)   { params.push(to);   conditions.push(`p.created_at <= $${params.length}`); }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(u.first_name) LIKE $${params.length}
          OR LOWER(u.last_name) LIKE $${params.length}
          OR LOWER(u.email)     LIKE $${params.length})`
      );
    }

    const where = conditions.join(' AND ');
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(
      `SELECT p.id, p.booking_id, p.status AS payment_status,
              ${LEDGER_STATUS_SQL}          AS ledger_status,
              p.total_amount, p.created_at, p.verified_at, p.balance_paid_at,
              b.start_time, b.deposit_amount, b.remainder_amount, b.discount_amount,
              b.deposit_method, b.remainder_method, b.status AS booking_status,
              b.subscription_id,
              COALESCE(c.name, 'Deleted Court') AS court_name,
              COALESCE(u.first_name, 'Unknown') AS first_name,
              COALESCE(u.last_name,  'User')    AS last_name,
              COALESCE(u.email, '')             AS customer_email
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN courts c ON c.id = b.court_id
       LEFT JOIN users  u ON u.id = p.customer_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Ledger headline numbers over the same filter set (minus pagination)
    const summaryParams = params.slice(0, params.length - 2);
    const { rows: summaryRows } = await db.query(
      `SELECT
         COALESCE(SUM(b.deposit_amount + b.remainder_amount)
           FILTER (WHERE (${LEDGER_STATUS_SQL}) IN ('paid','partial')), 0)::numeric AS collected,
         COALESCE(SUM(GREATEST(b.total_price - b.discount_amount - b.deposit_amount - b.remainder_amount, 0))
           FILTER (WHERE (${LEDGER_STATUS_SQL}) IN ('pending','partial')), 0)::numeric AS outstanding,
         COUNT(*) FILTER (WHERE (${LEDGER_STATUS_SQL}) = 'pending')::int  AS pending_count,
         COUNT(*) FILTER (WHERE (${LEDGER_STATUS_SQL}) = 'refunded')::int AS refunded_count,
         COUNT(*)::int AS total_count
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN users u ON u.id = p.customer_id
       WHERE ${where}`,
      summaryParams
    );

    const s = summaryRows[0];
    res.json({
      data: rows,
      page: parseInt(page),
      limit: parseInt(limit),
      summary: {
        collected:     Number(s.collected),
        outstanding:   Number(s.outstanding),
        pendingCount:  s.pending_count,
        refundedCount: s.refunded_count,
        totalCount:    s.total_count,
      },
    });
  } catch (err) { next(err); }
}
