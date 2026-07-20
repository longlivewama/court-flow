/**
 * Payment Gateway Webhook Receiver — POST /api/payments/webhook
 *
 * Automated escape hatch from "receipt approval purgatory": when the payment
 * provider confirms an online deposit, the booking is transitioned to
 * 'confirmed' through the real state machine with no staff involvement.
 *
 * Security model (unauthenticated endpoint, defense in depth):
 *   1. HMAC-SHA256 signature over a canonical field string, verified with a
 *      constant-time compare (global JSON body-parsing means the raw bytes
 *      are gone by the time we run, so we sign canonical fields — the same
 *      contract the simulated provider signs).
 *   2. Replay window: the signed timestamp must be within ±5 minutes.
 *   3. Idempotency: provider_event_id is UNIQUE in payment_webhook_events;
 *      a replayed delivery short-circuits to 200 without touching state.
 *   4. State machine: only pending_deposit / pending_verification bookings
 *      transition, and only along documented FSM edges (assertTransition).
 */
import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { withTransaction } from '../../../infrastructure/database/client';
import { assertTransition, assertPaymentTransition } from '../../../domain/booking/booking.state-machine';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { emailService } from '../../../infrastructure/email/email.service';
import { logger } from '../../../shared/logger';
import { UnauthorizedError, ValidationError } from '../../../shared/errors';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Fail fast at startup when the webhook secret is missing in production.
 * Called from the bootstrap sequence (index.ts) so a misconfigured production
 * server refuses to start rather than silently accepting webhooks signed with
 * the well-known development default — which would let anyone forge a
 * 'payment.succeeded' event and confirm arbitrary bookings for free.
 * Mirrors the fatal-on-missing-key contract in jwt.service.ts.
 */
export function assertWebhookSecretConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.PAYMENT_WEBHOOK_SECRET) {
    throw new Error(
      '[payment-webhook] PAYMENT_WEBHOOK_SECRET must be set in production. ' +
      'Refusing to start with the well-known development default.'
    );
  }
}

function webhookSecret(): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (secret) return secret;
  // Defense in depth: even if the startup guard above was somehow bypassed,
  // never fall back to the public default secret in production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[payment-webhook] PAYMENT_WEBHOOK_SECRET is not configured');
  }
  logger.warn('PAYMENT_WEBHOOK_SECRET is not set — using the dev-only default. Set it in production.');
  return 'dev-webhook-secret-change-me';
}

const payloadSchema = z.object({
  eventId:   z.string().min(8).max(255),
  type:      z.literal('payment.succeeded'),
  bookingId: z.string().uuid(),
  amount:    z.number().positive(),
  timestamp: z.number().int(),   // epoch milliseconds, signed by the provider
});

/** Canonical string both sides sign: eventId.type.bookingId.amount.timestamp */
export function canonicalPayload(p: z.infer<typeof payloadSchema>): string {
  return `${p.eventId}.${p.type}.${p.bookingId}.${p.amount}.${p.timestamp}`;
}

export function signPayload(canonical: string): string {
  return createHmac('sha256', webhookSecret()).update(canonical).digest('hex');
}

