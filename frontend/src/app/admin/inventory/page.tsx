'use client';

/**
 * Rental Inventory & VIP Subscription Control (screen 5.16).
 *
 * Owner workspace:
 *   · Equipment catalogue — edit stock with steppers, edit hourly prices
 *     inline, retire/reactivate items; changes hit the booking flow live.
 *   · VIP subscriptions — active memberships, computed MRR, and a working
 *     "Revoke" that cancels every future occurrence.
 */
import { useCallback, useEffect, useState } from 'react';
import { Package, Repeat, Plus, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Stepper } from '@/components/ui/Stepper';
import { Toggle } from '@/components/ui/Toggle';

interface EquipmentRow {
  id:           string;
  name:         string;
  category:     string;
  description:  string | null;
  hourly_price: string | number;
  stock_qty:    number;
  is_active:    boolean;
  in_use_now:   number;
}

interface SubscriptionRow {
  id:                 string;
  status:             'active' | 'cancelled' | 'completed';
  first_name:         string;
  last_name:          string;
  customer_email:     string;
  court_name:         string;
  first_start_time:   string;
  duration_minutes:   number;
  term_months:        number;
  occurrences:        number;
  weekly_price:       string | number;
  next_occurrence:    string | null;
  remaining_sessions: number;
}

const CATEGORY_ICON: Record<string, string> = { racket: '🏓', balls: '🎾', gear: '🧤' };

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function InventoryPage() {
  // ── Equipment state ───────────────────────────────────────────
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [eqLoading, setEqLoading] = useState(true);
  const [savingId, setSavingId]   = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

  // Add-item form
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', category: 'racket', hourlyPrice: '', stockQty: '' });
  const [adding, setAdding]   = useState(false);

  // ── Subscription state ────────────────────────────────────────
  const [subs, setSubs]         = useState<SubscriptionRow[]>([]);
  const [mrr, setMrr]           = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [subLoading, setSubLoading]   = useState(true);
  const [revokingId, setRevokingId]   = useState<string | null>(null);
  const [confirmId, setConfirmId]     = useState<string | null>(null);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadEquipment = useCallback(() => {
    api.get('/equipment?all=1')
      .then(({ data }) => setEquipment(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load inventory.'))
      .finally(() => setEqLoading(false));
  }, []);

  const loadSubs = useCallback(() => {
    api.get('/subscriptions')
      .then(({ data }) => {
        setSubs(data.data ?? []);
        setMrr(data.mrr ?? 0);
        setActiveCount(data.activeCount ?? 0);
      })
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load subscriptions.'))
      .finally(() => setSubLoading(false));
  }, []);

  useEffect(() => { loadEquipment(); loadSubs(); }, [loadEquipment, loadSubs]);

  async function patchEquipment(id: string, patch: Record<string, unknown>, successMsg: string) {
    setSavingId(id);
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch(`/equipment/${id}`, patch);
      setEquipment((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
      setNotice(successMsg);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Update failed.');
      loadEquipment();
    } finally {
      setSavingId(null);
    }
  }

  function commitPrice(row: EquipmentRow) {
    const draft = priceDrafts[row.id];
    if (draft === undefined) return;
    const value = Number(draft);
    setPriceDrafts((p) => { const n = { ...p }; delete n[row.id]; return n; });
    if (!Number.isFinite(value) || value < 0 || value === Number(row.hourly_price)) return;
    patchEquipment(row.id, { hourlyPrice: value }, `"${row.name}" now rents at EGP ${value.toFixed(0)}/hr.`);
  }

  async function addItem() {
    if (!newItem.name || !newItem.hourlyPrice) {
      return setError('New equipment needs a name and an hourly price.');
    }
    setAdding(true);
    setError('');
    try {
      await api.post('/equipment', {
        name:        newItem.name,
        category:    newItem.category,
        hourlyPrice: Number(newItem.hourlyPrice),
        stockQty:    Number(newItem.stockQty || 0),
      });
      setNewItem({ name: '', category: 'racket', hourlyPrice: '', stockQty: '' });
      setAddOpen(false);
      setNotice('Equipment added to the rental catalogue.');
      loadEquipment();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Could not add equipment.');
    } finally {
      setAdding(false);
    }
  }

  async function revoke(sub: SubscriptionRow) {
    setRevokingId(sub.id);
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch(`/subscriptions/${sub.id}/revoke`, {
        reason: 'Revoked from the VIP control panel',
      });
      setNotice(data.message ?? 'Subscription revoked.');
      setConfirmId(null);
      loadSubs();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Revoke failed.');
    } finally {
      setRevokingId(null);
    }
  }

  const totalStock = equipment.reduce((s, e) => s + (e.is_active ? e.stock_qty : 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rental &amp; VIP Control</h1>
          <p className="page-subtitle">Equipment inventory and long-term membership management</p>
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
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <span className="stat-label">Monthly recurring revenue</span>
          <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>
            {subLoading ? '—' : egp(mrr)}
          </span>
          <span className="stat-sub">from weekly VIP slots</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active subscriptions</span>
          <span className="stat-value">{subLoading ? '—' : activeCount}</span>
          <span className="stat-sub">fixed weekly bookings</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Rental units in stock</span>
          <span className="stat-value">{eqLoading ? '—' : totalStock}</span>
          <span className="stat-sub">{equipment.filter((e) => e.is_active).length} catalogue items</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Out right now</span>
          <span className="stat-value">
            {eqLoading ? '—' : equipment.reduce((s, e) => s + e.in_use_now, 0)}
          </span>
          <span className="stat-sub">units in live sessions</span>
        </div>
      </div>

      {/* ── Rental inventory ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={16} style={{ color: 'var(--text-tertiary)' }} />
          Rental Inventory
        </h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen((v) => !v)}>
          {addOpen ? <X size={13} /> : <Plus size={13} />}
          {addOpen ? 'Cancel' : 'Add equipment'}
        </button>
      </div>

      {addOpen && (
        <div className="card-sm" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: 2, minWidth: 180 }}>
            <label className="input-label">Name</label>
            <input className="input" value={newItem.name}
              placeholder="e.g. Carbon Pro Racket"
              onChange={(e) => setNewItem((n) => ({ ...n, name: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 130 }}>
            <label className="input-label">Category</label>
            <select className="input" value={newItem.category}
              onChange={(e) => setNewItem((n) => ({ ...n, category: e.target.value }))}>
              <option value="racket">Racket</option>
              <option value="balls">Balls</option>
              <option value="gear">Gear</option>
            </select>
          </div>
          <div className="input-group" style={{ width: 120 }}>
            <label className="input-label">EGP / hour</label>
            <input className="input" type="number" min={0} value={newItem.hourlyPrice}
              onChange={(e) => setNewItem((n) => ({ ...n, hourlyPrice: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 100 }}>
            <label className="input-label">Stock</label>
            <input className="input" type="number" min={0} value={newItem.stockQty}
              onChange={(e) => setNewItem((n) => ({ ...n, stockQty: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={addItem} disabled={adding}>
            <Check size={14} />
            {adding ? 'Adding…' : 'Add item'}
          </button>
        </div>
      )}

      <div className="table-wrap" style={{ marginBottom: 40 }}>
        <table>
          <thead>
            <tr>
              <th>Equipment</th>
              <th style={{ width: 150 }}>Hourly price</th>
              <th style={{ width: 160 }}>Stock</th>
              <th style={{ width: 90, textAlign: 'right' }}>In use</th>
              <th style={{ width: 130 }}>In catalogue</th>
            </tr>
          </thead>
          <tbody>
            {eqLoading ? (
              [0, 1, 2, 3].map((i) => (
                <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : equipment.map((row) => (
              <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.55 }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="addon-thumb" style={{ width: 34, height: 34, fontSize: 15 }} aria-hidden>
                      {CATEGORY_ICON[row.category] ?? '🎒'}
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }} className="truncate">
                        {row.description ?? row.category}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>EGP</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      style={{ width: 76, height: 30, fontSize: 13 }}
                      value={priceDrafts[row.id] ?? String(Number(row.hourly_price))}
                      onChange={(e) => setPriceDrafts((p) => ({ ...p, [row.id]: e.target.value }))}
                      onBlur={() => commitPrice(row)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      aria-label={`${row.name} hourly price`}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>/hr</span>
                  </div>
                </td>
                <td>
                  <Stepper
                    value={row.stock_qty}
                    min={0}
                    max={999}
                    onChange={(v) => patchEquipment(row.id, { stockQty: v }, `"${row.name}" stock set to ${v}.`)}
                    ariaLabel={`${row.name} stock`}
                  />
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {row.in_use_now > 0
                    ? <span style={{ color: 'var(--accent-green-text)' }}>{row.in_use_now}</span>
                    : '0'}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Toggle
                      checked={row.is_active}
                      disabled={savingId === row.id}
                      onChange={(v) => patchEquipment(row.id, { isActive: v }, `"${row.name}" ${v ? 'is back in' : 'removed from'} the booking flow.`)}
                      label={`${row.name} availability`}
                    />
                    <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {row.is_active ? 'Listed' : 'Hidden'}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {!eqLoading && equipment.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No rental equipment yet — add your first item above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── VIP subscriptions ────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Repeat size={16} style={{ color: 'var(--accent-green-text)' }} />
          VIP Subscriptions
        </h3>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          MRR {egp(mrr)} · {activeCount} active
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Slot</th>
              <th>Term</th>
              <th style={{ textAlign: 'right' }}>Weekly</th>
              <th>Next session</th>
              <th>Status</th>
              <th style={{ width: 180 }} />
            </tr>
          </thead>
          <tbody>
            {subLoading ? (
              [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : subs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No VIP subscriptions yet — create one from the New Booking panel with &quot;Repeat weekly&quot;.
                </td>
              </tr>
            ) : subs.map((sub) => {
              const start = new Date(sub.first_start_time);
              return (
                <tr key={sub.id}>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {sub.first_name} {sub.last_name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{sub.customer_email}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Repeat size={11} style={{ color: 'var(--accent-green-text)', flexShrink: 0 }} />
                      {start.toLocaleDateString('en-GB', { weekday: 'short' })}s{' '}
                      {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}{sub.court_name}
                    </div>
                  </td>
                  <td>
                    {sub.term_months} month{sub.term_months > 1 ? 's' : ''}
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {sub.remaining_sessions} of {sub.occurrences} left
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                    {egp(Number(sub.weekly_price))}
                  </td>
                  <td>
                    {sub.next_occurrence
                      ? new Date(sub.next_occurrence).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${sub.status === 'active' ? 'active' : sub.status === 'cancelled' ? 'cancelled' : 'completed'}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {sub.status === 'active' && (
                      confirmId === sub.id ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmId(null)} disabled={revokingId === sub.id}>
                            Keep
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => revoke(sub)} disabled={revokingId === sub.id}>
                            {revokingId === sub.id ? 'Revoking…' : `Cancel ${sub.remaining_sessions} sessions`}
                          </button>
                        </span>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmId(sub.id)}>
                          Revoke
                        </button>
                      )
                    )}
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
