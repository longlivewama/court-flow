'use client';

/**
 * Schedule Grid – court × time matrix with absolute positioning.
 * Displays bookings + blocked periods with categorized visual themes.
 * Owners get a "Block Time Slot" modal wired to dynamic business hours.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, X, Loader2, Plus,
  CheckCircle2, XCircle,
} from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { StateChip, BookingStatus } from '@/components/StateChip';
import { BookingSheet, CourtBlueprint } from '@/components/BookingSheet';
import { SPRING_GRID } from '@/lib/motion-tokens';

const TIMEZONE    = 'Africa/Cairo';
const HOUR_HEIGHT = 96; // px per hour – generous enough to prevent card overflow

// ── Types ─────────────────────────────────────────────────────────────────────
interface Court { id: string; name: string; number: number; }

interface Booking {
  id: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  first_name: string;
  last_name: string;
  customer_phone?: string;
  court_id: string;
  duration_minutes: number;
  court_name: string;
  total_price: number;
  deposit_amount: number;
  deposit_method: string;
  remainder_amount: number;
  remainder_method: string;
  payment_status: string;
  deposit_status: string;
}

type ReasonType = 'MAINTENANCE' | 'TOURNAMENT' | 'TRAINING' | 'ADMIN_CLOSED';

interface BlockedPeriod {
  id: string;
  court_id: string | null;
  reason_type: ReasonType;
  title: string;
  start_at: string;
  end_at: string;
  recurring: boolean;
}

interface WorkingHour {
  day_of_week: number;
  open_time: string;   // "HH:MM:SS"
  close_time: string;
  is_closed: boolean;
}

// ── Blocked period visual config ──────────────────────────────────────────────
const REASON_CONFIG: Record<ReasonType, {
  icon: string;
  label: string;
  publicLabel: string;
  bg: string;
  cardBg: string;
  border: string;
  borderL: string;
  textColor: string;
  pillBg: string;
  pillBorder: string;
}> = {
  MAINTENANCE: {
    icon: '🛠️',
    label: 'Maintenance',
    publicLabel: 'Unavailable: Maintenance',
    bg: 'rgba(127,29,29,0.15)',
    cardBg: 'rgba(127,29,29,0.18)',
    border: 'rgba(239,68,68,0.2)',
    borderL: '#ef4444',
    textColor: '#fca5a5',
    pillBg: 'rgba(239,68,68,0.08)',
    pillBorder: 'rgba(239,68,68,0.22)',
  },
  TOURNAMENT: {
    icon: '🏆',
    label: 'Tournament',
    publicLabel: 'Reserved for Tournament',
    bg: 'rgba(120,53,15,0.18)',
    cardBg: 'rgba(120,53,15,0.22)',
    border: 'rgba(245,158,11,0.2)',
    borderL: '#f59e0b',
    textColor: '#fcd34d',
    pillBg: 'rgba(245,158,11,0.08)',
    pillBorder: 'rgba(245,158,11,0.22)',
  },
  TRAINING: {
    icon: '⚽',
    label: 'Training Session',
    publicLabel: 'Reserved for Training',
    bg: 'rgba(29,78,216,0.12)',
    cardBg: 'rgba(29,78,216,0.18)',
    border: 'rgba(59,130,246,0.2)',
    borderL: '#3b82f6',
    textColor: '#93c5fd',
    pillBg: 'rgba(59,130,246,0.08)',
    pillBorder: 'rgba(59,130,246,0.22)',
  },
  ADMIN_CLOSED: {
    icon: '🔒',
    label: 'Admin Closed',
    publicLabel: 'Venue Closed',
    bg: 'rgba(39,39,42,0.85)',
    cardBg: 'rgba(39,39,42,0.9)',
    border: 'rgba(113,113,122,0.2)',
    borderL: '#71717a',
    textColor: '#a1a1aa',
    pillBg: 'rgba(113,113,122,0.08)',
    pillBorder: 'rgba(113,113,122,0.22)',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseHour(t: string): number { return parseInt(t.split(':')[0], 10); }
function parseMin(t: string):  number { return parseInt(t.split(':')[1], 10); }

/** Convert a 0-based hour (may be >23 for overnight continuation) to a
 *  12-hour AM/PM label, e.g. 0→"12:00 AM", 12→"12:00 PM", 13→"01:00 PM" */
function to12h(rawHour: number, minute = 0): string {
  const h24        = rawHour % 24;
  const ampm       = h24 >= 12 ? 'PM' : 'AM';
  const displayH   = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm         = String(minute).padStart(2, '0');
  return `${String(displayH).padStart(2, '0')}:${mm} ${ampm}`;
}

