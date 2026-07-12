'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { StateChip, BookingStatus } from '@/components/StateChip';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Filter, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

const TIMEZONE = 'Africa/Cairo';

interface Booking {
  id: string; status: BookingStatus; start_time: string; end_time: string;
  duration_minutes: number; total_price: number; deposit_amount: number;
  first_name: string; last_name: string; customer_email: string;
  court_name: string; court_number: number; payment_status: string;
}

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending_deposit', label: 'Pending Deposit' },
  { value: 'pending_verification', label: 'Pending Verification' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No Show' },
];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/bookings?${params}`);
      setBookings(data.data ?? data);
    } catch {} finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? bookings.filter((b) =>
        `${b.first_name} ${b.last_name} ${b.customer_email} ${b.court_name}`
          .toLowerCase().includes(search.toLowerCase())
      )
    : bookings;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">Manage all court reservations</p>
        </div>
        <a href="/dashboard/book" className="btn btn-primary" id="new-booking-btn">
          + New Booking
        </a>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            placeholder="Search customer, email, court…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
            aria-label="Search bookings"
          />
        </div>

        <select
          className="input"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ width: 200 }}
          aria-label="Filter by status"
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <motion.div className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <table aria-label="Bookings list">
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Court</th>
              <th>Date & Time</th>
              <th>Duration</th>
              <th>Total</th>
              <th>Deposit</th>
              <th>Status</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ height: 13, width: j === 0 ? 60 : 80 }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    <div className="empty-state-icon">📅</div>
                    <div className="empty-state-title">No bookings found</div>
                    <p>Try adjusting your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((b, i) => (
                <motion.tr
                  key={b.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => router.push(`/dashboard/bookings/${b.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {b.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 13 }}>
                      {b.first_name ?? 'Unknown'} {b.last_name ?? 'User'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{b.customer_email || '—'}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>Court {b.court_number ?? '?'} · {b.court_name ?? 'N/A'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {format(toZonedTime(new Date(b.start_time), TIMEZONE), 'dd/MM HH:mm')}
                  </td>
                  <td style={{ fontSize: 13 }}>{b.duration_minutes}m</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>
                    EGP {Number(b.total_price ?? 0).toFixed(2)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                    EGP {Number(b.deposit_amount ?? 0).toFixed(2)}
                  </td>
                  <td><StateChip status={b.status} size="sm" /></td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {b.payment_status?.replace(/_/g, ' ') ?? '—'}
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
