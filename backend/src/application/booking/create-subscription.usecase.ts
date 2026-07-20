/**
 * Create VIP Subscription Use Case
 *
 * A subscription is a fixed weekly reservation (same court, same weekday and
 * hour) for a 1- or 3-month term. Every weekly occurrence is materialised as a
 * regular `bookings` row pointing back at the subscription, so the existing
 * conflict-checking, check-in, cancellation, and reporting machinery all work
 * on subscription slots without special-casing.
 *
 * All occurrences are validated and inserted inside ONE transaction: if any
 * week conflicts with an existing booking or blocked period, the entire
 * subscription is rejected with the offending date so the club never sells a
 * "weekly" slot that silently skips weeks.
 *
 * Financial model: VIP slots are club-billed (invoice / pay-at-club) with a
 * zero deposit and the full slot price outstanding, settled per visit through
 * the normal payment flow.
 *
 * Authorization model: STAFF ONLY. A subscription mints 4–12 confirmed,
 * club-billed court reservations at once, so a self-serve customer could use it
 * to lock weeks of inventory for free. Access is restricted to owner/receptionist
 * at the route (routes.ts) and re-checked here as defense in depth — a member
 * arranges a VIP slot by asking the front desk, who provision it on their behalf
 * (setting it up IS the verification step, mirroring create-booking.usecase.ts).
 */
