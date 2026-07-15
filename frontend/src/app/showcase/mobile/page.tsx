'use client';

/**
 * Mobile App UI (screen 5.14) — three live phone viewports:
 *   1. Home dashboard      — greeting, next session, quick stats
 *   2. Mini-calendar       — day strip + tappable hour scheduler
 *   3. Mobile booking      — add-on steppers + sticky "Continue to Pay"
 * All three are interactive React state machines, not static mockups.
 */
import { useMemo, useState } from 'react';
import {
  CalendarCheck, ChevronRight, Home, Search, User,
  Repeat, Bell, MapPin,
} from 'lucide-react';
import { Stepper } from '@/components/ui/Stepper';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [16, 17, 18, 19, 20, 21, 22];
/** Deterministic pseudo-availability so the demo is stable per day+hour. */
function isFree(day: number, hour: number): boolean {
  return (day * 7 + hour) % 3 !== 0;
}

const ADDONS = [
  { id: 'carbon', name: 'Carbon Pro', price: 120, icon: '🏓' },
  { id: 'balls',  name: 'Ball Tube',  price: 40,  icon: '🎾' },
];

function PhoneTabBar({ active }: { active: 'home' | 'book' | 'profile' }) {
  const items = [
    { key: 'home',    icon: <Home size={16} />,        label: 'Home' },
    { key: 'book',    icon: <CalendarCheck size={16} />, label: 'Book' },
    { key: 'profile', icon: <User size={16} />,        label: 'Profile' },
  ] as const;
  return (
    <div style={{
      display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)',
      padding: '10px 0 14px', flexShrink: 0,
    }}>
      {items.map((i) => (
        <div key={i.key} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          fontSize: 9.5, fontWeight: 500,
          color: i.key === active ? 'var(--accent-green-text)' : 'var(--text-tertiary)',
        }}>
          {i.icon}
          {i.label}
        </div>
      ))}
    </div>
  );
}

