'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, CheckCircle, Clock, AlertCircle,
  Banknote, Smartphone, Percent, TrendingUp,
  RefreshCw, BarChart2, PieChart as PieChartIcon
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { StateChip } from '@/components/StateChip';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { FinancialSummary, AnalyticsPlot, PaymentDistributionSlice } from '@/lib/schemas';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const TIMEZONE  = 'Africa/Cairo';
const SPRING    = { type: 'spring' as const, stiffness: 320, damping: 28 };

interface DashboardStats {
  todayBookings:   number;
  pendingVerify:   number;
  confirmedToday:  number;
  noshowToday:     number;
}

interface TodayBooking {
  id:               string;
  status:           string;
  start_time:       string;
  duration_minutes: number;
  first_name:       string;
  last_name:        string;
  court_name:       string;
  payment_status:   string;
}

// ── Formatting & Config ───────────────────────────────────────────────────────
function egp(n: number) {
  return `EGP ${n.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PAYMENT_COLORS: Record<string, string> = {
  CASH: '#3b82f6',         // Blue/Sky
  VODAFONE_CASH: '#ec4899',// Magenta/Rose
  INSTAPAY: '#8b5cf6',     // Violet/Indigo
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: '💵 CASH',
  VODAFONE_CASH: '📱 VODAFONE_CASH',
  INSTAPAY: '💸 INSTAPAY',
};

// ── Financial widget card ────────────────────────────────────────────────────
interface FinCardProps {
  label:      string;
  value:      string;
  sub?:       string;
  icon:       React.ReactNode;
  gradient:   string;
  glow:       string;
  delay?:     number;
}

function FinCard({ label, value, sub, icon, gradient, glow, delay = 0 }: FinCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay }}
      style={{
        position: 'relative',
        borderRadius: 16,
        padding: '22px 24px',
        background: gradient,
        boxShadow: `0 8px 32px ${glow}, 0 1px 0 rgba(255,255,255,0.06) inset`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -20, right: -20,
          width: 100, height: 100,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'rgba(255,255,255,0.7)',
          }}
        >
          {label}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 0 }}>{icon}</span>
      </div>

      <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
        {value}
      </div>

      {sub && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: -4 }}>
          {sub}
        </div>
      )}
    </motion.div>
  );
}

// ── Skeleton cards ───────────────────────────────────────────────────────────
function FinCardSkeleton({ gradient, glow }: { gradient: string; glow: string }) {
  return (
    <div
      style={{
        borderRadius: 16, padding: '22px 24px',
        background: gradient,
        boxShadow: `0 8px 32px ${glow}`,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ height: 11, width: 90, borderRadius: 6, background: 'rgba(255,255,255,0.15)' }} />
      <div style={{ height: 28, width: 140, borderRadius: 8, background: 'rgba(255,255,255,0.2)' }} />
      <div style={{ height: 11, width: 110, borderRadius: 6, background: 'rgba(255,255,255,0.12)' }} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore();

  const [stats,    setStats]    = useState<DashboardStats | null>(null);
  const [bookings, setBookings] = useState<TodayBooking[]>([]);
  const [fin,      setFin]      = useState<FinancialSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [finLoad,  setFinLoad]  = useState(true);
  const [statsError, setStatsError] = useState('');
  const [finError,   setFinError]   = useState('');

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsPlot | null>(null);
  const [analyticsLoad, setAnalyticsLoad] = useState(true);
  const [rangeDays, setRangeDays] = useState<number>(30);

  const isStaff = user?.role === 'owner' || user?.role === 'receptionist';
  const isOwner = user?.role === 'owner';
  const today   = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

  // Client-only clock: avoids a hydration mismatch, since the server-rendered
  // shell and the client's first pre-effect render must produce identical output.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // ── Booking stats ─────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setStatsError('');
      try {
        const [schedRes, pendingRes] = await Promise.all([
          api.get(`/dashboard/schedule?date=${today}`),
          api.get('/bookings?status=pending_verification&limit=5'),
        ]);
        // Response shape: { bookings, blockedPeriods }; fall back to old plain array
        const schedData = schedRes.data;
        const schedule: TodayBooking[] = Array.isArray(schedData)
          ? schedData
          : (schedData?.bookings ?? []);
        setBookings(schedule.slice(0, 8));
        setStats({
          todayBookings:  schedule.length,
          pendingVerify:  pendingRes.data.data?.length ?? 0,
          confirmedToday: schedule.filter((b) => b.status === 'confirmed').length,
          noshowToday:    schedule.filter((b) => b.status === 'no_show').length,
        });
      } catch (err: unknown) {
        const axErr = err as { response?: { data?: { message?: string } } };
        setStatsError(axErr?.response?.data?.message ?? 'Failed to load today\u2019s schedule.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [today]);

  // ── Financial summary (staff only) ────────────────────────────
  useEffect(() => {
    if (!isStaff) { setFinLoad(false); return; }
    async function loadFin() {
      setFinError('');
      try {
        const { data } = await api.get('/bookings/financial-summary');
        setFin(data);
      } catch (err: unknown) {
        const axErr = err as { response?: { data?: { message?: string } } };
        setFinError(axErr?.response?.data?.message ?? 'Failed to load financial summary.');
      } finally {
        setFinLoad(false);
      }
    }
    loadFin();
  }, [isStaff]);

  function refreshFin() {
    setFinLoad(true);
    setFin(null);
    setFinError('');
    api.get('/bookings/financial-summary')
      .then(({ data }) => setFin(data))
      .catch((err: unknown) => {
        const axErr = err as { response?: { data?: { message?: string } } };
        setFinError(axErr?.response?.data?.message ?? 'Failed to refresh financial data.');
      })
      .finally(() => setFinLoad(false));
  }

  // ── Visual Analytics (owner only) ─────────────────────────────
  useEffect(() => {
    if (!isOwner) { setAnalyticsLoad(false); return; }
    let isMounted = true;
    setAnalyticsLoad(true);
    api.get(`/bookings/analytics-plots?range_days=${rangeDays}`)
      .then(({ data }) => { if (isMounted) setAnalytics(data); })
      .catch(() => {})
      .finally(() => { if (isMounted) setAnalyticsLoad(false); });
    return () => { isMounted = false; };
  }, [isOwner, rangeDays]);

  // Total calculation for the Donut chart
  const grandTotalRevenue = useMemo(() => {
    if (!analytics?.paymentDistribution) return 0;
    return analytics.paymentDistribution.reduce((sum, item) => sum + item.value, 0);
  }, [analytics]);

  // ── Stat cards (top row) ─────────────────────────────────────
  const statCards = [
    { label: "Today's Bookings", value: stats?.todayBookings ?? 0,  icon: <Calendar size={18} />,    color: 'var(--info)' },
    { label: 'Confirmed',        value: stats?.confirmedToday ?? 0,  icon: <CheckCircle size={18} />, color: 'var(--success)' },
    { label: 'Pending Verify',   value: stats?.pendingVerify ?? 0,   icon: <Clock size={18} />,       color: 'var(--warning)' },
    { label: 'No Shows',         value: stats?.noshowToday ?? 0,     icon: <AlertCircle size={18} />, color: 'var(--error)' },
  ];

  // ── Financial widget config ───────────────────────────────────
  const finCards: FinCardProps[] = [
    {
      label:    "Total Day Revenue",
      value:    fin ? egp(fin.totalRevenue) : '—',
      sub:      fin ? `${fin.totalBookings} active booking${fin.totalBookings !== 1 ? 's' : ''}` : undefined,
      icon:     <TrendingUp size={18} />,
      gradient: 'linear-gradient(135deg, #059669 0%, #065f46 100%)',
      glow:     'rgba(5,150,105,0.35)',
      delay:    0,
    },
    {
      label:    "Cash in Drawer",
      value:    fin ? egp(fin.totalCash) : '—',
      sub:      'Physical cash received today',
      icon:     <Banknote size={18} />,
      gradient: 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)',
      glow:     'rgba(37,99,235,0.35)',
      delay:    0.06,
    },
    {
      label:    "Digital Wallets",
      value:    fin ? egp(fin.totalDigital) : '—',
      sub:      fin
        ? `Vodafone ${egp(fin.totalVodafoneCash)} · InstaPay ${egp(fin.totalInstapay)}`
        : 'Vodafone Cash + InstaPay',
      icon:     <Smartphone size={18} />,
      gradient: 'linear-gradient(135deg, #db2777 0%, #7c1d5a 100%)',
      glow:     'rgba(219,39,119,0.35)',
      delay:    0.12,
    },
    {
      label:    "Discounts Applied",
      value:    fin ? egp(fin.totalDiscounts) : '—',
      sub:      'Total deductions — staff leakage monitor',
      icon:     <Percent size={18} />,
      gradient: 'linear-gradient(135deg, #d97706 0%, #78350f 100%)',
      glow:     'rgba(217,119,6,0.35)',
      delay:    0.18,
    },
  ];

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <h1 className="page-title">
              Good {now ? (now.getHours() < 12 ? 'morning' : 'afternoon') : 'day'},{' '}
              {user?.firstName}
            </h1>
            <p className="page-subtitle">
              {now ? format(toZonedTime(now, TIMEZONE), 'EEEE, dd MMMM yyyy') : ' '} · Africa/Cairo
            </p>
          </div>
          {/* Dynamic Range Filter Selector for Owner */}
          {isOwner && (
            <div style={{ display: 'flex', gap: 8, background: 'var(--bg-secondary)', padding: 4, borderRadius: 8 }}>
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => setRangeDays(days)}
                  className={`btn btn-sm ${rangeDays === days ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, padding: '6px 12px', height: 'auto', minHeight: 0 }}
                >
                  Past {days} Days
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Visual Analytics (Owner Only) ────────────────────────── */}
      {isOwner && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ marginBottom: 36 }}
          aria-label="Visual Analytics"
        >
          {/* Charts Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            {/* Component A — Payment Distribution */}
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <PieChartIcon size={18} style={{ color: 'var(--text-secondary)' }} />
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Payment Distribution</h3>
              </div>
              
              {analyticsLoad ? (
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', height: 240 }}>
                  <div className="skeleton" style={{ width: 180, height: 180, borderRadius: '50%' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="skeleton" style={{ height: 40, borderRadius: 8 }} />
                    ))}
                  </div>
                </div>
              ) : analytics ? (
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', height: '100%', minHeight: 240 }}>
                  <div style={{ position: 'relative', width: 220, height: 220, flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analytics.paymentDistribution}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={70}
                          outerRadius={100}
                          stroke="none"
                        >
                          {analytics.paymentDistribution.map((entry: PaymentDistributionSlice, index: number) => (
                            <Cell key={`cell-${index}`} fill={PAYMENT_COLORS[entry.name] || '#ccc'} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: any) => egp(value as number)}
                          contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: 13, color: 'var(--text-primary)' }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerEvents: 'none' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Revenue</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                        {egp(grandTotalRevenue)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Explicit Totals Grid/Legend */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 200 }}>
                    {analytics.paymentDistribution.map((item: PaymentDistributionSlice) => (
                      <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: PAYMENT_COLORS[item.name] || '#ccc' }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                            {PAYMENT_LABELS[item.name] || item.name}
                          </span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {egp(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
                  Failed to load analytics
                </div>
              )}
            </div>

            {/* Component B — Hourly Peak Traffic */}
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <BarChart2 size={18} style={{ color: 'var(--text-secondary)' }} />
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Hourly Peak Traffic</h3>
              </div>
              
              {analyticsLoad ? (
                <div className="skeleton" style={{ flex: 1, minHeight: 240, borderRadius: 12 }} />
              ) : analytics ? (
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.hourlyPeakTraffic} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#047857" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <XAxis 
                        dataKey="hour" 
                        tickLine={false} 
                        axisLine={false} 
                        tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                        dy={10}
                      />
                      <YAxis 
                        tickLine={false} 
                        axisLine={false} 
                        tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} 
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--bg-secondary)', opacity: 0.4 }}
                        contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: 13, color: 'var(--text-primary)' }}
                        itemStyle={{ color: 'var(--text-primary)' }}
                        formatter={(value: any) => [`${value as number} bookings`, 'Traffic']}
                        labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                      />
                      <Bar 
                        dataKey="bookingsCount" 
                        fill="url(#emeraldGradient)" 
                        radius={[4, 4, 0, 0]} 
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
                  Failed to load traffic data
                </div>
              )}
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Stats error banner ────────────────────────────────── */}
      {statsError && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={14} />
          {statsError}
        </div>
      )}

      {/* ── Booking stat cards ──────────────────────────────────── */}
      <div className="stat-grid" style={{ marginBottom: 32 }}>
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            className="stat-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: (isOwner ? 0.2 : 0) + (i * 0.06) }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-label">{card.label}</span>
              <span style={{ color: card.color, opacity: 0.8 }}>{card.icon}</span>
            </div>
            {loading
              ? <div className="skeleton" style={{ width: 60, height: 36, marginTop: 4 }} />
              : <div className="stat-value">{card.value}</div>}
          </motion.div>
        ))}
      </div>

      {/* ── Cash-Flow Breakdown (staff only) ────────────────────── */}
      {isStaff && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{ marginBottom: 36 }}
          aria-label="Financial summary"
        >
          {/* Section header */}
          <div
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 16,
            }}
          >
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                Cash Flow — Today
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                Live aggregation · {now ? format(toZonedTime(now, TIMEZONE), 'EEEE dd MMM yyyy') : ' '}
              </p>
            </div>
            <button
              onClick={refreshFin}
              disabled={finLoad}
              className="btn btn-ghost btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: finLoad ? 0.5 : 1 }}
              title="Refresh financial data"
            >
              <RefreshCw
                size={13}
                style={{ animation: finLoad ? 'spin 0.9s linear infinite' : 'none' }}
              />
              Refresh
            </button>
          </div>

          {/* Financial cards grid */}
          {finError && (
            <div style={{
              background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
              borderRadius: 8, padding: '10px 16px', marginBottom: 16,
              fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <AlertCircle size={14} />
              {finError}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            {finLoad
              ? finCards.map((c) => (
                  <FinCardSkeleton key={c.label} gradient={c.gradient} glow={c.glow} />
                ))
              : finCards.map((c) => <FinCard key={c.label} {...c} />)}
          </div>

          {/* Divider sub-breakdown for digital wallets */}
          {!finLoad && fin && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
              style={{
                marginTop: 16,
                padding: '14px 20px',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 24,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Wallet Breakdown
              </span>
              {[
                { label: '📱 Vodafone Cash', value: fin.totalVodafoneCash },
                { label: '⚡ InstaPay',      value: fin.totalInstapay },
                { label: '💵 Cash',          value: fin.totalCash },
                { label: '🏷️ Discounts',    value: fin.totalDiscounts },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)', fontWeight: 700,
                      fontSize: 14, color: 'var(--text-primary)',
                    }}
                  >
                    {egp(value)}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </motion.section>
      )}

      {/* ── Today's bookings table ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: isStaff ? 0.4 : 0.2 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Today's Bookings</h2>
          <a href="/dashboard/schedule" className="btn btn-secondary btn-sm">
            View Schedule
          </a>
        </div>

        <div className="table-wrap">
          <table aria-label="Today's bookings">
            <thead>
              <tr>
                <th>Time</th>
                <th>Customer</th>
                <th>Court</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}>
                        <div className="skeleton" style={{ height: 14, width: j === 0 ? 50 : 80 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : bookings.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                    No bookings today
                  </td>
                </tr>
              ) : (
                bookings.map((booking) => (
                  <tr
                    key={booking.id}
                    onClick={() => { window.location.href = `/dashboard/bookings/${booking.id}`; }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                      {format(toZonedTime(new Date(booking.start_time), TIMEZONE), 'HH:mm')}
                    </td>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {booking.first_name} {booking.last_name}
                    </td>
                    <td>{booking.court_name}</td>
                    <td>{booking.duration_minutes} min</td>
                    <td><StateChip status={booking.status as any} size="sm" /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {booking.payment_status?.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
