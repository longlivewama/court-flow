/**
 * Upload Receipt use case — core business logic coverage (Phase 15).
 *
 * The magic-byte sniff is a real security control (defeats a client lying
 * about Content-Type to smuggle an arbitrary file past the allowlist), so
 * it's exercised with real file signatures, not just mocked away.
 */
jest.mock('../src/infrastructure/database/client', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../src/infrastructure/auth/encryption.service', () => ({
  encryptAndStore: jest.fn().mockResolvedValue({ storageKey: 'key-1', encryptionIv: 'iv-1' }),
}));
jest.mock('../src/infrastructure/audit/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { RECEIPT_UPLOADED: 'RECEIPT_UPLOADED' },
}));

import { uploadReceipt, UploadReceiptInput } from '../src/application/booking/upload-receipt.usecase';
import { withTransaction } from '../src/infrastructure/database/client';
import { encryptAndStore } from '../src/infrastructure/auth/encryption.service';
import { ValidationError, NotFoundError } from '../src/shared/errors';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);
const PNG_BYTES  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF_BYTES  = Buffer.from('%PDF-1.4 fake', 'utf8');
const SCRIPT_BYTES = Buffer.from('#!/bin/sh\nrm -rf /', 'utf8');

interface RecordedCall { text: string; params: unknown[]; }

function makeClient(opts: {
  bookingRow?: Record<string, unknown> | null;
  paymentRow?: { id: string; status: string } | null;
} = {}) {
  const calls: RecordedCall[] = [];
  const bookingRow = opts.bookingRow === undefined
    ? { id: 'booking-1', status: 'pending_deposit', customer_id: 'cust-1' }
    : opts.bookingRow;
  const paymentRow = opts.paymentRow === undefined ? { id: 'payment-1', status: 'deposit_pending' } : opts.paymentRow;

  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/FROM bookings WHERE id = \$1 AND club_id = \$2 FOR UPDATE/i.test(text)) return { rows: bookingRow ? [bookingRow] : [] };
    if (/SELECT id, status FROM payments WHERE booking_id/i.test(text)) return { rows: paymentRow ? [paymentRow] : [] };
    if (/INSERT INTO receipts/i.test(text)) return { rows: [] };
    if (/UPDATE bookings SET status = 'pending_verification'/i.test(text)) return { rows: [] };
    if (/UPDATE payments SET status = 'deposit_pending'/i.test(text)) return { rows: [] };
    return { rows: [] };
  });
  return { query, calls };
}

function wire(client: { query: jest.Mock }) {
  (withTransaction as jest.Mock).mockImplementation(async (fn: (c: unknown) => unknown) => fn(client));
}

function baseInput(overrides: Partial<UploadReceiptInput> = {}): UploadReceiptInput {
  return {
    bookingId: 'booking-1', customerId: 'cust-1', clubId: 'club-1',
    fileBuffer: JPEG_BYTES, fileName: 'receipt.jpg', fileMime: 'image/jpeg', fileSize: 1024,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('uploadReceipt — file validation (magic-byte sniff)', () => {
  test('rejects a declared MIME type outside the allowlist', async () => {
    await expect(uploadReceipt(baseInput({ fileMime: 'application/x-sh', fileBuffer: SCRIPT_BYTES })))
      .rejects.toThrow(ValidationError);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('rejects a shell script disguised with an allowed declared MIME (Content-Type spoofing)', async () => {
    await expect(uploadReceipt(baseInput({ fileMime: 'image/jpeg', fileBuffer: SCRIPT_BYTES })))
      .rejects.toThrow(/does not match its declared type/);
  });

  test('rejects a real PNG declared as image/jpeg (signature/declared-type mismatch)', async () => {
    await expect(uploadReceipt(baseInput({ fileMime: 'image/jpeg', fileBuffer: PNG_BYTES })))
      .rejects.toThrow(ValidationError);
  });

  test('accepts a genuine JPEG', async () => {
    const client = makeClient();
    wire(client);
    await expect(uploadReceipt(baseInput({ fileMime: 'image/jpeg', fileBuffer: JPEG_BYTES }))).resolves.toBeUndefined();
  });

  test('accepts a genuine PNG', async () => {
    const client = makeClient();
    wire(client);
    await expect(uploadReceipt(baseInput({ fileMime: 'image/png', fileBuffer: PNG_BYTES }))).resolves.toBeUndefined();
  });

  test('accepts a genuine PDF', async () => {
    const client = makeClient();
    wire(client);
    await expect(uploadReceipt(baseInput({ fileMime: 'application/pdf', fileBuffer: PDF_BYTES }))).resolves.toBeUndefined();
  });

  test('rejects a file over the configured size limit', async () => {
    await expect(uploadReceipt(baseInput({ fileSize: 999_999_999 }))).rejects.toThrow(/too large/i);
    expect(encryptAndStore).not.toHaveBeenCalled();
  });
});

describe('uploadReceipt — ownership and state guards', () => {
  test('an unknown booking is a 404', async () => {
    const client = makeClient({ bookingRow: null });
    wire(client);
    await expect(uploadReceipt(baseInput())).rejects.toThrow(NotFoundError);
  });

  test('a customer cannot upload a receipt for someone else\'s booking (IDOR guard)', async () => {
    const client = makeClient({ bookingRow: { id: 'booking-1', status: 'pending_deposit', customer_id: 'someone-else' } });
    wire(client);
    await expect(uploadReceipt(baseInput())).rejects.toThrow(ValidationError);
  });

  test('a booking not in pending_deposit/pending_verification is rejected', async () => {
    const client = makeClient({ bookingRow: { id: 'booking-1', status: 'confirmed', customer_id: 'cust-1' } });
    wire(client);
    await expect(uploadReceipt(baseInput())).rejects.toThrow(ValidationError);
  });

  test('a booking with no payment record at all is a 404', async () => {
    const client = makeClient({ paymentRow: null });
    wire(client);
    await expect(uploadReceipt(baseInput())).rejects.toThrow(NotFoundError);
  });
});

describe('uploadReceipt — payment state transition on re-upload', () => {
  test('re-uploading after a rejection resets the payment back to deposit_pending', async () => {
    const client = makeClient({
      bookingRow: { id: 'booking-1', status: 'pending_verification', customer_id: 'cust-1' },
      paymentRow: { id: 'payment-1', status: 'deposit_rejected' },
    });
    wire(client);

    await uploadReceipt(baseInput());

    const resetCall = client.calls.find((c) => /UPDATE payments SET status = 'deposit_pending'/i.test(c.text))!;
    expect(resetCall.params).toEqual(['payment-1']);
  });

  test('a first-time upload (still deposit_pending) does not re-trigger the reset update', async () => {
    const client = makeClient({ paymentRow: { id: 'payment-1', status: 'deposit_pending' } });
    wire(client);

    await uploadReceipt(baseInput());

    expect(client.calls.some((c) => /UPDATE payments SET status = 'deposit_pending'/i.test(c.text))).toBe(false);
  });

  test('every successful upload transitions the booking to pending_verification', async () => {
    const client = makeClient();
    wire(client);

    await uploadReceipt(baseInput());

    const bookingUpdate = client.calls.find((c) => /UPDATE bookings SET status = 'pending_verification'/i.test(c.text))!;
    expect(bookingUpdate.params).toEqual(['booking-1']);
  });
});
