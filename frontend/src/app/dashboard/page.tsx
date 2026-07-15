'use client';

/**
 * Dashboard (screen 5.5) — staff home.
 *
 *   · KPI metrics row (today's bookings, revenue, pending verification, confirmed)
 *   · 14-day bookings trend (area line, single green series)
 *   · "Top Courts" donut — bookings split per court, categorical identity colors
 *   · Recent bookings table → opens the Booking Details panel
 *   · "New Booking" → opens the New Booking slide-over
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarPlus, CalendarCheck, Banknote, ShieldAlert, CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { StateChip, BookingStatus } from '@/components/StateChip';
import { NewBookingPanel } from '@/components/NewBookingPanel';
import { BookingDetailsPanel } from '@/components/BookingDetailsPanel';
import { catColor, SERIES_GREEN } from '@/lib/chartColors';
import type { FinancialSummary } from '@/lib/schemas';

const TIMEZONE = 'Africa/Cairo';
const TREND_DAYS = 14;

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-primary)',
  boxShadow: 'var(--shadow-md)',
};

interface BookingRow {
  id:               string;
  status:           string;
  start_time:       string;
  duration_minutes: number;
  first_name:       string;
  last_name:        string;
  court_name:       string;
  court_number:     number;
  subscription_id?: string | null;
}

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const isStaff = user?.role === 'owner' || user?.role === 'receptionist';

  // Customers have their own home — this screen is the staff cockpit.
  useEffect(() => {
    if (user && !isStaff) router.replace('/dashboard/availability');
  }, [user, isStaff, router]);

  const [todayBookings, setTodayBookings] = useState<BookingRow[]>([]);
  const [rangeBookings, setRangeBookings] = useState<BookingRow[]>([]);
  const [pendingCount, setPendingCount]   = useState(0);
  const [fin, setFin]                     = useState<FinancialSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  const [panelOpen, setPanelOpen]         = useState(false);
  const [detailsId, setDetailsId]         = useState<string | null>(null);

  const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setError('');
    try {
      const from = new Date(Date.now() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000);
      from.setHours(0, 0, 0, 0);

      const [schedRes, pendingRes, rangeRes, finRes] = await Promise.all([
        api.get(`/dashboard/schedule?date=${today}`),
        api.get('/bookings?status=pending_verification&limit=50'),
        api.get(`/bookings?from=${from.toISOString()}&to=${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}&limit=500`),
        api.get('/bookings/financial-summary'),
      ]);

      const sched = schedRes.data;
      setTodayBookings(Array.isArray(sched) ? sched : (sched?.bookings ?? []));
      setPendingCount((pendingRes.data.data ?? []).length);
      setRangeBookings(rangeRes.data.data ?? []);
      setFin(finRes.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Failed to load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { if (isStaff) load(); }, [isStaff, load]);

  // ── 14-day trend series ───────────────────────────────────────
  const trend = useMemo(() => {
    const active = rangeBookings.filter((b) => !['cancelled', 'expired'].includes(b.status));
    const byDay = new Map<string, number>();
    for (const b of active) {
      const key = format(toZonedTime(new Date(b.start_time), TIMEZONE), 'yyyy-MM-dd');
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return Array.from({ length: TREND_DAYS }, (_, i) => {
      const d = new Date(Date.now() - (TREND_DAYS - 1 - i) * 24 * 60 * 60 * 1000);
      const key = format(toZonedTime(d, TIMEZONE), 'yyyy-MM-dd');
      return { day: format(d, 'd MMM'), bookings: byDay.get(key) ?? 0 };
    });
  }, [rangeBookings]);

  // ── Top courts donut ──────────────────────────────────────────
  const topCourts = useMemo(() => {
    const active = rangeBookings.filter((b) => !['cancelled', 'expired'].includes(b.status));
    const byCourt = new Map<string, { name: string; number: number; count: number }>();
    for (const b of active) {
      const cur = byCourt.get(b.court_name) ?? { name: b.court_name, number: b.court_number, count: 0 };
      cur.count += 1;
      byCourt.set(b.court_name, cur);
    }
    // Identity color follows court number (stable), not popularity rank
    return Array.from(byCourt.values())
      .sort((a, b) => a.number - b.number)
      .map((c, i) => ({ ...c, color: catColor(i) }))
      .sort((a, b) => b.count - a.count);
  }, [rangeBookings]);

  const totalTrendBookings = trend.reduce((s, d) => s + d.bookings, 0);
  const recent = useMemo(
    () => [...rangeBookings]
      .sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time))
      .slice(0, 8),
    [rangeBookings]
  );

  if (!isStaff) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {format(toZonedTime(new Date(), TIMEZONE), 'EEEE, d MMMM yyyy')} · {user?.firstName}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setPanelOpen(true)}>
          <CalendarPlus size={14} />
          New Booking
        </button>
      </div>

      {error && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 24,
        }}>
          {error}
        </div>
      )}

      {/* ── KPI row ─────────────────────────────────────────── */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {loading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 108 }} />)
        ) : (
          <>
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stat-label">Today&apos;s bookings</span>
                <CalendarCheck size={14} style={{ color: 'var(--text-tertiary)' }} />
              </div>
              <span className="stat-value">{todayBookings.length}</span>
              <span className="stat-sub">across all courts</span>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stat-label">Revenue today</span>
                <Banknote size={14} style={{ color: 'var(--text-tertiary)' }} />
              </div>
              <span className="stat-value">{egp(fin?.totalRevenue ?? 0)}</span>
              <span className="stat-sub">
                cash {egp(fin?.totalCash ?? 0)} · digital {egp(fin?.totalDigital ?? 0)}
              </span>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stat-label">Pending verification</span>
                <ShieldAlert size={14} style={{ color: pendingCount > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }} />
              </div>
              <span className="stat-value" style={pendingCount > 0 ? { color: 'var(--warning)' } : undefined}>
                {pendingCount}
              </span>
              <span className="stat-sub">deposits awaiting review</span>
            </div>
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stat-label">Confirmed today</span>
                <CheckCircle2 size={14} style={{ color: 'var(--text-tertiary)' }} />
              </div>
              <span className="stat-value">
                {todayBookings.filter((b) => ['confirmed', 'checked_in'].includes(b.status)).length}
              </span>
              <span className="stat-sub">ready to play</span>
            </div>
          </>
        )}
      </div>

      {/* ── Charts row ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, marginBottom: 24 }}>
        {/* Bookings trend */}
        <div className="chart-card">
          <div>
            <div className="chart-title">Bookings — last {TREND_DAYS} days</div>
            <div className="chart-sub">{totalTrendBookings} total sessions</div>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_GREEN} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={SERIES_GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ stroke: 'var(--border-focus)', strokeWidth: 1 }}
                  formatter={(value) => [`${value} bookings`, null]}
                />
                <Area
                  type="monotone"
                  dataKey="bookings"
                  stroke={SERIES_GREEN}
                  strokeWidth={2}
                  fill="url(#trendFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: SERIES_GREEN, stroke: 'var(--surface)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top courts donut */}
        <div className="chart-card">
          <div>
            <div className="chart-title">Top Courts</div>
            <div className="chart-sub">bookings share · {TREND_DAYS} days</div>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : topCourts.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <span className="empty-state-title">No bookings yet</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ position: 'relative', height: 150 }}>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie
                      data={topCourts}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={46}
                      outerRadius={68}
                      paddingAngle={2}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    >
                      {topCourts.map((c) => <Cell key={c.name} fill={c.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(value, name) => [`${value} bookings`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                }}>
                  <span style={{ fontSize: 20, fontWeight: 600 }}>{totalTrendBookings}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    sessions
                  </span>
                </div>
              </div>
              {/* Legend — identity is never color-alone */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topCourts.slice(0, 5).map((c) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-secondary)', flex: 1 }} className="truncate">{c.name}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent bookings ─────────────────────────────────── */}
      <div className="chart-card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 24px 0' }}>
          <div className="chart-title">Recent bookings</div>
          <div className="chart-sub">latest activity · click a row for details</div>
        </div>
        {loading ? (
          <div style={{ padding: 24 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Court</th>
                  <th>When</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setDetailsId(b.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {b.first_name} {b.last_name}
                    </td>
                    <td>{b.court_name}</td>
                    <td>
                      {format(toZonedTime(new Date(b.start_time), TIMEZONE), 'd MMM · HH:mm')}
                    </td>
                    <td>{b.duration_minutes / 60}h</td>
                    <td><StateChip status={b.status as BookingStatus} size="sm" /></td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                      No bookings in the last {TREND_DAYS} days
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewBookingPanel open={panelOpen} onClose={() => setPanelOpen(false)} onCreated={load} />
      <BookingDetailsPanel
        open={!!detailsId}
        bookingId={detailsId}
        onClose={() => setDetailsId(null)}
        onChanged={load}
      />
    </>
  );
}
