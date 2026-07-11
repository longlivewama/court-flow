'use client';

/**
 * Receptionist deposit verification queue.
 * Displays bookings in 'pending_verification' status with approve/reject actions.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

interface PendingBooking {
  id: string; first_name: string; last_name: string; customer_email: string;
  court_name: string; start_time: string; deposit_amount: number; total_price: number;
  payment_id: string;
}

export default function VerifyPage() {
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ bookingId: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/bookings?status=pending_verification&limit=50');
      setBookings(data.data ?? data);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(bookingId: string) {
    setProcessing(bookingId);
    try {
      await api.patch(`/bookings/${bookingId}/verify`, { action: 'approve' });
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    } catch {} finally { setProcessing(null); }
  }

  async function handleReject(bookingId: string) {
    setProcessing(bookingId);
    try {
      await api.patch(`/bookings/${bookingId}/verify`, {
        action: 'reject', rejectionReason,
      });
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      setRejectDialog(null);
      setRejectionReason('');
    } catch {} finally { setProcessing(null); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Verify Deposits</h1>
          <p className="page-subtitle">{bookings.length} bookings awaiting verification</p>
        </div>
      </div>

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
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}
              >
                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
                    {b.first_name} {b.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {b.customer_email}
                  </div>
                </div>

                {/* Court & time */}
                <div style={{ minWidth: 140 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{b.court_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {format(toZonedTime(new Date(b.start_time), TIMEZONE), 'dd/MM HH:mm')}
                  </div>
                </div>

                {/* Amounts */}
                <div style={{ minWidth: 100, textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    EGP {Number(b.deposit_amount).toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    of EGP {Number(b.total_price).toFixed(2)}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
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