// ── POST /api/payments/webhook ────────────────────────────────
export async function handlePaymentWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = payloadSchema.parse(req.body);

    // 1. Signature check (constant-time)
    const provided = String(req.headers['x-webhook-signature'] ?? '');
    const expected = signPayload(canonicalPayload(payload));
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new UnauthorizedError('Invalid webhook signature');
    }

    // 2. Replay window
    if (Math.abs(Date.now() - payload.timestamp) > REPLAY_WINDOW_MS) {
      throw new UnauthorizedError('Webhook timestamp outside the accepted window');
    }

    interface ConfirmationEmail {
      to: string; firstName: string; startTime: Date;
      depositAmount: number; totalPrice: number;
    }
    interface WebhookOutcome {
      bookingStatus: string; paymentStatus: string; duplicate: boolean;
      email: ConfirmationEmail | null;
    }

    const result = await withTransaction<WebhookOutcome>(async (client) => {
      // 3. Idempotency — a replayed event id is a silent success
      const { rows: eventRows } = await client.query<{ id: string }>(
        `INSERT INTO payment_webhook_events (provider_event_id, booking_id, event_type, amount, payload)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_event_id) DO NOTHING
         RETURNING id`,
        [payload.eventId, payload.bookingId, payload.type, payload.amount, JSON.stringify(payload)]
      );
      if (!eventRows.length) {
        return { bookingStatus: 'unchanged', paymentStatus: 'unchanged', duplicate: true, email: null };
      }

      // 4. Load + lock the booking, then walk the FSM.
      // Multi-tenant: the webhook is unauthenticated, so the tenant scope is
      // derived from the booking row itself — the HMAC signature already
      // proves the gateway vouches for this exact booking id.
      const { rows: bookingRows } = await client.query<{
        id: string; status: string; customer_id: string; start_time: Date;
        total_price: string; discount_amount: string; deposit_amount: string;
        club_id: string;
      }>(
        `SELECT id, status, customer_id, start_time, total_price, discount_amount, deposit_amount, club_id
         FROM bookings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [payload.bookingId]
      );
      if (!bookingRows.length) throw new ValidationError('Unknown booking for webhook event');
      const booking = bookingRows[0];

      if (booking.status !== 'pending_deposit' && booking.status !== 'pending_verification') {
        // Paid twice / already confirmed / cancelled — record but do not mutate
        logger.warn({ bookingId: booking.id, status: booking.status }, 'Webhook for a non-pending booking ignored');
        return { bookingStatus: booking.status, paymentStatus: 'unchanged', duplicate: false, email: null };
      }

      // Walk the documented FSM edges rather than setting 'confirmed' by fiat
      if (booking.status === 'pending_deposit') {
        assertTransition('pending_deposit', 'pending_verification');
      }
      assertTransition('pending_verification', 'confirmed');

      const finalPrice = Math.max(Number(booking.total_price) - Number(booking.discount_amount), 0);
      const fullyPaid  = payload.amount >= finalPrice;

      await client.query(
        `UPDATE bookings
           SET status = 'confirmed',
               deposit_status = $2,
               deposit_method = 'ONLINE',
               deposit_amount = $3,
               expires_at = NULL,
               updated_at = NOW()
         WHERE id = $1`,
        [booking.id, fullyPaid ? 'FULLY_PAID' : 'DEPOSIT_PAID', payload.amount]
      );

      assertPaymentTransition('deposit_pending', 'deposit_approved');
      let paymentStatus = 'deposit_approved';
      if (fullyPaid) {
        assertPaymentTransition('deposit_approved', 'remaining_balance_pending');
        assertPaymentTransition('remaining_balance_pending', 'paid_in_full');
        paymentStatus = 'paid_in_full';
      }
      // verified_by stays NULL — this verification was performed by the
      // gateway, not a staff member.
      await client.query(
        `UPDATE payments
           SET status = $2, verified_at = NOW(),
               balance_paid_at = CASE WHEN $3 THEN NOW() ELSE balance_paid_at END,
               updated_at = NOW()
         WHERE booking_id = $1`,
        [booking.id, paymentStatus, fullyPaid]
      );

      await auditLog({
        clubId: booking.club_id,
        actionType: AUDIT_ACTIONS.PAYMENT_WEBHOOK_PROCESSED,
        entityType: 'booking', entityId: booking.id,
        newValues: {
          eventId: payload.eventId, amount: payload.amount,
          from: booking.status, to: 'confirmed', paymentStatus,
        },
        reason: 'Automated payment gateway confirmation — no staff intervention',
      });

      const { rows: custRows } = await client.query<{ email: string; first_name: string }>(
        `SELECT email, first_name FROM users WHERE id = $1`, [booking.customer_id]
      );
      const email: ConfirmationEmail | null = custRows.length
        ? {
            to: custRows[0].email, firstName: custRows[0].first_name,
            startTime: booking.start_time,
            depositAmount: payload.amount, totalPrice: Number(booking.total_price),
          }
        : null;

      return { bookingStatus: 'confirmed', paymentStatus, duplicate: false, email };
    });

    // Best-effort confirmation email after the transaction has committed
    if (result.email) {
      emailService.sendBookingConfirmation({ ...result.email, bookingId: payload.bookingId })
        .catch((err) => logger.warn({ err, bookingId: payload.bookingId }, 'Webhook confirmation email failed'));
    }

    res.status(200).json({
      received:      true,
      bookingStatus: result.bookingStatus,
      paymentStatus: result.paymentStatus,
      duplicate:     result.duplicate,
    });
  } catch (err) { next(err); }
}
