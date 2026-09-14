'use client';

/**
 * CancelBookingButton – a self-contained "Cancel Booking" action + confirmation
 * modal usable anywhere a full booking record is on screen (the customer
 * booking-detail page, admin views, …). It encapsulates:
 *   • the client-side refund/forfeit estimate (server returns the truth),
 *   • the mandatory-reason rule for staff,
 *   • the staff-only refund override,
 *   • the PATCH /bookings/:id/cancel call and a reactive onCancelled() callback.
 *
 * The authoritative refund outcome always comes back from the server; the
 * estimate here is purely to set expectations before the click.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { XCircle, Ban } from 'lucide-react';
import { api } from '@/lib/api';

const DEFAULT_DEADLINE_HOURS = 24;
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

interface CancelBookingButtonProps {
  bookingId:        string;
  status:           string;
  startTime:        string;
  depositAmount:    number | string;
  depositMethod?:   string | null;
  remainderAmount?: number | string;
  remainderMethod?: string | null;
  isStaff:          boolean;
  /** Fired after a successful cancellation so the parent can refetch. */
  onCancelled:      () => void;
  className?:       string;
}

const TERMINAL = ['cancelled', 'completed', 'no_show', 'expired'];

export function CancelBookingButton({
  bookingId, status, startTime, depositAmount, depositMethod,
  remainderAmount = 0, remainderMethod, isStaff, onCancelled, className,
}: CancelBookingButtonProps) {
  const [open, setOpen]       = useState(false);
  const [reason, setReason]   = useState('');
  const [override, setOverride] = useState<'auto' | 'refund' | 'forfeit'>('auto');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  // "Now" for the pre-cancel estimate below — a lazy useState initializer
  // (allowed to be impure; it only runs once, at mount) refreshed from the
  // "Cancel" button's own click handler (also allowed — purity rules only
  // constrain the render body itself) each time the confirm modal opens.
  const [now, setNow]         = useState(() => Date.now());

  if (TERMINAL.includes(status)) return null;

  const collected =
    (depositMethod && depositMethod !== 'NONE' ? Number(depositAmount) : 0) +
    (remainderMethod && remainderMethod !== 'NONE' ? Number(remainderAmount) : 0);
  const hoursUntilStart = (new Date(startTime).getTime() - now) / 3_600_000;
  const afterDeadline   = hoursUntilStart < DEFAULT_DEADLINE_HOURS;
  const outcome: 'none' | 'refund' | 'forfeit' =
    collected <= 0          ? 'none'
    : override === 'refund' ? 'refund'
    : override === 'forfeit' ? 'forfeit'
    : afterDeadline         ? 'forfeit'
    : 'refund';

  async function confirm() {
    if (busy) return; // guards against a duplicate mutation from a double-click
    if (isStaff && !reason.trim()) { setError('A cancellation reason is required.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/bookings/${bookingId}/cancel`, {
        reason: reason.trim() || undefined,
        ...(isStaff && override !== 'auto' ? { refundOverride: override } : {}),
      });
      setOpen(false);
      setReason('');
      setOverride('auto');
      onCancelled();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Cancellation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.button
        type="button"
        className={className ?? 'btn btn-danger btn-sm'}
        onClick={() => { setNow(Date.now()); setOpen(true); }}
        whileTap={{ scale: 0.97 }}
        aria-label="Cancel this booking"
      >
        <Ban size={14} />
        Cancel Booking
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="overlay-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !busy && setOpen(false)}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ban size={16} style={{ color: 'var(--error)' }} />
                Cancel Booking
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                This releases the court slot immediately. The action is recorded in
                the immutable audit log.
              </p>

              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">
                  Reason for cancellation {isStaff ? '(required)' : '(optional)'}
                </label>
                <textarea
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Change of plans / double booking…"
                  rows={3}
                  aria-label="Cancellation reason"
                />
              </div>

              {isStaff && collected > 0 && (
                <div className="input-group" style={{ marginBottom: 14 }}>
                  <label className="input-label">Deposit handling</label>
                  <select
                    className="input"
                    value={override}
                    onChange={(e) => setOverride(e.target.value as 'auto' | 'refund' | 'forfeit')}
                    aria-label="Deposit handling"
                  >
                    <option value="auto">Auto (apply deadline policy)</option>
                    <option value="refund">Force full refund (goodwill)</option>
                    <option value="forfeit">Force forfeit deposit</option>
                  </select>
                </div>
              )}

              <div style={{
                fontSize: 12.5, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, marginBottom: 16,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              }}>
                {outcome === 'none' && 'No payment was collected — nothing to refund.'}
                {outcome === 'refund' && `Your deposit of EGP ${collected.toFixed(0)} will be refunded.`}
                {outcome === 'forfeit' && `Cancelling within ${DEFAULT_DEADLINE_HOURS}h of start — the deposit of EGP ${collected.toFixed(0)} will be forfeited.`}
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                  color: '#ef4444', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <XCircle size={15} /> {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
                  Keep booking
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={confirm}
                  disabled={busy || (isStaff && !reason.trim())}
                >
                  {busy ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <Ban size={13} />}
                  Confirm Cancellation
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
