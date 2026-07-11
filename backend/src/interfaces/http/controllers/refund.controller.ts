import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { withTransaction } from '../../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

// ── POST /api/refunds ─────────────────────────────────────────
export async function createRefundRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { bookingId, amount, percent, reason, internalNotes } = req.body;

    // Validate booking exists and has approved deposit
    const { rows: bookingRows } = await db.query(
      `SELECT b.id, b.total_price, p.id AS payment_id, p.status AS payment_status
       FROM bookings b JOIN payments p ON p.booking_id=b.id
       WHERE b.id=$1 AND b.club_id=$2`,
      [bookingId, CLUB_ID]
    );
    if (!bookingRows.length) throw new NotFoundError('Booking', bookingId);
    const booking = bookingRows[0];

    if (!['deposit_approved', 'remaining_balance_pending', 'paid_in_full'].includes(booking.payment_status)) {
      throw new ValidationError('Refund can only be requested for bookings with approved payments');
    }

    const { rows } = await db.query(
      `INSERT INTO refunds (booking_id, payment_id, created_by, status, amount, percent, reason, internal_notes)
       VALUES ($1,$2,$3,'pending',$4,$5,$6,$7) RETURNING *`,
      [bookingId, booking.payment_id, req.user!.sub, amount, percent ?? null, reason, internalNotes ?? null]
    );

    await auditLog({ clubId: CLUB_ID, userId: req.user!.sub, userRole: 'receptionist',
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.REFUND_REQUESTED, entityType: 'refund',
      entityId: rows[0].id, newValues: rows[0] });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── GET /api/refunds ──────────────────────────────────────────
export async function listRefunds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT r.*, b.start_time, u.first_name, u.last_name
       FROM refunds r JOIN bookings b ON b.id=r.booking_id
       JOIN users u ON u.id=b.customer_id
       WHERE b.club_id=$1 ORDER BY r.created_at DESC`,
      [CLUB_ID]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ── PATCH /api/refunds/:id ────────────────────────────────────
export async function approveOrRejectRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { action, internalNotes } = req.body as { action: 'approve' | 'reject'; internalNotes?: string };
    if (!['approve', 'reject'].includes(action)) throw new ValidationError('action must be approve or reject');

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM refunds WHERE id=$1 FOR UPDATE`, [req.params.id]
      );
      if (!rows.length) throw new NotFoundError('Refund', req.params.id);
      if (rows[0].status !== 'pending') throw new ValidationError('Refund is not in pending status');

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await client.query(
        `UPDATE refunds SET status=$2, approved_by=$3,
           ${action === 'approve' ? 'approved_at' : 'rejected_at'}=NOW(),
           internal_notes=COALESCE($4,internal_notes), updated_at=NOW()
         WHERE id=$1`,
        [req.params.id, newStatus, req.user!.sub, internalNotes ?? null]
      );

      await auditLog({ clubId: CLUB_ID, userId: req.user!.sub, userRole: 'owner',
        ipAddress: req.ip,
        actionType: action === 'approve' ? AUDIT_ACTIONS.REFUND_APPROVED : AUDIT_ACTIONS.REFUND_REJECTED,
        entityType: 'refund', entityId: req.params.id, newValues: { status: newStatus } });
    });

    res.json({ message: `Refund ${action === 'approve' ? 'approved' : 'rejected'}` });
  } catch (err) { next(err); }
}
