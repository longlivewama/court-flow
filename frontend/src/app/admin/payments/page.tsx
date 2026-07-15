'use client';

/**
 * Payments ledger (screen 5.10).
 * Interactive ledger with status filters and Paid / Partial / Pending /
 * Refunded badges, plus headline collected/outstanding numbers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { BookingDetailsPanel } from '@/components/BookingDetailsPanel';

type LedgerStatus = 'all' | 'paid' | 'partial' | 'pending' | 'refunded' | 'rejected';

const FILTERS: { key: LedgerStatus; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'paid',     label: 'Paid' },
  { key: 'partial',  label: 'Partial' },
  { key: 'pending',  label: 'Pending' },
  { key: 'refunded', label: 'Refunded' },
];

interface LedgerRow {
  id:               string;
  booking_id:       string;
  ledger_status:    string;
  total_amount:     string | number;
  deposit_amount:   string | number;
  remainder_amount: string | number;
  discount_amount:  string | number;
  deposit_method:   string | null;
  start_time:       string;
  created_at:       string;
  court_name:       string;
  first_name:       string;
  last_name:        string;
  customer_email:   string;
  subscription_id:  string | null;
}

interface Summary {
  collected:     number;
  outstanding:   number;
  pendingCount:  number;
  refundedCount: number;
  totalCount:    number;
}

const BADGE_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', pending: 'Pending',
  refunded: 'Refunded', rejected: 'Rejected',
};

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function PaymentsPage() {
  const [filter, setFilter]   = useState<LedgerStatus>('all');
  const [search, setSearch]   = useState('');
  const [query, setQuery]     = useState('');
  const [page, setPage]       = useState(1);
  const [rows, setRows]       = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const LIMIT = 25;

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status: filter, page: String(page), limit: String(LIMIT) });
    if (query) params.set('search', query);
    api.get(`/payments?${params}`)
      .then(({ data }) => {
        setRows(data.data ?? []);
        setSummary(data.summary ?? null);
      })
      .catch((err) => {
        setError(err.response?.data?.message ?? 'Could not load the ledger.');
      })
      .finally(() => setLoading(false));
  }, [filter, page, query]);

  useEffect(load, [load]);

  // Debounce the search box into `query`
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Every deposit, balance and refund in one ledger</p>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {loading && !summary ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
        ) : summary && (
          <>
            <div className="stat-card">
              <span className="stat-label">Collected</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(summary.collected)}</span>
              <span className="stat-sub">{summary.totalCount} payment records</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outstanding</span>
              <span className="stat-value">{egp(summary.outstanding)}</span>
              <span className="stat-sub">balances still due</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Pending</span>
              <span className="stat-value" style={summary.pendingCount > 0 ? { color: 'var(--warning)' } : undefined}>
                {summary.pendingCount}
              </span>
              <span className="stat-sub">awaiting verification</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Refunded</span>
              <span className="stat-value">{summary.refundedCount}</span>
              <span className="stat-sub">partial or full refunds</span>
            </div>
          </>
        )}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg-control">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`seg-item ${filter === f.key ? 'active' : ''}`}
              onClick={() => { setFilter(f.key); setPage(1); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            style={{ width: 220, paddingLeft: 30, height: 34 }}
            placeholder="Search member…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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

      {/* Ledger table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Court</th>
              <th>Session</th>
              <th>Method</th>
              <th style={{ textAlign: 'right' }}>Paid</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No payments match this filter
                </td>
              </tr>
            ) : rows.map((r) => {
              const paid = Number(r.deposit_amount) + Number(r.remainder_amount);
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailsId(r.booking_id)}>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {r.first_name} {r.last_name}
                      {r.subscription_id && (
                        <Repeat size={11} style={{ color: 'var(--accent-green-text)' }} aria-label="VIP subscription" />
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{r.customer_email}</div>
                  </td>
                  <td>{r.court_name}</td>
                  <td>
                    {new Date(r.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {' · '}
                    {new Date(r.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>
                    {(r.deposit_method ?? 'none').toLowerCase().replace('_', ' ')}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                    {egp(paid)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {egp(Number(r.total_amount))}
                  </td>
                  <td>
                    <span className={`badge badge-${r.ledger_status}`}>
                      {BADGE_LABEL[r.ledger_status] ?? r.ledger_status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Page {page}</span>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft size={13} /> Prev
        </button>
        <button className="btn btn-secondary btn-sm" disabled={rows.length < LIMIT} onClick={() => setPage((p) => p + 1)}>
          Next <ChevronRight size={13} />
        </button>
      </div>

      <BookingDetailsPanel
        open={!!detailsId}
        bookingId={detailsId}
        onClose={() => setDetailsId(null)}
        onChanged={load}
      />
    </>
  );
}
