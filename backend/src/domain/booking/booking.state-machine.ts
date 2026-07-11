/**
 * Booking State Machine
 * Implements the full FSM as specified in SRS §8.4 and §11.
 *
 * States:
 *   draft → pending_deposit | cancelled | expired
 *   pending_deposit → pending_verification | cancelled | expired
 *   pending_verification → confirmed | pending_verification (re-upload)
 *   confirmed → checked_in | cancelled | no_show
 *   checked_in → completed
 *   completed → (terminal)
 *   cancelled → (terminal)
 *   no_show → (terminal)
 *   expired → (terminal)
 */
import { ConflictError } from '../../shared/errors';

export type BookingStatus =
  | 'draft'
  | 'pending_deposit'
  | 'pending_verification'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';

// Valid transitions map: current state → allowed next states
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  draft:                ['pending_deposit', 'cancelled', 'expired'],
  pending_deposit:      ['pending_verification', 'cancelled', 'expired'],
  pending_verification: ['confirmed', 'pending_verification', 'cancelled'],
  confirmed:            ['checked_in', 'cancelled', 'no_show'],
  checked_in:           ['completed'],
  completed:            [],
  cancelled:            [],
  no_show:              [],
  expired:              [],
};

export function isTerminalStatus(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `Cannot transition booking from '${from}' to '${to}'.`
    );
  }
}

export function getValidTransitions(current: BookingStatus): BookingStatus[] {
  return TRANSITIONS[current];
}

// ── Payment Status Machine ────────────────────────────────────
export type PaymentStatus =
  | 'deposit_pending'
  | 'deposit_approved'
  | 'deposit_rejected'
  | 'remaining_balance_pending'
  | 'paid_in_full'
  | 'partially_refunded'
  | 'fully_refunded';

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  deposit_pending:            ['deposit_approved', 'deposit_rejected'],
  deposit_approved:           ['remaining_balance_pending', 'partially_refunded', 'fully_refunded'],
  deposit_rejected:           ['deposit_pending'],   // customer re-uploads
  remaining_balance_pending:  ['paid_in_full'],
  paid_in_full:               ['partially_refunded', 'fully_refunded'],
  partially_refunded:         ['fully_refunded'],
  fully_refunded:             [],
};

export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus
): void {
  if (!PAYMENT_TRANSITIONS[from].includes(to)) {
    throw new ConflictError(
      `Cannot transition payment from '${from}' to '${to}'.`
    );
  }
}
