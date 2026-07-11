'use client';

/**
 * StateChip – animated booking status badge with micro-animations.
 * Emil Kowalski style: precise colors, subtle pulse for active states.
 */
import { motion } from 'framer-motion';

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

interface StateChipProps {
  status: BookingStatus;
  size?: 'sm' | 'md';
}

export function StateChip({ status, size = 'md' }: StateChipProps) {
  const isActive = ACTIVE_STATES.includes(status);

  return (
    <motion.span
      className={`badge badge-${status}`}
      style={{ fontSize: size === 'sm' ? 10 : 11 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {isActive && (
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
