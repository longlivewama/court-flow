import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { withTransaction } from '../../../infrastructure/database/client';
import { auditLog, auditLogStrict, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { recordLedgerEntryStrict, LEDGER_ENTRY_TYPES } from '../../../infrastructure/finance/ledger.service';
import { NotFoundError, ValidationError } from '../../../shared/errors';


// Strictly bound the refund payload: an unvalidated req.body previously let a
// caller record a negative, zero, or over-total refund. amount is additionally
// capped to the booking's total_price below (needs the fetched row).
const createRefundSchema = z.object({
  bookingId:     z.string().uuid(),
  amount:        z.number().positive(),
  percent:       z.number().min(0).max(100).optional(),
  reason:        z.string().trim().min(1).max(1000),
  internalNotes: z.string().trim().max(2000).optional(),
});

// ── POST /api/refunds ─────────────────────────────────────────
export async function createRefundRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { bookingId, amount, percent, reason, internalNotes } = createRefundSchema.parse(req.body);

    const refund = await withTransaction(async (client) => {
      // Lock the booking row so two concurrent refund requests for the same
      // booking can't both pass the net-collected check before either commits.
      const { rows: bookingRows } = await client.query(
        `SELECT b.id, b.total_price, b.deposit_amount, b.deposit_method,
                b.remainder_amount, b.remainder_method,
                p.id AS payment_id, p.status AS payment_status
         FROM bookings b JOIN payments p ON p.booking_id=b.id
         WHERE b.id=$1 AND b.club_id=$2
         FOR UPDATE OF b`,
        [bookingId, clubIdOf(req)]
      );
      if (!bookingRows.length) throw new NotFoundError('Booking', bookingId);
      const booking = bookingRows[0];

      if (!['deposit_approved', 'remaining_balance_pending', 'paid_in_full'].includes(booking.payment_status)) {
        throw new ValidationError('Refund can only be requested for bookings with approved payments');
      }

      // Net collected funds: what was actually paid in (deposit + any
      // settled remainder — mirrors the exact Finance/cancellation COLLECTED
      // formula in cancel-booking.usecase.ts) minus refunds already approved
      // or still pending against this same booking. A refund can never
      // exceed what is actually left to give back.
      const depositCollected =
        booking.deposit_method && booking.deposit_method !== 'NONE' ? Number(booking.deposit_amount) : 0;
      const remainderCollected =
        booking.remainder_method && booking.remainder_method !== 'NONE' ? Number(booking.remainder_amount) : 0;
      const collectedAmount = Math.round((depositCollected + remainderCollected) * 100) / 100;

      const { rows: existingRefundRows } = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM refunds WHERE booking_id = $1 AND status IN ('pending', 'approved')`,
        [bookingId]
      );
      const alreadyClaimed = Number(existingRefundRows[0].total);
      const netAvailable = Math.max(Math.round((collectedAmount - alreadyClaimed) * 100) / 100, 0);

      if (amount > netAvailable) {
        throw new ValidationError(
          `Refund amount (${amount}) exceeds the net collected amount still available (${netAvailable})`,
          { code: 'REFUND_EXCEEDS_COLLECTED_AMOUNT' }
        );
      }

      const { rows } = await client.query(
        `INSERT INTO refunds (booking_id, payment_id, created_by, status, amount, percent, reason, internal_notes)
         VALUES ($1,$2,$3,'pending',$4,$5,$6,$7) RETURNING *`,
        [bookingId, booking.payment_id, req.user!.sub, amount, percent ?? null, reason, internalNotes ?? null]
      );

      await auditLogStrict(client, { clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'receptionist',
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.REFUND_REQUESTED, entityType: 'refund',
        entityId: rows[0].id, newValues: { ...rows[0], collectedAmount, alreadyClaimed, netAvailable } });

      return rows[0];
    });

    res.status(201).json(refund);
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
      [clubIdOf(req)]
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
      // Scope the refund to this club via its booking (the refunds table has no
      // club_id column). FOR UPDATE OF r locks only the refund row, not the
      // joined booking. Prevents cross-tenant approval by guessing a refund id.
      // Also lock the booking row (b) so this can't race a concurrent refund
      // request being created for the same booking (createRefundRequest above
      // takes the same lock before computing net-collected funds).
      // Also lock the payment row (p) — approval writes payments.status and
      // payments.refunded_amount atomically alongside the refund itself, so a
      // concurrent approval of a SIBLING refund on the same payment can't
      // read a stale refunded_amount and overwrite this one's update.
      const { rows } = await client.query(
        `SELECT r.*, b.total_price, b.deposit_amount, b.deposit_method,
                b.remainder_amount, b.remainder_method,
                COALESCE(c.name, 'Court') AS court_name,
                p.status AS payment_status
         FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         JOIN payments p ON p.id = r.payment_id
         LEFT JOIN courts c ON c.id = b.court_id
         WHERE r.id = $1 AND b.club_id = $2
         FOR UPDATE OF r, b, p`,
        [req.params.id, clubIdOf(req)]
      );
      if (!rows.length) throw new NotFoundError('Refund', req.params.id);
      if (rows[0].status !== 'pending') throw new ValidationError('Refund is not in pending status');
      const refund = rows[0];

      // Re-validate against net collected funds at approval time too: another
      // refund on the same booking could have been approved in the time this
      // one sat pending, so the check at request-creation time alone is not
      // sufficient to guarantee approved refunds never exceed what's collected.
      // Validate BEFORE writing anything — a rejected approval must leave the
      // refund/payment/ledger completely untouched.
      let paymentSync: { newPaymentStatus: 'fully_refunded' | 'partially_refunded'; totalRefundedAfter: number; collectedAmount: number; alreadyApproved: number } | null = null;

      if (action === 'approve') {
        const depositCollected =
          refund.deposit_method && refund.deposit_method !== 'NONE' ? Number(refund.deposit_amount) : 0;
        const remainderCollected =
          refund.remainder_method && refund.remainder_method !== 'NONE' ? Number(refund.remainder_amount) : 0;
        const collectedAmount = Math.round((depositCollected + remainderCollected) * 100) / 100;

        const { rows: otherApprovedRows } = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric AS total
           FROM refunds WHERE booking_id = $1 AND status = 'approved' AND id <> $2`,
          [refund.booking_id, refund.id]
        );
        const alreadyApproved = Number(otherApprovedRows[0].total);
        const netAvailable = Math.max(Math.round((collectedAmount - alreadyApproved) * 100) / 100, 0);

        if (Number(refund.amount) > netAvailable) {
          throw new ValidationError(
            `Approving this refund (${refund.amount}) would exceed the net collected amount still available (${netAvailable})`,
            { code: 'REFUND_EXCEEDS_COLLECTED_AMOUNT' }
          );
        }

        const totalRefundedAfter = Math.round((alreadyApproved + Number(refund.amount)) * 100) / 100;
        paymentSync = {
          collectedAmount, alreadyApproved, totalRefundedAfter,
          newPaymentStatus: totalRefundedAfter >= collectedAmount ? 'fully_refunded' : 'partially_refunded',
        };
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await client.query(
        `UPDATE refunds SET status=$2, approved_by=$3,
           ${action === 'approve' ? 'approved_at' : 'rejected_at'}=NOW(),
           internal_notes=COALESCE($4,internal_notes), updated_at=NOW()
         WHERE id=$1`,
        [req.params.id, newStatus, req.user!.sub, internalNotes ?? null]
      );

      // Synchronise the payment + ledger atomically with the refund-status
      // change above, so payment/refund/ledger/reports can never drift out of
      // sync with each other — all in the same transaction, or none of it.
      if (paymentSync) {
        await client.query(
          `UPDATE payments SET status = $2, refunded_amount = $3, updated_at = NOW() WHERE id = $1`,
          [refund.payment_id, paymentSync.newPaymentStatus, paymentSync.totalRefundedAfter]
        );

        await recordLedgerEntryStrict(client, {
          clubId: clubIdOf(req), entryType: LEDGER_ENTRY_TYPES.REFUND, direction: 'DEBIT',
          amount: Number(refund.amount), bookingId: refund.booking_id, paymentId: refund.payment_id,
          courtName: refund.court_name, reason: refund.reason,
          createdBy: req.user!.sub, createdByRole: req.user!.role,
          metadata: {
            refundId: refund.id, collectedAmount: paymentSync.collectedAmount,
            alreadyApproved: paymentSync.alreadyApproved, totalRefundedAfter: paymentSync.totalRefundedAfter,
            paymentStatusBefore: refund.payment_status, paymentStatusAfter: paymentSync.newPaymentStatus,
          },
        });
      }

      await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
        ipAddress: req.ip,
        actionType: action === 'approve' ? AUDIT_ACTIONS.REFUND_APPROVED : AUDIT_ACTIONS.REFUND_REJECTED,
        entityType: 'refund', entityId: req.params.id, newValues: { status: newStatus } });
    });

    res.json({ message: `Refund ${action === 'approve' ? 'approved' : 'rejected'}` });
  } catch (err) { next(err); }
}
