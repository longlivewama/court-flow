/**
 * Verify Deposit Use Case (Receptionist action)
 * Approve → booking 'confirmed' + payment 'deposit_approved'
 * Reject  → booking stays 'pending_verification' + payment 'deposit_rejected'
 */
import { withTransaction } from '../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
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

      await auditLog({
        clubId: input.clubId, userId: input.receptionistId, userRole: 'receptionist',
        ipAddress: input.ipAddress, deviceInfo: input.deviceInfo,
        actionType: AUDIT_ACTIONS.DEPOSIT_APPROVED, entityType: 'booking',
        entityId: input.bookingId,
        newValues: { status: 'confirmed', paymentStatus: 'deposit_approved' },
      });

      // Send confirmation email — best-effort: an SMTP outage must never
      // roll back an already-verified deposit.
      try {
        await emailService.sendBookingConfirmation({
          to:           customer.email,
          firstName:    customer.first_name,
          bookingId:    input.bookingId,
          startTime:    booking.start_time,
          depositAmount: booking.deposit_amount,
          totalPrice:   booking.total_price,
        });
      } catch (err) {
        logger.warn({ err, bookingId: input.bookingId }, 'Booking confirmation email failed; deposit approval preserved');
      }
    } else {
      // Reject
      await client.query(
        `UPDATE payments SET status = 'deposit_rejected',
           rejection_reason = $2, verified_by = $3, verified_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [paymentId, input.rejectionReason ?? 'Receipt rejected by receptionist', input.receptionistId]
      );

      await auditLog({
        clubId: input.clubId, userId: input.receptionistId, userRole: 'receptionist',
        ipAddress: input.ipAddress, deviceInfo: input.deviceInfo,
        actionType: AUDIT_ACTIONS.DEPOSIT_REJECTED, entityType: 'booking',
        entityId: input.bookingId,
        newValues: { paymentStatus: 'deposit_rejected', reason: input.rejectionReason },
      });

      // Send rejection email — best-effort, same rationale as above
      try {
        await emailService.sendPaymentRejected({
          to:        customer.email,
          firstName: customer.first_name,
          bookingId: input.bookingId,
          reason:    input.rejectionReason ?? 'Your receipt could not be verified. Please re-upload.',
        });
      } catch (err) {
        logger.warn({ err, bookingId: input.bookingId }, 'Payment rejection email failed; rejection preserved');
      }
    }
  });
}
