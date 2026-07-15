'use client';

/**
 * Tournaments — client view.
 *
 *   · Browse open and running tournaments
 *   · Register a team for the entry fee, then pay it online
 *   · Follow the live bracket
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Users, CalendarDays, CreditCard, Check, X } from 'lucide-react';
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
}

interface TeamRow {
  id: string;
  name: string;
  seed: number | null;
  captain_name: string | null;
  is_mine: boolean;
  payment_status: 'paid' | 'partial' | 'pending';
  amount_due?: number;
  amount_paid?: number;
  outstanding?: number;
}

interface TournamentDetail extends TournamentRow {
  teams: TeamRow[];
  matches: BracketMatch[];
  stats: { teamCount: number };
}

const STATUS_BADGE: Record<TournamentRow['status'], { cls: string; label: string }> = {
  registration_open: { cls: 'badge-active',     label: 'Registration open' },
  in_progress:       { cls: 'badge-checked_in', label: 'In progress' },
  completed:         { cls: 'badge-completed',  label: 'Completed' },
  cancelled:         { cls: 'badge-cancelled',  label: 'Cancelled' },
};

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

export default function ClientTournamentsPage() {
  const [list, setList]       = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<TournamentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [draft, setDraft]         = useState({ teamName: '', contactPhone: '' });
  const [registering, setRegistering] = useState(false);
  const [payingId, setPayingId]   = useState<string | null>(null);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadList = useCallback(() => {
    api.get('/tournaments')
      .then(({ data }) => setList((data.data ?? []).filter((t: TournamentRow) => t.status !== 'cancelled')))
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

  async function registerTeam() {
    if (!detail || !draft.teamName.trim()) return setError('Give your team a name first.');
    setRegistering(true);
    setError('');
    try {
      await api.post(`/tournaments/${detail.id}/teams`, {
        teamName:     draft.teamName.trim(),
        contactPhone: draft.contactPhone.trim() || undefined,
      });
      setDraft({ teamName: '', contactPhone: '' });
      setRegisterOpen(false);
      setNotice('Team registered! Pay the entry fee to secure your spot.');
      loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(apiError(err, 'Could not register your team.'));
    } finally {
      setRegistering(false);
    }
  }

  async function payFee(team: TeamRow) {
    if (!detail) return;
    setPayingId(team.id);
    setError('');
    try {
      const { data } = await api.post(`/tournaments/${detail.id}/teams/${team.id}/pay`, {});
      setNotice(data.message ?? 'Payment received — you are all set!');
      loadDetail(detail.id);
    } catch (err) {
      setError(apiError(err, 'Payment failed — please try again.'));
    } finally {
      setPayingId(null);
    }
  }

  const teamNames = useMemo(() => {
    const map: Record<string, string> = {};
    detail?.teams.forEach((t) => { map[t.id] = t.name; });
    return map;
  }, [detail]);

  const myTeam = detail?.teams.find((t) => t.is_mine) ?? null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-subtitle">Register your team, pay online, and follow the bracket</p>
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

      {/* Tournament cards */}
      {loading ? (
        <div className="stat-grid">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 160 }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Trophy size={40} className="empty-state-icon" />
          <span className="empty-state-title">No tournaments right now</span>
          <p>Check back soon — new competitions are announced here.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
          {list.map((t) => (
            <button key={t.id} className="card" onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                borderColor: t.id === selectedId ? 'var(--accent-green)' : undefined,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Trophy size={18} style={{ color: 'var(--accent-green-text)' }} />
                <span className={`badge ${STATUS_BADGE[t.status].cls}`}>{STATUS_BADGE[t.status].label}</span>
              </div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>{t.name}</h3>
              {t.description && (
                <p style={{ fontSize: 12.5, marginBottom: 10 }} className="truncate">{t.description}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CalendarDays size={12} />
                  {new Date(t.starts_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Users size={12} />
                  {t.team_count} / {t.max_teams} teams
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', fontWeight: 500 }}>
                  <CreditCard size={12} />
                  {t.registration_fee > 0 ? `${egp(t.registration_fee)} entry` : 'Free entry'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail */}
      {selectedId && (
        detailLoading || !detail ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {detail.name}
                  <span className={`badge ${STATUS_BADGE[detail.status].cls}`}>{STATUS_BADGE[detail.status].label}</span>
                </h2>
                {detail.description && <p style={{ marginTop: 6 }}>{detail.description}</p>}
              </div>

              {/* My registration / payment state */}
              {myTeam ? (
                <div className="card-sm" style={{ minWidth: 240 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Your team</div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>{myTeam.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${myTeam.payment_status}`}>{myTeam.payment_status}</span>
                    {myTeam.payment_status !== 'paid' && (
                      <button className="btn btn-primary btn-sm" onClick={() => payFee(myTeam)} disabled={payingId === myTeam.id}>
                        <CreditCard size={12} />
                        {payingId === myTeam.id ? 'Processing…' : `Pay ${egp(myTeam.outstanding ?? detail.registration_fee)} online`}
                      </button>
                    )}
                    {myTeam.payment_status === 'paid' && (
                      <span style={{ fontSize: 12, color: 'var(--accent-green-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Check size={12} /> Entry fee settled
                      </span>
                    )}
                  </div>
                </div>
              ) : detail.status === 'registration_open' && (
                registerOpen ? (
                  <div className="card-sm" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="input-group" style={{ minWidth: 160 }}>
                      <label className="input-label">Team name</label>
                      <input className="input" value={draft.teamName} placeholder="e.g. Net Ninjas"
                        onChange={(e) => setDraft((d) => ({ ...d, teamName: e.target.value }))} />
                    </div>
                    <div className="input-group" style={{ width: 150 }}>
                      <label className="input-label">Phone (optional)</label>
                      <input className="input" value={draft.contactPhone}
                        onChange={(e) => setDraft((d) => ({ ...d, contactPhone: e.target.value }))} />
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={registerTeam} disabled={registering}>
                      {registering ? 'Registering…' : 'Register'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRegisterOpen(false)} aria-label="Cancel registration">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-primary" onClick={() => setRegisterOpen(true)}>
                    <Users size={14} />
                    Register your team · {detail.registration_fee > 0 ? egp(detail.registration_fee) : 'Free'}
                  </button>
                )
              )}
            </div>

            {/* Registered teams */}
            <h4 style={{ marginBottom: 8 }}>Registered teams ({detail.teams.length})</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: detail.matches.length ? 24 : 0 }}>
              {detail.teams.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Be the first team to register!</span>
              ) : detail.teams.map((team) => (
                <span key={team.id} className="badge badge-draft"
                  style={{ height: 26, textTransform: 'none', fontSize: 12, fontWeight: 500,
                    borderColor: team.is_mine ? 'var(--accent-green)' : undefined }}>
                  {team.seed ? `#${team.seed} ` : ''}{team.name}{team.is_mine ? ' (you)' : ''}
                </span>
              ))}
            </div>

            {/* Live bracket */}
            {detail.matches.length > 0 && (
              <>
                <h4 style={{ marginBottom: 8 }}>Bracket</h4>
                <Bracket matches={detail.matches} teamNames={teamNames} />
              </>
            )}
          </div>
        )
      )}
    </>
  );
}
