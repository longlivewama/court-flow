/**
 * Create Booking Use Case
 *
 * Implements SRS §8.4 booking creation with:
 *   - Row-level pessimistic locking (SELECT … FOR UPDATE)
 *   - Deposit snapshot at creation time
 *   - Atomic DB transaction
 *   - Audit logging
 */
import { createHash } from 'crypto';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { PoolClient } from 'pg';
import { withTransaction } from '../../infrastructure/database/client';
import { validateBookingSlot } from '../../domain/booking/booking.validator';
import { assertTransition, assertPaymentTransition } from '../../domain/booking/booking.state-machine';
import { isPrimeTime, PRIME_TIME_EXPIRY_MINUTES } from '../../domain/booking/prime-time';
import { auditLogStrict, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { emailService } from '../../infrastructure/email/email.service';
import { sheetsService } from '../../infrastructure/sheets/sheets.service';
import { ValidationError, ConflictError, ForbiddenError } from '../../shared/errors';
import { logger } from '../../shared/logger';

const TIMEZONE = 'Africa/Cairo';

function formatTimeslot(start: Date, end: Date): string {
  return `${format(toZonedTime(start, TIMEZONE), 'EEE dd MMM yyyy · HH:mm')}–${format(
    toZonedTime(end, TIMEZONE), 'HH:mm'
  )}`;
}

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
  /** Single-use token proving the customer owns an active waitlist hold on this slot */
  waitlistToken?:  string;
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

interface LedgerSnapshot {
  bookingId: string;
  name:      string;
  phone:     string;
  courtName: string;
  timeslot:  string;
}

export async function createBooking(
  input: CreateBookingInput
): Promise<BookingResult> {
  // Fail-safe ledger snapshot — captured inside the txn for a consistent read,
  // then mirrored to the club sheet AFTER commit (off the request's hot path).
  let ledger: LedgerSnapshot | null = null;

  const result = await withTransaction(async (client: PoolClient) => {
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

    // ── Fetch court price (+ name for the fail-safe ledger row) ─
    const { rows: courtRows } = await client.query<{ name: string; price_per_slot: number }>(
      `SELECT name, price_per_slot FROM courts WHERE id = $1`,
      [input.courtId]
    );
    const { name: courtName, price_per_slot } = courtRows[0];

    // ── Reject past-dated customer bookings ────────────────────
    // A customer must not be able to self-book a slot whose start time has
    // already passed. Staff keep the ability to record retroactive walk-ins.
    if (input.createdByRole === 'customer' && input.startTime.getTime() < Date.now()) {
      throw new ValidationError('Start time must be in the future.');
    }

    // ── ANTI-LOCKOUT: cap customers to 1 active unpaid booking ─────────
    // Without this cap, one account can spray pending_deposit bookings across
    // every court and lock the whole club for the expiry window without ever
    // paying. The per-customer advisory lock serialises concurrent creates by
    // the same account (each create locks a different court row, so the court
    // lock alone cannot stop two parallel requests both passing the count).
    if (input.createdByRole === 'customer') {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [input.customerId]
      );
      const { rows: pendingRows } = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM bookings
         WHERE customer_id = $1
           AND club_id = $2
           AND deleted_at IS NULL
           AND status = 'pending_deposit'
           AND end_time > NOW()`,
        [input.customerId, input.clubId]
      );
      if (pendingRows[0].count >= 1) {
        throw new ConflictError(
          'You already have a booking awaiting payment. Pay its deposit (or cancel it) before reserving another slot.'
        );
      }
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

    // ── ANTI-SCALPING: honour active waitlist holds ─────────────────────
    // A cancelled prime-time slot is held for the top waitlist user for a
    // short window (see cancelBookingHandler). While a hold is active the
    // slot is NOT public: only the held user, presenting the single-use
    // token issued to them, may book it. Everyone else — including bots
    // polling availability — is rejected until the hold expires.
    const requestedEnd = new Date(input.startTime.getTime() + input.durationMinutes * 60 * 1000);
    const { rows: holdRows } = await client.query<{
      id: string; user_id: string; token_hash: string;
    }>(
      `SELECT id, user_id, token_hash
       FROM slot_holds
       WHERE court_id = $1
         AND claimed_at IS NULL
         AND expires_at > NOW()
         AND start_time < $3::timestamptz
         AND end_time   > $2::timestamptz
       ORDER BY created_at
       FOR UPDATE`,
      [input.courtId, input.startTime.toISOString(), requestedEnd.toISOString()]
    );
    let claimedHoldId: string | null = null;
    if (holdRows.length > 0) {
      const hold = holdRows[0];
      const presentedHash = input.waitlistToken
        ? createHash('sha256').update(input.waitlistToken).digest('hex')
        : null;
      const isHoldOwner  = hold.user_id === input.customerId;
      const tokenMatches = presentedHash !== null && presentedHash === hold.token_hash;
      // Staff may override a hold (walk-in at the desk beats an unclaimed hold)
      if (!isAdminRole && !(isHoldOwner && tokenMatches)) {
        throw new ForbiddenError(
          'This slot is temporarily reserved for a waitlisted member. Try again in a few minutes.'
        );
      }
      if (isHoldOwner && tokenMatches) claimedHoldId = hold.id;
    }

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

    // ── Deadlock prevention: acquire equipment locks in a strict global order ──
    // Two concurrent bookings renting the same items in *different* request
    // order (A locks racket→balls while B locks balls→racket) form a circular
    // wait, and Postgres kills one with "deadlock detected". Sorting the lines
    // by equipment UUID before locking imposes one total order on lock
    // acquisition: any transaction that waits does so only for a lock with an
    // ID ≥ every lock it already holds, so a wait-for cycle would require an
    // ID strictly greater than itself — impossible. Every code path that locks
    // multiple equipment rows must preserve this ascending-ID invariant.
    const requestedLines = [...(input.equipment ?? [])].sort((a, b) =>
      a.equipmentId < b.equipmentId ? -1 : a.equipmentId > b.equipmentId ? 1 : 0
    );

    for (const line of requestedLines) {
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

    // ── ANTI-LOCKOUT: dynamic deposit deadline ──────────────────
    // The club-wide expiry (default 2h) is generous enough to be abused as a
    // free hold on the most contested inventory. Prime-time slots (weekends
    // or weekdays from 17:00, club-local) override it down to 15 minutes —
    // pay quickly or release the slot. Off-peak keeps the configured window.
    const { pending_deposit_expiry_minutes } = settingsRows[0];
    const effectiveExpiryMinutes = isPrimeTime(input.startTime)
      ? Math.min(PRIME_TIME_EXPIRY_MINUTES, pending_deposit_expiry_minutes)
      : pending_deposit_expiry_minutes;
    const expiresAt = initialStatus === 'pending_deposit'
      ? new Date(Date.now() + effectiveExpiryMinutes * 60 * 1000)
      : null;

    // ── Insert booking ─────────────────────────────────────────
    const { rows: bookingRows } = await client.query<{ id: string }>(
      `INSERT INTO bookings
         (club_id, court_id, customer_id, created_by, status,
          start_time, end_time, duration_minutes,
          total_price, deposit_percent_snap, deposit_amount, remaining_balance, notes,
          deposit_status, deposit_method, remainder_amount, remainder_method, discount_amount, admin_notes, processed_by_id,
          expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
        input.processedById,
        expiresAt ? expiresAt.toISOString() : null,
      ]
    );
    const bookingId = bookingRows[0].id;

    // Consume the waitlist hold atomically with the booking it authorised
    if (claimedHoldId) {
      await client.query(
        `UPDATE slot_holds SET claimed_at = NOW(), booking_id = $2 WHERE id = $1`,
        [claimedHoldId, bookingId]
      );
      await auditLogStrict(client, {
        clubId: input.clubId, userId: input.createdBy, userRole: input.createdByRole,
        ipAddress: input.ipAddress, actionType: AUDIT_ACTIONS.SLOT_HOLD_CLAIMED,
        entityType: 'slot_hold', entityId: claimedHoldId,
        newValues: { bookingId },
      });
    }

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
    await auditLogStrict(client, {
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
      await auditLogStrict(client, {
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

    // ── Capture the fail-safe ledger row (synced post-commit) ──
    const { rows: contactRows } = await client.query<{ first_name: string; phone: string | null }>(
      `SELECT first_name, phone FROM users WHERE id = $1`,
      [input.customerId]
    );
    ledger = {
      bookingId,
      name:      contactRows[0]?.first_name ?? 'Member',
      phone:     contactRows[0]?.phone ?? '',
      courtName,
      timeslot:  formatTimeslot(input.startTime, endTime),
    };

    return {
      id:               bookingId,
      status:           initialStatus,
      depositAmount,
      totalPrice,
      remainingBalance,
      equipmentTotal,
    };
  });

  // ── Emergency fail-safe ledger sync (background, best-effort) ──────────────
  // Fired the instant a booking is created so owners/staff see it in the backup
  // sheet immediately, with a 'PENDING_APPROVAL' status (the later deposit
  // verification upserts the same row to 'CONFIRMED'). Deliberately NOT awaited:
  // booking creation is the customer hot path and the sheet is a backup, not a
  // source of truth — a Sheets outage must never slow or fail a committed booking.
  const l = ledger as LedgerSnapshot | null;
  if (l) {
    void sheetsService
      .syncPendingBooking(input.clubId, l.bookingId, {
        name: l.name, phone: l.phone, courtName: l.courtName,
        timeslot: l.timeslot, confirmedAt: '', channel: '',
      })
      .catch((err) =>
        logger.warn({ err, bookingId: l.bookingId }, 'Pending-booking ledger sync failed; booking preserved')
      );
  }

  return result;
}
