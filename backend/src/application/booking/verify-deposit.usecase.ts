/**
 * Verify Deposit Use Case (Receptionist action)
 * Approve → booking 'confirmed' + payment 'deposit_approved'
 * Reject  → booking stays 'pending_verification' + payment 'deposit_rejected'
 */
import { withTransaction } from '../../infrastructure/database/client';
import { auditLogStrict, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { emailService } from '../../infrastructure/email/email.service';
import { NotFoundError, ForbiddenError } from '../../shared/errors';
import { logger } from '../../shared/logger';

export interface VerifyDepositInput {
  bookingId:       string;
  receptionistId:  string;
  clubId:          string;
  action:          'approve' | 'reject';
  rejectionReason?: string;
  ipAddress?:      string;
  deviceInfo?:     string;
}

export async function verifyDeposit(input: VerifyDepositInput): Promise<void> {
  // Email is dispatched AFTER commit — never inside the transaction — so an SMTP
  // stall cannot pin a pooled DB connection (pool-exhaustion risk under load).
  interface Notify {
    kind:          'approve' | 'reject';
    to:            string;
    firstName:     string;
    bookingId:     string;
    startTime:     Date;
    depositAmount: number;
    totalPrice:    number;
    reason:        string;
  }
  let notify: Notify | null = null;

  await withTransaction(async (client) => {
    // Lock booking row
    const { rows: bookingRows } = await client.query<{
      id: string; status: string; customer_id: string; court_id: string;
      start_time: Date; total_price: number; deposit_amount: number;
    }>(
      `SELECT id, status, customer_id, court_id, start_time, total_price, deposit_amount
       FROM bookings WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [input.bookingId, input.clubId]
    );

    if (!bookingRows.length) throw new NotFoundError('Booking', input.bookingId);
    const booking = bookingRows[0];

    if (booking.status !== 'pending_verification') {
      throw new ForbiddenError(
        `Booking is in '${booking.status}' status; can only verify from 'pending_verification'`
      );
    }

    // Load payment
    const { rows: paymentRows } = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [input.bookingId]
    );
    if (!paymentRows.length) throw new NotFoundError('Payment');
    const paymentId = paymentRows[0].id;

    // Load customer email for notification
    const { rows: customerRows } = await client.query<{ email: string; first_name: string }>(
      `SELECT email, first_name FROM users WHERE id = $1`,
      [booking.customer_id]
    );
    const customer = customerRows[0];

    if (input.action === 'approve') {
      await client.query(
        `UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
        [input.bookingId]
      );
      await client.query(
        `UPDATE payments SET status = 'deposit_approved', verified_by = $2, verified_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [paymentId, input.receptionistId]
      );

      await auditLogStrict(client, {
        clubId: input.clubId, userId: input.receptionistId, userRole: 'receptionist',
        ipAddress: input.ipAddress, deviceInfo: input.deviceInfo,
        actionType: AUDIT_ACTIONS.DEPOSIT_APPROVED, entityType: 'booking',
        entityId: input.bookingId,
        newValues: { status: 'confirmed', paymentStatus: 'deposit_approved' },
      });

      // Queue the confirmation email for dispatch after commit.
      if (customer) {
        notify = {
          kind: 'approve', to: customer.email, firstName: customer.first_name,
          bookingId: input.bookingId, startTime: booking.start_time,
          depositAmount: booking.deposit_amount, totalPrice: booking.total_price, reason: '',
        };
      }
    } else {
      // Reject
      await client.query(
        `UPDATE payments SET status = 'deposit_rejected',
           rejection_reason = $2, verified_by = $3, verified_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [paymentId, input.rejectionReason ?? 'Receipt rejected by receptionist', input.receptionistId]
      );

      await auditLogStrict(client, {
        clubId: input.clubId, userId: input.receptionistId, userRole: 'receptionist',
        ipAddress: input.ipAddress, deviceInfo: input.deviceInfo,
        actionType: AUDIT_ACTIONS.DEPOSIT_REJECTED, entityType: 'booking',
        entityId: input.bookingId,
        newValues: { paymentStatus: 'deposit_rejected', reason: input.rejectionReason },
      });

      // Queue the rejection email for dispatch after commit.
      if (customer) {
        notify = {
          kind: 'reject', to: customer.email, firstName: customer.first_name,
          bookingId: input.bookingId, startTime: booking.start_time,
          depositAmount: booking.deposit_amount, totalPrice: booking.total_price,
          reason: input.rejectionReason ?? 'Your receipt could not be verified. Please re-upload.',
        };
      }
    }
  });

  // ── Best-effort notification, AFTER the transaction has committed ─────────
  // An SMTP outage must never roll back an already-verified deposit, and (post
  // this refactor) must never hold a DB connection open while it stalls.
  const n = notify as Notify | null;
  if (n?.kind === 'approve') {
    try {
      await emailService.sendBookingConfirmation({
        to: n.to, firstName: n.firstName, bookingId: n.bookingId,
        startTime: n.startTime, depositAmount: n.depositAmount, totalPrice: n.totalPrice,
      });
    } catch (err) {
      logger.warn({ err, bookingId: input.bookingId }, 'Booking confirmation email failed; deposit approval preserved');
    }
  } else if (n?.kind === 'reject') {
    try {
      await emailService.sendPaymentRejected({
        to: n.to, firstName: n.firstName, bookingId: n.bookingId, reason: n.reason,
      });
    } catch (err) {
      logger.warn({ err, bookingId: input.bookingId }, 'Payment rejection email failed; rejection preserved');
    }
  }
}
