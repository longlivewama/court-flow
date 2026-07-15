'use client';

/**
 * Coaching — training sessions financial ledger.
 *
 *   · Coach roster with hourly rate + commission split (owner edits)
 *   · Session ledger: every session shows what the client paid, the coach's
 *     commission payout, and the club's retained profit
 *   · Mark-paid flow feeds the Finance dashboard and owner analytics
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Check, Dumbbell, UserCheck, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Toggle } from '@/components/ui/Toggle';

interface CoachRow {
  id: string;
  name: string;
  phone: string | null;
  specialty: string | null;
  hourly_rate: number;
  commission_pct: number;
  is_active: boolean;
  session_count: number;
  earned: number;
  club_profit: number;
}

interface SessionRow {
  id: string;
  coach_id: string;
  coach_name: string;
  client_name: string;
  court_name: string | null;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  price: number;
  coach_share: number;
  club_share: number;
  is_paid: boolean;
  payment_method: string;
  paid_at: string | null;
}

interface LedgerSummary {
  collected: number;
  coachPayouts: number;
  clubProfit: number;
  outstanding: number;
  unpaidCount: number;
}

const PAY_METHODS = ['CASH', 'INSTAPAY', 'VODAFONE_CASH'] as const;

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function CoachingPage() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [coaches, setCoaches]           = useState<CoachRow[]>([]);
  const [coachesLoading, setCoachesLoading] = useState(true);
  const [sessions, setSessions]         = useState<SessionRow[]>([]);
  const [summary, setSummary]           = useState<LedgerSummary | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [coachFormOpen, setCoachFormOpen] = useState(false);
  const [coachDraft, setCoachDraft] = useState({ name: '', specialty: '', hourlyRate: '', commissionPct: '60' });
  const [savingCoach, setSavingCoach] = useState(false);

  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState({
    coachId: '', customerName: '',
    date: new Date().toISOString().slice(0, 10),
    startHour: '17', hours: '1', price: '',
  });
  const [savingSession, setSavingSession] = useState(false);

  const [payId, setPayId]       = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<string>('CASH');
  const [paying, setPaying]     = useState(false);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadCoaches = useCallback(() => {
    api.get(`/coaching/coaches${isOwner ? '?all=1' : ''}`)
      .then(({ data }) => setCoaches(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load coaches.'))
      .finally(() => setCoachesLoading(false));
  }, [isOwner]);

  const loadSessions = useCallback(() => {
    api.get('/coaching/sessions?range_days=180')
      .then(({ data }) => { setSessions(data.data ?? []); setSummary(data.summary ?? null); })
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load the session ledger.'))
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => { loadCoaches(); loadSessions(); }, [loadCoaches, loadSessions]);

  function apiError(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
    return e.response?.data?.error?.message ?? e.response?.data?.message ?? fallback;
  }

  async function addCoach() {
    if (!coachDraft.name.trim() || !coachDraft.hourlyRate) {
      return setError('A coach needs a name and an hourly rate.');
    }
    setSavingCoach(true);
    setError('');
    try {
      await api.post('/coaching/coaches', {
        name:          coachDraft.name.trim(),
        specialty:     coachDraft.specialty.trim() || null,
        hourlyRate:    Number(coachDraft.hourlyRate),
        commissionPct: Number(coachDraft.commissionPct) || 60,
      });
      setCoachDraft({ name: '', specialty: '', hourlyRate: '', commissionPct: '60' });
      setCoachFormOpen(false);
      setNotice('Coach added to the roster.');
      loadCoaches();
    } catch (err) {
      setError(apiError(err, 'Could not add the coach.'));
    } finally {
      setSavingCoach(false);
    }
  }

  async function patchCoach(id: string, patch: Record<string, unknown>, msg: string) {
    setError('');
    try {
      await api.patch(`/coaching/coaches/${id}`, patch);
      setNotice(msg);
      loadCoaches();
    } catch (err) {
      setError(apiError(err, 'Update failed.'));
    }
  }

  async function addSession() {
    if (!sessionDraft.coachId) return setError('Pick a coach for the session.');
    setSavingSession(true);
    setError('');
    try {
      const start = new Date(`${sessionDraft.date}T${sessionDraft.startHour.padStart(2, '0')}:00:00`);
      const end   = new Date(start.getTime() + Number(sessionDraft.hours) * 3600000);
      await api.post('/coaching/sessions', {
        coachId:      sessionDraft.coachId,
        customerName: sessionDraft.customerName.trim() || null,
        startTime:    start.toISOString(),
        endTime:      end.toISOString(),
        price:        sessionDraft.price === '' ? undefined : Number(sessionDraft.price),
      });
      setSessionDraft((d) => ({ ...d, customerName: '', price: '' }));
      setSessionFormOpen(false);
      setNotice('Training session logged.');
      loadSessions();
      loadCoaches();
    } catch (err) {
      setError(apiError(err, 'Could not log the session.'));
    } finally {
      setSavingSession(false);
    }
  }

  async function markPaid(row: SessionRow) {
    setPaying(true);
    setError('');
    try {
      await api.post(`/coaching/sessions/${row.id}/pay`, { method: payMethod });
      setNotice(`Collected ${egp(row.price)} — ${egp(row.coach_share)} to ${row.coach_name}, ${egp(row.club_share)} club profit.`);
      setPayId(null);
      loadSessions();
      loadCoaches();
    } catch (err) {
      setError(apiError(err, 'Could not record the payment.'));
    } finally {
      setPaying(false);
    }
  }

  async function setSessionStatus(row: SessionRow, status: SessionRow['status']) {
    setError('');
    try {
      await api.patch(`/coaching/sessions/${row.id}`, { status });
      setNotice(`Session marked ${status}.`);
      loadSessions();
    } catch (err) {
      setError(apiError(err, 'Could not update the session.'));
    }
  }

  const selectedCoach = coaches.find((c) => c.id === sessionDraft.coachId);
  const estPrice = selectedCoach && sessionDraft.price === ''
    ? selectedCoach.hourly_rate * Number(sessionDraft.hours || 1)
    : Number(sessionDraft.price || 0);
  const estCoach = selectedCoach ? Math.round(estPrice * selectedCoach.commission_pct) / 100 : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Coaching</h1>
          <p className="page-subtitle">Training sessions, coach commissions and club profit</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isOwner && (
            <button className="btn btn-secondary" onClick={() => setCoachFormOpen((v) => !v)}>
              {coachFormOpen ? <X size={14} /> : <UserCheck size={14} />}
              {coachFormOpen ? 'Cancel' : 'Add coach'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setSessionFormOpen((v) => !v)}>
            {sessionFormOpen ? <X size={14} /> : <Plus size={14} />}
            {sessionFormOpen ? 'Cancel' : 'Log session'}
          </button>
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
        {sessionsLoading || !summary ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
        ) : (
          <>
            <div className="stat-card">
              <span className="stat-label">Training revenue</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(summary.collected)}</span>
              <span className="stat-sub">collected · last 180 days</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Coach payouts</span>
              <span className="stat-value">{egp(summary.coachPayouts)}</span>
              <span className="stat-sub">commissions owed to coaches</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Club profit</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(summary.clubProfit)}</span>
              <span className="stat-sub">kept after commissions</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outstanding</span>
              <span className="stat-value" style={{ color: summary.outstanding > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {egp(summary.outstanding)}
              </span>
              <span className="stat-sub">{summary.unpaidCount} unpaid session(s)</span>
            </div>
          </>
        )}
      </div>

      {/* Add-coach form (owner) */}
      {coachFormOpen && (
        <div className="card-sm" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: 2, minWidth: 170 }}>
            <label className="input-label">Name</label>
            <input className="input" value={coachDraft.name} placeholder="Coach name"
              onChange={(e) => setCoachDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="input-group" style={{ flex: 2, minWidth: 170 }}>
            <label className="input-label">Specialty</label>
            <input className="input" value={coachDraft.specialty} placeholder="e.g. Junior development"
              onChange={(e) => setCoachDraft((d) => ({ ...d, specialty: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 130 }}>
            <label className="input-label">EGP / hour</label>
            <input className="input" type="number" min={0} value={coachDraft.hourlyRate}
              onChange={(e) => setCoachDraft((d) => ({ ...d, hourlyRate: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 140 }}>
            <label className="input-label">Coach cut (%)</label>
            <input className="input" type="number" min={0} max={100} value={coachDraft.commissionPct}
              onChange={(e) => setCoachDraft((d) => ({ ...d, commissionPct: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={addCoach} disabled={savingCoach}>
            <Check size={14} />
            {savingCoach ? 'Adding…' : 'Add coach'}
          </button>
        </div>
      )}

      {/* Log-session form */}
      {sessionFormOpen && (
        <div className="card-sm" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ width: 190 }}>
            <label className="input-label">Coach</label>
            <select className="input" value={sessionDraft.coachId}
              onChange={(e) => setSessionDraft((d) => ({ ...d, coachId: e.target.value }))}>
              <option value="">Select a coach…</option>
              {coaches.filter((c) => c.is_active).map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {egp(c.hourly_rate)}/hr</option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ flex: 2, minWidth: 160 }}>
            <label className="input-label">Client</label>
            <input className="input" value={sessionDraft.customerName} placeholder="Client name"
              onChange={(e) => setSessionDraft((d) => ({ ...d, customerName: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 150 }}>
            <label className="input-label">Date</label>
            <input className="input" type="date" value={sessionDraft.date}
              onChange={(e) => setSessionDraft((d) => ({ ...d, date: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 110 }}>
            <label className="input-label">Start hour</label>
            <select className="input" value={sessionDraft.startHour}
              onChange={(e) => setSessionDraft((d) => ({ ...d, startHour: e.target.value }))}>
              {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ width: 100 }}>
            <label className="input-label">Hours</label>
            <select className="input" value={sessionDraft.hours}
              onChange={(e) => setSessionDraft((d) => ({ ...d, hours: e.target.value }))}>
              {[1, 1.5, 2, 3].map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
          </div>
          <div className="input-group" style={{ width: 140 }}>
            <label className="input-label">Price (EGP)</label>
            <input className="input" type="number" min={0} value={sessionDraft.price}
              placeholder={selectedCoach ? String(selectedCoach.hourly_rate * Number(sessionDraft.hours || 1)) : 'auto'}
              onChange={(e) => setSessionDraft((d) => ({ ...d, price: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={addSession} disabled={savingSession}>
            <Check size={14} />
            {savingSession ? 'Saving…' : 'Log session'}
          </button>
          {selectedCoach && (
            <div style={{ width: '100%', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Split preview: client pays <strong style={{ color: 'var(--text-secondary)' }}>{egp(estPrice)}</strong>
              {' → '}coach {egp(estCoach)} ({selectedCoach.commission_pct}%) · club keeps {egp(estPrice - estCoach)}
            </div>
          )}
        </div>
      )}

      {/* Coach roster */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserCheck size={16} style={{ color: 'var(--text-tertiary)' }} />
          Coach Roster
        </h3>
      </div>
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Coach</th>
              <th style={{ width: 110, textAlign: 'right' }}>Rate / hr</th>
              <th style={{ width: 110, textAlign: 'right' }}>Coach cut</th>
              <th style={{ width: 90, textAlign: 'right' }}>Sessions</th>
              <th style={{ width: 130, textAlign: 'right' }}>Earned</th>
              <th style={{ width: 130, textAlign: 'right' }}>Club profit</th>
              {isOwner && <th style={{ width: 110 }}>Active</th>}
            </tr>
          </thead>
          <tbody>
            {coachesLoading ? (
              [0, 1].map((i) => (
                <tr key={i}><td colSpan={isOwner ? 7 : 6}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : coaches.length === 0 ? (
              <tr>
                <td colSpan={isOwner ? 7 : 6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No coaches yet{isOwner ? ' — add your first coach above.' : '.'}
                </td>
              </tr>
            ) : coaches.map((c) => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                <td>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{c.specialty ?? '—'}</div>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(c.hourly_rate)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.commission_pct}%</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.session_count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(c.earned)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-green-text)' }}>{egp(c.club_profit)}</td>
                {isOwner && (
                  <td>
                    <Toggle
                      checked={c.is_active}
                      onChange={(v) => patchCoach(c.id, { isActive: v }, `${c.name} is now ${v ? 'active' : 'inactive'}.`)}
                      label={`${c.name} active`}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Session ledger */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Dumbbell size={16} style={{ color: 'var(--accent-green-text)' }} />
          Session Ledger
        </h3>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>last 180 days</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Coach</th>
              <th style={{ width: 110, textAlign: 'right' }}>Client pays</th>
              <th style={{ width: 110, textAlign: 'right' }}>Coach cut</th>
              <th style={{ width: 110, textAlign: 'right' }}>Club keeps</th>
              <th style={{ width: 110 }}>Payment</th>
              <th style={{ width: 230 }} />
            </tr>
          </thead>
          <tbody>
            {sessionsLoading ? (
              [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No training sessions yet — log the first one above.
                </td>
              </tr>
            ) : sessions.map((row) => {
              const start = new Date(row.start_time);
              const end   = new Date(row.end_time);
              return (
                <tr key={row.id} style={{ opacity: row.status === 'cancelled' ? 0.5 : 1 }}>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.client_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' · '}
                      {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      –{end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {row.court_name ? ` · ${row.court_name}` : ''}
                    </div>
                  </td>
                  <td>{row.coach_name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{egp(row.price)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(row.coach_share)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-green-text)' }}>{egp(row.club_share)}</td>
                  <td>
                    {row.is_paid ? (
                      <span className="badge badge-paid">paid</span>
                    ) : row.status === 'cancelled' ? (
                      <span className="badge badge-cancelled">cancelled</span>
                    ) : (
                      <span className="badge badge-pending">unpaid</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!row.is_paid && row.status !== 'cancelled' && (
                      payId === row.id ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <select className="input" style={{ width: 130, height: 28, fontSize: 12 }}
                            value={payMethod} aria-label="Payment method"
                            onChange={(e) => setPayMethod(e.target.value)}>
                            {PAY_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" onClick={() => markPaid(row)} disabled={paying}>
                            {paying ? '…' : 'Collect'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setPayId(null)} aria-label="Cancel">
                            <X size={12} />
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setPayId(row.id); setPayMethod('CASH'); }}>
                            <Wallet size={12} />
                            Collect {egp(row.price)}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setSessionStatus(row, 'cancelled')}>
                            Cancel
                          </button>
                        </span>
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
