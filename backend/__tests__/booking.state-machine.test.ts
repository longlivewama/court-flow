/**
 * Booking State Machine – Unit Tests
 * Verifies all legal and illegal FSM transitions.
 */
import {
  canTransition,
  assertTransition,
  isTerminalStatus,
  getValidTransitions,
  BookingStatus,
} from '../src/domain/booking/booking.state-machine';

describe('BookingStateMachine', () => {
  describe('canTransition', () => {
    test('draft → pending_deposit (allowed)', () => {
      expect(canTransition('draft', 'pending_deposit')).toBe(true);
    });
    test('draft → confirmed (not allowed)', () => {
      expect(canTransition('draft', 'confirmed')).toBe(false);
    });
    test('pending_deposit → pending_verification (allowed)', () => {
      expect(canTransition('pending_deposit', 'pending_verification')).toBe(true);
    });
    test('pending_deposit → expired (allowed)', () => {
      expect(canTransition('pending_deposit', 'expired')).toBe(true);
    });
    test('pending_verification → confirmed (allowed)', () => {
      expect(canTransition('pending_verification', 'confirmed')).toBe(true);
    });
    test('pending_verification → pending_verification (re-upload allowed)', () => {
      expect(canTransition('pending_verification', 'pending_verification')).toBe(true);
    });
    test('confirmed → checked_in (allowed)', () => {
      expect(canTransition('confirmed', 'checked_in')).toBe(true);
    });
    test('confirmed → no_show (allowed)', () => {
      expect(canTransition('confirmed', 'no_show')).toBe(true);
    });
    test('confirmed → cancelled (allowed)', () => {
      expect(canTransition('confirmed', 'cancelled')).toBe(true);
    });
    test('checked_in → completed (allowed)', () => {
      expect(canTransition('checked_in', 'completed')).toBe(true);
    });
    test('completed → cancelled (NOT allowed – terminal)', () => {
      expect(canTransition('completed', 'cancelled')).toBe(false);
    });
    test('cancelled → confirmed (NOT allowed – terminal)', () => {
      expect(canTransition('cancelled', 'confirmed')).toBe(false);
    });
    test('no_show → confirmed (NOT allowed – terminal)', () => {
      expect(canTransition('no_show', 'confirmed')).toBe(false);
    });
    test('expired → pending_deposit (NOT allowed – terminal)', () => {
      expect(canTransition('expired', 'pending_deposit')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    test('throws ConflictError on illegal transition', () => {
      expect(() => assertTransition('completed', 'cancelled')).toThrow();
    });
    test('does not throw on legal transition', () => {
      expect(() => assertTransition('draft', 'pending_deposit')).not.toThrow();
    });
  });

  describe('isTerminalStatus', () => {
    test('completed is terminal', () => expect(isTerminalStatus('completed')).toBe(true));
    test('cancelled is terminal', () => expect(isTerminalStatus('cancelled')).toBe(true));
    test('no_show is terminal',   () => expect(isTerminalStatus('no_show')).toBe(true));
    test('expired is terminal',   () => expect(isTerminalStatus('expired')).toBe(true));
    test('confirmed is NOT terminal', () => expect(isTerminalStatus('confirmed')).toBe(false));
    test('draft is NOT terminal',     () => expect(isTerminalStatus('draft')).toBe(false));
  });

  describe('getValidTransitions', () => {
    test('confirmed has 3 valid next states', () => {
      const transitions = getValidTransitions('confirmed');
      expect(transitions).toContain('checked_in');
      expect(transitions).toContain('cancelled');
      expect(transitions).toContain('no_show');
    });
    test('completed has no valid transitions', () => {
      expect(getValidTransitions('completed')).toHaveLength(0);
    });
  });
});

import { assertPaymentTransition, PaymentStatus } from '../src/domain/booking/booking.state-machine';

describe('PaymentStateMachine', () => {
  test('deposit_pending → deposit_approved (allowed)', () => {
    expect(() => assertPaymentTransition('deposit_pending', 'deposit_approved')).not.toThrow();
  });
  test('deposit_pending → deposit_rejected (allowed)', () => {
    expect(() => assertPaymentTransition('deposit_pending', 'deposit_rejected')).not.toThrow();
  });
  test('deposit_rejected → deposit_pending (re-upload, allowed)', () => {
    expect(() => assertPaymentTransition('deposit_rejected', 'deposit_pending')).not.toThrow();
  });
  test('deposit_approved → remaining_balance_pending (allowed)', () => {
    expect(() => assertPaymentTransition('deposit_approved', 'remaining_balance_pending')).not.toThrow();
  });
  test('remaining_balance_pending → paid_in_full (allowed)', () => {
    expect(() => assertPaymentTransition('remaining_balance_pending', 'paid_in_full')).not.toThrow();
  });
  test('paid_in_full → partially_refunded (allowed)', () => {
    expect(() => assertPaymentTransition('paid_in_full', 'partially_refunded')).not.toThrow();
  });
  test('fully_refunded → paid_in_full (NOT allowed – terminal)', () => {
    expect(() => assertPaymentTransition('fully_refunded', 'paid_in_full')).toThrow();
  });
  test('deposit_pending → paid_in_full (NOT allowed – skip steps)', () => {
    expect(() => assertPaymentTransition('deposit_pending', 'paid_in_full')).toThrow();
  });
});
