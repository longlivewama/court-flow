'use client';

/**
 * Coach viewport — /dashboard/coaching
 *
 * The COACH role's home: their own profile, a weekly calendar grid of
 * allocated training sessions, and personal commission earnings. Backed by
 * GET /api/coaching/me, which never exposes club-wide financials.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, type Variants } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Dumbbell, CalendarClock,
  Banknote, Hourglass, MapPin, Link2,
} from 'lucide-react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { getDur, EASE_STANDARD } from '@/lib/motion-tokens';

const TIMEZONE = 'Africa/Cairo';

const ENTRANCE_CONTAINER: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const ENTRANCE_SECTION: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: getDur('--dur-slow'), ease: EASE_STANDARD },
  },
};

interface CoachProfile {
  id: string;
  name: string;
  phone: string | null;
  specialty: string | null;
  hourly_rate: number;
  commission_pct: number;
  is_active: boolean;
}

interface MySession {
  id: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  coach_share: number;
  is_paid: boolean;
  paid_at: string | null;
  notes: string | null;
  client_name: string;
  court_name: string | null;
}

interface MySummary {
  earnedPaid: number;
  pendingShare: number;
  upcomingCount: number;
  hoursThisWeek: number;
}

const STATUS_STYLE: Record<MySession['status'], { label: string; color: string; bg: string; border: string }> = {
  scheduled: { label: 'Scheduled', color: 'var(--info)',          bg: 'var(--info-bg)',    border: 'var(--info-border)' },
  completed: { label: 'Completed', color: 'var(--success)',       bg: 'var(--success-bg)', border: 'var(--success-border)' },
  cancelled: { label: 'Cancelled', color: 'var(--error)',         bg: 'var(--error-bg)',   border: 'var(--error-border)' },
};

function egp(n: number): string {
  return `EGP ${Math.round(n).toLocaleString('en-EG')}`;
}

function StatusPill({ status }: { status: MySession['status'] }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.03em',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

export default function CoachViewportPage() {
  const { user } = useAuthStore();
  const router   = useRouter();
  const allowed  = user?.role === 'coach' || user?.role === 'owner';

  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);

  const [coach, setCoach]       = useState<CoachProfile | null>(null);
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [summary, setSummary]   = useState<MySummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(toZonedTime(new Date(), TIMEZONE), { weekStartsOn: 1 })
  );

  const load = useCallback(() => {
    setError('');
    api.get('/coaching/me?range_days=120')
      .then(({ data }) => {
        setCoach(data.coach ?? null);
        setSessions(data.data ?? []);
        setSummary(data.summary ?? null);
      })
      .catch((err) => {
        const e = err as { response?: { data?: { message?: string } } };
        setError(e.response?.data?.message ?? 'Could not load your coaching schedule.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const todayCairo = toZonedTime(new Date(), TIMEZONE);

  const sessionsByDay = useMemo(() => {
    const map = new Map<number, MySession[]>();
    for (const s of sessions) {
      const local = toZonedTime(new Date(s.start_time), TIMEZONE);
      const idx = weekDays.findIndex((d) => isSameDay(d, local));
      if (idx === -1) continue;
      map.set(idx, [...(map.get(idx) ?? []), s]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
    }
    return map;
  }, [sessions, weekDays]);

  const recent = useMemo(
    () => [...sessions].sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time)).slice(0, 12),
    [sessions]
  );

  if (!allowed) return null;

  return (
    <motion.div variants={ENTRANCE_CONTAINER} initial="hidden" animate="visible">
      {/* ── Header ── */}
      <motion.div variants={ENTRANCE_SECTION} className="page-header">
        <div>
          <h1 className="page-title">My Coaching</h1>
          <p className="page-subtitle">
            {coach
              ? <>Training calendar &amp; commission ledger · {coach.name}{coach.specialty ? ` — ${coach.specialty}` : ''}</>
              : 'Your personal training calendar'}
          </p>
        </div>
        {coach && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 14px', fontSize: 12.5, color: 'var(--text-secondary)',
          }}>
            <Dumbbell size={13} style={{ color: 'var(--accent-green-text)' }} />
            {egp(coach.hourly_rate)}/hr · {coach.commission_pct}% commission
          </div>
        )}
      </motion.div>

      {error && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 24,
        }}>
          {error}
        </div>
      )}

      {/* ── Unlinked guidance state ── */}
      {!loading && !coach && !error && (
        <motion.div variants={ENTRANCE_SECTION} className="card" style={{ textAlign: 'center', padding: '56px 32px' }}>
          <Link2 size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
          <h3 style={{ marginBottom: 8 }}>No coach profile linked yet</h3>
          <p style={{ maxWidth: 440, margin: '0 auto' }}>
            Your login isn&apos;t connected to a coach on the roster. Ask your club
            owner to link your email from <strong>Admin → Coaching</strong> — your
            allocated sessions and earnings will appear here immediately after.
          </p>
        </motion.div>
      )}

      {(loading || coach) && (
        <>
          {/* ── KPI row ── */}
          <motion.div variants={ENTRANCE_SECTION} className="stat-grid" style={{ marginBottom: 24 }}>
            {loading ? (
              [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 108 }} />)
            ) : (
              <>
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="stat-label">Upcoming sessions</span>
                    <CalendarClock size={14} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                  <span className="stat-value">{summary?.upcomingCount ?? 0}</span>
                  <span className="stat-sub">on your calendar</span>
                </div>
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="stat-label">Hours this week</span>
                    <Hourglass size={14} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                  <span className="stat-value">{(summary?.hoursThisWeek ?? 0).toFixed(1)}h</span>
                  <span className="stat-sub">excluding cancellations</span>
                </div>
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="stat-label">Earned — paid out</span>
                    <Banknote size={14} style={{ color: 'var(--accent-green-text)' }} />
                  </div>
                  <span className="stat-value" style={{ color: 'var(--accent-green-text)' }}>
                    {egp(summary?.earnedPaid ?? 0)}
                  </span>
                  <span className="stat-sub">your commission · last 120 days</span>
                </div>
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="stat-label">Pending payout</span>
                    <Banknote size={14} style={{ color: summary?.pendingShare ? 'var(--warning)' : 'var(--text-tertiary)' }} />
                  </div>
                  <span className="stat-value" style={summary?.pendingShare ? { color: 'var(--warning)' } : undefined}>
                    {egp(summary?.pendingShare ?? 0)}
                  </span>
                  <span className="stat-sub">awaiting collection</span>
                </div>
              </>
            )}
          </motion.div>

          {/* ── Week calendar grid ── */}
          <motion.div variants={ENTRANCE_SECTION} className="chart-card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div className="chart-title">Week of {format(weekStart, 'd MMM yyyy')}</div>
                <div className="chart-sub">your allocated training slots</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" aria-label="Previous week"
                  onClick={() => setWeekStart((d) => addDays(d, -7))}>
                  <ChevronLeft size={14} />
                </button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setWeekStart(startOfWeek(toZonedTime(new Date(), TIMEZONE), { weekStartsOn: 1 }))}>
                  This week
                </button>
                <button className="btn btn-secondary btn-sm" aria-label="Next week"
                  onClick={() => setWeekStart((d) => addDays(d, 7))}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="skeleton" style={{ height: 220 }} />
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
                gap: 8, overflowX: 'auto',
              }}>
                {weekDays.map((day, di) => {
                  const isToday = isSameDay(day, todayCairo);
                  const daySessions = sessionsByDay.get(di) ?? [];
                  return (
                    <div key={di} style={{
                      background: isToday ? 'var(--surface-2)' : 'var(--bg-elevated)',
                      border: `1px solid ${isToday ? 'var(--border-focus)' : 'var(--border)'}`,
                      borderRadius: 10, padding: 8, minHeight: 148,
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <div style={{ textAlign: 'center', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                        <div style={{
                          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                          color: isToday ? 'var(--accent-green-text)' : 'var(--text-tertiary)',
                        }}>
                          {format(day, 'EEE')}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {format(day, 'd')}
                        </div>
                      </div>
                      {daySessions.length === 0 ? (
                        <div style={{ fontSize: 10.5, color: 'var(--text-disabled)', textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
                          —
                        </div>
                      ) : daySessions.map((s) => {
                        const st = STATUS_STYLE[s.status];
                        const startL = toZonedTime(new Date(s.start_time), TIMEZONE);
                        const endL   = toZonedTime(new Date(s.end_time), TIMEZONE);
                        return (
                          <motion.div
                            key={s.id}
                            layout
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, ease: EASE_STANDARD }}
                            style={{
                              background: st.bg,
                              border: `1px solid ${st.border}`,
                              borderLeft: `3px solid ${st.color}`,
                              borderRadius: 7, padding: '6px 8px',
                              display: 'flex', flexDirection: 'column', gap: 2,
                              opacity: s.status === 'cancelled' ? 0.6 : 1,
                            }}
                          >
                            <span style={{
                              fontSize: 10.5, fontWeight: 700, color: st.color,
                              fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
                            }}>
                              {format(startL, 'HH:mm')}–{format(endL, 'HH:mm')}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }} className="truncate">
                              {s.client_name}
                            </span>
                            {s.court_name && (
                              <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <MapPin size={8} /> {s.court_name}
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                              color: s.is_paid ? 'var(--accent-green-text)' : 'var(--text-tertiary)',
                            }}>
                              {egp(s.coach_share)}{s.is_paid ? ' · paid' : ''}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* ── Personal session ledger ── */}
          <motion.div variants={ENTRANCE_SECTION} className="chart-card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 24px 0' }}>
              <div className="chart-title">My sessions</div>
              <div className="chart-sub">latest first · your commission only</div>
            </div>
            {loading ? (
              <div style={{ padding: 24 }}>
                {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Client</th>
                      <th>Court</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>My cut</th>
                      <th>Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((s) => (
                      <tr key={s.id} style={{ opacity: s.status === 'cancelled' ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {format(toZonedTime(new Date(s.start_time), TIMEZONE), 'd MMM · HH:mm')}
                        </td>
                        <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{s.client_name}</td>
                        <td>{s.court_name ?? '—'}</td>
                        <td><StatusPill status={s.status} /></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{egp(s.coach_share)}</td>
                        <td style={{ fontSize: 12, color: s.is_paid ? 'var(--accent-green-text)' : 'var(--text-tertiary)' }}>
                          {s.is_paid
                            ? `Paid${s.paid_at ? ` · ${format(toZonedTime(new Date(s.paid_at), TIMEZONE), 'd MMM')}` : ''}`
                            : 'Pending'}
                        </td>
                      </tr>
                    ))}
                    {recent.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                          No sessions allocated yet — they appear here as soon as the desk schedules you.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
