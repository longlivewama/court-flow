'use client';

/**
 * StateChip – animated booking status badge with micro-animations.
 * Emil Kowalski style: precise colors, subtle pulse for active states.
 *
 *   · confirmed        → inline SVG checkmark drawn stroke-by-stroke
 *   · pending_deposit  → additive layout pulse marking the deposit
 *                        hold-window boundary (display only — expiry is
 *                        always decided by the server's own clock, never
 *                        a client-side countdown)
 */
import { motion } from 'motion/react';
import { EASE_DRAW } from '@/lib/motion-tokens';

export type BookingStatus =
  | 'draft' | 'pending_deposit' | 'pending_verification'
  | 'confirmed' | 'checked_in' | 'completed'
  | 'cancelled' | 'no_show' | 'expired';

const STATUS_LABELS: Record<BookingStatus, string> = {
  draft:                'Draft',
  pending_deposit:      'Pending Deposit',
  pending_verification: 'Pending Verification',
  confirmed:            'Confirmed',
  checked_in:           'Checked In',
  completed:            'Completed',
  cancelled:            'Cancelled',
  no_show:              'No Show',
  expired:              'Expired',
};

const ACTIVE_STATES: BookingStatus[] = ['pending_verification', 'confirmed', 'checked_in'];

/** Green confirmation tick, stroke-drawn on mount. */
function ConfirmedCheck({ size }: { size: number }) {
  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 12 12"
      fill="none" aria-hidden style={{ flexShrink: 0 }}
    >
      <motion.path
        d="M2 6.4 L4.7 9.1 L10 3.1"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: EASE_DRAW }}
      />
    </motion.svg>
  );
}

interface StateChipProps {
  status: BookingStatus;
  size?: 'sm' | 'md';
}

export function StateChip({ status, size = 'md' }: StateChipProps) {
  const isActive = ACTIVE_STATES.includes(status);
  const isHold   = status === 'pending_deposit';

  return (
    <motion.span
      layout
      className={`badge badge-${status}`}
      style={{ fontSize: size === 'sm' ? 10 : 11 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        // Soft expanding ring marks the live deposit hold window
        ...(isHold && {
          boxShadow: [
            '0 0 0 0px rgba(242,184,75,0.30)',
            '0 0 0 5px rgba(242,184,75,0)',
          ],
        }),
      }}
      transition={{
        type: 'spring', stiffness: 400, damping: 25,
        ...(isHold && {
          boxShadow: { duration: 1.8, repeat: Infinity, ease: 'easeOut' },
        }),
      }}
    >
      {status === 'confirmed' ? (
        <ConfirmedCheck size={size === 'sm' ? 9 : 10} />
      ) : isActive && (
        <motion.span
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'currentColor', flexShrink: 0,
          }}
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {STATUS_LABELS[status] ?? status}
    </motion.span>
  );
}
