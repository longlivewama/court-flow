/**
 * Booking Controller – CRUD + state transitions for bookings.
 * All endpoints enforce RBAC via middleware.
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createBooking } from '../../../application/booking/create-booking.usecase';
import { uploadReceipt } from '../../../application/booking/upload-receipt.usecase';
import { verifyDeposit } from '../../../application/booking/verify-deposit.usecase';
import { deleteBooking } from '../../../application/booking/delete-booking.usecase';
import { db } from '../../../infrastructure/database/client';
import { withTransaction } from '../../../infrastructure/database/client';
import { decryptFile } from '../../../infrastructure/auth/encryption.service';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { emailService } from '../../../infrastructure/email/email.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10') * 1024 * 1024 },
});

// Translate multer failures (oversized file, malformed multipart body, wrong
// field name) into operational 400s instead of unhandled 500s.
export function receiptUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  upload.single('receipt')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB ?? 10} MB`
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected file field '${err.field}'. Upload the file under the 'receipt' field.`
          : `Upload failed: ${err.message}`;
      return next(new ValidationError(message));
    }
    next(err);
  });
}

// ── GET /api/bookings ──────────────────────────────────────
// Customers must never receive admin_notes – strip it from every row
// when the requester's role is 'customer'.
export async function listBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, sub: userId } = req.user!;
    const { status, courtId, customerId, from, to, page = '1', limit = '20' } = req.query as Record<string, string>;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params: unknown[] = [CLUB_ID];
    const conditions: string[] = ['b.club_id = $1', 'b.deleted_at IS NULL'];

    // Customers only see their own bookings
    if (role === 'customer') {
      params.push(userId);
      conditions.push(`b.customer_id = $${params.length}`);
    } else if (customerId) {
      params.push(customerId);
      conditions.push(`b.customer_id = $${params.length}`);
    }

    if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }
    if (courtId) { params.push(courtId); conditions.push(`b.court_id = $${params.length}`); }
    if (from)    { params.push(from);    conditions.push(`b.start_time >= $${params.length}`); }
    if (to)      { params.push(to);      conditions.push(`b.start_time <= $${params.length}`); }

    const where = conditions.join(' AND ');
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(
      `SELECT b.*,
              COALESCE(c.name, 'Deleted Court') AS court_name,
              COALESCE(c.number, 0) AS court_number,
              COALESCE(u.first_name, 'Unknown') AS first_name,
              COALESCE(u.last_name, 'User') AS last_name,
              COALESCE(u.email, '') AS customer_email,
              p.status AS payment_status, p.deposit_amount, p.total_amount
       FROM bookings b
       LEFT JOIN courts c ON c.id = b.court_id
       LEFT JOIN users  u ON u.id = b.customer_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE ${where}
       ORDER BY b.start_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Privacy gate: strip admin_notes for customer callers
    const data = role === 'customer'
      ? rows.map((r) => { const copy = { ...r }; delete copy.admin_notes; return copy; })
      : rows;

    res.json({ data, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/financial-summary ────────────────────────────
// Returns cash-flow breakdown for a given date (defaults to today).
// Gated to receptionist + owner.
export async function getFinancialSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Accept optional ?from=YYYY-MM-DD&to=YYYY-MM-DD; default = today in Africa/Cairo
    const tz = 'Africa/Cairo';
    const { from, to } = req.query as Record<string, string>;

    // ── Logical business-day grouping ──────────────────────────────
    // The operational shift runs from 12:00 PM (noon) to 06:00 AM the
    // following morning.  A booking at 01:30 AM on Tuesday therefore
    // belongs to Monday's revenue bucket, not Tuesday's.
    //
    // We shift each booking's start_time back by 6 hours before casting
    // to a date so that 00:00–05:59 folds into the previous calendar
    // day, while 06:00+ stays on its own calendar date.  This produces
    // the correct business-day label without a separate CTE.
    //
    // SQL expression:
    //   ((start_time AT TIME ZONE tz) - INTERVAL '6 hours')::date

    const shiftInterval = `INTERVAL '6 hours'`;
    const logicalDateExpr = `((start_time AT TIME ZONE '${tz}') - ${shiftInterval})::date`;

    const fromExpr = from ? `$2::date` : `(NOW() AT TIME ZONE '${tz}' - ${shiftInterval})::date`;
    const toExpr   = to   ? `$${from ? 3 : 2}::date` : `(NOW() AT TIME ZONE '${tz}' - ${shiftInterval})::date`;

    const finalParams: unknown[] = [CLUB_ID];
    if (from) finalParams.push(from);
    if (to)   finalParams.push(to);

    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'CASH'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'CASH'), 0)::numeric AS "totalCash",
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'VODAFONE_CASH'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'VODAFONE_CASH'), 0)::numeric AS "totalVodafoneCash",
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'INSTAPAY'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'INSTAPAY'), 0)::numeric AS "totalInstapay",
         COALESCE(SUM(discount_amount), 0)::numeric AS "totalDiscounts",
         (COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method <> 'NONE'), 0) +
          COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method <> 'NONE'), 0))::numeric AS "totalRevenue",
         COUNT(*)::int                                                                            AS "totalBookings"
       FROM bookings
       WHERE club_id = $1
         AND ${logicalDateExpr} BETWEEN ${fromExpr} AND ${toExpr}
         AND status NOT IN ('cancelled','expired')`,
      finalParams
    );

    const row = rows[0];
    res.json({
      date:              from ?? new Date().toLocaleDateString('sv', { timeZone: tz }),
      totalCash:         Number(row.totalCash),
      totalVodafoneCash: Number(row.totalVodafoneCash),
      totalInstapay:     Number(row.totalInstapay),
      totalDigital:      Number(row.totalVodafoneCash) + Number(row.totalInstapay),
      totalDiscounts:    Number(row.totalDiscounts),
      totalRevenue:      Number(row.totalRevenue),
      totalBookings:     Number(row.totalBookings),
    });
  } catch (err) { next(err); }
}

import { z } from 'zod';

const createBookingSchema = z.object({
  courtId: z.string().optional(),
  court_id: z.string().optional(),
  customerId: z.string().optional(),
  customer_id: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  startTime: z.string().optional(),
  start_time: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  duration_minutes: z.number().int().positive().optional(),
  notes: z.string().optional(),
  discountAmount: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  depositAmount: z.number().min(0).optional(),
  deposit_amount: z.number().min(0).optional(),
  depositMethod: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  deposit_method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  remainderAmount: z.number().min(0).optional(),
  remainder_amount: z.number().min(0).optional(),
  remainderMethod: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  remainder_method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  // Customer-facing aliases: "how much did you pay and how" — stored as the
  // booking's deposit (self-reported until staff verify the receipt).
  amountPaid: z.number().min(0).optional(),
  amount_paid: z.number().min(0).optional(),
  paymentMethod: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  payment_method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  adminNotes: z.string().optional(),
  admin_notes: z.string().optional(),
});

// ── POST /api/bookings ────────────────────────────────────────
export async function createBookingHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createBookingSchema.parse(req.body);
    // Accept both camelCase (API convention) and snake_case (sent by the frontend form)
    const courtId        = parsed.courtId        ?? parsed.court_id;
    const customerId     = parsed.customerId      ?? parsed.customer_id;
    const startTime      = parsed.startTime       ?? parsed.start_time;
    const durationMinutes = parsed.durationMinutes ?? parsed.duration_minutes;
    const notes          = parsed.notes;
    
    const { sub: userId, role } = req.user!;

    if (!courtId)        throw new ValidationError('courtId (or court_id) is required');
    if (!startTime)      throw new ValidationError('startTime (or start_time) is required');
    if (!durationMinutes) throw new ValidationError('durationMinutes (or duration_minutes) is required');

    // Customers always book for themselves
    let resolvedCustomerId = role === 'customer' ? userId : (customerId ?? null);

    if (role !== 'customer' && !resolvedCustomerId && parsed.customerName && parsed.customerPhone) {
      const { rows } = await db.query('SELECT id FROM users WHERE phone = $1 LIMIT 1', [parsed.customerPhone]);
      if (rows.length > 0) {
        resolvedCustomerId = rows[0].id;
      } else {
        const email = `walkin_${parsed.customerPhone.replace(/\D/g, '')}@courtflow.local`;
        const nameParts = parsed.customerName.trim().split(' ');
        const firstName = nameParts[0] || 'WalkIn';
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Customer';
        const { rows: insertRows } = await db.query(
          `INSERT INTO users (club_id, first_name, last_name, phone, email, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, 'WALKIN_NO_PASSWORD', 'customer') RETURNING id`,
          [CLUB_ID, firstName, lastName, parsed.customerPhone, email]
        );
        resolvedCustomerId = insertRows[0].id;
      }
    }

    if (!resolvedCustomerId) resolvedCustomerId = userId; // Fallback
    
    // Discounts are a staff pricing lever. A customer must never be able to
    // discount their own booking (it reduces total_price and the required
    // deposit downstream), so force it to 0 regardless of the payload — the
    // same authorization gate applied to admin_notes below.
    const discountAmount = role === 'customer'
      ? 0
      : (parsed.discountAmount ?? parsed.discount_amount ?? 0);
    const depositAmount  = parsed.depositAmount  ?? parsed.deposit_amount
      ?? parsed.amountPaid ?? parsed.amount_paid ?? 0;
    const depositMethod  = parsed.depositMethod  ?? parsed.deposit_method
      ?? parsed.paymentMethod ?? parsed.payment_method ?? 'NONE';
    const remainderAmount= parsed.remainderAmount?? parsed.remainder_amount?? 0;
    const remainderMethod= parsed.remainderMethod?? parsed.remainder_method?? 'NONE';

    const result = await createBooking({
      clubId:          CLUB_ID,
      courtId:         courtId!,
      customerId:      resolvedCustomerId,
      createdBy:       userId,
      createdByRole:   role,
      startTime:       new Date(startTime!),
      durationMinutes: durationMinutes as any,
      notes:           parsed.notes,
      discountAmount,
      depositAmount,
      depositMethod,
      remainderAmount,
      remainderMethod,
      // Privacy gate: customers must NEVER be able to set admin_notes.
      // Strip the field entirely from the use-case call when the actor
      // is a customer, regardless of what the request body contained.
      adminNotes:      role === 'customer' ? null : (parsed.adminNotes ?? parsed.admin_notes ?? null),
      processedById:   userId,
      ipAddress:       req.ip,
      deviceInfo:      req.headers['user-agent']
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
}


// ── GET /api/bookings/:id ─────────────────────────────────────
export async function getBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { role, sub: userId } = req.user!;

    const { rows } = await db.query(
      `SELECT b.*,
              COALESCE(c.name, 'Deleted Court') AS court_name,
              COALESCE(c.number, 0) AS court_number,
              COALESCE(u.first_name, 'Unknown') AS first_name,
              COALESCE(u.last_name, 'User') AS last_name,
              COALESCE(u.email, '') AS customer_email,
              EXISTS (SELECT 1 FROM receipts r WHERE r.booking_id = b.id) AS has_receipt
       FROM bookings b
       LEFT JOIN courts c ON c.id = b.court_id
       LEFT JOIN users  u ON u.id = b.customer_id
       WHERE b.id = $1 AND b.club_id = $2 AND b.deleted_at IS NULL`,
      [id, CLUB_ID]
    );

    if (!rows.length) throw new NotFoundError('Booking', id);
    const booking = { ...rows[0] };

    if (role === 'customer' && booking.customer_id !== userId) {
      throw new ForbiddenError('You can only view your own bookings');
    }

    // Privacy gate: customers must never see admin_notes
    if (role === 'customer') {
      delete booking.admin_notes;
    }

    res.json(booking);
  } catch (err) { next(err); }
}

// ── POST /api/bookings/:id/receipt ────────────────────────────
export async function uploadReceiptHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No file uploaded');

    await uploadReceipt({
      bookingId:   req.params.id,
      customerId:  req.user!.sub,
      clubId:      CLUB_ID,
      fileBuffer:  req.file.buffer,
      fileName:    req.file.originalname,
      fileMime:    req.file.mimetype,
      fileSize:    req.file.size,
      ipAddress:   req.ip,
      deviceInfo:  req.headers['user-agent'],
    });

    res.json({ message: 'Receipt uploaded successfully. Awaiting verification.' });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/:id/receipt ─────────────────────────────
// Streams the latest decrypted receipt for a booking.
// Staff (receptionist/owner/admin) can view any receipt; customers only their own.
export async function getReceiptHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { role, sub: userId } = req.user!;

    const { rows: bookingRows } = await db.query<{ id: string; customer_id: string }>(
      `SELECT id, customer_id FROM bookings WHERE id = $1 AND club_id = $2`,
      [id, CLUB_ID]
    );
    if (!bookingRows.length) throw new NotFoundError('Booking', id);

    if (role === 'customer' && bookingRows[0].customer_id !== userId) {
      throw new ForbiddenError('You can only view receipts for your own bookings');
    }

    const { rows: receiptRows } = await db.query<{
      file_name: string; file_mime: string; storage_key: string; encryption_iv: string;
    }>(
      `SELECT file_name, file_mime, storage_key, encryption_iv
       FROM receipts WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (!receiptRows.length) throw new NotFoundError('Receipt for booking', id);
    const receipt = receiptRows[0];

    let fileBuffer: Buffer;
    try {
      fileBuffer = decryptFile(receipt.storage_key, receipt.encryption_iv);
    } catch {
      // File missing on disk or encrypted under a rotated/incorrect key
      throw new NotFoundError('Receipt file (unreadable or missing from storage)', id);
    }

    res.setHeader('Content-Type', receipt.file_mime);
    res.setHeader('Content-Disposition', `inline; filename="${receipt.file_name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(fileBuffer);
  } catch (err) { next(err); }
}

// ── PATCH /api/bookings/:id/verify ────────────────────────────
export async function verifyDepositHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { action, rejectionReason } = req.body as { action: 'approve' | 'reject'; rejectionReason?: string };

    await verifyDeposit({
      bookingId:      req.params.id,
      receptionistId: req.user!.sub,
      clubId:         CLUB_ID,
      action,
      rejectionReason,
      ipAddress:      req.ip,
      deviceInfo:     req.headers['user-agent'],
    });

    res.json({ message: `Deposit ${action === 'approve' ? 'approved' : 'rejected'} successfully` });
  } catch (err) { next(err); }
}

// ── PATCH /api/bookings/:id/checkin ──────────────────────────
export async function checkinHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; status: string; customer_id: string }>(
        `SELECT id, status, customer_id FROM bookings WHERE id=$1 AND club_id=$2 FOR UPDATE`,
        [req.params.id, CLUB_ID]
      );
      if (!rows.length) throw new NotFoundError('Booking', req.params.id);
      if (rows[0].status !== 'confirmed') throw new ValidationError(`Booking must be 'confirmed' to check in`);

      await client.query(
        `UPDATE bookings SET status='checked_in', checked_in_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [req.params.id]
      );

      await auditLog({ clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.BOOKING_CHECKED_IN,
        entityType: 'booking', entityId: req.params.id,
        newValues: { status: 'checked_in', checkedInAt: new Date().toISOString() } });
    });

    res.json({ message: 'Customer checked in successfully' });
  } catch (err) { next(err); }
}

// ── PATCH /api/bookings/:id/cancel ───────────────────────────
export async function cancelBookingHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { reason } = req.body;

    await withTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string; status: string; customer_id: string; start_time: Date;
      }>(
        `SELECT id,status,customer_id,start_time FROM bookings WHERE id=$1 AND club_id=$2 FOR UPDATE`,
        [req.params.id, CLUB_ID]
      );
      if (!rows.length) throw new NotFoundError('Booking', req.params.id);
      const booking = rows[0];

      // Customers can only cancel their own bookings
      if (req.user!.role === 'customer' && booking.customer_id !== req.user!.sub) {
        throw new ForbiddenError('You can only cancel your own bookings');
      }

      const TERMINAL = ['cancelled', 'completed', 'no_show', 'expired'];
      if (TERMINAL.includes(booking.status)) {
        throw new ValidationError(`Cannot cancel a booking in '${booking.status}' status`);
      }

      // Cancellation policy: check deadline
      const { rows: clubRows } = await client.query<{ cancellation_deadline_hours: number }>(
        `SELECT cancellation_deadline_hours FROM clubs WHERE id=$1`, [CLUB_ID]
      );
      const deadlineHours = clubRows[0]?.cancellation_deadline_hours ?? 24;
      const deadline = new Date(booking.start_time.getTime() - deadlineHours * 60 * 60 * 1000);
      const afterDeadline = new Date() > deadline;

      await client.query(
        `UPDATE bookings SET status='cancelled', cancellation_reason=$2, cancelled_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [booking.id, reason ?? null]
      );

      // Load customer email
      const { rows: custRows } = await client.query<{ email: string; first_name: string }>(
        `SELECT email, first_name FROM users WHERE id=$1`, [booking.customer_id]
      );

      await auditLog({ clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
        ipAddress: req.ip, actionType: AUDIT_ACTIONS.BOOKING_CANCELLED,
        entityType: 'booking', entityId: booking.id,
        newValues: { status: 'cancelled', reason, afterDeadline } });

      if (custRows.length) {
        // Best-effort: an SMTP outage must never roll back the cancellation
        try {
          await emailService.sendBookingCancellation({
            to: custRows[0].email, firstName: custRows[0].first_name,
            bookingId: booking.id, startTime: booking.start_time,
            refundStatus: afterDeadline ? 'Deposit forfeited (after cancellation deadline)' : 'Eligible for refund',
          });
        } catch {
          // logged inside the email service after its own retries
        }
      }
    });

    res.json({ message: 'Booking cancelled successfully' });
  } catch (err) { next(err); }
}

// ── PATCH /api/bookings/:id/settle ─────────────────────────────
// Allows receptionist / owner to manually settle payment fields.
export async function settlePaymentHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Accept both camelCase and snake_case variants from the frontend
    const settleSchema = z.object({
      depositAmount:   z.number().min(0).optional(),
      deposit_amount:  z.number().min(0).optional(),
      depositMethod:   z.enum(['CASH', 'VODAFONE_CASH', 'INSTAPAY', 'NONE']).optional(),
      deposit_method:  z.enum(['CASH', 'VODAFONE_CASH', 'INSTAPAY', 'NONE']).optional(),
      remainderAmount:  z.number().min(0).optional(),
      remainder_amount: z.number().min(0).optional(),
      remainderMethod:  z.enum(['CASH', 'VODAFONE_CASH', 'INSTAPAY', 'NONE']).optional(),
      remainder_method: z.enum(['CASH', 'VODAFONE_CASH', 'INSTAPAY', 'NONE']).optional(),
      discountAmount:  z.number().min(0).optional(),
      discount_amount: z.number().min(0).optional(),
      adminNotes:      z.string().optional().nullable(),
      admin_notes:     z.string().optional().nullable(),
    });

    const parsed = settleSchema.parse(req.body);

    // Normalise: prefer camelCase, fall back to snake_case
    const depositAmount   = parsed.depositAmount   ?? parsed.deposit_amount;
    const depositMethod   = parsed.depositMethod   ?? parsed.deposit_method;
    const remainderAmount = parsed.remainderAmount  ?? parsed.remainder_amount;
    const remainderMethod = parsed.remainderMethod  ?? parsed.remainder_method;
    const discountAmount  = parsed.discountAmount   ?? parsed.discount_amount;
    const adminNotes      = parsed.adminNotes       ?? parsed.admin_notes;

    const bookingId = req.params.id;

    let updatedBooking: Record<string, unknown> = {};

    await withTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string; total_price: number; deposit_amount: number;
        remainder_amount: number; discount_amount: number; status: string;
      }>(
        `SELECT id, total_price, deposit_amount, remainder_amount, discount_amount, status
         FROM bookings WHERE id=$1 AND club_id=$2 FOR UPDATE`,
        [bookingId, CLUB_ID]
      );
      if (!rows.length) throw new NotFoundError('Booking', bookingId);

      const existing = rows[0];

      // Resolve final amounts (what will be stored)
      const finalDeposit   = depositAmount   ?? Number(existing.deposit_amount);
      const finalRemainder = remainderAmount ?? Number(existing.remainder_amount);
      const finalDiscount  = discountAmount  ?? Number(existing.discount_amount);
      const totalPaid      = finalDeposit + finalRemainder;
      const netPrice       = Math.max(Number(existing.total_price) - finalDiscount, 0);

      // Derive financial status
      let financialStatus: string;
      if (totalPaid <= 0) {
        financialStatus = 'NOT_PAID';
      } else if (netPrice > 0 && totalPaid >= netPrice) {
        financialStatus = 'FULLY_PAID';
      } else {
        financialStatus = 'DEPOSIT_PAID';
      }

      const { rows: updated } = await client.query(
        `UPDATE bookings
           SET deposit_amount   = $2,
               deposit_method   = COALESCE($3, deposit_method),
               remainder_amount = $4,
               remainder_method = COALESCE($5, remainder_method),
               discount_amount  = $6,
               admin_notes      = COALESCE($7, admin_notes),
               deposit_status   = $8,
               updated_at       = NOW()
         WHERE id = $1 AND club_id = $9
         RETURNING *`,
        [
          bookingId,
          finalDeposit,
          depositMethod ?? null,
          finalRemainder,
          remainderMethod ?? null,
          finalDiscount,
          adminNotes ?? null,
          financialStatus,
          CLUB_ID,
        ]
      );

      updatedBooking = updated[0] ?? {};

      await auditLog({
        clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
        ipAddress: req.ip,
        actionType: AUDIT_ACTIONS.BALANCE_RECORDED,
        entityType: 'booking', entityId: bookingId,
        newValues: { depositAmount: finalDeposit, depositMethod, remainderAmount: finalRemainder, remainderMethod, discountAmount: finalDiscount, adminNotes, financialStatus },
      });
    });

    res.json({ message: 'Payment settled successfully', booking: updatedBooking });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/analytics-plots ─────────────────────────
// Returns two analytics channels for owner charting:
//   paymentDistribution  – cash-split by method over rolling window
//   hourlyPeakTraffic    – booking count grouped by local hour
// Gated to owner / admin.
export async function getAnalyticsPlots(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const tz       = 'Africa/Cairo';
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '30', 10), 1), 365);

    // ── 1. Payment-method distribution ──────────────────────────
    // One-pass conditional aggregate; no subqueries needed.
    const { rows: distRows } = await db.query(
      `SELECT
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'CASH'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'CASH'), 0)::numeric AS cash,
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'VODAFONE_CASH'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'VODAFONE_CASH'), 0)::numeric AS vodafone_cash,
         COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_method = 'INSTAPAY'), 0)::numeric +
         COALESCE(SUM(remainder_amount) FILTER (WHERE remainder_method = 'INSTAPAY'), 0)::numeric AS instapay
       FROM bookings
       WHERE club_id = $1
         AND status  NOT IN ('cancelled', 'expired')
         AND created_at >= NOW() - ($2 || ' days')::interval`,
      [CLUB_ID, rangeDays]
    );

    const dr = distRows[0];
    const paymentDistribution = [
      { name: 'CASH',          value: Number(dr.cash) },
      { name: 'VODAFONE_CASH', value: Number(dr.vodafone_cash) },
      { name: 'INSTAPAY',      value: Number(dr.instapay) },
    ];

    // ── 2. Hourly peak traffic ───────────────────────────────────
    // Extract local hour from start_time, group and count.
    // Only confirmed / checked_in / completed bookings count as traffic.
    const { rows: peakRows } = await db.query(
      `SELECT
         EXTRACT(HOUR FROM (start_time AT TIME ZONE $3))::int AS hour_slot,
         COUNT(*)::int                                          AS bookings_count
       FROM bookings
       WHERE club_id = $1
         AND status  IN ('confirmed', 'checked_in', 'completed', 'draft', 'pending_deposit', 'pending_verification')
         AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY hour_slot
       ORDER BY hour_slot`,
      [CLUB_ID, rangeDays, tz]
    );

    // Build a dense 06:00–22:00 series so charts always have full x-axis even
    // when some hours have zero bookings.
    const hourMap = new Map<number, number>(peakRows.map((r: { hour_slot: number; bookings_count: number }) => [r.hour_slot, r.bookings_count]));
    const hourlyPeakTraffic = Array.from({ length: 17 }, (_, i) => {
      const h = i + 6; // 06:00 … 22:00
      return {
        hour:          `${String(h).padStart(2, '0')}:00`,
        bookingsCount: hourMap.get(h) ?? 0,
      };
    });

    res.json({
      rangeDays,
      generatedAt:        new Date().toISOString(),
      paymentDistribution,
      hourlyPeakTraffic,
    });
  } catch (err) { next(err); }
}

// ── DELETE /api/bookings/:id (owner only) ─────────────────────
const deleteBookingSchema = z.object({
  reason: z.string().trim().min(1, 'A deletion reason is required'),
});

export async function deleteBookingHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = deleteBookingSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('A deletion reason is required');
    const { reason } = parsed.data;

    await deleteBooking({
      bookingId:     req.params.id,
      clubId:        CLUB_ID,
      deletedBy:     req.user!.sub,
      deletedByRole: req.user!.role,
      reason,
      ipAddress:     req.ip,
      deviceInfo:    req.headers['user-agent'],
    });

    res.json({ message: 'Booking permanently deleted' });
  } catch (err) { next(err); }
}

