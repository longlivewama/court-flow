'use client';

/**
 * Tournaments — owner control room.
 *
 *   · Create tournaments with a registration fee and team cap
 *   · Enter teams, record fee payments (full or partial, any method) and see
 *     exactly who paid vs. who still owes
 *   · Generate the single-elimination bracket and record match results
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, Check, Trophy, Users, Wallet, GitBranch } from 'lucide-react';
import { api } from '@/lib/api';
import { Bracket, BracketMatch } from '@/components/Bracket';

interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
  registration_fee: number;
  max_teams: number;
  starts_at: string;
  status: 'registration_open' | 'in_progress' | 'completed' | 'cancelled';
  team_count: number;
  collected: number;
  outstanding: number;
}

interface TeamRow {
  id: string;
  name: string;
  seed: number | null;
  captain_name: string | null;
  captain_email?: string;
  contact_phone?: string | null;
  amount_due?: number;
  amount_paid?: number;
  outstanding?: number;
  payment_method?: string;
  paid_at?: string | null;
  payment_status: 'paid' | 'partial' | 'pending';
}

interface TournamentDetail extends TournamentRow {
  teams: TeamRow[];
  matches: BracketMatch[];
  stats: { teamCount: number; collected: number; outstanding: number; paidTeams: number };
}

const STATUS_BADGE: Record<TournamentRow['status'], { cls: string; label: string }> = {
  registration_open: { cls: 'badge-active',    label: 'Registration open' },
  in_progress:       { cls: 'badge-checked_in', label: 'In progress' },
  completed:         { cls: 'badge-completed', label: 'Completed' },
  cancelled:         { cls: 'badge-cancelled', label: 'Cancelled' },
};

const PAY_METHODS = ['CASH', 'INSTAPAY', 'VODAFONE_CASH', 'ONLINE'] as const;

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function AdminTournamentsPage() {
  const [list, setList]       = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<TournamentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [draft, setDraft] = useState({
    name: '', description: '', registrationFee: '', maxTeams: '16',
    startsAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
  });

  const [teamDraft, setTeamDraft]   = useState({ teamName: '', contactPhone: '' });
  const [addingTeam, setAddingTeam] = useState(false);

  const [payTeamId, setPayTeamId]   = useState<string | null>(null);
  const [payDraft, setPayDraft]     = useState({ amount: '', method: 'CASH' });
  const [paying, setPaying]         = useState(false);

  const [generating, setGenerating] = useState(false);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadList = useCallback(() => {
    api.get('/tournaments')
      .then(({ data }) => setList(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load tournaments.'))
      .finally(() => setLoading(false));
  }, []);

  const loadDetail = useCallback((id: string) => {
    setDetailLoading(true);
    api.get(`/tournaments/${id}`)
      .then(({ data }) => setDetail(data))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load the tournament.'))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  function apiError(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
    return e.response?.data?.error?.message ?? e.response?.data?.message ?? fallback;
  }

  async function createTournament() {
    if (!draft.name.trim() || draft.registrationFee === '') {
      return setError('A tournament needs a name and a registration fee (0 is allowed).');
    }
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post('/tournaments', {
        name:            draft.name.trim(),
        description:     draft.description.trim() || undefined,
        registrationFee: Number(draft.registrationFee),
        maxTeams:        Number(draft.maxTeams) || 16,
        startsAt:        new Date(draft.startsAt).toISOString(),
      });
      setCreateOpen(false);
      setDraft((d) => ({ ...d, name: '', description: '', registrationFee: '' }));
      setNotice(`"${data.name}" created — registration is open.`);
      loadList();
      setSelectedId(data.id);
    } catch (err) {
      setError(apiError(err, 'Could not create the tournament.'));
    } finally {
      setCreating(false);
    }
  }

  async function addTeam() {
    if (!detail || !teamDraft.teamName.trim()) return setError('The team needs a name.');
    setAddingTeam(true);
    setError('');
    try {
      await api.post(`/tournaments/${detail.id}/teams`, {
        teamName:     teamDraft.teamName.trim(),
        contactPhone: teamDraft.contactPhone.trim() || undefined,
      });
      setTeamDraft({ teamName: '', contactPhone: '' });
      setNotice('Team registered.');
      loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(apiError(err, 'Could not register the team.'));
    } finally {
      setAddingTeam(false);
    }
  }

  async function recordPayment(team: TeamRow) {
    if (!detail) return;
    setPaying(true);
    setError('');
    try {
      const amount = payDraft.amount === '' ? undefined : Number(payDraft.amount);
      const { data } = await api.post(`/tournaments/${detail.id}/teams/${team.id}/pay`, {
        amount, method: payDraft.method,
      });
      setNotice(data.message ?? 'Payment recorded.');
      setPayTeamId(null);
      setPayDraft({ amount: '', method: 'CASH' });
      loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(apiError(err, 'Could not record the payment.'));
    } finally {
      setPaying(false);
    }
  }

  async function generateBracket() {
    if (!detail) return;
    setGenerating(true);
    setError('');
    try {
      const { data } = await api.post(`/tournaments/${detail.id}/bracket`);
      setNotice(data.message ?? 'Bracket generated.');
      loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(apiError(err, 'Could not generate the bracket.'));
    } finally {
      setGenerating(false);
    }
  }

  async function recordResult(matchId: string, winnerId: string, score1?: number, score2?: number) {
    if (!detail) return;
    setError('');
    try {
      const { data } = await api.patch(`/tournaments/${detail.id}/matches/${matchId}`, {
        winnerId, score1, score2,
      });
      setNotice(data.final ? '🏆 Champion decided — tournament completed!' : 'Result recorded — winner advanced.');
      loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(apiError(err, 'Could not record the result.'));
    }
  }

  const teamNames = useMemo(() => {
    const map: Record<string, string> = {};
    detail?.teams.forEach((t) => { map[t.id] = t.name; });
    return map;
  }, [detail]);

  const totals = useMemo(() => ({
    active:      list.filter((t) => t.status === 'registration_open' || t.status === 'in_progress').length,
    collected:   list.reduce((s, t) => s + t.collected, 0),
    outstanding: list.reduce((s, t) => s + t.outstanding, 0),
    teams:       list.reduce((s, t) => s + t.team_count, 0),
  }), [list]);

  const champion = useMemo(() => {
    if (!detail || detail.status !== 'completed' || !detail.matches.length) return null;
    const finalRound = Math.max(...detail.matches.map((m) => m.round));
    const final = detail.matches.find((m) => m.round === finalRound);
    return final?.winner_id ? teamNames[final.winner_id] : null;
  }, [detail, teamNames]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-subtitle">Brackets, registrations and fee collection</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen((v) => !v)}>
          {createOpen ? <X size={14} /> : <Plus size={14} />}
          {createOpen ? 'Cancel' : 'New tournament'}
        </button>
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
        {loading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
        ) : (
          <>
            <div className="stat-card">
              <span className="stat-label">Active tournaments</span>
              <span className="stat-value">{totals.active}</span>
              <span className="stat-sub">{list.length} all-time</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Fees collected</span>
              <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(totals.collected)}</span>
              <span className="stat-sub">across all tournaments</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outstanding</span>
              <span className="stat-value" style={{ color: totals.outstanding > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {egp(totals.outstanding)}
              </span>
              <span className="stat-sub">unpaid registrations</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Teams registered</span>
              <span className="stat-value">{totals.teams}</span>
              <span className="stat-sub">all tournaments</span>
            </div>
          </>
        )}
      </div>

      {/* Create form */}
      {createOpen && (
        <div className="card-sm" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: 2, minWidth: 200 }}>
            <label className="input-label">Name</label>
            <input className="input" value={draft.name} placeholder="e.g. Summer Padel Cup 2026"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 150 }}>
            <label className="input-label">Fee / team (EGP)</label>
            <input className="input" type="number" min={0} value={draft.registrationFee}
              onChange={(e) => setDraft((d) => ({ ...d, registrationFee: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 110 }}>
            <label className="input-label">Max teams</label>
            <input className="input" type="number" min={2} max={128} value={draft.maxTeams}
              onChange={(e) => setDraft((d) => ({ ...d, maxTeams: e.target.value }))} />
          </div>
          <div className="input-group" style={{ width: 210 }}>
            <label className="input-label">Starts</label>
            <input className="input" type="datetime-local" value={draft.startsAt}
              onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))} />
          </div>
          <div className="input-group" style={{ flex: 3, minWidth: 220 }}>
            <label className="input-label">Description (optional)</label>
            <input className="input" value={draft.description} placeholder="Format, prizes, rules…"
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
          <button className="btn btn-primary" onClick={createTournament} disabled={creating}>
            <Check size={14} />
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}

      {/* Tournament list */}
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Tournament</th>
              <th style={{ width: 150 }}>Status</th>
              <th style={{ width: 90, textAlign: 'right' }}>Teams</th>
              <th style={{ width: 110, textAlign: 'right' }}>Fee</th>
              <th style={{ width: 120, textAlign: 'right' }}>Collected</th>
              <th style={{ width: 120, textAlign: 'right' }}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 22 }} /></td></tr>
              ))
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No tournaments yet — create your first one above.
                </td>
              </tr>
            ) : list.map((t) => (
              <tr key={t.id} onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                style={{ cursor: 'pointer', background: t.id === selectedId ? 'rgba(34,197,94,0.05)' : undefined }}>
                <td>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Trophy size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                    {t.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    starts {new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </td>
                <td><span className={`badge ${STATUS_BADGE[t.status].cls}`}>{STATUS_BADGE[t.status].label}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.team_count} / {t.max_teams}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(t.registration_fee)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-green-text)' }}>{egp(t.collected)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: t.outstanding > 0 ? 'var(--warning)' : undefined }}>
                  {egp(t.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Selected tournament detail ────────────────────────── */}
      {selectedId && (
        detailLoading || !detail ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Trophy size={18} style={{ color: 'var(--accent-green-text)' }} />
                  {detail.name}
                  <span className={`badge ${STATUS_BADGE[detail.status].cls}`}>{STATUS_BADGE[detail.status].label}</span>
                </h2>
                {detail.description && <p style={{ marginTop: 4 }}>{detail.description}</p>}
                {champion && (
                  <p style={{ marginTop: 4, color: 'var(--accent-green-text)', fontWeight: 500 }}>
                    🏆 Champions: {champion}
                  </p>
                )}
              </div>
              {(detail.status === 'registration_open' || (detail.status === 'in_progress' && detail.matches.length === 0)) && (
                <button className="btn btn-primary" onClick={generateBracket}
                  disabled={generating || detail.teams.length < 2}
                  title={detail.teams.length < 2 ? 'Register at least 2 teams first' : undefined}>
                  <GitBranch size={14} />
                  {generating ? 'Generating…' : detail.matches.length ? 'Regenerate bracket' : 'Generate bracket'}
                </button>
              )}
            </div>

            {/* Tournament financial stats */}
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <span className="stat-label"><Users size={11} style={{ marginRight: 4 }} />Teams</span>
                <span className="stat-value">{detail.stats.teamCount}</span>
                <span className="stat-sub">{detail.stats.paidTeams} fully paid</span>
              </div>
              <div className="stat-card">
                <span className="stat-label"><Wallet size={11} style={{ marginRight: 4 }} />Collected</span>
                <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>{egp(detail.stats.collected)}</span>
                <span className="stat-sub">registration fees received</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Outstanding</span>
                <span className="stat-value" style={{ color: detail.stats.outstanding > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {egp(detail.stats.outstanding)}
                </span>
                <span className="stat-sub">still owed by teams</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Expected total</span>
                <span className="stat-value">{egp(detail.stats.collected + detail.stats.outstanding)}</span>
                <span className="stat-sub">{egp(detail.registration_fee)} × {detail.stats.teamCount} teams</span>
              </div>
            </div>

            {/* Team & payment ledger */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3>Teams &amp; payments</h3>
            </div>
            {detail.status === 'registration_open' && (
              <div className="card-sm" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="input-group" style={{ flex: 2, minWidth: 180 }}>
                  <label className="input-label">Team name</label>
                  <input className="input" value={teamDraft.teamName} placeholder="e.g. Smash Brothers"
                    onChange={(e) => setTeamDraft((d) => ({ ...d, teamName: e.target.value }))} />
                </div>
                <div className="input-group" style={{ width: 170 }}>
                  <label className="input-label">Contact phone</label>
                  <input className="input" value={teamDraft.contactPhone} placeholder="01x xxxx xxxx"
                    onChange={(e) => setTeamDraft((d) => ({ ...d, contactPhone: e.target.value }))} />
                </div>
                <button className="btn btn-secondary" onClick={addTeam} disabled={addingTeam}>
                  <Plus size={14} />
                  {addingTeam ? 'Adding…' : 'Register team'}
                </button>
              </div>
            )}

            <div className="table-wrap" style={{ marginBottom: 32 }}>
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Captain</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Due</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Paid</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 230 }} />
                  </tr>
                </thead>
                <tbody>
                  {detail.teams.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                        No teams yet — register the first one above.
                      </td>
                    </tr>
                  ) : detail.teams.map((team) => (
                    <tr key={team.id}>
                      <td>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {team.seed ? `#${team.seed} · ` : ''}{team.name}
                        </div>
                        {team.contact_phone && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{team.contact_phone}</div>
                        )}
                      </td>
                      <td>
                        {team.captain_name ?? <span style={{ color: 'var(--text-tertiary)' }}>Walk-in</span>}
                        {team.captain_email && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{team.captain_email}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(team.amount_due ?? 0)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-green-text)' }}>
                        {egp(team.amount_paid ?? 0)}
                        {team.paid_at && (
                          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                            {team.payment_method} · {new Date(team.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                      </td>
                      <td><span className={`badge badge-${team.payment_status}`}>{team.payment_status}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        {team.payment_status !== 'paid' && (
                          payTeamId === team.id ? (
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input className="input" type="number" min={0} placeholder={`${team.outstanding ?? 0}`}
                                style={{ width: 84, height: 28, fontSize: 12 }}
                                value={payDraft.amount} aria-label="Payment amount"
                                onChange={(e) => setPayDraft((d) => ({ ...d, amount: e.target.value }))} />
                              <select className="input" style={{ width: 110, height: 28, fontSize: 12 }}
                                value={payDraft.method} aria-label="Payment method"
                                onChange={(e) => setPayDraft((d) => ({ ...d, method: e.target.value }))}>
                                {PAY_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                              </select>
                              <button className="btn btn-primary btn-sm" onClick={() => recordPayment(team)} disabled={paying}>
                                {paying ? '…' : 'Save'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setPayTeamId(null)}>
                                <X size={12} />
                              </button>
                            </span>
                          ) : (
                            <button className="btn btn-secondary btn-sm"
                              onClick={() => { setPayTeamId(team.id); setPayDraft({ amount: '', method: 'CASH' }); }}>
                              <Wallet size={12} />
                              Record payment
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bracket */}
            {detail.matches.length > 0 && (
              <>
                <h3 style={{ marginBottom: 4 }}>Bracket</h3>
                <p style={{ fontSize: 12.5, marginBottom: 8 }}>
                  Click &quot;Record result&quot; on a match, optionally enter scores, then click the winning team.
                </p>
                <Bracket
                  matches={detail.matches}
                  teamNames={teamNames}
                  canRecord={detail.status === 'in_progress'}
                  onRecord={recordResult}
                />
              </>
            )}
          </>
        )
      )}
    </>
  );
}