/** Long label for dropdown options: adds "(Midnight)" / "(Noon)" hints. */
function hourOptionLabel(h: number): string {
  const base = to12h(h);
  if (h % 24 === 0)  return `${base} (Midnight)`;
  if (h % 24 === 12) return `${base} (Noon)`;
  return base;
}

/** Miniature padel court etched into each column header — low-opacity
 *  wireframe strokes only, pure decoration behind the court label. */
function CourtHeaderLines() {
  return (
    <svg
      viewBox="0 0 120 58" preserveAspectRatio="none" aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, pointerEvents: 'none' }}
    >
      <rect x="18" y="10" width="84" height="40" rx="3"
        stroke="var(--border-focus)" strokeWidth="1" fill="none" opacity="0.35" />
      <line x1="60" y1="10" x2="60" y2="50" stroke="var(--border-focus)" strokeWidth="1" strokeDasharray="2 3" opacity="0.3" />
      <line x1="32" y1="10" x2="32" y2="50" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
      <line x1="88" y1="10" x2="88" y2="50" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
      <line x1="32" y1="30" x2="88" y2="30" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

/**
 * Pointer-aware radial glow: writes the registered --mx/--my custom
 * properties straight onto the column's glow layer (its first child),
 * so cursor tracking never touches React state or triggers re-renders.
 */
