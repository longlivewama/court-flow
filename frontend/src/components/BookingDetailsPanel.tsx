'use client';

/**
 * Booking Details slide-over panel (screen 5.9).
 *
 * Shows the selected booking with its rented-gear breakdown, payment
 * summary, VIP subscription context, and the cancellation / check-in
 * actions permitted for the current role.
 */
import { useCallback, useEffect, useState } from 'react';
import { Repeat, LogIn, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Drawer } from '@/components/ui/Drawer';

interface EquipmentLine {
  equipment_id:      string;
  name:              string;
  category:          string;
  quantity:          number;
  hourly_price_snap: string | number;
  hours:             string | number;
  subtotal:          string | number;
}

interface BookingDetails {
  id:               string;
  status:           string;
  court_name:       string;
  court_number:     number;
  first_name:       string;
  last_name:        string;
  customer_email:   string;
  start_time:       string;
  end_time:         string;
  duration_minutes: number;
  total_price:      string | number;
  deposit_amount:   string | number;
  remainder_amount: string | number;
  discount_amount:  string | number;
  deposit_method:   string | null;
  remainder_method: string | null;
  deposit_status:   string;
  notes:            string | null;
  subscription_id:  string | null;
  subscription?:    { status: string; term_months: number; occurrences: number; weekly_price: string | number } | null;
  equipment:        EquipmentLine[];
  equipment_total:  number;
  // Cancellation outcome (populated once the booking is cancelled)
  refund_status?:      string | null;
  refund_amount?:      string | number | null;
  cancellation_reason?: string | null;
  cancelled_at?:       string | null;
}

// Client-side default; the server holds the authoritative, per-club value and
// always returns the real outcome. Used only for the pre-cancel estimate.
const DEFAULT_DEADLINE_HOURS = 24;

function refundStatusLabel(s?: string | null): { label: string; color: string } {
  switch (s) {
    case 'REFUNDED':       return { label: 'Refunded',        color: 'var(--accent-green-text)' };
    case 'FORFEITED':      return { label: 'Deposit forfeited', color: 'var(--warning)' };
    case 'PARTIAL':        return { label: 'Partially refunded', color: 'var(--warning)' };
    case 'NOT_APPLICABLE': return { label: 'No payment collected', color: 'var(--text-tertiary)' };
    default:               return { label: s ?? '—', color: 'var(--text-tertiary)' };
  }
}

const TERMINAL_STATUSES = ['cancelled', 'completed', 'no_show', 'expired'];

interface BookingDetailsPanelProps {
  open:       boolean;
  onClose:    () => void;
  bookingId:  string | null;
  /** Called after a successful cancel / check-in so lists can refetch */
  onChanged?: () => void;
}

