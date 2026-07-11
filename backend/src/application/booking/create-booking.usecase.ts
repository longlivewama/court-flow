/**
 * Create Booking Use Case
 *
 * Implements SRS §8.4 booking creation with:
 *   - Row-level pessimistic locking (SELECT … FOR UPDATE)
 *   - Deposit snapshot at creation time
 *   - Atomic DB transaction
 *   - Audit logging
 */
import { PoolClient } from 'pg';
import { withTransaction } from '../../infrastructure/database/client';
import { validateBookingSlot } from '../../domain/booking/booking.validator';
import { auditLog, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { emailService } from '../../infrastructure/email/email.service';

export interface CreateBookingInput {
  clubId:          string;
  courtId:         string;
  customerId:      string;
  createdBy:       string;
  createdByRole:   string;
  startTime:       Date;
  durationMinutes: 60 | 90 | 120;
  notes?:          string;
  discountAmount?: number;
  depositAmount?:  number;
  depositMethod?:  'INSTAPAY' | 'VODAFONE_CASH' | 'CASH' | 'NONE';
  remainderAmount?: number;
  remainderMethod?: 'INSTAPAY' | 'VODAFONE_CASH' | 'CASH' | 'NONE';
  adminNotes?:     string | null;
  processedById:   string | null;
  ipAddress?:      string;
  deviceInfo?:     string;
}

export interface BookingResult {
  id:              string;
  status:          string;
  depositAmount:   number;
  totalPrice:      number;
  remainingBalance: number;
}

export async function createBooking(
  input: CreateBookingInput
): Promise<BookingResult> {
  return withTransaction(async (client: PoolClient) => {
    // ── PESSIMISTIC LOCK: lock the court row for this transaction ──
    // This prevents concurrent bookings from passing validation simultaneously.
    await client.query(
      `SELECT id FROM courts WHERE id = $1 FOR UPDATE`,
      [input.courtId]
    );

    // ── Fetch club settings (deposit %, expiry) ────────────────
    const { rows: settingsRows } = await client.query<{
      deposit_percent:                number;
      pending_deposit_expiry_minutes: number;
    }>(
      `SELECT deposit_percent, pending_deposit_expiry_minutes FROM clubs WHERE id = $1`,
      [input.clubId]
    );

    if (!settingsRows.length) throw new Error('Club not found');
    const { deposit_percent } = settingsRows[0];

    // ── Fetch court price ──────────────────────────────────────
    const { rows: courtRows } = await client.query<{ price_per_slot: number }>(
      `SELECT price_per_slot FROM courts WHERE id = $1`,
      [input.courtId]
    );
    const { price_per_slot } = courtRows[0];

    // ── Validate slot (working hours, status, conflicts) ───────
    // Bypass the working-hours gate for all non-customer roles so that
    // owners, receptionists, and staff can book at any hour they choose.
    const isAdminRole = ['owner', 'receptionist', 'staff'].includes(input.createdByRole);
    await validateBookingSlot(client, {
      clubId:             input.clubId,
      courtId:            input.courtId,
      startTime:          input.startTime,
      durationMinutes:    input.durationMinutes,
      bypassWorkingHours: isAdminRole,
    });

    // ── Calculate financial snapshot ───────────────────────────
    const durationMultiplier = input.durationMinutes / 60;
    const totalPrice    = price_per_slot * durationMultiplier;
    
    // Apply discount for final calculation
    const finalPrice = Math.max(totalPrice - (input.discountAmount ?? 0), 0);
    const depositAmount = input.depositAmount ?? Math.round((finalPrice * deposit_percent / 100) * 100) / 100;
    
    const deposit_status = input.depositMethod && input.depositMethod !== 'NONE' ? 'DEPOSIT_PAID' : 'NOT_PAID';
    const remainingBalance = Math.max(Math.round((finalPrice - (input.depositAmount ?? 0) - (input.remainderAmount ?? 0)) * 100) / 100, 0);

    const endTime = new Date(
      input.startTime.getTime() + input.durationMinutes * 60 * 1000
    );

    // ── Determine initial status ───────────────────────────────
    const initialStatus =
      input.createdByRole === 'receptionist' ? 'draft' : 'pending_deposit';

    // ── Insert booking ─────────────────────────────────────────
    const { rows: bookingRows } = await client.query<{ id: string }>(
      `INSERT INTO bookings
         (club_id, court_id, customer_id, created_by, status,
          start_time, end_time, duration_minutes,
          total_price, deposit_percent_snap, deposit_amount, remaining_balance, notes,
          deposit_status, deposit_method, remainder_amount, remainder_method, discount_amount, admin_notes, processed_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        input.clubId,
        input.courtId,
        input.customerId,
        input.createdBy,
        initialStatus,
        input.startTime.toISOString(),
        endTime.toISOString(),
        input.durationMinutes,
        totalPrice,
        deposit_percent,
        depositAmount,
        remainingBalance,
        input.notes ?? null,
        deposit_status,
        input.depositMethod ?? 'NONE',
        input.remainderAmount ?? 0,
        input.remainderMethod ?? 'NONE',
        input.discountAmount ?? 0,
        input.adminNotes ?? null,
        input.processedById
      ]
    );
    const bookingId = bookingRows[0].id;

    // ── Insert payment record ──────────────────────────────────
    await client.query(
      `INSERT INTO payments
         (booking_id, club_id, customer_id, status, deposit_amount, total_amount)
       VALUES ($1,$2,$3,'deposit_pending',$4,$5)`,
      [bookingId, input.clubId, input.customerId, depositAmount, totalPrice]
    );

    // ── Audit log ──────────────────────────────────────────────
    await auditLog({
      clubId:     input.clubId,
      userId:     input.createdBy,
      userRole:   input.createdByRole,
      ipAddress:  input.ipAddress,
      deviceInfo: input.deviceInfo,
      actionType: AUDIT_ACTIONS.BOOKING_CREATED,
      entityType: 'booking',
      entityId:   bookingId,
      newValues: {
        courtId:         input.courtId,
        customerId:      input.customerId,
        startTime:       input.startTime.toISOString(),
        durationMinutes: input.durationMinutes,
        totalPrice,
        status:          initialStatus,
      },
    });

    return {
      id:               bookingId,
      status:           initialStatus,
      depositAmount,
      totalPrice,
      remainingBalance,
    };
  });
}