function trackSlotGlow(e: React.PointerEvent<HTMLDivElement>) {
  const glow = e.currentTarget.firstElementChild as HTMLElement | null;
  if (!glow || !glow.classList.contains('slot-glow')) return;
  const r = e.currentTarget.getBoundingClientRect();
  glow.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  glow.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

function getPaymentState(b: Booking) {
  const totalPaid   = Number(b.deposit_amount) + Number(b.remainder_amount);
  const isFullyPaid = totalPaid >= Number(b.total_price) && Number(b.total_price) > 0;
  const isPartial   = totalPaid > 0 && !isFullyPaid;
  if (isFullyPaid) return { label: 'Fully Paid',      color: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: '#059669' };
  if (isPartial)   return { label: 'Partial/Deposit', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: '#d97706' };
  return              { label: 'Unpaid',             color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: '#dc2626' };
}

// ── Block Time Slot Modal ─────────────────────────────────────────────────────
interface BlockModalProps {
  courts: Court[];
  workingHours: WorkingHour[];
  selectedDate: Date;
  onClose: () => void;
  onCreated: () => void;
}

function BlockModal({ courts, workingHours, selectedDate, onClose, onCreated }: BlockModalProps) {
  const dateStr   = format(toZonedTime(selectedDate, TIMEZONE), 'yyyy-MM-dd');
  const dayOfWeek = toZonedTime(selectedDate, TIMEZONE).getDay();
  const todayWH   = workingHours.find((w) => w.day_of_week === dayOfWeek);

  // Full 24-hour range – admins are not restricted to the venue's
  // operational window when creating blocked periods.
  const hourOptions: number[] = Array.from({ length: 24 }, (_, i) => i);

  const [courtId,     setCourtId]     = useState<string>('');
  const [reasonType,  setReasonType]  = useState<ReasonType>('MAINTENANCE');
  const [title,       setTitle]       = useState('');
  const [startHour,   setStartHour]   = useState(0);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour,     setEndHour]     = useState(1);
  const [endMinute,   setEndMinute]   = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState(false);

  const pad = (n: number) => String(n).padStart(2, '0');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (startHour * 60 + startMinute >= endHour * 60 + endMinute) {
      setError('End time must be after start time.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const startAt = fromZonedTime(
        new Date(`${dateStr}T${pad(startHour)}:${pad(startMinute)}:00`), TIMEZONE
      ).toISOString();
      const endAt = fromZonedTime(
        new Date(`${dateStr}T${pad(endHour)}:${pad(endMinute)}:00`), TIMEZONE
      ).toISOString();

      await api.post('/courts/blocked-periods', {
        courtId:    courtId || null,
        reasonType,
        title:      title.trim() || REASON_CONFIG[reasonType].label,
        startAt,
        endAt,
        recurring:  false,
      });
      setSuccess(true);
      setTimeout(() => onCreated(), 600);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to create blocked period.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: 14,
    outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.07em', color: 'var(--text-tertiary)',
    marginBottom: 5, display: 'block',
  };
  const cfg = REASON_CONFIG[reasonType];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 20 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: 28,
          width: '100%',
          maxWidth: 500,
          boxShadow: '0 32px 100px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>🚫 Block Time Slot</h2>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              {format(toZonedTime(selectedDate, TIMEZONE), 'EEEE, MMM d yyyy')}
              {todayWH && !todayWH.is_closed && (
                <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
                  · Open {todayWH.open_time.slice(0,5)}–{todayWH.close_time.slice(0,5)}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4, lineHeight: 1 }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Reason Type */}
          <div>
            <label style={labelStyle}>Reason Type *</label>
            <select
              value={reasonType}
              onChange={(e) => setReasonType(e.target.value as ReasonType)}
              style={{ ...inputStyle, cursor: 'pointer' }}
              required
            >
              {(Object.entries(REASON_CONFIG) as [ReasonType, typeof REASON_CONFIG[ReasonType]][]).map(([key, c]) => (
                <option key={key} value={key}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label style={labelStyle}>Title / Description</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. ${cfg.label} – Court 1`}
              maxLength={120}
              style={inputStyle}
            />
          </div>

          {/* Court */}
          <div>
            <label style={labelStyle}>Applies to</label>
            <select
              value={courtId}
              onChange={(e) => setCourtId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— All Courts —</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>Court {c.number} · {c.name}</option>
              ))}
            </select>
          </div>

          {/* Time pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Start Time</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}>
                  {hourOptions.map((h) => <option key={h} value={h}>{hourOptionLabel(h)}</option>)}
                </select>
                <select value={startMinute} onChange={(e) => setStartMinute(Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer', width: 72 }}>
                  {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>End Time</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}>
                  {hourOptions.map((h) => <option key={h} value={h}>{hourOptionLabel(h)}</option>)}
                </select>
                <select value={endMinute} onChange={(e) => setEndMinute(Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer', width: 72 }}>
                  {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Live preview badge */}
          <motion.div
            key={reasonType}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', borderRadius: 10,
              background: cfg.bg,
              border: `1px solid ${cfg.border}55`,
            }}
          >
            <span style={{ fontSize: 22 }}>{cfg.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: cfg.textColor }}>{cfg.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {to12h(startHour, startMinute)} – {to12h(endHour, endMinute)}
                {' · '}
                {courtId ? courts.find((c) => c.id === courtId)?.name ?? 'Selected Court' : 'All Courts'}
              </div>
            </div>
          </motion.div>

          {/* Error / Success feedback */}
          <AnimatePresence>
            {error && (
              <motion.div key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 8 }}>
                <XCircle size={14} /> {error}
              </motion.div>
            )}
            {success && (
              <motion.div key="ok" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.1)',
                  border: '1px solid rgba(16,185,129,0.25)', color: '#10b981', fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={14} /> Blocked period created!
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '11px 0', borderRadius: 10,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                color: 'var(--text-secondary)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
            <motion.button
              type="submit"
              disabled={loading || success}
              whileHover={(loading || success) ? {} : { scale: 1.01, backgroundColor: '#b91c1c' }}
              whileTap={{ scale: (loading || success) ? 1 : 0.97 }}
              transition={{ duration: 0.15 }}
              style={{
                flex: 2, padding: '11px 16px', borderRadius: 6, border: 'none',
                background: (loading || success) ? 'var(--bg-secondary)' : '#dc2626',
                color: (loading || success) ? 'var(--text-tertiary)' : '#fff',
                fontWeight: 500, fontSize: 14, cursor: (loading || success) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: (loading || success) ? 'none' : '0 4px 16px rgba(220,38,38,0.35)',
              }}
            >
              {loading
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Blocking…</>
                : success
                  ? <><CheckCircle2 size={14} /> Done!</>
                  : <><Plus size={14} /> Block Slot</>}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// Maps raw DB lowercase strings → frontend uppercase REASON_CONFIG keys.
// Acts as defence-in-depth for any cached or legacy API responses that
// still carry lowercase values even after the server-side fix.
const DB_TO_REASON_TYPE: Record<string, ReasonType> = {
  maintenance:   'MAINTENANCE',
  tournament:    'TOURNAMENT',
  private_event: 'TRAINING',
  other:         'ADMIN_CLOSED',
  holiday:       'ADMIN_CLOSED',
  // Pass-through for already-uppercase values
  MAINTENANCE:   'MAINTENANCE',
  TOURNAMENT:    'TOURNAMENT',
  TRAINING:      'TRAINING',
  ADMIN_CLOSED:  'ADMIN_CLOSED',
};

function normaliseBlockedPeriods(raw: unknown[]): BlockedPeriod[] {
  return (raw as BlockedPeriod[]).map((bp) => ({
    ...bp,
    reason_type: DB_TO_REASON_TYPE[bp.reason_type] ?? 'ADMIN_CLOSED',
  }));
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const { user } = useAuthStore();
  const isOwner  = user?.role === 'owner';
  const isStaff  = isOwner || user?.role === 'receptionist';

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [courts,       setCourts]       = useState<Court[]>([]);
  const [bookings,     setBookings]     = useState<Booking[]>([]);
  const [blocked,      setBlocked]      = useState<BlockedPeriod[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHour[]>([]);
  const [selected,     setSelected]     = useState<Booking | null>(null);
  const [showModal,    setShowModal]    = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const dateStr   = format(toZonedTime(selectedDate, TIMEZONE), 'yyyy-MM-dd');
  const dayOfWeek = toZonedTime(selectedDate, TIMEZONE).getDay();
  const todayWH   = workingHours.find((w) => w.day_of_week === dayOfWeek);

  // Dynamic grid window from working hours.
  // Overnight-safe: if closeHour < startHour the shift crosses midnight.
  // We normalize by adding 24 to closeHour so the span is always positive,
  // then display each hour label as (rawHour % 24).
  const gridStartHour = todayWH && !todayWH.is_closed ? parseHour(todayWH.open_time)  : 6;
  const gridEndHourRaw = todayWH && !todayWH.is_closed ? parseHour(todayWH.close_time) : 23;
  const gridEndHour    = gridEndHourRaw < gridStartHour ? gridEndHourRaw + 24 : gridEndHourRaw;
  // HOURS contains the raw hour values (may be > 23 for post-midnight slots)
  const HOURS = Array.from({ length: Math.max(gridEndHour - gridStartHour + 1, 1) }, (_, i) => i + gridStartHour);

  // ── Grid virtualization ─────────────────────────────────────────────
  // A dense day (many courts × long opening hours × hundreds of bookings)
  // used to mount every hour row, court column and booking card at once,
  // which chokes the DOM on low-end receptionist machines. Both axes are
  // virtualized with @tanstack/react-virtual: only the hour rows and court
  // columns intersecting the scroll viewport (plus a small overscan) are
  // kept in the active DOM tree, and booking/blocked cards are culled to
  // the visible pixel window, so scrolling stays smooth at any density.
  const TIME_AXIS_W = 80;   // px — sticky time gutter
  const HEADER_H    = 58;   // px — sticky court header row
  const MIN_COL_W   = 200;  // px — court column floor before horizontal scroll kicks in

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setGridWidth(entries[0].contentRect.width));
    ro.observe(el);
    setGridWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Columns stretch to fill the container until MIN_COL_W, then overflow-x
  const colWidth = Math.max(
    MIN_COL_W,
    courts.length > 0 ? (gridWidth - TIME_AXIS_W) / courts.length : MIN_COL_W
  );

  const rowVirtualizer = useVirtualizer({
    count: HOURS.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HOUR_HEIGHT,
    overscan: 3,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: courts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => colWidth,
    overscan: 1,
  });

  // Column width is responsive; force the virtualizer to pick up new sizes
  useEffect(() => { columnVirtualizer.measure(); }, [colWidth, columnVirtualizer]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();
  const rowsTotal   = rowVirtualizer.getTotalSize();
  const colsTotal   = columnVirtualizer.getTotalSize();

  // Visible pixel window (incl. overscan) used to cull absolutely-positioned
  // booking/blocked cards that live outside the rendered rows.
  const visibleTop    = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const visibleBottom = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].end : 0;

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([
      api.get('/courts'),
      api.get(`/dashboard/schedule?date=${dateStr}`),
      api.get('/settings/working-hours'),
    ]).then(([courtsRes, scheduleRes, whRes]) => {
      if (cancelled) return;

      const sortedCourts = (courtsRes.data?.data || courtsRes.data || [])
        .sort((a: Court, b: Court) => a.number - b.number);
      setCourts(sortedCourts);

      // New response shape: { bookings, blockedPeriods }; fall back to old plain array
      const schedData = scheduleRes.data;
      if (Array.isArray(schedData)) {
        setBookings(schedData);
        setBlocked([]);
      } else {
        setBookings(schedData?.bookings ?? []);
        // Normalise reason_type to uppercase before storing – guards against
        // legacy cached responses still carrying raw lowercase DB values.
        setBlocked(normaliseBlockedPeriods(schedData?.blockedPeriods ?? []));
      }

      setWorkingHours(Array.isArray(whRes.data) ? whRes.data : []);
    }).catch((err: unknown) => {
      if (cancelled) return;
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to load the schedule. Please try again.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [dateStr]);

  useEffect(load, [load]);

  function getBookingsForCourt(courtId: string): Booking[] {
    return bookings.filter((b) => b.court_id === courtId);
  }

  function getBlockedForCourt(courtId: string): BlockedPeriod[] {
    // Includes "all courts" blocks (court_id === null) and court-specific ones
    return blocked.filter((bp) => bp.court_id === null || bp.court_id === courtId);
  }

  // Top pixel offset relative to the dynamic grid start hour.
  // Overnight-safe: if the slot's hour has crossed midnight within the
  // same business shift (e.g. open=12, slot=01:00), add 24 so the
  // offset stays positive and proportional.
  function topOffset(isoTime: string): number {
    const t = toZonedTime(new Date(isoTime), TIMEZONE);
    let hours = t.getHours();
    if (hours < gridStartHour) hours += 24;
    const mins = (hours - gridStartHour) * 60 + t.getMinutes();
    return Math.max((mins / 60) * HOUR_HEIGHT, 0);
  }

  function blockHeight(startIso: string, endIso: string): number {
    const durationH = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
    return Math.max(durationH * HOUR_HEIGHT, 0);
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Schedule Grid</h1>
          <p className="page-subtitle">
            Proportional court availability
            {todayWH && !todayWH.is_closed && (
              <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
                · Open {todayWH.open_time.slice(0,5)}–{todayWH.close_time.slice(0,5)}
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedDate((d) => subDays(d, 1))} aria-label="Previous day">
            <ChevronLeft size={14} />
          </button>
          <div style={{ padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
            {format(toZonedTime(selectedDate, TIMEZONE), 'EEEE, dd MMM yyyy')}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedDate((d) => addDays(d, 1))} aria-label="Next day">
            <ChevronRight size={14} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedDate(new Date())}>Today</button>

          {/* Block Slot button – owner only */}
          {isOwner && (
            <motion.button
              onClick={() => setShowModal(true)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%)',
                color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(153,27,27,0.4)',
              }}
            >
              <Plus size={14} /> Block Slot
            </motion.button>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        paddingBottom: 14, marginBottom: 20,
        borderBottom: '1px solid rgba(39,39,42,0.8)',
      }}>
        {(Object.entries(REASON_CONFIG) as [ReasonType, typeof REASON_CONFIG[ReasonType]][]).map(([key, cfg]) => (
          <div key={key} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 13px', borderRadius: 999,
            border: `1px solid ${cfg.pillBorder}`,
            background: cfg.pillBg,
            fontSize: 11, fontWeight: 600, color: cfg.textColor,
            letterSpacing: '0.02em',
          }}>
            <span style={{ lineHeight: 1 }}>{cfg.icon}</span>
            <span>{cfg.label}</span>
          </div>
        ))}
        {/* Normal Booking pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 13px', borderRadius: 999,
          border: '1px solid rgba(16,185,129,0.22)',
          background: 'rgba(16,185,129,0.08)',
          fontSize: 11, fontWeight: 600, color: '#34d399',
          letterSpacing: '0.02em',
        }}>
          <span style={{ lineHeight: 1 }}>🟢</span>
          <span>Normal Booking</span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Grid Container (virtualized on both axes) ── */}
      <motion.div layoutScroll ref={scrollRef} style={{
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 260px)',
        background: 'rgb(5,5,7)',
        border: '1px solid rgba(63,63,70,0.8)',
        borderRadius: 16,
        padding: 0,
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}>
        {loading ? (
          <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" style={{ color: 'var(--text-tertiary)', width: 24, height: 24 }} />
          </div>
        ) : courts.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No courts available.</div>
        ) : (
          <div style={{ width: TIME_AXIS_W + colsTotal }}>

            {/* ── Column headers (sticky top, virtualized) ── */}
            <div style={{
              display: 'flex',
              borderBottom: '2px solid rgba(63,63,70,0.9)',
              background: 'rgba(9,9,11,0.97)',
              backdropFilter: 'blur(16px)',
              position: 'sticky', top: 0, zIndex: 30,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              height: HEADER_H,
            }}>
              {/* Corner spacer that aligns with the time-axis (sticky on both axes) */}
              <div style={{
                width: TIME_AXIS_W, flexShrink: 0,
                borderRight: '1px solid rgba(63,63,70,0.7)',
                background: 'rgba(5,5,7,0.98)',
                position: 'sticky', left: 0, zIndex: 31,
              }} />
              <div style={{ position: 'relative', width: colsTotal, height: '100%' }}>
                {virtualCols.map((vc) => {
                  const court = courts[vc.index];
                  return (
                    <div key={court.id} style={{
                      position: 'absolute',
                      left: vc.start, width: vc.size, top: 0, height: '100%',
                      padding: '13px 16px 11px',
                      borderRight: '1px solid rgba(63,63,70,0.7)',
                      textAlign: 'center',
                      boxSizing: 'border-box',
                    }}>
                      {/* Miniature court wireframe backdrop */}
                      <CourtHeaderLines />
                      {/* Subtle top accent bar */}
                      <div style={{
                        position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
                        background: `linear-gradient(90deg, transparent, ${['#7c3aed','#2563eb','#0891b2','#059669','#d97706'][vc.index % 5]}88, transparent)`,
                        borderRadius: '0 0 4px 4px',
                      }} />
                      <div style={{
                        position: 'relative',
                        fontSize: 13, fontWeight: 800,
                        color: '#f4f4f5',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}>Court {court.number}</div>
                      <div style={{ position: 'relative', fontSize: 10, color: '#71717a', marginTop: 3, fontWeight: 500, letterSpacing: '0.03em' }}>{court.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Time grid ── */}
            <div style={{ display: 'flex', position: 'relative' }}>

              {/* Time axis – sticky left, virtualized rows */}
              <div style={{
                width: TIME_AXIS_W, flexShrink: 0,
                borderRight: '2px solid rgba(63,63,70,0.8)',
                position: 'sticky', left: 0,
                zIndex: 20,
                background: 'rgb(5,5,7)',
                height: rowsTotal,
              }}>
                {virtualRows.map((vr) => {
                  const hour        = HOURS[vr.index];
                  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                  const ampm        = (hour % 24) >= 12 ? 'PM' : 'AM';
                  const isMidnight  = (hour % 24) === 0;
                  const isNoon      = (hour % 24) === 12;
                  const isEven      = vr.index % 2 === 0;
                  return (
                    <div key={hour} style={{
                      position: 'absolute',
                      top: vr.start, left: 0, right: 0,
                      height: vr.size,
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      paddingTop: 6,
                      background: isEven ? 'rgba(24,24,27,0.35)' : 'rgb(5,5,7)',
                      borderBottom: '1px solid rgba(63,63,70,0.55)',
                      boxSizing: 'border-box',
                    }}>
                      <span style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: isMidnight ? '#a1a1aa' : isNoon ? '#34d399' : '#52525b',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        letterSpacing: '0.06em',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        textShadow: isNoon ? '0 0 8px rgba(52,211,153,0.4)' : 'none',
                      }}>
                        {String(displayHour).padStart(2, '0')}:00<br />
                        <span style={{ fontSize: 8, opacity: 0.7 }}>{ampm}</span>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Courts wrapper — only columns intersecting the viewport mount */}
              <div style={{ position: 'relative', width: colsTotal, height: rowsTotal }}>

                {/* Court columns (virtualized) */}
                {virtualCols.map((vc) => {
                  const court = courts[vc.index];
                  const courtBookings = getBookingsForCourt(court.id);
                  const courtBlocked  = getBlockedForCourt(court.id);

                  return (
                    <div key={court.id} onPointerMove={trackSlotGlow} style={{
                      position: 'absolute',
                      left: vc.start, width: vc.size,
                      top: 0, height: rowsTotal,
                      borderRight: '1px solid rgba(63,63,70,0.7)',
                      boxSizing: 'border-box',
                      zIndex: 10,
                    }}>
                      {/* Pointer-tracked radial glow layer — must stay first child */}
                      <div className="slot-glow" aria-hidden />
                      {/* Zebra row backgrounds + horizontal grid lines (visible rows only) */}
                      {virtualRows.map((vr) => (
                        <div key={HOURS[vr.index]} style={{
                          position: 'absolute',
                          top: vr.start,
                          left: 0, right: 0,
                          height: vr.size,
                          background: vr.index % 2 === 0
                            ? 'rgba(24,24,27,0.35)'
                            : 'transparent',
                          borderBottom: (HOURS[vr.index] % 24) === 11 || (HOURS[vr.index] % 24) === 23
                            ? '1px solid rgba(99,102,241,0.12)'
                            : '1px solid rgba(63,63,70,0.45)',
                          boxSizing: 'border-box',
                          pointerEvents: 'none',
                          zIndex: 0,
                        }} />
                      ))}

                      {/* ── Blocked period blocks (non-clickable, culled to viewport) ── */}
                      {courtBlocked.map((bp) => {
                        const cfg   = REASON_CONFIG[bp.reason_type] ?? REASON_CONFIG.ADMIN_CLOSED;
                        const top   = topOffset(bp.start_at);
                        const h     = blockHeight(bp.start_at, bp.end_at);
                        if (h <= 0) return null;
                        // Skip cards entirely outside the rendered row window
                        if (top >= visibleBottom || top + h <= visibleTop) return null;
                        const startLbl = format(toZonedTime(new Date(bp.start_at), TIMEZONE), 'hh:mm aa');
                        const endLbl   = format(toZonedTime(new Date(bp.end_at),   TIMEZONE), 'hh:mm aa');

                        return (
                          <motion.div
                            key={bp.id}
                            layout
                            layoutId={`schedule-${court.id}-${bp.id}`}
                            initial={false}
                            transition={SPRING_GRID}
                            title={isStaff ? `${cfg.icon} ${bp.title} (${startLbl}–${endLbl})` : cfg.publicLabel}
                            style={{
                              position: 'absolute', top, height: h, left: 3, right: 3,
                              background: cfg.cardBg,
                              borderLeft: `4px solid ${cfg.borderL}`,
                              border: `1px solid ${cfg.border}`,
                              borderLeftWidth: 4,
                              borderRadius: 8,
                              padding: '7px 10px',
                              overflow: 'hidden',
                              zIndex: 20,
                              cursor: 'not-allowed',
                              display: 'flex', flexDirection: 'column', gap: 3,
                              boxShadow: `0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)`,
                              backdropFilter: 'blur(6px)',
                              userSelect: 'none',
                              pointerEvents: 'all',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 13, lineHeight: 1 }}>{cfg.icon}</span>
                              <span style={{
                                fontSize: 11, fontWeight: 700,
                                color: cfg.textColor,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {isStaff ? (bp.title || cfg.label) : cfg.publicLabel}
                              </span>
                            </div>
                            {h > 44 && (
                              <span style={{
                                fontSize: 10, fontWeight: 500,
                                color: cfg.textColor, opacity: 0.65,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              }}>
                                {startLbl}–{endLbl}
                              </span>
                            )}
                            {isOwner && h > 64 && (
                              <span style={{
                                fontSize: 9, fontWeight: 700,
                                letterSpacing: '0.07em', textTransform: 'uppercase',
                                color: cfg.textColor, opacity: 0.45,
                                marginTop: 'auto',
                              }}>
                                {bp.reason_type.replace('_', ' ')}
                              </span>
                            )}
                          </motion.div>
                        );
                      })}

                      {/* ── Booking blocks (clickable, culled to viewport) ── */}
                      {courtBookings.map((b) => {
                        const startCairo = toZonedTime(new Date(b.start_time), TIMEZONE);
                        let startHours = startCairo.getHours();
                        if (startHours < gridStartHour) startHours += 24; // overnight shift
                        const mins = (startHours - gridStartHour) * 60 + startCairo.getMinutes();
                        const top  = Math.max((mins / 60) * HOUR_HEIGHT, 0);
                        const h    = (b.duration_minutes / 60) * HOUR_HEIGHT;
                        // Skip cards entirely outside the rendered row window
                        if (top >= visibleBottom || top + h <= visibleTop) return null;
                        const pay  = getPaymentState(b);

                        return (
                          <motion.div
                            key={b.id}
                            // Shared layoutId: cells morph via spring physics
                            // when the grid geometry changes instead of snapping
                            layout
                            layoutId={`schedule-${court.id}-${b.id}`}
                            // No mount animation: virtualized cards re-mount on
                            // every scroll-in and a fade would read as flicker
                            initial={false}
                            animate={{ opacity: 1, scale: 1 }}
                            whileHover={{ scale: 1.015, zIndex: 30 }}
                            transition={SPRING_GRID}
                            onClick={() => setSelected(b)}
                            role="button"
                            aria-label={`Booking for ${b.first_name} ${b.last_name}`}
                            style={{
                              position: 'absolute', top, height: h, left: 4, right: 4,
                              background: 'rgba(6,46,37,0.55)',
                              borderLeft: '4px solid #10b981',
                              border: '1px solid rgba(16,185,129,0.22)',
                              borderLeftWidth: 4,
                              borderRadius: 8,
                              padding: '8px 10px',
                              cursor: 'pointer',
                              overflow: 'hidden',
                              backdropFilter: 'blur(6px)',
                              boxShadow: '0 4px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
                              display: 'flex', flexDirection: 'column', gap: 4,
                              zIndex: 15,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700,
                                  color: '#f4f4f5',
                                  whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden',
                                  lineHeight: 1.4,
                                }}>
                                  {b.first_name} {b.last_name}
                                </span>
                                {b.customer_phone && (
                                  <span style={{
                                    fontSize: 10, color: '#a1a1aa',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                    letterSpacing: '0.02em',
                                  }}>{b.customer_phone}</span>
                                )}
                              </div>
                              <StateChip status={b.status} size="sm" />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 'auto' }}>
                              <div style={{ width: 5, height: 5, borderRadius: '50%', background: pay.border, flexShrink: 0 }} />
                              <span style={{ fontSize: 10, color: pay.color, fontWeight: 600, letterSpacing: '0.02em' }}>{pay.label}</span>
                            </div>

                            <div style={{
                              fontSize: 10, color: '#71717a',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              fontWeight: 500, lineHeight: 1.4,
                            }}>
                              {(() => {
                                const dep    = Number(b.deposit_amount);
                                const rem    = Number(b.remainder_amount);
                                const total  = Number(b.total_price);
                                const unpaid = Math.max(total - dep - rem, 0);
                                const depStr    = dep > 0 ? `Paid: ${dep.toFixed(0)} EGP (${(b.deposit_method || 'CASH').replace('_', ' ')})` : null;
                                const remStr    = rem > 0 ? `+ ${rem.toFixed(0)} EGP (${(b.remainder_method || 'CASH').replace('_', ' ')})` : null;
                                const unpaidStr = unpaid > 0 ? `Remainder: ${unpaid.toFixed(0)} EGP UNPAID` : null;
                                return (
                                  <>
                                    <span>{[depStr, remStr].filter(Boolean).join(' ') || 'Paid: 0 EGP'}</span>
                                    {unpaidStr && (
                                      <span style={{
                                        display: 'block', color: '#f87171',
                                        fontWeight: 700, marginTop: 2,
                                      }}>⚠ {unpaidStr}</span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Booking detail sheet ── */}
      <BookingSheet open={!!selected} onClose={() => setSelected(null)} title="Booking Details">
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StateChip status={selected.status} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: 20 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: getPaymentState(selected).border }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: getPaymentState(selected).color }}>{getPaymentState(selected).label}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg-secondary)', padding: 16, borderRadius: 12 }}>
              {[
                ['Customer', `${selected.first_name} ${selected.last_name}`],
                ['Phone',    selected.customer_phone || 'N/A'],
                ['Court',    selected.court_name],
                ['Start',    format(toZonedTime(new Date(selected.start_time), TIMEZONE), 'hh:mm aa · dd/MM/yyyy')],
                ['Duration', `${selected.duration_minutes} minutes`],
                ['Financials', `${(Number(selected.deposit_amount) + Number(selected.remainder_amount)).toFixed(2)} EGP paid of ${Number(selected.total_price).toFixed(2)} EGP total`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    {label === 'Court' && <CourtBlueprint width={34} animate />}
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <a href={`/dashboard/bookings/${selected.id}`} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Manage Booking
              </a>
              {selected.status === 'confirmed' && (
                <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={async () => { await api.patch(`/bookings/${selected.id}/checkin`); setSelected(null); window.location.reload(); }}>
                  Check In ✓
                </button>
              )}
            </div>
          </div>
        )}
      </BookingSheet>

      {/* ── Block Time Slot modal ── */}
      <AnimatePresence>
        {showModal && isOwner && (
          <BlockModal
            courts={courts}
            workingHours={workingHours}
            selectedDate={selectedDate}
            onClose={() => setShowModal(false)}
            onCreated={() => { setShowModal(false); load(); }}
          />
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }

        /* Pointer-aware radial glow. Registered custom properties let the
           cursor position itself be transitioned natively by the compositor;
           values are written straight to the DOM (no React re-renders). */
        @property --mx { syntax: '<percentage>'; inherits: false; initial-value: 50%; }
        @property --my { syntax: '<percentage>'; inherits: false; initial-value: 50%; }
        .slot-glow {
          --mx: 50%;
          --my: 50%;
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          opacity: 0;
          background: radial-gradient(160px circle at var(--mx) var(--my),
            rgba(34,197,94,0.08), transparent 70%);
          transition:
            opacity var(--dur-normal) var(--ease-standard),
            --mx var(--dur-fast) linear,
            --my var(--dur-fast) linear;
        }
        div:hover > .slot-glow { opacity: 1; }
      `}</style>
    </div>
  );
}
