'use client';

/**
 * Weekly Calendar (screen 5.6).
 *
 *   · Mon–Sun columns × hourly rows across the operating day
 *   · Booking blocks tinted with each court's *identity* color
 *     (categorical — never status-based)
 *   · VIP subscription occurrences carry a loop "repeat" icon
 *   · Click an empty slot  → New Booking panel pre-filled with that time
 *   · Click a booking      → Booking Details panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Repeat, CalendarPlus } from 'lucide-react';
import { addDays, format, isSameDay, startOfWeek } from 'date-fns';
import { api } from '@/lib/api';
import { NewBookingPanel } from '@/components/NewBookingPanel';
import { BookingDetailsPanel } from '@/components/BookingDetailsPanel';
import { calendarBlockStyle, catColor } from '@/lib/chartColors';

const DAY_START_HOUR    = 0;   // full 24-hour coverage — 00:00 … 23:00
const DAY_END_HOUR      = 24;  // exclusive
const ROW_HEIGHT        = 52;  // px — must match .week-slot height
const DEFAULT_OPEN_HOUR = 8;   // grid auto-scrolls here on load (overridden by club hours)

interface Court {
  id:           string;
  name:         string;
  court_number: number;
}

interface CalBooking {
  id:               string;
  court_id:         string;
  court_name:       string;
  court_number:     number;
  status:           string;
  start_time:       string;
  end_time:         string;
  duration_minutes: number;
  first_name:       string;
  last_name:        string;
  subscription_id:  string | null;
}

const HIDDEN_STATUSES = ['cancelled', 'expired'];

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [courts, setCourts]       = useState<Court[]>([]);
  const [courtFilter, setCourtFilter] = useState<string>('all');
  const [bookings, setBookings]   = useState<CalBooking[]>([]);
  const [loading, setLoading]     = useState(true);

  const [newOpen, setNewOpen]     = useState(false);
  const [newStart, setNewStart]   = useState<Date | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  // Hour the grid scrolls to on first paint. The full 00:00–23:00 range is
  // always rendered (so no booking is ever hidden), but we open the viewport
  // on the club's earliest configured opening hour to spare users a scroll
  // through the empty overnight rows. Falls back to DEFAULT_OPEN_HOUR.
  const [openHour, setOpenHour]   = useState(DEFAULT_OPEN_HOUR);
  const gridRef        = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  const days  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i),
    []
  );

  useEffect(() => {
    api.get('/courts')
      .then(({ data }) => {
        const list: Court[] = Array.isArray(data) ? data : data.data ?? [];
        setCourts([...list].sort((a, b) => a.court_number - b.court_number));
      })
      .catch(() => { /* legend degrades gracefully */ });
  }, []);

  // Pull the club's configured operating hours to choose a sensible initial
  // scroll offset. We take the earliest opening hour across all open days so
  // the weekly grid lands on the working window regardless of which day it is.
  useEffect(() => {
    api.get('/settings/working-hours')
      .then(({ data }) => {
        const rows: { open_time?: string; is_closed?: boolean }[] = Array.isArray(data) ? data : [];
        const opens = rows
          .filter((r) => !r.is_closed && r.open_time)
          .map((r) => parseInt(r.open_time!.split(':')[0], 10))
          .filter((h) => Number.isFinite(h));
        if (opens.length) {
          setOpenHour(Math.min(Math.max(Math.min(...opens), 0), 23));
        }
      })
      .catch(() => { /* fall back to DEFAULT_OPEN_HOUR */ });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const from = weekStart.toISOString();
    const to   = addDays(weekStart, 7).toISOString();
    api.get(`/bookings?from=${from}&to=${to}&limit=500`)
      .then(({ data }) => setBookings(data.data ?? []))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [weekStart]);

  useEffect(load, [load]);

  // Land the viewport on the working window once, after the grid first paints.
  // Guarded by a ref so it never yanks the user's scroll on later re-renders.
  useEffect(() => {
    if (loading || hasAutoScrolled.current || !gridRef.current) return;
    gridRef.current.scrollTop = openHour * ROW_HEIGHT;
    hasAutoScrolled.current = true;
  }, [loading, openHour]);

  // Stable identity color per court (sorted by number — matches every chart)
  const courtIndex = useMemo(() => {
    const map = new Map<string, number>();
    courts.forEach((c, i) => map.set(c.id, i));
    return map;
  }, [courts]);

  const visible = useMemo(
    () => bookings.filter((b) =>
      !HIDDEN_STATUSES.includes(b.status)
      && (courtFilter === 'all' || b.court_id === courtFilter)
    ),
    [bookings, courtFilter]
  );

  /** Bookings that start on `day` at `hour`, with layout info for overlaps. */
  function eventsAt(day: Date, hour: number): CalBooking[] {
    return visible.filter((b) => {
      const s = new Date(b.start_time);
      return isSameDay(s, day) && s.getHours() === hour;
    });
  }

  function openSlot(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    setNewStart(start);
    setNewOpen(true);
  }

  const today = new Date();

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">
            {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            className="input"
            style={{ width: 170, height: 32, fontSize: 13 }}
            value={courtFilter}
            onChange={(e) => setCourtFilter(e.target.value)}
            aria-label="Filter by court"
          >
            <option value="all">All courts</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="seg-control">
            <button className="seg-item" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week">
              <ChevronLeft size={13} />
            </button>
            <button className="seg-item" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Today
            </button>
            <button className="seg-item" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week">
              <ChevronRight size={13} />
            </button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setNewStart(null); setNewOpen(true); }}>
            <CalendarPlus size={13} />
            New Booking
          </button>
        </div>
      </div>

      {/* Court identity legend */}
      {courts.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 12 }}>
          {courts.map((c, i) => (
            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(i) }} />
              {c.name}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
            <Repeat size={11} style={{ color: 'var(--accent-green-text)' }} />
            weekly VIP
          </span>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 480, borderRadius: 12 }} />
      ) : (
        <div className="week-grid" ref={gridRef} role="grid" aria-label="Weekly booking calendar">
          {/* Header row */}
          <div className="week-head-cell" style={{ borderLeft: 'none' }} aria-hidden />
          {days.map((d) => (
            <div key={d.toISOString()} className={`week-head-cell ${isSameDay(d, today) ? 'today' : ''}`}>
              {format(d, 'EEE')}
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, textTransform: 'none', letterSpacing: 0 }}>
                {format(d, 'd')}
              </div>
            </div>
          ))}

          {/* Hour rows */}
          {hours.map((hour) => (
            <div key={hour} style={{ display: 'contents' }}>
              <div className="week-time-cell">{String(hour).padStart(2, '0')}:00</div>
              {days.map((day) => {
                const events = eventsAt(day, hour);
                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    className="week-slot"
                    role="gridcell"
                    onClick={() => events.length === 0 && openSlot(day, hour)}
                    aria-label={`${format(day, 'EEE d')} ${hour}:00`}
                  >
                    {events.map((b, idx) => {
                      const idxInCourts = courtIndex.get(b.court_id) ?? 0;
                      const style = calendarBlockStyle(idxInCourts);
                      const spanRows = Math.min(
                        b.duration_minutes / 60,
                        DAY_END_HOUR - hour
                      );
                      const width = 100 / events.length;
                      return (
                        <div
                          key={b.id}
                          className="week-event"
                          style={{
                            background: style.background,
                            borderColor: style.borderColor,
                            color: style.color,
                            height: spanRows * ROW_HEIGHT - 5,
                            left: `calc(${idx * width}% + 3px)`,
                            width: `calc(${width}% - 6px)`,
                            right: 'auto',
                          }}
                          onClick={(e) => { e.stopPropagation(); setDetailsId(b.id); }}
                          title={`${b.first_name} ${b.last_name} · ${b.court_name}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                            {b.subscription_id && <Repeat size={9} style={{ flexShrink: 0 }} aria-label="Weekly VIP subscription" />}
                            <span className="truncate">{b.first_name} {b.last_name}</span>
                          </div>
                          <div style={{ opacity: 0.75 }} className="truncate">
                            {b.court_name}{spanRows > 1 ? ` · ${b.duration_minutes / 60}h` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <NewBookingPanel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={load}
        initialStart={newStart}
        initialCourtId={courtFilter !== 'all' ? courtFilter : undefined}
      />
      <BookingDetailsPanel
        open={!!detailsId}
        bookingId={detailsId}
        onClose={() => setDetailsId(null)}
        onChanged={load}
      />
    </>
  );
}
