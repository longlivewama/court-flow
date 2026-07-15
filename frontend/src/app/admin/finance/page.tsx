'use client';

/**
 * Finance — owner P&L dashboard.
 *
 *   · Net profit = every collected revenue stream − (operating expenses +
 *     coach payouts), with margin and per-stream breakdown
 *   · Monthly revenue vs. costs chart with the net-profit line
 *   · Smart recommendations computed server-side from real movement
 *   · Expense ledger — log electricity, salaries, maintenance, gear …
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Plus, X, Check, Trash2, TrendingUp, AlertTriangle, Info, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { SERIES_GREEN } from '@/lib/chartColors';

const COST_ORANGE = '#EA580C';

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-primary)',
  boxShadow: 'var(--shadow-md)',
};

interface Financials {
  rangeDays: number;
  totals: {
    revenue: {
      bookings: number; tournaments: number; training: number; total: number;
      rentalsWithinBookings: number; rentalsPreviousPeriod: number;
    };
    costs: { operatingExpenses: number; coachPayouts: number; total: number };
    trainingClubShare: number;
    tournamentOutstanding: number;
    netProfit: number;
    marginPct: number;
  };
  expensesByCategory: { category: string; total: number }[];
  monthly: { month: string; revenue: number; expenses: number; netProfit: number }[];
  recommendations: { severity: 'positive' | 'warning' | 'info'; text: string }[];
}

interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amount: string | number;
  expense_date: string;
  created_by_name: string | null;
}

const CATEGORIES = [
  { value: 'electricity', label: 'Electricity', icon: '⚡' },
  { value: 'water',       label: 'Water',       icon: '💧' },
  { value: 'salaries',    label: 'Salaries',    icon: '👥' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { value: 'gear',        label: 'Gear purchases', icon: '🎒' },
  { value: 'marketing',   label: 'Marketing',   icon: '📣' },
  { value: 'other',       label: 'Other',       icon: '📎' },
];

const RANGES = [
  { days: 30,  label: '30d' },
  { days: 90,  label: '90d' },
  { days: 365, label: '1y' },
];

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

function monthLabel(m: string): string {
  return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

function catMeta(value: string) {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

const REC_STYLE: Record<string, { border: string; bg: string; color: string; icon: React.ReactNode }> = {
  positive: { border: 'var(--success-border)', bg: 'var(--success-bg)', color: 'var(--success)', icon: <TrendingUp size={14} /> },
  warning:  { border: 'var(--warning-border)', bg: 'var(--warning-bg)', color: 'var(--warning)', icon: <AlertTriangle size={14} /> },
  info:     { border: 'var(--info-border)',    bg: 'var(--info-bg)',    color: 'var(--info)',    icon: <Info size={14} /> },
};

export default function FinancePage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [fin, setFin]         = useState<Financials | null>(null);
  const [finLoading, setFinLoading] = useState(true);

  const [expenses, setExpenses]     = useState<ExpenseRow[]>([]);
  const [expLoading, setExpLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding]   = useState(false);
  const [draft, setDraft]     = useState({
    category: 'electricity',
    description: '',
    amount: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadFinancials = useCallback(() => {
    setFinLoading(true);
    api.get(`/analytics/financials?range_days=${rangeDays}`)
      .then(({ data }) => setFin(data))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load financials.'))
      .finally(() => setFinLoading(false));
  }, [rangeDays]);

  const loadExpenses = useCallback(() => {
    api.get(`/expenses?range_days=${rangeDays}`)
      .then(({ data }) => setExpenses(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load expenses.'))
      .finally(() => setExpLoading(false));
  }, [rangeDays]);

  useEffect(() => { loadFinancials(); loadExpenses(); }, [loadFinancials, loadExpenses]);

  async function addExpense() {
    if (!draft.description.trim() || !draft.amount || Number(draft.amount) <= 0) {
      return setError('An expense needs a description and a positive amount.');
    }
    setAdding(true);
    setError('');
    try {
      await api.post('/expenses', {
        category:    draft.category,
        description: draft.description.trim(),
        amount:      Number(draft.amount),
        expenseDate: draft.expenseDate,
      });
      setDraft((d) => ({ ...d, description: '', amount: '' }));
      setAddOpen(false);
      setNotice('Expense logged — net profit updated.');
      loadExpenses();
      loadFinancials();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Could not log the expense.');
    } finally {
      setAdding(false);
    }
  }

  async function removeExpense(row: ExpenseRow) {
    setDeletingId(row.id);
    setError('');
    try {
      await api.delete(`/expenses/${row.id}`);
      setNotice(`Removed "${row.description}".`);
      loadExpenses();
      loadFinancials();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Could not remove the expense.');
    } finally {
      setDeletingId(null);
    }
  }

  const t = fin?.totals;
  const expenseTotal = fin?.expensesByCategory.reduce((s, e) => s + e.total, 0) ?? 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-subtitle">Revenue streams, operating costs and net profit</p>
        </div>
        <div className="seg-control">
          {RANGES.map((r) => (
            <button key={r.days}
              className={`seg-item ${rangeDays === r.days ? 'active' : ''}`}
              onClick={() => setRangeDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" style={{
          background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
          color: 'var(--accent-green-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {notice}
        </div>
      )}
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
        {finLoading || !t ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
        ) : (
          <>
            <div className="stat-card">
              <span className="stat-label">Total revenue · {rangeDays}d</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(t.revenue.total)}</span>
              <span className="stat-sub">bookings, tournaments & training</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total costs</span>
              <span className="stat-value">{egp(t.costs.total)}</span>
              <span className="stat-sub">{egp(t.costs.operatingExpenses)} expenses + {egp(t.costs.coachPayouts)} coach payouts</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Net profit</span>
              <span className="stat-value" style={{ color: t.netProfit >= 0 ? 'var(--accent-green-text)' : 'var(--error)' }}>
                {t.netProfit < 0 ? `− ${egp(Math.abs(t.netProfit))}` : egp(t.netProfit)}
              </span>
              <span className="stat-sub">{t.marginPct}% margin</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outstanding</span>
              <span className="stat-value" style={{ color: t.tournamentOutstanding > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {egp(t.tournamentOutstanding)}
              </span>
              <span className="stat-sub">unpaid tournament fees</span>
            </div>
          </>
        )}
      </div>

      {/* Recommendations */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div>
          <div className="chart-title">Smart recommendations</div>
          <div className="chart-sub">computed from the last {rangeDays} days of real activity</div>
        </div>
        {finLoading || !fin ? (
          <div className="skeleton" style={{ height: 72 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fin.recommendations.map((rec, i) => {
              const s = REC_STYLE[rec.severity];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: s.bg, border: `1px solid ${s.border}`, color: s.color,
                  borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 2 }}>{s.icon}</span>
                  <span>{rec.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Row: P&L chart + revenue streams */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        <div className="chart-card">
          <div>
            <div className="chart-title">Revenue vs. costs — last 6 months</div>
            <div className="chart-sub">net profit overlaid</div>
          </div>
          {finLoading || !fin ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={fin.monthly} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel}
                  tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                <YAxis tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  tickLine={false} axisLine={false} width={46} />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  labelFormatter={(m) => monthLabel(String(m))}
                  formatter={(value, name) => [egp(Number(value)),
                    name === 'revenue' ? 'Revenue' : name === 'expenses' ? 'Costs' : 'Net profit']} />
                <Legend wrapperStyle={{ fontSize: 12 }}
                  formatter={(v: string) => (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {v === 'revenue' ? 'Revenue' : v === 'expenses' ? 'Costs' : 'Net profit'}
                    </span>
                  )} />
                <Bar dataKey="revenue"  fill={SERIES_GREEN} radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="expenses" fill={COST_ORANGE}  radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Line type="monotone" dataKey="netProfit" stroke="var(--text-primary)" strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--text-primary)', stroke: 'var(--surface)', strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <div>
            <div className="chart-title">Revenue streams</div>
            <div className="chart-sub">collected in the last {rangeDays} days</div>
          </div>
          {finLoading || !t ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { label: 'Court bookings',   value: t.revenue.bookings,    sub: `incl. ${egp(t.revenue.rentalsWithinBookings)} equipment rentals` },
                { label: 'Tournament fees',  value: t.revenue.tournaments, sub: `${egp(t.tournamentOutstanding)} still outstanding` },
                { label: 'Training sessions',value: t.revenue.training,    sub: `${egp(t.trainingClubShare)} club share after coach cuts` },
              ].map((row) => (
                <div key={row.label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="price-row" style={{ padding: 0 }}>
                    <span>{row.label}</span>
                    <strong>{egp(row.value)}</strong>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{row.sub}</div>
                </div>
              ))}
              <div className="price-row total">
                <span>Total collected</span>
                <strong style={{ color: 'var(--accent-green-text)' }}>{egp(t.revenue.total)}</strong>
              </div>
              <div className="price-row">
                <span>Costs (expenses + payouts)</span>
                <strong style={{ color: COST_ORANGE }}>− {egp(t.costs.total)}</strong>
              </div>
              <div className="price-row total">
                <span>Net profit</span>
                <strong style={{ color: t.netProfit >= 0 ? 'var(--accent-green-text)' : 'var(--error)' }}>
                  {t.netProfit < 0 ? `− ${egp(Math.abs(t.netProfit))}` : egp(t.netProfit)}
                </strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expense ledger */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Receipt size={16} style={{ color: 'var(--text-tertiary)' }} />
          Expense Ledger
          <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--text-tertiary)' }}>
            · {egp(expenseTotal)} in the last {rangeDays} days
          </span>
        </h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen((v) => !v)}>
          {addOpen ? <X size={13} /> : <Plus size={13} />}
          {addOpen ? 'Cancel' : 'Log expense'}
        </button>
      </div>

      {/* Category chips */}
      {!finLoading && fin && fin.expensesByCategory.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {fin.expensesByCategory.map((c) => (
            <span key={c.category} className="badge badge-draft" style={{ height: 26, textTransform: 'none', fontSize: 12, fontWeight: 500 }}>
              {catMeta(c.category).icon} {catMeta(c.category).label} · {egp(c.total)}
            </span>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="card-sm" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ width: 160 }}>
            <label className="input-label">Category</label>
            <select className="input" value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="input-group" style={{ flex: 2, minWidth: 200 }}>
            <label className="input-label">Description</label>
            <input className="input" value={draft.description}
              placeholder="e.g. July electricity bill"
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 130 }}>
            <label className="input-label">Amount (EGP)</label>
            <input className="input" type="number" min={0} value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 150 }}>
            <label className="input-label">Date</label>
            <input className="input" type="date" value={draft.expenseDate}
              onChange={(e) => setDraft((d) => ({ ...d, expenseDate: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={addExpense} disabled={adding}>
            <Check size={14} />
            {adding ? 'Saving…' : 'Log expense'}
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Expense</th>
              <th style={{ width: 150 }}>Category</th>
              <th style={{ width: 120 }}>Date</th>
              <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {expLoading ? (
              [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No expenses logged in this range — use &quot;Log expense&quot; to start tracking costs.
                </td>
              </tr>
            ) : expenses.map((row) => (
              <tr key={row.id}>
                <td>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.description}</div>
                  {row.created_by_name && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>by {row.created_by_name}</div>
                  )}
                </td>
                <td>{catMeta(row.category).icon} {catMeta(row.category).label}</td>
                <td>{new Date(row.expense_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {egp(Number(row.amount))}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-ghost btn-sm" aria-label={`Delete ${row.description}`}
                    onClick={() => removeExpense(row)} disabled={deletingId === row.id}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