export default function MobileShowcasePage() {
  // Phone 2 state — mini-calendar
  const [selDay, setSelDay]   = useState(2);
  const [selHour, setSelHour] = useState<number | null>(19);

  // Phone 3 state — booking composer
  const [qty, setQty] = useState<Record<string, number>>({ carbon: 1 });
  const HOURS_BOOKED = 2;
  const COURT_RATE = 400;

  const addonTotal = useMemo(
    () => ADDONS.reduce((s, a) => s + (qty[a.id] ?? 0) * a.price * HOURS_BOOKED, 0),
    [qty]
  );
  const total = COURT_RATE * HOURS_BOOKED + addonTotal;

  const weekDates = useMemo(() => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return DAY_LABELS.map((_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.getDate();
    });
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mobile App UI</h1>
          <p className="page-subtitle">Member-facing app — three live viewports</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── Phone 1 · Home dashboard ─────────────────────── */}
        <div className="phone-frame">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Good evening</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Ahmed 👋</div>
              </div>
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: 'var(--surface)',
                border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--text-secondary)', position: 'relative',
              }}>
                <Bell size={15} />
                <span style={{
                  position: 'absolute', top: 7, right: 7, width: 6, height: 6,
                  borderRadius: 99, background: 'var(--accent-green)',
                }} />
              </div>
            </div>

            {/* Next session */}
            <div className="card-sm" style={{ background: 'var(--accent-green-bg)', borderColor: 'var(--success-border)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--accent-green-text)', marginBottom: 6 }}>
                Next session
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                Tonight · 19:00–21:00
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                <MapPin size={11} />
                Centre Court
                <span className="repeat-chip" style={{ marginLeft: 'auto' }}>
                  <Repeat size={10} /> VIP
                </span>
              </div>
            </div>

            {/* Quick stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Sessions', value: '18', sub: 'this season' },
                { label: 'Tier', value: 'Gold', sub: '2 to Platinum' },
              ].map((s) => (
                <div key={s.label} className="card-sm" style={{ background: 'var(--surface)' }}>
                  <div className="stat-label" style={{ fontSize: 9.5 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, margin: '2px 0' }}>{s.value}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Recent */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Recent activity</div>
              {[
                { t: 'Court 2 · 2h', d: 'Sun 12 Jul', s: 'completed' },
                { t: 'Centre Court · 1h', d: 'Thu 9 Jul', s: 'completed' },
                { t: 'Court 3 · 2h', d: 'Mon 6 Jul', s: 'cancelled' },
              ].map((r) => (
                <div key={r.d} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                  borderBottom: '1px solid var(--border)', fontSize: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.t}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{r.d}</div>
                  </div>
                  <span className={`badge badge-${r.s}`} style={{ fontSize: 9 }}>{r.s}</span>
                </div>
              ))}
            </div>
          </div>
          <PhoneTabBar active="home" />
        </div>

        {/* ── Phone 2 · Mini-calendar scheduler ─────────────── */}
        <div className="phone-frame">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Schedule</div>
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: 'var(--surface)',
                border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--text-secondary)',
              }}>
                <Search size={15} />
              </div>
            </div>

            {/* Day strip */}
            <div style={{ display: 'flex', gap: 6 }}>
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => { setSelDay(i); setSelHour(null); }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${selDay === i ? 'var(--accent-green)' : 'var(--border)'}`,
                    background: selDay === i ? 'var(--accent-green-bg)' : 'var(--surface)',
                    color: selDay === i ? 'var(--accent-green-text)' : 'var(--text-secondary)',
                    textAlign: 'center', fontFamily: 'var(--font-sans)',
                    transition: 'all 150ms',
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase' }}>{d}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{weekDates[i]}</div>
                </button>
              ))}
            </div>

            {/* Hour list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {HOURS.map((h) => {
                const free = isFree(selDay, h);
                const selected = selHour === h;
                return (
                  <button
                    key={h}
                    disabled={!free}
                    onClick={() => setSelHour(h)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', borderRadius: 10, cursor: free ? 'pointer' : 'not-allowed',
                      border: `1px solid ${selected ? 'var(--accent-green)' : 'var(--border)'}`,
                      background: selected ? 'var(--accent-green-bg)' : 'var(--surface)',
                      opacity: free ? 1 : 0.45, fontFamily: 'var(--font-sans)',
                      transition: 'all 150ms', textAlign: 'left',
                    }}
                  >
                    <span style={{
                      fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                      color: selected ? 'var(--accent-green-text)' : 'var(--text-primary)',
                    }}>
                      {h}:00
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flex: 1 }}>
                      {free ? 'Centre Court · EGP 400/hr' : 'Fully booked'}
                    </span>
                    {free && <ChevronRight size={13} style={{ color: 'var(--text-tertiary)' }} />}
                  </button>
                );
              })}
            </div>

            {selHour !== null && (
              <div style={{
                fontSize: 11.5, color: 'var(--accent-green-text)', textAlign: 'center',
                background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
                borderRadius: 8, padding: '8px 10px',
              }}>
                {DAY_LABELS[selDay]} {weekDates[selDay]} · {selHour}:00 selected
              </div>
            )}
          </div>
          <PhoneTabBar active="book" />
        </div>

        {/* ── Phone 3 · Mobile booking with sticky pay CTA ──── */}
        <div className="phone-frame">
          <div className="phone-notch" />
          <div className="phone-screen" style={{ paddingBottom: 8 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Confirm booking</div>

            <div className="card-sm" style={{ background: 'var(--surface)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
                }}>
                  🎾
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Centre Court</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Fri {weekDates[4]} Jul · 19:00–21:00 · 2h
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  EGP {COURT_RATE * HOURS_BOOKED}
                </div>
              </div>
            </div>

            {/* Add-ons */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Add-ons</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ADDONS.map((a) => {
                  const q = qty[a.id] ?? 0;
                  return (
                    <div key={a.id} className={`addon-card ${q > 0 ? 'selected' : ''}`} style={{ padding: '8px 10px' }}>
                      <div className="addon-thumb" style={{ width: 32, height: 32, fontSize: 14 }} aria-hidden>{a.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{a.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>EGP {a.price}/hr</div>
                      </div>
                      <Stepper
                        value={q}
                        min={0}
                        max={4}
                        onChange={(v) => setQty((prev) => ({ ...prev, [a.id]: v }))}
                        ariaLabel={`${a.name} quantity`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="card-sm" style={{ background: 'var(--surface)' }}>
              <div className="price-row" style={{ fontSize: 12 }}>
                <span>Court · 2h</span>
                <strong>EGP {COURT_RATE * HOURS_BOOKED}</strong>
              </div>
              <div className="price-row" style={{ fontSize: 12 }}>
                <span>Add-ons</span>
                <strong>EGP {addonTotal}</strong>
              </div>
              <div className="price-row total" style={{ fontSize: 13 }}>
                <span>Total</span>
                <strong>EGP {total}</strong>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 6 }}>
                50% deposit (EGP {Math.round(total / 2)}) due now to confirm.
              </div>
            </div>
          </div>

          {/* Sticky pay bar */}
          <div style={{
            padding: '12px 16px 18px', borderTop: '1px solid var(--border)',
            background: 'var(--bg-elevated)', flexShrink: 0,
          }}>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', height: 42 }}>
              Continue to Pay · EGP {Math.round(total / 2)}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
