'use client';

/**
 * Marketing landing (screen 5.1).
 * Quiet-luxury tone: near-black canvas, hairline borders, one green accent.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight, CalendarCheck, CreditCard, BarChart2,
  Repeat, Users, ShieldCheck, Check,
} from 'lucide-react';

const FEATURES = [
  {
    icon: <CalendarCheck size={17} />,
    title: 'Effortless scheduling',
    body: 'A live weekly grid across every court. Slots, blocks and walk-ins managed from one calm screen.',
  },
  {
    icon: <CreditCard size={17} />,
    title: 'Deposits & payments',
    body: 'Deposit verification, split payments and refunds — a full ledger without a spreadsheet in sight.',
  },
  {
    icon: <Repeat size={17} />,
    title: 'VIP fixed bookings',
    body: 'Sell the same prime slot weekly for one or three months, and watch recurring revenue compound.',
  },
  {
    icon: <ShieldCheck size={17} />,
    title: 'Racket & gear rental',
    body: 'A priced add-on catalogue with live stock tracking — every rented racket lands on the invoice.',
  },
  {
    icon: <BarChart2 size={17} />,
    title: 'Owner analytics',
    body: 'Occupancy, revenue split per court, growth and MRR — decisions from data, not gut feel.',
  },
  {
    icon: <Users size={17} />,
    title: 'Roles & permissions',
    body: 'Owners, receptionists and members each see exactly what they should. Audit-logged, always.',
  },
];

const METRICS = [
  { value: '38%', label: 'more bookings in prime hours' },
  { value: '4.2h', label: 'front-desk admin saved weekly' },
  { value: '99.9%', label: 'uptime — matches on schedule' },
];

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!localStorage.getItem('cf_access_token'));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav className="landing-nav">
        <div className="nav-logo" style={{ padding: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <rect width="20" height="20" rx="5" fill="#22C55E" />
            <path d="M5 10h10M10 5v10" stroke="#06170C" strokeWidth="2" strokeLinecap="round" />
          </svg>
          CourtFlow
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {authed ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Open dashboard
              <ArrowRight size={13} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Get started</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <span className="landing-eyebrow">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent-green)' }} />
          Club management, refined
        </span>
        <h1>
          Run your club.<br />
          Book more. <span style={{ color: 'var(--accent-green-text)' }}>Grow faster.</span>
        </h1>
        <p style={{ fontSize: 17, maxWidth: 560, lineHeight: 1.65 }}>
          CourtFlow is the operating system for premium padel and tennis clubs —
          scheduling, payments, equipment rental and long-term memberships in one
          quiet, precise workspace.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/register" className="btn btn-primary btn-lg">
            Start free
            <ArrowRight size={15} />
          </Link>
          <Link href="/login" className="btn btn-secondary btn-lg">
            Book a demo
          </Link>
        </div>

        {/* Product glimpse */}
        <div
          className="card"
          style={{
            width: '100%', maxWidth: 640, marginTop: 32, textAlign: 'left',
            background: 'var(--surface)', padding: 0, overflow: 'hidden',
          }}
          aria-hidden
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
          }}>
            {['#F16565', '#F2B84B', '#22C55E'].map((c) => (
              <span key={c} style={{ width: 8, height: 8, borderRadius: 99, background: c, opacity: 0.7 }} />
            ))}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>
              courtflow.app/dashboard
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 20 }}>
            {[
              { label: "Today's bookings", value: '24', delta: '+4 vs last Tue' },
              { label: 'Revenue today', value: 'EGP 9,640', delta: '+12%' },
              { label: 'Occupancy', value: '86%', delta: 'Prime 18–22h full' },
            ].map((s) => (
              <div key={s.label} className="card-sm" style={{ background: 'var(--surface-2)' }}>
                <div className="stat-label">{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 2px' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--accent-green-text)' }}>{s.delta}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 20px 20px', display: 'flex', gap: 6 }}>
            {[52, 68, 44, 80, 96, 74, 88, 61, 92, 70, 84, 58].map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1, height: 64, display: 'flex', alignItems: 'flex-end',
                }}
              >
                <div style={{
                  width: '100%', height: `${h}%`, borderRadius: 3,
                  background: i === 4 ? 'var(--accent-green)' : 'var(--surface-2)',
                  border: '1px solid var(--border)',
                }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Metrics band */}
      <section className="landing-section" style={{ paddingTop: 0 }}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 1, background: 'var(--border)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}
        >
          {METRICS.map((m) => (
            <div key={m.label} style={{ background: 'var(--surface)', padding: '28px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>{m.value}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="landing-section">
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2>Everything the front desk touches, in one place</h2>
          <p style={{ marginTop: 8 }}>Built with the restraint of a members-only club.</p>
        </div>
        <div className="landing-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div
                style={{
                  width: 34, height: 34, borderRadius: 8, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--accent-green-bg)', color: 'var(--accent-green-text)',
                  marginBottom: 14,
                }}
              >
                {f.icon}
              </div>
              <h4 style={{ marginBottom: 6 }}>{f.title}</h4>
              <p style={{ fontSize: 13.5 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="landing-section" style={{ paddingBottom: 96 }}>
        <div
          className="card"
          style={{ textAlign: 'center', padding: '56px 32px', background: 'var(--surface)' }}
        >
          <h2 style={{ marginBottom: 10 }}>Your courts, fully booked.</h2>
          <p style={{ maxWidth: 440, margin: '0 auto 24px' }}>
            Join the clubs running their entire operation on CourtFlow — setup takes one afternoon.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" className="btn btn-primary btn-lg">
              Create your club account
              <ArrowRight size={15} />
            </Link>
          </div>
          <div style={{
            display: 'flex', gap: 20, justifyContent: 'center', marginTop: 20,
            fontSize: 12.5, color: 'var(--text-tertiary)', flexWrap: 'wrap',
          }}>
            {['No credit card required', 'Free onboarding', 'Cancel anytime'].map((t) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={12} style={{ color: 'var(--accent-green-text)' }} />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)', padding: '24px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        maxWidth: 1120, margin: '0 auto', width: '100%', flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          © {new Date().getFullYear()} CourtFlow — premium club management
        </span>
        <div style={{ display: 'flex', gap: 20, fontSize: 12.5 }}>
          <Link href="/login" style={{ color: 'var(--text-secondary)' }}>Sign in</Link>
          <Link href="/register" style={{ color: 'var(--text-secondary)' }}>Create account</Link>
        </div>
      </footer>
    </div>
  );
}
