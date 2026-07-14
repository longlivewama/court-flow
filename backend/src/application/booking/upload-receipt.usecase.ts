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

/**
 * Detect the true file type from the buffer's magic bytes. The client-declared
 * MIME (multipart Content-Type) is fully attacker-controlled and must never be
 * trusted on its own — a shell script sent as `Content-Type: image/png` would
 * otherwise pass. Returns the detected MIME, or null if it matches none of the
 * allowed signatures.
 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // '%PDF-'
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  return null;
}

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
  // Content-based check: verify the actual bytes match an allowed signature and
  // agree with the declared type. Defeats MIME spoofing (e.g. a .sh uploaded as
  // image/png).
  const detected = sniffMime(input.fileBuffer);
  if (!detected || detected !== input.fileMime) {
    throw new ValidationError(
      'File content does not match its declared type. Allowed: JPEG, PNG, PDF.'
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
