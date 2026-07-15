'use client';

/**
 * Analytics (screen 5.11) — owner business intelligence.
 *
 *   · KPI row incl. MRR from active VIP subscriptions
 *   · Revenue trend (6 months, bars)
 *   · Revenue split per court (donut, categorical identity colors)
 *   · Court occupancy (horizontal utilisation bars)
 *   · Member growth (line) + daily bookings (area)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { api } from '@/lib/api';
import { catColor, SERIES_GREEN } from '@/lib/chartColors';

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-primary)',
  boxShadow: 'var(--shadow-md)',
};

interface Overview {
  rangeDays: number;
  kpis: {
    revenue: number; bookings: number; uniqueCustomers: number;
    cancellations: number; newCustomers: number;
    activeSubscriptions: number; mrr: number;
  };
  bookingsPerDay:   { date: string; bookings: number; revenue: number }[];
  revenueByCourt:   { courtId: string; name: string; number: number; revenue: number }[];
  occupancyByCourt: { courtId: string; name: string; number: number; bookedHours: number; bookings: number; occupancyPct: number }[];
  revenueByMonth:   { month: string; revenue: number; bookings: number }[];
  customerGrowth:   { month: string; newCustomers: number }[];
}

const RANGES = [
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

function monthLabel(m: string): string {
  return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

export default function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData]           = useState<Overview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/analytics/overview?range_days=${rangeDays}`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load analytics.'))
      .finally(() => setLoading(false));
  }, [rangeDays]);

  // Donut slices keep court-number order for stable identity colors
  const revenueSlices = useMemo(() => {
    if (!data) return [];
    return [...data.revenueByCourt]
      .sort((a, b) => a.number - b.number)
      .map((c, i) => ({ ...c, color: catColor(i) }))
      .filter((c) => c.revenue > 0);
  }, [data]);

  const totalCourtRevenue = revenueSlices.reduce((s, c) => s + c.revenue, 0);

  const occupancy = useMemo(() => {
    if (!data) return [];
    return [...data.occupancyByCourt].sort((a, b) => a.number - b.number)
      .map((c, i) => ({ ...c, color: catColor(i) }));
  }, [data]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Revenue, occupancy and growth — verified payments only</p>
        </div>
        <div className="seg-control">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`seg-item ${rangeDays === r.days ? 'active' : ''}`}
              onClick={() => setRangeDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {loading || !data ? (
          [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
        ) : (
          <>
            <div className="stat-card">
              <span className="stat-label">Revenue · {rangeDays}d</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(data.kpis.revenue)}</span>
              <span className="stat-sub">{data.kpis.bookings} bookings</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">MRR</span>
              <span className="stat-value">{egp(data.kpis.mrr)}</span>
              <span className="stat-sub">{data.kpis.activeSubscriptions} active VIP subscriptions</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Active players</span>
              <span className="stat-value">{data.kpis.uniqueCustomers}</span>
              <span className="stat-sub">{data.kpis.newCustomers} new members</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Cancellations</span>
              <span className="stat-value">{data.kpis.cancellations}</span>
              <span className="stat-sub">in the selected range</span>
            </div>
          </>
        )}
      </div>

      {/* Row 1: revenue trend + split */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        <div className="chart-card">
          <div>
            <div className="chart-title">Revenue — last 6 months</div>
            <div className="chart-sub">collected deposits + balances</div>
          </div>
          {loading || !data ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.revenueByMonth} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                />
                <YAxis
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  labelFormatter={(m) => monthLabel(String(m))}
                  formatter={(value) => [egp(Number(value)), 'Revenue']}
                />
                <Bar dataKey="revenue" fill={SERIES_GREEN} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <div>
            <div className="chart-title">Revenue split by court</div>
            <div className="chart-sub">last {rangeDays} days</div>
          </div>
          {loading || !data ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : revenueSlices.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <span className="empty-state-title">No verified revenue yet</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ position: 'relative', height: 140 }}>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={revenueSlices}
                      dataKey="revenue"
                      nameKey="name"
                      innerRadius={42}
                      outerRadius={62}
                      paddingAngle={2}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    >
                      {revenueSlices.map((c) => <Cell key={c.courtId} fill={c.color} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [egp(Number(v)), n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{egp(totalCourtRevenue)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {revenueSlices.map((c) => (
                  <div key={c.courtId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-secondary)', flex: 1 }} className="truncate">{c.name}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                      {egp(c.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: occupancy + growth */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        <div className="chart-card">
          <div>
            <div className="chart-title">Court occupancy</div>
            <div className="chart-sub">booked hours vs. open hours · {rangeDays}d</div>
          </div>
          {loading || !data ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
              {occupancy.map((c) => (
                <div key={c.courtId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                      {c.name}
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {c.occupancyPct}% · {c.bookedHours}h
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${c.occupancyPct}%`, height: '100%',
                      background: c.color, borderRadius: 4,
                      transition: 'width 500ms var(--ease-smooth)',
                    }} />
                  </div>
                </div>
              ))}
              {occupancy.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No courts configured.</span>
              )}
            </div>
          )}
        </div>

        <div className="chart-card">
          <div>
            <div className="chart-title">Member growth</div>
            <div className="chart-sub">new registrations per month</div>
          </div>
          {loading || !data ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.customerGrowth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
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
                  labelFormatter={(m) => monthLabel(String(m))}
                  formatter={(v) => [`${v} members`, 'New']}
                />
                <Line
                  type="monotone"
                  dataKey="newCustomers"
                  stroke={SERIES_GREEN}
                  strokeWidth={2}
                  dot={{ r: 3, fill: SERIES_GREEN, stroke: 'var(--surface)', strokeWidth: 2 }}
                  activeDot={{ r: 4.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Row 3: daily bookings */}
      <div className="chart-card">
        <div>
          <div className="chart-title">Bookings per day</div>
          <div className="chart-sub">last {rangeDays} days</div>
        </div>
        {loading || !data ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.bookingsPerDay} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_GREEN} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={SERIES_GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                minTickGap={32}
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
                labelFormatter={(d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                formatter={(v) => [`${v} bookings`, null]}
              />
              <Area
                type="monotone"
                dataKey="bookings"
                stroke={SERIES_GREEN}
                strokeWidth={2}
                fill="url(#dailyFill)"
                dot={false}
                activeDot={{ r: 4, fill: SERIES_GREEN, stroke: 'var(--surface)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
