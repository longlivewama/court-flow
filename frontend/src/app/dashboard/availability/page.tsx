'use client';

/**
 * Court Availability Grid
 * Interactive free/booked time-slot matrix for all courts over the club's
 * operational business day (12:00 PM → 06:00 AM next day, Cairo time).
 * Free slots are clickable and deep-link into the booking form.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { format, addDays, addMinutes } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  Calendar, ChevronLeft, ChevronRight, CircleCheck, CircleX,
  Construction, Clock, RefreshCw,
} from 'lucide-react';

const TIMEZONE = 'Africa/Cairo';
const OVERNIGHT_CUTOFF = 6; // business day: noon → 6 AM next day

// Hour sequence for the grid rows: 12 PM … 11 PM, then 12 AM … 5 AM (+1 day)
const GRID_HOURS = [...Array.from({ length: 12 }, (_, i) => i + 12), ...Array.from({ length: 6 }, (_, i) => i)];

interface Court {
  id: string;
  name: string;
  court_number: number;
  price_per_hour: number;
}

interface BookedSlot   { court_id: string; start_time: string; end_time: string; }
interface BlockedSlot  { court_id: string | null; title: string; start_at: string; end_at: string; }

interface GridData {
  date: string;
  courts: Court[];
  bookedSlots: BookedSlot[];
  blockedPeriods: BlockedSlot[];
}

type SlotState = 'free' | 'booked' | 'blocked' | 'past';

const SLOT_STYLE: Record<SlotState, { bg: string; border: string; color: string; label: string }> = {
  free:    { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.35)',  color: '#22c55e', label: 'Available' },
  booked:  { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.30)',  color: '#ef4444', label: 'Booked' },
  blocked: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', color: '#94a3b8', label: 'Blocked' },
  past:    { bg: 'transparent',            border: 'var(--border)',          color: 'var(--text-tertiary)', label: 'Past' },
};

function hourLabel(h: number): string {
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${String(display).padStart(2, '0')}:00 ${h >= 12 ? 'PM' : 'AM'}`;
}

export default function AvailabilityPage() {
  const router = useRouter();
  const todayCairo = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

  const [date, setDate]       = useState(todayCairo);
  const [data, setData]       = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/courts/availability-grid?date=${date}`);
      setData(data);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to load availability. Please retry.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  function shiftDate(days: number) {
    setDate(format(addDays(new Date(`${date}T12:00:00`), days), 'yyyy-MM-dd'));
  }

  // Resolve each grid row to its absolute UTC start (post-midnight hours belong
  // to the NEXT calendar day — same overnight rule as the booking form).
  const slots = useMemo(() => {
    return GRID_HOURS.map((hour) => {
      const calendarDate = hour < OVERNIGHT_CUTOFF
        ? format(addDays(new Date(`${date}T12:00:00`), 1), 'yyyy-MM-dd')
        : date;
      const start = fromZonedTime(`${calendarDate}T${String(hour).padStart(2, '0')}:00:00`, TIMEZONE);
      return { hour, start, end: addMinutes(start, 60) };
    });
  }, [date]);

  const now = new Date();

  // Booked/blocked takes precedence over "past" so history stays visible on
  // the grid — only a slot that was never booked or blocked collapses to 'past'.
  function slotState(courtId: string, start: Date, end: Date): SlotState {
    const isBooked = data?.bookedSlots.some(
      (b) => b.court_id === courtId && new Date(b.start_time) < end && new Date(b.end_time) > start
    );
    if (isBooked) return 'booked';
    const isBlocked = data?.blockedPeriods.some(
      (bp) => (bp.court_id === null || bp.court_id === courtId)
        && new Date(bp.start_at) < end && new Date(bp.end_at) > start
    );
    if (isBlocked) return 'blocked';
    if (end <= now) return 'past';
    return 'free';
  }

  function handleSlotClick(court: Court, hour: number, state: SlotState) {
    if (state !== 'free') return;
    router.push(`/dashboard/book?court=${court.id}&date=${date}&hour=${hour}`);
  }

  const courts = data?.courts ?? [];

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Court Availability</h1>
          <p className="page-subtitle">
            Scan free slots at a glance — tap a green slot to book it instantly
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => shiftDate(-1)} aria-label="Previous day">
            <ChevronLeft size={15} />
          </button>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={14} style={{ color: 'var(--text-tertiary)' }} />
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Availability date"
              style={{ width: 160 }}
            />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => shiftDate(1)} aria-label="Next day">
            <ChevronRight size={15} />
          </button>
          {date !== todayCairo && (
            <button className="btn btn-secondary btn-sm" onClick={() => setDate(todayCairo)}>
              Today
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Refresh availability">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        {(['free', 'booked', 'blocked', 'past'] as SlotState[]).map((s) => (
          <span
            key={s}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, color: SLOT_STYLE[s].color,
              background: SLOT_STYLE[s].bg, border: `1px solid ${SLOT_STYLE[s].border}`,
              borderRadius: 999, padding: '4px 12px',
            }}
          >
            {s === 'free' ? <CircleCheck size={12} /> : s === 'booked' ? <CircleX size={12} /> : s === 'blocked' ? <Construction size={12} /> : <Clock size={12} />}
            {SLOT_STYLE[s].label}
          </span>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
          Business day: 12:00 PM → 06:00 AM (next morning) · Africa/Cairo
        </span>
      </div>

      {/* ── Error ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="card"
            style={{ padding: '14px 18px', marginBottom: 16, border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Grid ───────────────────────────────────────────────── */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ padding: 20, overflowX: 'auto' }}
      >
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <div className="skeleton" style={{ height: 40, width: 90, borderRadius: 8 }} />
                {Array.from({ length: Math.max(courts.length, 2) }).map((_, j) => (
                  <div key={j} className="skeleton" style={{ height: 40, flex: 1, borderRadius: 8 }} />
                ))}
              </div>
            ))}
          </div>
        ) : courts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon" style={{ fontSize: 42 }}>🎾</div>
            <div className="empty-state-title">No active courts</div>
            <p>The club has no courts configured yet.</p>
          </div>
        ) : (
          <div
            role="grid"
            aria-label={`Court availability for ${date}`}
            style={{
              display: 'grid',
              gridTemplateColumns: `92px repeat(${courts.length}, minmax(140px, 1fr))`,
              gap: 8,
              minWidth: 92 + courts.length * 148,
            }}
          >
            {/* Column headers */}
            <div />
            {courts.map((c) => (
              <div
                key={c.id}
                role="columnheader"
                style={{
                  textAlign: 'center', padding: '10px 8px',
                  background: 'var(--bg-secondary)', borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Court {c.court_number} · {c.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  EGP {Number(c.price_per_hour).toFixed(0)}/hr
                </div>
              </div>
            ))}

            {/* Slot rows */}
            {slots.map(({ hour, start, end }, rowIdx) => (
              <div key={hour} style={{ display: 'contents' }}>
                <div
                  role="rowheader"
                  style={{
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: 'var(--text-secondary)', paddingLeft: 4,
                  }}
                >
                  {hourLabel(hour)}
                  {hour < OVERNIGHT_CUTOFF && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b' }}>+1 DAY</span>
                  )}
                </div>

                {courts.map((c) => {
                  const state = slotState(c.id, start, end);
                  const style = SLOT_STYLE[state];
                  const isPast = end <= now;
                  const clickable = state === 'free';
                  return (
                    <motion.button
                      key={`${c.id}-${hour}`}
                      type="button"
                      role="gridcell"
                      aria-label={`${c.name} at ${hourLabel(hour)}: ${style.label}${isPast && state !== 'past' ? ' (past)' : ''}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(rowIdx * 0.02, 0.3) }}
                      whileHover={clickable ? { scale: 1.03, boxShadow: '0 4px 16px rgba(34,197,94,0.25)' } : undefined}
                      whileTap={clickable ? { scale: 0.97 } : undefined}
                      onClick={() => handleSlotClick(c, hour, state)}
                      disabled={!clickable}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        height: 42, borderRadius: 10,
                        background: style.bg,
                        border: `1px solid ${style.border}`,
                        color: style.color,
                        fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                        cursor: clickable ? 'pointer' : 'default',
                        opacity: isPast ? 0.45 : 1,
                        transition: 'background 0.15s',
                      }}
                    >
                      {state === 'free' && <><CircleCheck size={13} /> Book</>}
                      {state === 'booked' && <><CircleX size={13} /> Booked</>}
                      {state === 'blocked' && <><Construction size={13} /> Blocked</>}
                      {state === 'past' && '—'}
                    </motion.button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
