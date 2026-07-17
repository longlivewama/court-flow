'use client';

/**
 * Receptionist Check-In page.
 * Shows today's confirmed bookings and allows instant check-in.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserCheck, Clock, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 28 };

interface Booking {
  id: string; first_name: string; last_name: string; customer_email: string;
  court_name: string; court_number: number; start_time: string;
  duration_minutes: number; total_price: number; deposit_amount: number;
  status: string;
}

export default function CheckInPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [actionError, setActionError] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());

  const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/dashboard/schedule?date=${today}`);
      // Response shape: { bookings, blockedPeriods }; fall back to old plain array
      const schedule: Booking[] = Array.isArray(data) ? data : (data?.bookings ?? []);
      const confirmed = schedule.filter((b) => b.status === 'confirmed');
      setBookings(confirmed);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to load check-in list.');
    } finally { setLoading(false); }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  async function handleCheckIn(bookingId: string) {
    setProcessing(bookingId);
    setActionError('');
    try {
      await api.patch(`/bookings/${bookingId}/checkin`);
      setCheckedIn((prev) => new Set([...prev, bookingId]));
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setActionError(axErr?.response?.data?.message ?? 'Failed to check in this booking.');
    } finally { setProcessing(null); }
  }

  const filtered = search
    ? bookings.filter((b) =>
        `${b.first_name} ${b.last_name} ${b.customer_email} ${b.court_name}`
          .toLowerCase().includes(search.toLowerCase())
      )
    : bookings;

  const now = toZonedTime(new Date(), TIMEZONE);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Check In</h1>
          <p className="page-subtitle">
            {format(now, 'EEEE dd/MM/yyyy')} · {filtered.length} bookings awaiting check-in
          </p>
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

      {/* Quick search */}
      <div style={{ position: 'relative', maxWidth: 400, marginBottom: 24 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
        <input
          className="input"
          placeholder="Search customer name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 36 }}
          aria-label="Search customers"
          autoFocus
        />
      </div>

      {/* Checked-in counter */}
      {checkedIn.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--success-bg)', border: '1px solid var(--success-border)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 20,
            fontSize: 13, color: 'var(--success)',
          }}
        >
          <UserCheck size={14} />
          {checkedIn.size} customer{checkedIn.size > 1 ? 's' : ''} checked in this session
        </motion.div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="skeleton" style={{ height: 14, width: 80 + j * 20 }} />
              ))}
            </div>
          ))}
        </div>
      ) : filtered.length === 0 && !search ? (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ fontSize: 48 }}>🎾</div>
          <div className="empty-state-title">No bookings awaiting check-in</div>
          <p>All confirmed bookings for today have been handled.</p>
        </div>
      ) : (
        <AnimatePresence>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((b, i) => {
              const startCairo = toZonedTime(new Date(b.start_time), TIMEZONE);
              const minutesUntil = Math.round((startCairo.getTime() - now.getTime()) / 60000);
              const isOverdue = minutesUntil < 0;
              const isImminent = minutesUntil <= 15 && minutesUntil >= 0;

              return (
                <motion.div
                  key={b.id}
                  className="card"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24, height: 0 }}
                  transition={{ ...SPRING, delay: i * 0.03 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
                    borderColor: isOverdue ? 'var(--error-border)' : isImminent ? 'var(--warning-border)' : 'var(--border)',
                  }}
                >
                  {/* Time indicator */}
                  <div style={{ minWidth: 64, textAlign: 'center' }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700,
                      color: isOverdue ? 'var(--error)' : isImminent ? 'var(--warning)' : 'var(--text-primary)',
                    }}>
                      {format(startCairo, 'HH:mm')}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                      <Clock size={9} />
                      {isOverdue ? `${Math.abs(minutesUntil)}m ago` : `in ${minutesUntil}m`}
                    </div>
                  </div>

                  {/* Customer info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
                      {b.first_name} {b.last_name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{b.customer_email}</div>
                  </div>

                  {/* Court */}
                  <div style={{ minWidth: 100 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Court {b.court_number}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{b.duration_minutes} min</div>
                  </div>

                  {/* Amount due */}
                  <div style={{ minWidth: 90, textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>Balance due</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                      EGP {(Number(b.total_price) - Number(b.deposit_amount)).toFixed(2)}
                    </div>
                  </div>

                  {/* Check-in button */}
                  <motion.button
                    className="btn btn-primary"
                    onClick={() => handleCheckIn(b.id)}
                    disabled={processing === b.id}
                    whileTap={{ scale: 0.96 }}
                    style={{ minWidth: 110, justifyContent: 'center' }}
                    id={`checkin-${b.id}`}
                    aria-label={`Check in ${b.first_name} ${b.last_name}`}
                  >
                    {processing === b.id ? (
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                    ) : (
                      <><UserCheck size={14} /> Check In</>
                    )}
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
