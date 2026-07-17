'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { api } from '@/lib/api';
import { StateChip, BookingStatus } from '@/components/StateChip';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CalendarCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

const TIMEZONE = 'Africa/Cairo';

interface Booking {
  id: string;
  status: BookingStatus;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  total_price: number;
  deposit_amount: number;
  court_name: string;
  court_number: number;
  payment_status: string;
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/bookings/me');
      setBookings(data.data ?? data);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Bookings</h1>
          <p className="page-subtitle">Your upcoming and past court reservations</p>
        </div>
        <a href="/dashboard/book" className="btn btn-primary" id="new-booking-btn">
          + Book a Court
        </a>
      </div>

      <motion.div className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <table aria-label="My bookings list">
          <thead>
            <tr>
              <th>ID</th>
              <th>Court</th>
              <th>Date &amp; Time</th>
              <th>Duration</th>
              <th>Total</th>
              <th>Deposit</th>
              <th>Status</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ height: 13, width: j === 0 ? 60 : 80 }} /></td>
                  ))}
                </tr>
              ))
            ) : bookings.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    <div className="empty-state-icon"><CalendarCheck size={32} /></div>
                    <div className="empty-state-title">No bookings yet</div>
                    <p>
                      <a href="/dashboard/book" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
                        Book your first court
                      </a>
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              bookings.map((b, i) => (
                <motion.tr
                  key={b.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => router.push(`/dashboard/bookings/${b.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {b.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td style={{ fontSize: 13 }}>Court {b.court_number} · {b.court_name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {format(toZonedTime(new Date(b.start_time), TIMEZONE), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td style={{ fontSize: 13 }}>{b.duration_minutes}m</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>
                    EGP {Number(b.total_price).toFixed(2)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                    EGP {Number(b.deposit_amount).toFixed(2)}
                  </td>
                  <td><StateChip status={b.status} size="sm" /></td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {b.payment_status?.replace(/_/g, ' ')}
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
