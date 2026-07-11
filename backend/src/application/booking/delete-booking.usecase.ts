/**
 * Delete Booking Use Case (Owner-only, destructive)
 *
 * Permanently removes a booking and its dependent receipt/payment rows inside
 * a single transaction, after persisting a full pre-deletion snapshot to the
 * append-only audit log (WHO / WHEN / WHERE / WHAT + mandatory reason).
 *
 * Guardrail: bookings referenced by any refund record cannot be deleted —
 * destroying that link would corrupt financial reconciliation.
 */
import { withTransaction } from '../../infrastructure/database/client';
import { auditLogStrict, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { NotFoundError, ConflictError } from '../../shared/errors';

export interface DeleteBookingInput {
  bookingId:   string;
  clubId:      string;
  deletedBy:   string;
  deletedByRole: string;
  reason:      string;
  ipAddress?:  string;
  deviceInfo?: string;
}

export async function deleteBooking(input: DeleteBookingInput): Promise<void> {
  await withTransaction(async (client) => {
    // ── Lock the booking and capture the full pre-deletion snapshot ──
    const { rows } = await client.query(
      `SELECT b.*,
              c.name   AS court_name,
              c.number AS court_number,
              u.first_name,
              u.last_name,
              u.email  AS customer_email
       FROM bookings b
       JOIN courts c ON c.id = b.court_id
       JOIN users  u ON u.id = b.customer_id
       WHERE b.id = $1 AND b.club_id = $2
       FOR UPDATE OF b`,
      [input.bookingId, input.clubId]
    );

    if (!rows.length) throw new NotFoundError('Booking', input.bookingId);
    const snapshot = rows[0];

    // ── Guardrail: never delete a booking tied to refund records ─────
    const { rows: refundRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM refunds WHERE booking_id = $1`,
      [input.bookingId]
    );
    if (parseInt(refundRows[0].count, 10) > 0) {
      throw new ConflictError('Cannot delete a booking with existing refund records');
    }

    // ── Persist the audit record before the row is destroyed ─────────
    // Strict + same transaction: if this INSERT fails, the whole deletion
    // rolls back — a permanent deletion must never happen unaudited.
    await auditLogStrict(client, {
      clubId:     input.clubId,
      userId:     input.deletedBy,
      userRole:   input.deletedByRole,
      ipAddress:  input.ipAddress,
      deviceInfo: input.deviceInfo,
      actionType: AUDIT_ACTIONS.BOOKING_DELETED,
      entityType: 'booking',
      entityId:   input.bookingId,
      previousValues: snapshot,
      reason:     input.reason,
    });

    // ── Explicit ordered deletion: receipts → payments → booking ─────
    await client.query(`DELETE FROM receipts WHERE booking_id = $1`, [input.bookingId]);
    await client.query(`DELETE FROM payments WHERE booking_id = $1`, [input.bookingId]);
    await client.query(`DELETE FROM bookings WHERE id = $1`, [input.bookingId]);
  });
}
