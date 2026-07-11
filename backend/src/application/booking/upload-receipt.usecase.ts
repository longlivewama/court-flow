/**
 * Receipt Upload Use Case
 * Validates the file, encrypts it with AES-256-GCM, stores the reference,
 * and transitions booking to 'pending_verification'.
 */
import { withTransaction } from '../../infrastructure/database/client';
import { encryptAndStore } from '../../infrastructure/auth/encryption.service';
import { assertTransition } from '../../domain/booking/booking.state-machine';
import { assertPaymentTransition } from '../../domain/booking/booking.state-machine';
import { auditLog, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { ValidationError, NotFoundError } from '../../shared/errors';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB ?? '10') * 1024 * 1024;

export interface UploadReceiptInput {
  bookingId:   string;
  customerId:  string;
  clubId:      string;
  fileBuffer:  Buffer;
  fileName:    string;
  fileMime:    string;
  fileSize:    number;
  ipAddress?:  string;
  deviceInfo?: string;
}

export async function uploadReceipt(input: UploadReceiptInput): Promise<void> {
  // ── File validation ────────────────────────────────────────
  if (!ALLOWED_MIME_TYPES.includes(input.fileMime)) {
    throw new ValidationError(
      `Invalid file type. Allowed: JPEG, PNG, PDF. Received: ${input.fileMime}`
    );
  }
  if (input.fileSize > MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB ?? 10} MB`
    );
  }

  await withTransaction(async (client) => {
    // ── Load booking with FOR UPDATE lock ─────────────────────
    const { rows: bookingRows } = await client.query<{
      id: string;
      status: string;
      customer_id: string;
    }>(
      `SELECT id, status, customer_id FROM bookings WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [input.bookingId, input.clubId]
    );

    if (!bookingRows.length) throw new NotFoundError('Booking', input.bookingId);
    const booking = bookingRows[0];

    // Only the booking customer can upload
    if (booking.customer_id !== input.customerId) {
      throw new ValidationError('You can only upload receipts for your own bookings');
    }

    // Booking must be in pending_deposit or pending_verification
    if (!['pending_deposit', 'pending_verification'].includes(booking.status)) {
      throw new ValidationError(
        `Cannot upload receipt for a booking in '${booking.status}' status`
      );
    }

    // ── Encrypt and store file ────────────────────────────────
    const { storageKey, encryptionIv } = await encryptAndStore(
      input.fileBuffer,
      input.fileName
    );

    // ── Get payment record ────────────────────────────────────
    const { rows: paymentRows } = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [input.bookingId]
    );
    if (!paymentRows.length) throw new NotFoundError('Payment record for booking');
    const payment = paymentRows[0];

    // ── Insert receipt record ─────────────────────────────────
    await client.query(
      `INSERT INTO receipts
         (payment_id, booking_id, uploaded_by, file_name, file_mime, file_size_bytes, storage_key, encryption_iv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        payment.id,
        input.bookingId,
        input.customerId,
        input.fileName,
        input.fileMime,
        input.fileSize,
        storageKey,
        encryptionIv,
      ]
    );

    // ── Transition booking → pending_verification ──────────────
    assertTransition(booking.status as any, 'pending_verification');
    await client.query(
      `UPDATE bookings SET status = 'pending_verification', updated_at = NOW() WHERE id = $1`,
      [input.bookingId]
    );

    // ── Transition payment → deposit_pending ──────────────────
    if (payment.status === 'deposit_rejected') {
      // Re-upload after rejection: reset to deposit_pending
      await client.query(
        `UPDATE payments SET status = 'deposit_pending', updated_at = NOW() WHERE id = $1`,
        [payment.id]
      );
    }

    // ── Audit ─────────────────────────────────────────────────
    await auditLog({
      clubId:     input.clubId,
      userId:     input.customerId,
      userRole:   'customer',
      ipAddress:  input.ipAddress,
      deviceInfo: input.deviceInfo,
      actionType: AUDIT_ACTIONS.RECEIPT_UPLOADED,
      entityType: 'booking',
      entityId:   input.bookingId,
      newValues:  { fileName: input.fileName, fileSize: input.fileSize },
    });
  });
}
