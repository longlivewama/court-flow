'use client';

/**
 * New Booking slide-over panel (screen 5.8).
 *
 * One panel serves both sides of the desk:
 *   staff (owner / receptionist)  – can book on behalf of any member
 *   customers                     – book for themselves
 *
 * Features:
 *   · court / date / start-hour / duration selection with live pricing
 *   · Add-ons & Equipment section — stepper counters recompute the total live
 *   · Repeat / Subscription toggle — weekly VIP slot for 1 or 3 months,
 *     routed to POST /api/subscriptions instead of a one-off booking
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Drawer } from '@/components/ui/Drawer';
import { EquipmentPicker } from '@/components/EquipmentPicker';
import { SubscriptionToggle, SubscriptionTerm } from '@/components/SubscriptionToggle';

interface Court {
  id:             string;
  name:           string;
  court_number:   number;
  price_per_hour: string | number;
  status:         string;
}

interface Customer {
  id:         string;
  first_name: string;
  last_name:  string;
  email:      string;
}

interface NewBookingPanelProps {
  open:            boolean;
  onClose:         () => void;
  onCreated?:      () => void;
  initialCourtId?: string;
  /** Local date-time of the clicked calendar slot */
  initialStart?:   Date | null;
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function NewBookingPanel({ open, onClose, onCreated, initialCourtId, initialStart }: NewBookingPanelProps) {
  const { user } = useAuthStore();
  const isStaff = user?.role === 'owner' || user?.role === 'receptionist';

  const [courts, setCourts]       = useState<Court[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [courtId, setCourtId]       = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate]             = useState(toDateInput(new Date()));
  const [startHour, setStartHour]   = useState(18);
  const [hours, setHours]           = useState(1);
  const [notes, setNotes]           = useState('');

  const [equipmentQty, setEquipmentQty]     = useState<Record<string, number>>({});
  const [equipmentTotal, setEquipmentTotal] = useState(0);

  const [repeat, setRepeat] = useState(false);
  const [term, setTerm]     = useState<SubscriptionTerm>(1);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [done, setDone]             = useState(false);

  // Reset the form each time the panel opens (optionally pre-filled from a
  // clicked calendar slot).
  useEffect(() => {
    if (!open) return;
    setError('');
    setDone(false);
    setNotes('');
    setEquipmentQty({});
    setEquipmentTotal(0);
    setRepeat(false);
    setTerm(1);
    setHours(1);
    if (initialStart) {
      setDate(toDateInput(initialStart));
      setStartHour(initialStart.getHours());
    }
    if (initialCourtId) setCourtId(initialCourtId);
  }, [open, initialStart, initialCourtId]);

  useEffect(() => {
    if (!open) return;
    api.get('/courts')
      .then(({ data }) => {
        const list: Court[] = Array.isArray(data) ? data : data.data ?? [];
        setCourts(list);
        setCourtId((prev) => prev || initialCourtId || list[0]?.id || '');
      })
      .catch(() => setError('Could not load courts'));

    if (isStaff) {
      api.get('/users')
        .then(({ data }) => setCustomers(data.data ?? []))
        .catch(() => { /* staff can still book for themselves */ });
    }
  }, [open, isStaff, initialCourtId]);

  const court = courts.find((c) => c.id === courtId);
  const courtPrice = Number(court?.price_per_hour ?? 0);

  const courtSubtotal = courtPrice * hours;
  const weeklyPrice   = courtSubtotal;                    // subscription price excludes add-ons
  const total         = repeat ? weeklyPrice : courtSubtotal + equipmentTotal;

  const startTimeISO = useMemo(() => {
    const hh = String(startHour).padStart(2, '0');
    return new Date(`${date}T${hh}:00:00`).toISOString();
  }, [date, startHour]);

  const handleEquipment = useCallback(
    (q: Record<string, number>, subtotal: number) => {
      setEquipmentQty(q);
      setEquipmentTotal(subtotal);
    },
    []
  );

  async function submit() {
    setError('');
    if (!courtId) return setError('Select a court');
    if (isStaff && !customerId) return setError('Select a member for this booking');

    setSubmitting(true);
    try {
      if (repeat) {
        await api.post('/subscriptions', {
          courtId,
          customerId: isStaff ? customerId : undefined,
          startTime:  startTimeISO,
          durationMinutes: hours * 60,
          termMonths: term,
          notes: notes || undefined,
        });
      } else {
        await api.post('/bookings', {
          court_id:    courtId,
          customer_id: isStaff ? customerId : undefined,
          start_time:  startTimeISO,
          duration_minutes: hours * 60,
          equipment: Object.entries(equipmentQty)
            .filter(([, qty]) => qty > 0)
            .map(([equipmentId, quantity]) => ({ equipmentId, quantity })),
          notes: notes || undefined,
        });
      }
      setDone(true);
      onCreated?.();
      setTimeout(onClose, 900);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(
        e.response?.data?.error?.message
        ?? e.response?.data?.message
        ?? 'Could not create the booking. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Booking"
      subtitle={repeat ? `Weekly VIP slot · ${term * 4} sessions` : 'Single session'}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {repeat ? 'Per week' : 'Total'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              EGP {total.toFixed(0)}
              {repeat && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-tertiary)' }}>
                  {' '}· EGP {(weeklyPrice * 4).toFixed(0)}/mo
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || done}>
            {done ? <Check size={14} /> : <CalendarPlus size={14} />}
            {done ? 'Booked' : submitting ? 'Booking…' : repeat ? 'Start Subscription' : 'Confirm Booking'}
          </button>
        </div>
      }
    >
      {/* Court */}
      <div className="input-group">
        <label className="input-label" htmlFor="nb-court">Court</label>
        <select
          id="nb-court"
          className="input"
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
        >
          {courts.map((c) => (
            <option key={c.id} value={c.id} disabled={c.status !== 'available'}>
              {c.name} · EGP {Number(c.price_per_hour).toFixed(0)}/hr
              {c.status !== 'available' ? ` (${c.status})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Member (staff only) */}
      {isStaff && (
        <div className="input-group">
          <label className="input-label" htmlFor="nb-customer">Member</label>
          <select
            id="nb-customer"
            className="input"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Select a member…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name} · {c.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* When */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="input-group">
          <label className="input-label" htmlFor="nb-date">Date</label>
          <input
            id="nb-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="nb-start">Start</label>
          <select
            id="nb-start"
            className="input"
            value={startHour}
            onChange={(e) => setStartHour(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="nb-hours">Duration</label>
          <select
            id="nb-hours"
            className="input"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Repeat / subscription */}
      <SubscriptionToggle
        enabled={repeat}
        term={term}
        onEnable={setRepeat}
        onTerm={setTerm}
        weeklyPrice={weeklyPrice}
      />

      {/* Add-ons */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Add-ons &amp; Equipment</div>
          {equipmentTotal > 0 && !repeat && (
            <span style={{ fontSize: 12, color: 'var(--accent-green-text)', fontVariantNumeric: 'tabular-nums' }}>
              + EGP {equipmentTotal.toFixed(0)}
            </span>
          )}
        </div>
        {repeat ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            Rental gear is added per visit — the front desk will attach it at check-in.
          </p>
        ) : (
          <EquipmentPicker hours={hours} quantities={equipmentQty} onChange={handleEquipment} />
        )}
      </div>

      {/* Notes */}
      <div className="input-group">
        <label className="input-label" htmlFor="nb-notes">Notes (optional)</label>
        <textarea
          id="nb-notes"
          className="input"
          rows={2}
          placeholder="Anything the front desk should know…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Price summary */}
      <div className="card-sm" style={{ background: 'var(--bg-elevated)' }}>
        <div className="price-row">
          <span>{court?.name ?? 'Court'} × {hours}h</span>
          <strong>EGP {courtSubtotal.toFixed(0)}</strong>
        </div>
        {!repeat && equipmentTotal > 0 && (
          <div className="price-row">
            <span>Equipment rental</span>
            <strong>EGP {equipmentTotal.toFixed(0)}</strong>
          </div>
        )}
        {repeat && (
          <div className="price-row">
            <span>{term * 4} weekly sessions</span>
            <strong>EGP {(weeklyPrice * term * 4).toFixed(0)}</strong>
          </div>
        )}
        <div className="price-row total">
          <span>{repeat ? 'Weekly total' : 'Total due'}</span>
          <strong>EGP {total.toFixed(0)}</strong>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--error-bg)', border: '1px solid var(--error-border)',
            color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </Drawer>
  );
}
