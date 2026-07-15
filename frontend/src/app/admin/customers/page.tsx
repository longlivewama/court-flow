'use client';

/**
 * Customers (screen 5.12) — active member table with booking counts,
 * lifetime spend, and derived membership tiers.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { api } from '@/lib/api';

interface Customer {
  id:              string;
  first_name:      string;
  last_name:       string;
  email:           string;
  phone:           string | null;
  created_at:      string;
  bookings_count:  number;
  total_spent:     string | number;
  last_booking_at: string | null;
}

type Tier = 'Platinum' | 'Gold' | 'Silver' | 'Member';

/** Tier is earned by loyalty (sessions) or lifetime spend, whichever is higher. */
function tierOf(c: Customer): Tier {
  const spent = Number(c.total_spent);
  if (c.bookings_count >= 20 || spent >= 15000) return 'Platinum';
  if (c.bookings_count >= 10 || spent >= 7000)  return 'Gold';
  if (c.bookings_count >= 3  || spent >= 1500)  return 'Silver';
  return 'Member';
}

const TIER_STYLE: Record<Tier, React.CSSProperties> = {
  Platinum: { background: '#241F33', color: '#A78BFA', border: '1px solid #342D4A' },
  Gold:     { background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)' },
  Silver:   { background: 'var(--info-bg)', color: 'var(--info)', border: '1px solid var(--info-border)' },
  Member:   { background: 'var(--neutral-bg)', color: 'var(--neutral-text)', border: '1px solid var(--border)' },
};

const TIER_FILTERS: ('all' | Tier)[] = ['all', 'Platinum', 'Gold', 'Silver', 'Member'];

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | Tier>('all');

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.get(`/users${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then(({ data }) => setCustomers(data.data ?? []))
        .catch((err) => setError(err.response?.data?.message ?? 'Could not load members.'))
        .finally(() => setLoading(false));
    }, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = useMemo(
    () => customers.filter((c) => tierFilter === 'all' || tierOf(c) === tierFilter),
    [customers, tierFilter]
  );

  const totals = useMemo(() => ({
    members: customers.length,
    sessions: customers.reduce((s, c) => s + c.bookings_count, 0),
    revenue: customers.reduce((s, c) => s + Number(c.total_spent), 0),
  }), [customers]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">Active members, loyalty tiers and lifetime value</p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <span className="stat-label">Active members</span>
          <span className="stat-value">{loading ? '—' : totals.members}</span>
          <span className="stat-sub">with verified accounts</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total sessions</span>
          <span className="stat-value">{loading ? '—' : totals.sessions}</span>
          <span className="stat-sub">booked all-time</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Lifetime revenue</span>
          <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>
            {loading ? '—' : egp(totals.revenue)}
          </span>
          <span className="stat-sub">from listed members</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg-control">
          {TIER_FILTERS.map((t) => (
            <button
              key={t}
              className={`seg-item ${tierFilter === t ? 'active' : ''}`}
              onClick={() => setTierFilter(t)}
            >
              {t === 'all' ? 'All tiers' : t}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            style={{ width: 240, paddingLeft: 30, height: 34 }}
            placeholder="Search name or email…"
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Phone</th>
              <th style={{ textAlign: 'right' }}>Bookings</th>
              <th style={{ textAlign: 'right' }}>Lifetime spend</th>
              <th>Last session</th>
              <th>Tier</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state" style={{ padding: 40 }}>
                    <Users size={28} className="empty-state-icon" />
                    <span className="empty-state-title">No members found</span>
                  </div>
                </td>
              </tr>
            ) : filtered.map((c) => {
              const tier = tierOf(c);
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                      }}>
                        {c.first_name[0]}{c.last_name[0]}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {c.first_name} {c.last_name}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{c.phone ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                    {c.bookings_count}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {egp(Number(c.total_spent))}
                  </td>
                  <td>
                    {c.last_booking_at
                      ? new Date(c.last_booking_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'Never'}
                  </td>
                  <td>
                    <span className="badge" style={TIER_STYLE[tier]}>{tier}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
