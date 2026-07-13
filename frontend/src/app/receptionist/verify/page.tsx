'use client';

/**
 * Deposit verification queue (receptionist + owner).
 * Every 'pending_verification' booking is shown with its uploaded deposit
 * receipt image side-by-side with the customer's self-reported payment
 * metadata (amount paid + payment method) so staff can verify the transfer
 * and confirm the booking in one glance.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Eye, Wallet, CreditCard, Phone, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ReceiptViewer } from '@/components/ReceiptViewer';

const TIMEZONE = 'Africa/Cairo';
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

interface PendingBooking {
  id: string; first_name: string; last_name: string; customer_email: string;
  customer_phone?: string | null;
  court_name: string; start_time: string; end_time: string; duration_minutes: number;
  deposit_amount: number; total_price: number;
  deposit_method: string; remainder_amount: number; deposit_status: string;
  payment_id: string;
}

function methodLabel(m?: string) {
  if (!m || m === 'NONE') return 'Not specified';
  return m.replace(/_/g, ' ');
}

function egp(n: number | string) {
  return `EGP ${Number(n).toFixed(2)}`;
}

export default function VerifyPage() {
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [actionError, setActionError] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ bookingId: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/bookings?status=pending_verification&limit=50');
      setBookings(data.data ?? data);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to load pending verifications.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(bookingId: string) {
    setProcessing(bookingId);
    setActionError('');
    try {
      await api.patch(`/bookings/${bookingId}/verify`, { action: 'approve' });
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setActionError(axErr?.response?.data?.message ?? 'Failed to approve deposit.');
    } finally { setProcessing(null); }
  }

  async function handleReject(bookingId: string) {
    setProcessing(bookingId);
    setActionError('');
    try {
      await api.patch(`/bookings/${bookingId}/verify`, {
        action: 'reject', rejectionReason,
      });
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      setRejectDialog(null);
      setRejectionReason('');
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setActionError(axErr?.response?.data?.message ?? 'Failed to reject deposit.');
    } finally { setProcessing(null); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Verify Deposits</h1>
          <p className="page-subtitle">{bookings.length} bookings awaiting verification</p>
        </div>
      </div>

      {/* Error banners */}
      {error && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ {error}
        </div>
      )}
      {actionError && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ {actionError}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ display: 'flex', gap: 16 }}>
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="skeleton" style={{ height: 14, width: 80 + j * 20, flex: j === 3 ? 1 : undefined }} />
              ))}
            </div>
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ fontSize: 48 }}>✅</div>
          <div className="empty-state-title">All caught up!</div>
          <p>No receipts awaiting verification.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence>
            {bookings.map((b, i) => (
              <motion.div
                key={b.id}
                className="card"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                transition={{ ...SPRING, delay: i * 0.04 }}
                style={{ display: 'flex', alignItems: 'stretch', gap: 20, padding: '18px 20px', flexWrap: 'wrap' }}
              >
                {/* ── Left: booking + self-reported payment metadata ── */}
                <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
                      {b.first_name} {b.last_name}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, color: 'var(--text-secondary)', marginTop: 4,
                      fontFamily: 'var(--font-mono)',
                    }}>
                      <Phone size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                      {b.customer_phone || 'No phone on file'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {b.customer_email}
                    </div>
                  </div>

                  {/* Court + full time slot range */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{b.court_name}</div>
                    {(() => {
                      const start = toZonedTime(new Date(b.start_time), TIMEZONE);
                      const end   = toZonedTime(new Date(b.end_time), TIMEZONE);
                      const durationMin = b.duration_minutes
                        ?? Math.round((end.getTime() - start.getTime()) / 60_000);
                      return (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 12, color: 'var(--text-secondary)', marginTop: 3,
                          fontFamily: 'var(--font-mono)',
                        }}>
                          <Clock size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                          <span>
                            {format(start, 'dd/MM/yyyy')} · {format(start, 'HH:mm')} - {format(end, 'HH:mm')}
                          </span>
                          <span style={{ color: 'var(--text-tertiary)' }}>({durationMin} min)</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Financial breakdown */}
                  {(() => {
                    const total     = Number(b.total_price);
                    const paid      = Number(b.deposit_amount) + Number(b.remainder_amount || 0);
                    const remaining = Math.max(total - paid, 0);
                    const rows: [string, string, string][] = [
                      ['Total Price',       egp(total),     'var(--text-primary)'],
                      ['Amount Paid',       egp(paid),      '#22c55e'],
                      ['Remaining Balance', egp(remaining), remaining > 0 ? '#f59e0b' : 'var(--text-tertiary)'],
                    ];
                    return (
                      <div style={{
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '10px 14px',
                        display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                        {rows.map(([label, value, color]) => (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: 'var(--font-mono)' }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Self-reported payment chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 'auto' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, color: '#22c55e',
                      background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
                      borderRadius: 999, padding: '4px 12px', fontFamily: 'var(--font-mono)',
                    }}>
                      <Wallet size={12} />
                      Reported paid: EGP {Number(b.deposit_amount).toFixed(2)}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, color: '#8b5cf6',
                      background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
                      borderRadius: 999, padding: '4px 12px',
                    }}>
                      <CreditCard size={12} />
                      {methodLabel(b.deposit_method)}
                    </span>
                  </div>
                </div>

                {/* ── Middle: deposit receipt image (side-by-side) ── */}
                <div style={{ flex: '0 1 240px', minWidth: 200 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 6,
                  }}>
                    Deposit Receipt
                  </div>
                  <ReceiptViewer bookingId={b.id} maxHeight={160} />
                </div>

                {/* ── Right: actions ── */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <a
                    href={`/dashboard/bookings/${b.id}`}
                    className="btn btn-secondary btn-sm"
                    aria-label={`View booking ${b.id}`}
                    title="View receipt"
                  >
                    <Eye size={13} />
                  </a>

                  <motion.button
                    className="btn btn-sm"
                    style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }}
                    onClick={() => handleApprove(b.id)}
                    disabled={processing === b.id}
                    whileTap={{ scale: 0.95 }}
                    aria-label={`Approve deposit for ${b.first_name}`}
                    id={`approve-${b.id}`}
                  >
                    {processing === b.id ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <CheckCircle size={13} />}
                    Approve
                  </motion.button>

                  <motion.button
                    className="btn btn-danger btn-sm"
                    onClick={() => setRejectDialog({ bookingId: b.id })}
                    disabled={processing === b.id}
                    whileTap={{ scale: 0.95 }}
                    aria-label={`Reject deposit for ${b.first_name}`}
                    id={`reject-${b.id}`}
                  >
                    <XCircle size={13} />
                    Reject
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Reject dialog */}
      <AnimatePresence>
        {rejectDialog && (
          <motion.div
            className="overlay-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={SPRING}
            >
              <h3 style={{ marginBottom: 16 }}>Reject Receipt</h3>
              <div className="input-group" style={{ marginBottom: 20 }}>
                <label className="input-label">Reason for rejection</label>
                <textarea
                  className="input"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Receipt is unclear, wrong amount…"
                  rows={3}
                  aria-label="Rejection reason"
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setRejectDialog(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleReject(rejectDialog.bookingId)}
                  disabled={!rejectionReason.trim()}
                >
                  {processing ? <div className="spinner" style={{ width: 12, height: 12 }} /> : null}
                  Confirm Rejection
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
