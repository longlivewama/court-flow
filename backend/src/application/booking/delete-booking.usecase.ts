/**
 * Delete Booking Use Case (Owner-only, soft-delete)
 *
 * Marks a booking as deleted (soft-delete) by setting deleted_at, deleted_by,
 * and deletion_reason inside a single transaction, after persisting a full
 * pre-deletion snapshot to the append-only audit log.
 *
 * The booking row and its dependent receipts/payments are preserved for
 * historical audit and financial reconciliation purposes.
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
              COALESCE(c.name, 'Deleted Court') AS court_name,
              COALESCE(c.number, 0)              AS court_number,
              COALESCE(u.first_name, 'Unknown')  AS first_name,
              COALESCE(u.last_name, 'User')      AS last_name,
              COALESCE(u.email, '')               AS customer_email
       FROM bookings b
       LEFT JOIN courts c ON c.id = b.court_id
       LEFT JOIN users  u ON u.id = b.customer_id
       WHERE b.id = $1 AND b.club_id = $2 AND b.deleted_at IS NULL
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

    // ── Persist the audit record before the row is marked deleted ────
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

    // ── Soft-delete: mark as deleted instead of destroying the row ───
    await client.query(
      `UPDATE bookings
         SET deleted_at      = NOW(),
             deleted_by      = $2,
             deletion_reason = $3,
             status          = 'cancelled',
             updated_at      = NOW()
       WHERE id = $1`,
      [input.bookingId, input.deletedBy, input.reason]
    );
  });
}

