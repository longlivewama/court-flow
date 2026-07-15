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
import { assertTransition, assertPaymentTransition } from '../../domain/booking/booking.state-machine';
import { auditLog, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { emailService } from '../../infrastructure/email/email.service';
import { ValidationError } from '../../shared/errors';

export interface BookingEquipmentLine {
  equipmentId: string;
  quantity:    number;
}

export interface CreateBookingInput {
  clubId:          string;
  courtId:         string;
  customerId:      string;
  createdBy:       string;
  createdByRole:   string;
  startTime:       Date;
  durationMinutes: number;
  /** Rental add-ons (rackets, balls, gear) charged per hour */
  equipment?:      BookingEquipmentLine[];
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
  equipmentTotal:  number;
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

    // ── Reject past-dated customer bookings ────────────────────
    // A customer must not be able to self-book a slot whose start time has
    // already passed. Staff keep the ability to record retroactive walk-ins.
    if (input.createdByRole === 'customer' && input.startTime.getTime() < Date.now()) {
      throw new ValidationError('Start time must be in the future.');
    }

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

    // ── Equipment rental lines ─────────────────────────────────
    // Each line locks its equipment row, then checks the remaining stock
    // against every overlapping active booking's rented quantity. The hourly
    // price is snapshotted per line so later catalogue edits never rewrite
    // the financial history of an existing booking.
    const hours = input.durationMinutes / 60;
    const endTimeForStock = new Date(
      input.startTime.getTime() + input.durationMinutes * 60 * 1000
    );

    interface ResolvedEquipmentLine {
      equipmentId: string;
      name:        string;
      quantity:    number;
      hourlyPrice: number;
      subtotal:    number;
    }
    const equipmentLines: ResolvedEquipmentLine[] = [];

    for (const line of input.equipment ?? []) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new ValidationError('Equipment quantity must be a positive integer');
      }

      const { rows: eqRows } = await client.query<{
        id: string; name: string; hourly_price: string; stock_qty: number; is_active: boolean;
      }>(
        `SELECT id, name, hourly_price, stock_qty, is_active
         FROM equipment WHERE id = $1 AND club_id = $2 FOR UPDATE`,
        [line.equipmentId, input.clubId]
      );
      if (!eqRows.length || !eqRows[0].is_active) {
        throw new ValidationError('Selected equipment is not available for rental');
      }
      const eq = eqRows[0];

      const { rows: reservedRows } = await client.query<{ reserved: number }>(
        `SELECT COALESCE(SUM(be.quantity), 0)::int AS reserved
         FROM booking_equipment be
         JOIN bookings b ON b.id = be.booking_id
         WHERE be.equipment_id = $1
           AND b.deleted_at IS NULL
           AND b.status IN ('draft','pending_deposit','pending_verification','confirmed','checked_in')
           AND b.start_time < $3::timestamptz
           AND b.end_time   > $2::timestamptz`,
        [eq.id, input.startTime.toISOString(), endTimeForStock.toISOString()]
      );
      const availableQty = eq.stock_qty - reservedRows[0].reserved;
      if (line.quantity > availableQty) {
        throw new ValidationError(
          `Only ${Math.max(availableQty, 0)} × "${eq.name}" available for this time slot`
        );
      }

      const hourlyPrice = Number(eq.hourly_price);
      equipmentLines.push({
        equipmentId: eq.id,
        name:        eq.name,
        quantity:    line.quantity,
        hourlyPrice,
        subtotal:    Math.round(hourlyPrice * line.quantity * hours * 100) / 100,
      });
    }

    const equipmentTotal = Math.round(
      equipmentLines.reduce((sum, l) => sum + l.subtotal, 0) * 100
    ) / 100;

    // ── Calculate financial snapshot ───────────────────────────
    const durationMultiplier = input.durationMinutes / 60;
    const totalPrice    = price_per_slot * durationMultiplier + equipmentTotal;

    // Apply discount for final calculation
    const finalPrice = Math.max(totalPrice - (input.discountAmount ?? 0), 0);
    const requiredDeposit = Math.round((finalPrice * deposit_percent / 100) * 100) / 100;
    const depositAmount = input.depositAmount ?? requiredDeposit;
    const remainderAmount = input.remainderAmount ?? 0;
    const totalCollected = depositAmount + remainderAmount;

    const remainingBalance = Math.max(Math.round((finalPrice - (input.depositAmount ?? 0) - (input.remainderAmount ?? 0)) * 100) / 100, 0);

    const endTime = new Date(
      input.startTime.getTime() + input.durationMinutes * 60 * 1000
    );

    // ── Determine initial status ───────────────────────────────
    // Staff (owner/receptionist) collecting cash-in-hand at booking time IS the
    // verification step — the same authority verify-deposit.usecase.ts grants them
    // post-creation. We walk the real FSM (pending_deposit → pending_verification →
    // confirmed) rather than setting 'confirmed' by fiat, so a future change to
    // TRANSITIONS can't silently desync this shortcut from the documented state machine.
    // Customer-submitted payment fields are self-reported and unverified (no payment
    // gateway exists), so customers are never eligible — they still go through
    // upload-receipt → staff verify like today.
    const isTrustedStaff = input.createdByRole === 'owner' || input.createdByRole === 'receptionist';
    const paymentRecorded = !!input.depositMethod && input.depositMethod !== 'NONE';
    const depositSatisfied = paymentRecorded && depositAmount >= requiredDeposit;
    const isFullyPaidUpfront = paymentRecorded && totalCollected >= finalPrice;
    const autoVerifyEligible = isTrustedStaff && (depositSatisfied || isFullyPaidUpfront);

    let initialStatus: 'draft' | 'pending_deposit' | 'confirmed';
    if (autoVerifyEligible) {
      assertTransition('pending_deposit', 'pending_verification');
      assertTransition('pending_verification', 'confirmed');
      initialStatus = 'confirmed';
    } else {
      initialStatus = input.createdByRole === 'receptionist' ? 'draft' : 'pending_deposit';
    }

    const deposit_status = !paymentRecorded
      ? 'NOT_PAID'
      : isFullyPaidUpfront
        ? 'FULLY_PAID'
        : 'DEPOSIT_PAID';

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

    // ── Insert equipment rental lines ──────────────────────────
    for (const line of equipmentLines) {
      await client.query(
        `INSERT INTO booking_equipment
           (booking_id, equipment_id, quantity, hourly_price_snap, hours, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bookingId, line.equipmentId, line.quantity, line.hourlyPrice, hours, line.subtotal]
      );
    }

    // ── Resolve payment record state ────────────────────────────
    // Mirrors the same payment_status chain verify-deposit.usecase.ts walks;
    // we just walk it here, atomically, because the "verification" already
    // happened (a trusted staff member collected the money in person).
    let paymentStatus: 'deposit_pending' | 'deposit_approved' | 'paid_in_full' = 'deposit_pending';
    let verifiedBy:     string | null = null;
    let verifiedAt:     Date   | null = null;
    let balancePaidBy:  string | null = null;
    let balancePaidAt:  Date   | null = null;

    if (autoVerifyEligible) {
      assertPaymentTransition('deposit_pending', 'deposit_approved');
      paymentStatus = 'deposit_approved';
      verifiedBy    = input.createdBy;
      verifiedAt    = new Date();

      if (isFullyPaidUpfront) {
        assertPaymentTransition('deposit_approved', 'remaining_balance_pending');
        assertPaymentTransition('remaining_balance_pending', 'paid_in_full');
        paymentStatus = 'paid_in_full';
        balancePaidBy = input.createdBy;
        balancePaidAt = new Date();
      }
    }

    // ── Insert payment record ──────────────────────────────────
    await client.query(
      `INSERT INTO payments
         (booking_id, club_id, customer_id, status, deposit_amount, total_amount,
          verified_by, verified_at, balance_paid_by, balance_paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        bookingId, input.clubId, input.customerId, paymentStatus, depositAmount, totalPrice,
        verifiedBy, verifiedAt, balancePaidBy, balancePaidAt,
      ]
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
        equipmentTotal,
        equipment:       equipmentLines.map((l) => `${l.quantity}× ${l.name}`),
        status:          initialStatus,
      },
    });

    if (autoVerifyEligible) {
      await auditLog({
        clubId:     input.clubId,
        userId:     input.createdBy,
        userRole:   input.createdByRole,
        ipAddress:  input.ipAddress,
        deviceInfo: input.deviceInfo,
        actionType: AUDIT_ACTIONS.DEPOSIT_APPROVED,
        entityType: 'booking',
        entityId:   bookingId,
        newValues:  { status: initialStatus, paymentStatus },
        reason:     'Self-verified at creation — staff-recorded payment collected in person',
      });
    }

    return {
      id:               bookingId,
      status:           initialStatus,
      depositAmount,
      totalPrice,
      remainingBalance,
      equipmentTotal,
    };
  });
}
