/**
 * Cancel Booking use case.
 *
 * A single, concurrency-safe entry point for BOTH customer self-service
 * cancellations and staff/owner overrides. It:
 *   1. Locks the booking row (FOR UPDATE) so concurrent cancels can't double-act.
 *   2. Authorises the actor (customers may only cancel their own booking).
 *   3. Applies the club's configurable time-window refund policy, with an
 *      optional staff override (force refund / force forfeit).
 *   4. Frees the court slot by moving the booking to 'cancelled'.
 *   5. Settles the money: marks the payment fully_refunded / forfeited and
 *      appends an immutable REFUND or FORFEIT_INCOME ledger entry so the
 *      Finance dashboard stays accurate (cancelled bookings never inflate
 *      revenue; genuinely-retained deposits are still counted, as income).
 *   6. Writes a rich, immutable BOOKING_CANCELLED audit event.
 *   7. Routes a freed prime-time slot to the top waitlist entry (anti-scalping).
 *   8. Fires best-effort email + WhatsApp alerts AFTER commit.
 */
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { randomBytes, createHash } from 'crypto';
import { withTransaction } from '../../infrastructure/database/client';
import { auditLogStrict, AUDIT_ACTIONS } from '../../infrastructure/audit/audit.service';
import { recordLedgerEntryStrict, LEDGER_ENTRY_TYPES } from '../../infrastructure/finance/ledger.service';
import { emailService } from '../../infrastructure/email/email.service';
import { whatsappService } from '../../infrastructure/whatsapp/whatsapp.service';
import { isPrimeTime, WAITLIST_HOLD_MINUTES } from '../../domain/booking/prime-time';
import { NotFoundError, ForbiddenError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';

const TIMEZONE = 'Africa/Cairo';
const TERMINAL_STATUSES = ['cancelled', 'completed', 'no_show', 'expired'];

export type CancelActorRole = 'owner' | 'receptionist' | 'customer' | 'coach';
export type RefundOverride = 'auto' | 'refund' | 'forfeit';
export type RefundOutcome = 'REFUNDED' | 'FORFEITED' | 'NOT_APPLICABLE' | 'PARTIAL';

export interface CancelBookingInput {
  bookingId:       string;
  clubId:          string;
  actorId:         string;
  actorRole:       CancelActorRole;
  reason?:         string;
  /** Staff-only. Ignored for customers/coaches. Defaults to 'auto' (deadline policy). */
  refundOverride?: RefundOverride;
  ipAddress?:      string;
  deviceInfo?:     string;
}

export interface CancelBookingResult {
  bookingId:       string;
  status:          'cancelled';
  courtName:       string;
  refundStatus:    RefundOutcome;
  refundAmount:    number;
  collectedAmount: number;
  afterDeadline:   boolean;
  cancelledAt:     string;
}

function formatTimeslot(start: Date, end: Date): string {
  return `${format(toZonedTime(start, TIMEZONE), 'EEE dd MMM yyyy · HH:mm')}–${format(
    toZonedTime(end, TIMEZONE), 'HH:mm'
  )}`;
}

function refundLine(outcome: RefundOutcome, amount: number): string {
  switch (outcome) {
    case 'REFUNDED':  return `Refund: EGP ${amount.toFixed(2)} will be returned`;
    case 'FORFEITED': return 'Deposit forfeited (cancelled after the deadline)';
    case 'PARTIAL':   return `Partial refund: EGP ${amount.toFixed(2)}`;
    default:          return 'No payment was collected — nothing to refund';
  }
}

export async function cancelBooking(input: CancelBookingInput): Promise<CancelBookingResult> {
  const isStaff = input.actorRole === 'owner' || input.actorRole === 'receptionist';

  // Populated inside the txn; dispatched only after a durable commit.
  interface HoldOffer {
    to: string; firstName: string; courtName: string;
    startTime: Date; token: string; expiresAt: Date;
  }
  interface CancelNotify {
    to: string; firstName: string; phone: string | null; bookingId: string;
    startTime: Date; endTime: Date; courtName: string;
    refundStatus: RefundOutcome; refundAmount: number;
  }
  let holdOffer: HoldOffer | null = null;
  let notify: CancelNotify | null = null;
  let result!: CancelBookingResult;

  await withTransaction(async (client) => {
    // ── 1. Lock the booking row ──────────────────────────────────────────────
    const { rows } = await client.query<{
      id: string; status: string; customer_id: string; court_id: string;
      start_time: Date; end_time: Date; total_price: string;
      deposit_amount: string; deposit_method: string | null;
      remainder_amount: string; remainder_method: string | null;
      deposit_status: string; court_name: string;
    }>(
      `SELECT b.id, b.status, b.customer_id, b.court_id, b.start_time, b.end_time,
              b.total_price, b.deposit_amount, b.deposit_method,
              b.remainder_amount, b.remainder_method, b.deposit_status,
              COALESCE(c.name, 'Court') AS court_name
       FROM bookings b
       LEFT JOIN courts c ON c.id = b.court_id
       WHERE b.id = $1 AND b.club_id = $2 AND b.deleted_at IS NULL
       FOR UPDATE OF b`,
      [input.bookingId, input.clubId]
    );
    if (!rows.length) throw new NotFoundError('Booking', input.bookingId);
    const booking = rows[0];

    // ── 2. Authorisation ─────────────────────────────────────────────────────
    if (input.actorRole === 'customer' && booking.customer_id !== input.actorId) {
      throw new ForbiddenError('You can only cancel your own bookings');
    }
    if (input.actorRole === 'coach') {
      throw new ForbiddenError('Coaches cannot cancel court bookings');
    }

    // ── 3. Terminal-state guard (idempotency / race safety) ──────────────────
    if (TERMINAL_STATUSES.includes(booking.status)) {
      throw new ValidationError(`This booking is already '${booking.status}' and cannot be cancelled again`);
    }

    // ── 4. Configurable time-window policy ───────────────────────────────────
    const { rows: clubRows } = await client.query<{ cancellation_deadline_hours: number }>(
      `SELECT cancellation_deadline_hours FROM clubs WHERE id = $1`, [input.clubId]
    );
    const deadlineHours = clubRows[0]?.cancellation_deadline_hours ?? 24;
    const deadline      = new Date(booking.start_time.getTime() - deadlineHours * 60 * 60 * 1000);
    const afterDeadline = new Date() > deadline;

    // ── 5. What was actually collected? (mirrors the Finance COLLECTED formula
    //     exactly, so revenue and refunds can never diverge) ──────────────────
    const depositCollected =
      booking.deposit_method && booking.deposit_method !== 'NONE' ? Number(booking.deposit_amount) : 0;
    const remainderCollected =
      booking.remainder_method && booking.remainder_method !== 'NONE' ? Number(booking.remainder_amount) : 0;
    const collectedAmount = Math.round((depositCollected + remainderCollected) * 100) / 100;

    // ── 6. Refund decision ───────────────────────────────────────────────────
    // Staff may override the automatic deadline policy (goodwill refund, or a
    // forced forfeit). Customers always follow the deadline policy.
    const override: RefundOverride = isStaff ? (input.refundOverride ?? 'auto') : 'auto';
    let refundStatus: RefundOutcome;
    let refundAmount = 0;

    if (collectedAmount <= 0) {
      refundStatus = 'NOT_APPLICABLE';
    } else {
      const decision =
        override === 'refund'  ? 'refund' :
        override === 'forfeit' ? 'forfeit' :
        afterDeadline          ? 'forfeit' : 'refund';
      if (decision === 'refund') {
        refundStatus = 'REFUNDED';
        refundAmount = collectedAmount;
      } else {
        refundStatus = 'FORFEITED';
        refundAmount = 0;
      }
    }

    const cancelledAt = new Date();

    // ── 7. Free the court slot ───────────────────────────────────────────────
    await client.query(
      `UPDATE bookings
         SET status = 'cancelled', cancelled_at = $2, cancellation_reason = $3,
             cancelled_by = $4, cancelled_by_role = $5,
             refund_status = $6, refund_amount = $7, updated_at = NOW()
       WHERE id = $1`,
      [
        booking.id, cancelledAt, input.reason ?? null,
        input.actorId, input.actorRole, refundStatus, refundAmount,
      ]
    );

    // ── 8. Settle the payment + write the ledger entry ───────────────────────
    const { rows: paymentRows } = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [booking.id]
    );
    const payment = paymentRows[0] ?? null;

    if (refundStatus === 'REFUNDED') {
      if (payment) {
        await client.query(
          `UPDATE payments SET status = 'fully_refunded', updated_at = NOW() WHERE id = $1`,
          [payment.id]
        );
      }
      await recordLedgerEntryStrict(client, {
        clubId: input.clubId, entryType: LEDGER_ENTRY_TYPES.REFUND, direction: 'DEBIT',
        amount: refundAmount, bookingId: booking.id, paymentId: payment?.id ?? null,
        courtName: booking.court_name,
        reason: input.reason ?? `Cancellation refund (${override === 'refund' ? 'staff override' : 'within policy window'})`,
        createdBy: input.actorId, createdByRole: input.actorRole,
        metadata: {
          collectedAmount, afterDeadline, deadlineHours,
          override, cancelledByRole: input.actorRole,
        },
      });
    } else if (refundStatus === 'FORFEITED') {
      if (payment) {
        await client.query(
          `UPDATE payments SET status = 'forfeited', updated_at = NOW() WHERE id = $1`,
          [payment.id]
        );
      }
      await recordLedgerEntryStrict(client, {
        clubId: input.clubId, entryType: LEDGER_ENTRY_TYPES.FORFEIT_INCOME, direction: 'CREDIT',
        amount: collectedAmount, bookingId: booking.id, paymentId: payment?.id ?? null,
        courtName: booking.court_name,
        reason: input.reason ?? `Deposit forfeited on cancellation (${override === 'forfeit' ? 'staff override' : 'after deadline'})`,
        createdBy: input.actorId, createdByRole: input.actorRole,
        metadata: {
          collectedAmount, afterDeadline, deadlineHours,
          override, cancelledByRole: input.actorRole,
        },
      });
    }

    // ── 9. Immutable audit event with the full financial picture ─────────────
    await auditLogStrict(client, {
      clubId: input.clubId, userId: input.actorId, userRole: input.actorRole,
      ipAddress: input.ipAddress, deviceInfo: input.deviceInfo,
      actionType: AUDIT_ACTIONS.BOOKING_CANCELLED, entityType: 'booking', entityId: booking.id,
      previousValues: { status: booking.status },
      newValues: {
        status:                'cancelled',
        bookingId:             booking.id,
        courtName:             booking.court_name,
        cancellationReason:    input.reason ?? null,
        cancelledByRole:       input.actorRole,
        cancelledByUserId:     input.actorId,
        originalDepositAmount: Number(booking.deposit_amount),
        collectedAmount,
        refundStatus,
        refundAmount,
        afterDeadline,
        deadlineHours,
        cancelledAt:           cancelledAt.toISOString(),
      },
      reason: input.reason ?? undefined,
    });

    // ── 10. Anti-scalping: route a freed prime-time slot to the waitlist ─────
    const slotIsUpcoming = new Date(booking.start_time).getTime() > Date.now();
    if (slotIsUpcoming && isPrimeTime(new Date(booking.start_time))) {
      const { rows: topEntry } = await client.query<{
        id: string; user_id: string; email: string; first_name: string;
      }>(
        `SELECT w.id, w.user_id, u.email, u.first_name
         FROM waitlist_entries w
         JOIN users u ON u.id = w.user_id
         WHERE w.club_id = $1
           AND w.fulfilled_at IS NULL
           AND (w.court_id IS NULL OR w.court_id = $2)
           AND w.desired_start < $4::timestamptz
           AND w.desired_end   > $3::timestamptz
           AND w.user_id <> $5
         ORDER BY w.created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [input.clubId, booking.court_id, booking.start_time, booking.end_time, booking.customer_id]
      );

      if (topEntry.length) {
        const entry     = topEntry[0];
        const token     = randomBytes(24).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + WAITLIST_HOLD_MINUTES * 60 * 1000);

        const { rows: holdRows } = await client.query<{ id: string }>(
          `INSERT INTO slot_holds (club_id, court_id, user_id, start_time, end_time, token_hash, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [input.clubId, booking.court_id, entry.user_id, booking.start_time, booking.end_time, tokenHash, expiresAt]
        );
        await client.query(`UPDATE waitlist_entries SET fulfilled_at = NOW() WHERE id = $1`, [entry.id]);

        await auditLogStrict(client, {
          clubId: input.clubId, userId: input.actorId, userRole: input.actorRole,
          ipAddress: input.ipAddress, actionType: AUDIT_ACTIONS.SLOT_HOLD_CREATED,
          entityType: 'slot_hold', entityId: holdRows[0].id,
          newValues: {
            waitlistEntryId: entry.id, heldFor: entry.user_id, courtId: booking.court_id,
            startTime: booking.start_time, expiresAt: expiresAt.toISOString(),
            cancelledBookingId: booking.id,
          },
          reason: 'Prime-time cancellation routed to the waitlist instead of the public pool',
        });

        holdOffer = {
          to: entry.email, firstName: entry.first_name, courtName: booking.court_name,
          startTime: new Date(booking.start_time), token, expiresAt,
        };
      }
    }

    // ── 11. Load member contact for the after-commit notifications ───────────
    const { rows: custRows } = await client.query<{ email: string; first_name: string; phone: string | null }>(
      `SELECT email, first_name, phone FROM users WHERE id = $1`, [booking.customer_id]
    );
    if (custRows.length) {
      notify = {
        to: custRows[0].email, firstName: custRows[0].first_name, phone: custRows[0].phone,
        bookingId: booking.id, startTime: booking.start_time, endTime: booking.end_time,
        courtName: booking.court_name, refundStatus, refundAmount,
      };
    }

    result = {
      bookingId: booking.id, status: 'cancelled', courtName: booking.court_name,
      refundStatus, refundAmount, collectedAmount, afterDeadline,
      cancelledAt: cancelledAt.toISOString(),
    };
  });

  // ── 12. Best-effort notifications, strictly AFTER commit ───────────────────
  // The `as` assertions defeat TS control-flow narrowing: these vars are only
  // assigned inside the transaction closure, which TS can't see (same pattern
  // used across the booking use cases).
  const offer = holdOffer as HoldOffer | null;
  if (offer) {
    emailService.sendWaitlistSlotOffer(offer).catch(() => { /* logged in the service */ });
  }

  const n = notify as CancelNotify | null;
  if (n) {
    const humanRefund =
      n.refundStatus === 'REFUNDED'  ? `Refund of EGP ${n.refundAmount.toFixed(2)} approved` :
      n.refundStatus === 'FORFEITED' ? 'Deposit forfeited (after cancellation deadline)' :
      n.refundStatus === 'PARTIAL'   ? `Partial refund of EGP ${n.refundAmount.toFixed(2)}` :
                                       'No payment on file';

    emailService.sendBookingCancellation({
      to: n.to, firstName: n.firstName, bookingId: n.bookingId,
      startTime: n.startTime, refundStatus: humanRefund,
    }).catch((err) => logger.warn({ err, bookingId: n.bookingId }, 'Cancellation email failed; cancellation preserved'));

    whatsappService.sendBookingCancelled(input.clubId, n.bookingId, {
      phone: n.phone ?? '', name: n.firstName, courtName: n.courtName,
      timeslot: formatTimeslot(n.startTime, n.endTime),
      refundLine: refundLine(n.refundStatus, n.refundAmount),
    }).catch((err) => logger.warn({ err, bookingId: n.bookingId }, 'Cancellation WhatsApp failed; cancellation preserved'));
  }

  return result;
}
