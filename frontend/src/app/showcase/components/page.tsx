'use client';

/**
 * Component Library strip (screen 5.15).
 * Every primitive in the CourtFlow design system, live and interactive:
 * buttons, inputs, badges, toggles, steppers, toasts, skeletons, modals.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarPlus, Check, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { Stepper } from '@/components/ui/Stepper';
import { StateChip, BookingStatus } from '@/components/StateChip';

const STATUSES: BookingStatus[] = [
  'draft', 'pending_deposit', 'pending_verification', 'confirmed',
  'checked_in', 'completed', 'cancelled', 'no_show', 'expired',
];

const LEDGER = ['paid', 'partial', 'pending', 'refunded'] as const;

interface ToastItem {
  id:      number;
  kind:    'success' | 'info' | 'warning' | 'error';
  title:   string;
  body:    string;
}

const TOAST_META = {
  success: { icon: <Check size={14} />,         color: 'var(--accent-green-text)' },
  info:    { icon: <Info size={14} />,          color: 'var(--info)' },
  warning: { icon: <AlertTriangle size={14} />, color: 'var(--warning)' },
  error:   { icon: <XCircle size={14} />,       color: 'var(--error)' },
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ fontSize: 15 }}>{title}</h3>
        {sub && <p style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ComponentsPage() {
  const [toggleA, setToggleA] = useState(true);
  const [toggleB, setToggleB] = useState(false);
  const [count, setCount]     = useState(2);
  const [inputValue, setInputValue] = useState('');
  const [selectValue, setSelectValue] = useState('court-1');
  const [busy, setBusy]       = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts]   = useState<ToastItem[]>([]);
  const [seg, setSeg]         = useState('week');

  function pushToast(kind: ToastItem['kind']) {
    const id = Date.now();
    const copy: Record<ToastItem['kind'], [string, string]> = {
      success: ['Booking confirmed', 'Court 2 · Friday 19:00 — the member has been emailed.'],
      info:    ['Heads up', 'Working hours change to 10:00–24:00 next week.'],
      warning: ['Deposit pending', '3 receipts are waiting for verification.'],
      error:   ['Slot unavailable', 'That hour was just booked by another member.'],
    };
    setToasts((t) => [...t, { id, kind, title: copy[kind][0], body: copy[kind][1] }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }

  function fakeBusy() {
    setBusy(true);
    setTimeout(() => { setBusy(false); pushToast('success'); }, 1400);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Component Library</h1>
          <p className="page-subtitle">The CourtFlow design system — every primitive, live</p>
        </div>
      </div>

      {/* Buttons */}
      <Section title="Buttons" sub="Primary carries the single green accent; everything else stays quiet.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={fakeBusy} disabled={busy}>
            {busy ? <span className="spinner" /> : <CalendarPlus size={14} />}
            {busy ? 'Booking…' : 'New Booking'}
          </button>
          <button className="btn btn-secondary" onClick={() => pushToast('info')}>Secondary</button>
          <button className="btn btn-ghost" onClick={() => pushToast('info')}>Ghost</button>
          <button className="btn btn-danger" onClick={() => pushToast('error')}>Danger</button>
          <button className="btn btn-primary" disabled>Disabled</button>
          <button className="btn btn-primary btn-sm" onClick={() => pushToast('success')}>Small</button>
          <button className="btn btn-secondary btn-lg" onClick={() => pushToast('info')}>Large</button>
        </div>
      </Section>

      {/* Inputs */}
      <Section title="Inputs" sub="Hairline borders, focus ring in border-strong.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="demo-text">Member name</label>
            <input
              id="demo-text"
              className="input"
              placeholder="Type to try me…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            {inputValue && (
              <span className="input-error" style={{ color: 'var(--accent-green-text)' }}>
                {inputValue.length} characters — live state
              </span>
            )}
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="demo-select">Court</label>
            <select
              id="demo-select"
              className="input"
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
            >
              <option value="court-1">Centre Court</option>
              <option value="court-2">Court 2 — Panoramic</option>
              <option value="court-3">Court 3 — Indoor</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="demo-error">With error</label>
            <input
              id="demo-error"
              className="input"
              style={{ borderColor: 'var(--error-border)' }}
              defaultValue="19:00 on a closed day"
              aria-invalid
            />
            <span className="input-error">The club is closed at the selected time.</span>
          </div>
        </div>
      </Section>

      {/* Toggles, steppers, segmented */}
      <Section title="Controls" sub="Toggle switches, the − / + stepper and segmented filters.">
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle checked={toggleA} onChange={setToggleA} label="Court open" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Court open — <strong style={{ color: 'var(--text-primary)' }}>{toggleA ? 'yes' : 'no'}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle checked={toggleB} onChange={setToggleB} label="Repeat weekly" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Repeat weekly — <strong style={{ color: 'var(--text-primary)' }}>{toggleB ? 'on' : 'off'}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Stepper value={count} onChange={setCount} min={0} max={8} ariaLabel="Racket count" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {count} × Carbon Pro · <strong style={{ color: 'var(--text-primary)' }}>EGP {count * 120}</strong>/hr
            </span>
          </div>
          <div className="seg-control">
            {['day', 'week', 'month'].map((s) => (
              <button key={s} className={`seg-item ${seg === s ? 'active' : ''}`} onClick={() => setSeg(s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Badges */}
      <Section title="Status badges" sub="Booking lifecycle states plus the payments-ledger set.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {STATUSES.map((s) => <StateChip key={s} status={s} />)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LEDGER.map((s) => (
            <span key={s} className={`badge badge-${s}`}>{s}</span>
          ))}
          <span className="repeat-chip" style={{ fontSize: 11 }}>⟳ WEEKLY VIP</span>
        </div>
      </Section>

      {/* Toasts */}
      <Section title="Toast alerts" sub="Fire one — they stack bottom-right and auto-dismiss.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.keys(TOAST_META) as ToastItem['kind'][]).map((k) => (
            <button key={k} className="btn btn-secondary btn-sm" onClick={() => pushToast(k)}>
              <span style={{ color: TOAST_META[k].color, display: 'inline-flex' }}>{TOAST_META[k].icon}</span>
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </Section>

      {/* Skeletons */}
      <Section title="Skeleton loaders" sub="Shimmer placeholders used on every data screen.">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: '40%' }} />
            <div className="skeleton" style={{ height: 14, width: '85%' }} />
            <div className="skeleton" style={{ height: 14, width: '70%' }} />
            <div className="skeleton" style={{ height: 90, marginTop: 8 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 108 }} />
            <div className="skeleton" style={{ height: 36, width: '60%' }} />
          </div>
        </div>
      </Section>

      {/* Modal */}
      <Section title="Modal" sub="Centered dialog on a blurred backdrop.">
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>Open confirmation modal</button>
      </Section>

      {/* Modal instance */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              className="overlay-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setModalOpen(false)}
            />
            <motion.div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label="Revoke subscription"
              initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-48%' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
              exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-48%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <h3>Revoke subscription?</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setModalOpen(false)} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              <p style={{ marginBottom: 20 }}>
                This cancels the remaining 9 weekly sessions on Centre Court.
                The member keeps every session already played.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Keep it</button>
                <button
                  className="btn btn-danger"
                  onClick={() => { setModalOpen(false); pushToast('success'); }}
                >
                  Revoke subscription
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast viewport */}
      <div className="toast-viewport" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className="toast"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span style={{ color: TOAST_META[t.kind].color, marginTop: 2, flexShrink: 0 }}>
                {TOAST_META[t.kind].icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.body}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ height: 22, padding: '0 4px' }}
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