import { PoolClient } from 'pg';
import { withTransaction } from '../../infrastructure/database/client';
import { validateBookingSlot } from '../../domain/booking/booking.validator';
import { auditLog, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { ValidationError, ConflictError, ForbiddenError } from '../../shared/errors';

const STAFF_ROLES = ['owner', 'receptionist'];

const WEEKS_PER_MONTH = 4;

export interface CreateSubscriptionInput {
  clubId:          string;
  courtId:         string;
  customerId:      string;
  createdBy:       string;
  createdByRole:   string;
  firstStartTime:  Date;
  durationMinutes: number;
  termMonths:      1 | 3;
  notes?:          string;
  ipAddress?:      string;
  deviceInfo?:     string;
}

export interface SubscriptionResult {
  id:           string;
  status:       string;
  occurrences:  number;
  weeklyPrice:  number;
  monthlyPrice: number;
  firstStartTime: string;
  lastStartTime:  string;
  bookingIds:   string[];
}

export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<SubscriptionResult> {
  // Staff-only invariant (also enforced at the route). Never trust the caller
  // to have been gated upstream — a subscription creates confirmed inventory,
  // so a non-staff actor reaching here is a hard authorization failure.
  if (!STAFF_ROLES.includes(input.createdByRole)) {
    throw new ForbiddenError('Only club staff can create subscriptions.');
  }
  if (input.termMonths !== 1 && input.termMonths !== 3) {
    throw new ValidationError('Subscription term must be 1 or 3 months');
  }
  if (input.firstStartTime.getTime() < Date.now()) {
    throw new ValidationError('First session must be in the future.');
  }

  const occurrences = input.termMonths * WEEKS_PER_MONTH;

  return withTransaction(async (client: PoolClient) => {
    // Pessimistic lock on the court serialises concurrent subscription and
    // booking creation, exactly like create-booking.usecase.ts.
    await client.query(`SELECT id FROM courts WHERE id = $1 FOR UPDATE`, [input.courtId]);

    const { rows: courtRows } = await client.query<{ price_per_slot: string; name: string }>(
      `SELECT price_per_slot, name FROM courts WHERE id = $1 AND club_id = $2`,
      [input.courtId, input.clubId]
    );
    if (!courtRows.length) throw new ValidationError('Court not found');

    const pricePerSlot = Number(courtRows[0].price_per_slot);
    const weeklyPrice  = Math.round(pricePerSlot * (input.durationMinutes / 60) * 100) / 100;

    const { rows: clubRows } = await client.query<{ deposit_percent: number }>(
      `SELECT deposit_percent FROM clubs WHERE id = $1`,
      [input.clubId]
    );
    if (!clubRows.length) throw new ValidationError('Club not found');
    const depositPercent = clubRows[0].deposit_percent;

    // Staff always bypass the working-hours gate (they can book any hour).
    const isAdminRole = STAFF_ROLES.includes(input.createdByRole);

    // ── Validate every weekly occurrence up front ──────────────
    const starts: Date[] = Array.from({ length: occurrences }, (_, i) =>
      new Date(input.firstStartTime.getTime() + i * 7 * 24 * 60 * 60 * 1000)
    );

    for (const start of starts) {
      try {
        await validateBookingSlot(client, {
          clubId:             input.clubId,
          courtId:            input.courtId,
          startTime:          start,
          durationMinutes:    input.durationMinutes,
          bypassWorkingHours: isAdminRole,
        });
      } catch (err) {
        if (err instanceof ConflictError || err instanceof ValidationError) {
          throw new ConflictError(
            `Week of ${start.toISOString().slice(0, 10)} is unavailable — ${err.message}`
          );
        }
        throw err;
      }
    }

    // ── Insert the subscription record ─────────────────────────
    const { rows: subRows } = await client.query<{ id: string }>(
      `INSERT INTO subscriptions
         (club_id, customer_id, court_id, created_by, status,
          first_start_time, duration_minutes, term_months, occurrences,
          price_per_slot_snap, weekly_price)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.clubId, input.customerId, input.courtId, input.createdBy,
        input.firstStartTime.toISOString(), input.durationMinutes,
        input.termMonths, occurrences, pricePerSlot, weeklyPrice,
      ]
    );
    const subscriptionId = subRows[0].id;

    // ── Materialise each occurrence as a confirmed booking ─────
    // Confirmed by fiat is safe here: only staff reach this use case (guarded at
    // the route and again at the top), and a staff member setting up the VIP
    // arrangement IS the verification step.
    const bookingIds: string[] = [];
    for (const start of starts) {
      const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000);

      const { rows: bookingRows } = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (club_id, court_id, customer_id, created_by, status,
            start_time, end_time, duration_minutes,
            total_price, deposit_percent_snap, deposit_amount, remaining_balance,
            notes, deposit_status, deposit_method, remainder_amount, remainder_method,
            discount_amount, admin_notes, processed_by_id, subscription_id)
         VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,0,$8,$10,'NOT_PAID','NONE',0,'NONE',0,NULL,$11,$12)
         RETURNING id`,
        [
          input.clubId, input.courtId, input.customerId, input.createdBy,
          start.toISOString(), end.toISOString(), input.durationMinutes,
          weeklyPrice, depositPercent,
          input.notes ?? 'VIP weekly subscription',
          input.createdBy, subscriptionId,
        ]
      );
      const bookingId = bookingRows[0].id;
      bookingIds.push(bookingId);

      await client.query(
        `INSERT INTO payments
           (booking_id, club_id, customer_id, status, deposit_amount, total_amount)
         VALUES ($1,$2,$3,'deposit_pending',0,$4)`,
        [bookingId, input.clubId, input.customerId, weeklyPrice]
      );
    }

    await auditLog({
      clubId:     input.clubId,
      userId:     input.createdBy,
      userRole:   input.createdByRole,
      ipAddress:  input.ipAddress,
      deviceInfo: input.deviceInfo,
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
      entityType: 'subscription',
      entityId:   subscriptionId,
      newValues: {
        courtId:         input.courtId,
        customerId:      input.customerId,
        firstStartTime:  input.firstStartTime.toISOString(),
        durationMinutes: input.durationMinutes,
        termMonths:      input.termMonths,
        occurrences,
        weeklyPrice,
      },
    });

    return {
      id:             subscriptionId,
      status:         'active',
      occurrences,
      weeklyPrice,
      monthlyPrice:   Math.round(weeklyPrice * WEEKS_PER_MONTH * 100) / 100,
      firstStartTime: starts[0].toISOString(),
      lastStartTime:  starts[starts.length - 1].toISOString(),
      bookingIds,
    };
  });
}