export function BookingDetailsPanel({ open, onClose, bookingId, onChanged }: BookingDetailsPanelProps) {
  const { user } = useAuthStore();
  const isStaff = user?.role === 'owner' || user?.role === 'receptionist';

  const [booking, setBooking]   = useState<BookingDetails | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundOverride, setRefundOverride] = useState<'auto' | 'refund' | 'forfeit'>('auto');
  const [acting, setActing]     = useState(false);
  // "Now" for the pre-cancel refund estimate below — a lazy initializer
  // (allowed to be impure; runs once at mount) refreshed inside load()'s
  // async response handler each time a booking is (re)fetched, alongside
  // setBooking, rather than calling the impure Date.now() in the render body.
  const [now, setNow]           = useState(() => Date.now());

  // The bare async fetch — no synchronous setState at its start, so it's
  // safe to call directly from the open-effect below (only its .then/.catch/
  // .finally callbacks touch state, same as setBooking already did).
  const fetchBooking = useCallback(() => {
    if (!bookingId) return;
    return api.get(`/bookings/${bookingId}`)
      .then(({ data }) => { setBooking(data); setNow(Date.now()); })
      .catch(() => setError('Could not load this booking'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  // Full reload used by event handlers (cancel/check-in) after a mutation —
  // synchronously flips the loading skeleton back on first, which is fine
  // here since these only ever run from a click handler, not an effect.
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchBooking();
  }, [fetchBooking]);

  // Reset panel-local state when it opens for a (possibly new) booking.
  // Adjusted synchronously during render (React's documented alternative to
  // an effect for "reset state when a prop changes") since the panel stays
  // mounted between opens for its slide animation, so a key-based remount
  // isn't an option.
  const openBookingKey = open ? bookingId : null;
  const [prevKey, setPrevKey] = useState(openBookingKey);
  if (openBookingKey !== prevKey) {
    setPrevKey(openBookingKey);
    if (openBookingKey) {
      setBooking(null);
      setCancelMode(false);
      setCancelReason('');
      setRefundOverride('auto');
      setLoading(true);
      setError('');
    }
  }

  // The actual fetch is a genuine external-system side effect, so it stays
  // in an effect — but calls the synchronous-setState-free fetchBooking(),
  // not load(), since the loading/error reset above already covers what
  // load()'s own synchronous setState calls would otherwise duplicate here.
  useEffect(() => {
    if (open && bookingId) {
      fetchBooking();
    }
  }, [open, bookingId, fetchBooking]);

  async function cancelBooking() {
    if (!bookingId || acting) return; // guards against a duplicate mutation from a double-click
    // Staff must always give a reason (mirrors the server-side guard).
    if (isStaff && !cancelReason.trim()) {
      setError('A cancellation reason is required.');
      return;
    }
    setActing(true);
    setError('');
    try {
      await api.patch(`/bookings/${bookingId}/cancel`, {
        reason: cancelReason.trim() || undefined,
        // Only staff may override the automatic deadline policy.
        ...(isStaff && refundOverride !== 'auto' ? { refundOverride } : {}),
      });
      onChanged?.();
      load();
      setCancelMode(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Cancellation failed');
    } finally {
      setActing(false);
    }
  }

  async function checkIn() {
    if (!bookingId || acting) return; // guards against a duplicate mutation from a double-click
    setActing(true);
    setError('');
    try {
      await api.patch(`/bookings/${bookingId}/checkin`);
      onChanged?.();
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Check-in failed');
    } finally {
      setActing(false);
    }
  }

  const total     = Number(booking?.total_price ?? 0);
  const discount  = Number(booking?.discount_amount ?? 0);
  const deposit   = Number(booking?.deposit_amount ?? 0);
  const remainder = Number(booking?.remainder_amount ?? 0);
  const paid      = deposit + remainder;
  const outstanding = Math.max(total - discount - paid, 0);
  const courtSubtotal = total - (booking?.equipment_total ?? 0);

  const canCancel  = booking && !TERMINAL_STATUSES.includes(booking.status);
  const canCheckIn = isStaff && booking?.status === 'confirmed';

  // Pre-cancel refund estimate (server returns the authoritative outcome).
  const collectedEstimate =
    (booking?.deposit_method && booking.deposit_method !== 'NONE' ? deposit : 0) +
    (booking?.remainder_method && booking.remainder_method !== 'NONE' ? remainder : 0);
  const hoursUntilStart = booking
    ? (new Date(booking.start_time).getTime() - now) / 3_600_000
    : 0;
  const estimatedAfterDeadline = hoursUntilStart < DEFAULT_DEADLINE_HOURS;
  const estimatedOutcome: 'none' | 'refund' | 'forfeit' =
    collectedEstimate <= 0        ? 'none'
    : refundOverride === 'refund' ? 'refund'
    : refundOverride === 'forfeit' ? 'forfeit'
    : estimatedAfterDeadline      ? 'forfeit'
    : 'refund';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Booking Details"
      subtitle={booking ? `#${booking.id.slice(0, 8)}` : undefined}
      footer={
        booking ? (
          cancelMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="input"
                placeholder={isStaff ? 'Reason for cancellation (required)' : 'Reason for cancellation (optional)'}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                aria-label="Cancellation reason"
              />

              {/* Staff-only refund override */}
              {isStaff && collectedEstimate > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Deposit handling</label>
                  <select
                    className="input"
                    value={refundOverride}
                    onChange={(e) => setRefundOverride(e.target.value as 'auto' | 'refund' | 'forfeit')}
                    aria-label="Deposit handling"
                  >
                    <option value="auto">Auto (apply deadline policy)</option>
                    <option value="refund">Force full refund (goodwill)</option>
                    <option value="forfeit">Force forfeit deposit</option>
                  </select>
                </div>
              )}

              {/* Refund estimate */}
              <div style={{
                fontSize: 12, lineHeight: 1.5, padding: '8px 12px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}>
                {estimatedOutcome === 'none' && 'No payment was collected — nothing to refund.'}
                {estimatedOutcome === 'refund' && `Estimated outcome: EGP ${collectedEstimate.toFixed(0)} will be refunded.`}
                {estimatedOutcome === 'forfeit' && `Estimated outcome: deposit of EGP ${collectedEstimate.toFixed(0)} will be forfeited (within ${DEFAULT_DEADLINE_HOURS}h of start).`}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setCancelMode(false)} disabled={acting}>
                  Keep booking
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={cancelBooking}
                  disabled={acting || (isStaff && !cancelReason.trim())}
                >
                  {acting ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {canCancel && (
                <button className="btn btn-danger" onClick={() => setCancelMode(true)} disabled={acting}>
                  <XCircle size={14} />
                  Cancel Booking
                </button>
              )}
              {canCheckIn && (
                <button className="btn btn-primary" onClick={checkIn} disabled={acting}>
                  <LogIn size={14} />
                  {acting ? 'Checking in…' : 'Check In'}
                </button>
              )}
            </div>
          )
        ) : undefined
      }
    >
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
        </div>
      )}

      {booking && (
        <>
          {/* Status + VIP */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`badge badge-${booking.status}`}>{booking.status.replace(/_/g, ' ')}</span>
            {booking.subscription_id && (
              <span className="repeat-chip" title="Part of a weekly VIP subscription">
                <Repeat size={11} />
                WEEKLY VIP
                {booking.subscription?.term_months ? ` · ${booking.subscription.term_months}MO` : ''}
              </span>
            )}
          </div>

          {/* Cancellation outcome summary */}
          {booking.status === 'cancelled' && (
            <div className="card-sm" style={{ background: 'var(--surface-2)', borderLeft: '3px solid var(--error-border)' }}>
              <div className="price-row">
                <span>Refund status</span>
                <strong style={{ color: refundStatusLabel(booking.refund_status).color }}>
                  {refundStatusLabel(booking.refund_status).label}
                  {Number(booking.refund_amount) > 0 ? ` · EGP ${Number(booking.refund_amount).toFixed(0)}` : ''}
                </strong>
              </div>
              {booking.cancellation_reason && (
                <div className="price-row">
                  <span>Reason</span>
                  <strong style={{ textAlign: 'right', maxWidth: 220 }}>{booking.cancellation_reason}</strong>
                </div>
              )}
            </div>
          )}

          {/* Who / where / when */}
          <div className="card-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="price-row">
              <span>Member</span>
              <strong>{booking.first_name} {booking.last_name}</strong>
            </div>
            <div className="price-row">
              <span>Court</span>
              <strong>{booking.court_name}</strong>
            </div>
            <div className="price-row">
              <span>Date</span>
              <strong>
                {new Date(booking.start_time).toLocaleDateString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                })}
              </strong>
            </div>
            <div className="price-row">
              <span>Time</span>
              <strong>
                {new Date(booking.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                {' – '}
                {new Date(booking.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                {' · '}{booking.duration_minutes / 60}h
              </strong>
            </div>
          </div>

          {/* Rented gear breakdown */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Rented Equipment</div>
            {booking.equipment.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>No gear rented with this booking.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {booking.equipment.map((line) => (
                  <div key={line.equipment_id} className="addon-card">
                    <div className="addon-thumb" aria-hidden>
                      {line.category === 'racket' ? '🏓' : line.category === 'balls' ? '🎾' : '🧤'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }} className="truncate">
                        {line.quantity} × {line.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                        EGP {Number(line.hourly_price_snap).toFixed(0)}/hr × {Number(line.hours)}h
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      EGP {Number(line.subtotal).toFixed(0)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment summary */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Payment Summary</div>
            <div className="card-sm" style={{ background: 'var(--bg-elevated)' }}>
              <div className="price-row">
                <span>Court time</span>
                <strong>EGP {courtSubtotal.toFixed(0)}</strong>
              </div>
              {(booking.equipment_total ?? 0) > 0 && (
                <div className="price-row">
                  <span>Equipment rental</span>
                  <strong>EGP {Number(booking.equipment_total).toFixed(0)}</strong>
                </div>
              )}
              {discount > 0 && (
                <div className="price-row">
                  <span>Discount</span>
                  <strong style={{ color: 'var(--accent-green-text)' }}>− EGP {discount.toFixed(0)}</strong>
                </div>
              )}
              <div className="price-row">
                <span>Paid so far{booking.deposit_method && booking.deposit_method !== 'NONE' ? ` (${booking.deposit_method.toLowerCase().replace('_', ' ')})` : ''}</span>
                <strong>EGP {paid.toFixed(0)}</strong>
              </div>
              <div className="price-row total">
                <span>Outstanding</span>
                <strong style={{ color: outstanding > 0 ? 'var(--warning)' : 'var(--accent-green-text)' }}>
                  EGP {outstanding.toFixed(0)}
                </strong>
              </div>
            </div>
          </div>

          {booking.notes && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Notes</div>
              <p style={{ fontSize: 13 }}>{booking.notes}</p>
            </div>
          )}
        </>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--error-bg)', border: '1px solid var(--error-border)',
            color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </Drawer>
  );
}
