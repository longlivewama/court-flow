'use client';

/**
 * Feature bento grid — live timetable morphs, escrow split, advisory-lock
 * ball path, and the member-app teaser tile.
 *
 * Motion hygiene: the timetable's cycling interval only runs while the grid
 * is on screen, and every continuous loop collapses to a static frame under
 * prefers-reduced-motion (one-shot entrance reveals are kept).
 */
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  motion, AnimatePresence, useInView, useReducedMotion,
} from 'motion/react';
import {
  ShieldCheck, Lock, Landmark, LayoutGrid, Smartphone,
} from 'lucide-react';
import { EASE_STANDARD, SPRING_GRID } from '@/lib/motion-tokens';
import { TiltWrapper } from '@/components/ui/TiltWrapper';
import { REVEAL, REVEAL_GROUP } from './reveal';

/* ── Bento 1 · virtualized timetable with state-shifting slot ────────────── */
const BOOKED_SLOTS = new Set([1, 4, 6, 9, 14]);
const CURSOR_PATH  = [2, 7, 11, 12, 5, 10];

function BentoTimetable() {
  const ref     = useRef<HTMLDivElement>(null);
  const inView  = useInView(ref, { amount: 0.25 });
  const reduce  = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const t = setInterval(() => setStep((s) => s + 1), 1700);
    return () => clearInterval(t);
  }, [inView, reduce]);

  const cursorAt = CURSOR_PATH[step % CURSOR_PATH.length];
  const state    = step % 2 === 0 ? 'Hold · 50% deposit' : 'Confirmed';

  return (
    <div ref={ref} className="bento-timetable" aria-hidden>
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className={`bento-slot ${BOOKED_SLOTS.has(i) ? 'booked' : ''}`}>
          {i === cursorAt && (
            <motion.div
              layoutId="bento-slot-cursor"
              transition={SPRING_GRID}
              style={{
                position: 'absolute', inset: -1, borderRadius: 7,
                border: '1.5px solid var(--accent-green)',
                background: 'rgba(34,197,94,0.14)',
                boxShadow: '0 0 18px rgba(34,197,94,0.25)',
              }}
            />
          )}
        </div>
      ))}
      <div style={{ gridColumn: 'span 4', display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            className="pill-green"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE_STANDARD }}
          >
            {state}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Bento 2 · escrow split bar ──────────────────────────────────────────── */
function EscrowSplit() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', height: 30, borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)', background: 'var(--surface-2)',
      }}>
        <motion.div
          animate={reduce
            ? { width: '50%' }
            : { width: ['30%', '50%', '50%', '30%'] }}
          transition={reduce
            ? undefined
            : { duration: 5, times: [0, 0.35, 0.65, 1], repeat: Infinity, ease: EASE_STANDARD }}
          style={{
            background: 'linear-gradient(90deg, var(--accent-green-bg), rgba(34,197,94,0.4))',
            borderRight: '1px solid var(--success-border)',
            display: 'flex', alignItems: 'center', paddingLeft: 10, minWidth: 96,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-green-text)', whiteSpace: 'nowrap' }}>
            50% ESCROW
          </span>
        </motion.div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            SETTLED ON-SITE
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
        <Lock size={12} style={{ color: 'var(--accent-green-text)' }} />
        Deposits verified per tenant ledger — never pooled across clubs
      </div>
    </div>
  );
}

/* ── Bento 3 · advisory-lock ball path ───────────────────────────────────── */
const BALL_PATH = 'M 14 78 C 80 8, 148 122, 226 48 C 286 -8, 338 96, 402 60';
const CHECKPOINTS: Array<[number, number, number]> = [
  [104, 58, 0],   // x, y, pulse delay
  [226, 48, 1.1],
  [340, 62, 2.2],
];

function ConcurrencyPath() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden style={{ position: 'relative', height: 110 }}>
      <svg viewBox="0 0 416 110" style={{ width: '100%', height: '100%', display: 'block' }} fill="none">
        {/* Booking request path — dashes flow via stroke-dashoffset */}
        <motion.path
          d={BALL_PATH}
          stroke="var(--border-focus)"
          strokeWidth="1.5"
          strokeDasharray="5 7"
          animate={reduce ? undefined : { strokeDashoffset: [0, -144] }}
          transition={reduce ? undefined : { duration: 5.6, repeat: Infinity, ease: 'linear' }}
        />
        {/* Advisory-lock checkpoints */}
        {CHECKPOINTS.map(([cx, cy, delay]) => (
          <g key={`${cx}-${cy}`}>
            <motion.circle
              cx={cx} cy={cy} r="9"
              stroke="var(--accent-green)" strokeWidth="1"
              initial={{ opacity: 0.15, scale: 0.7 }}
              animate={reduce
                ? { opacity: 0.5, scale: 1 }
                : { opacity: [0.15, 0.7, 0.15], scale: [0.7, 1.25, 0.7] }}
              transition={reduce
                ? undefined
                : { duration: 3.3, repeat: Infinity, delay, ease: 'easeInOut' }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
            <circle cx={cx} cy={cy} r="3" fill="var(--accent-green)" opacity="0.85" />
          </g>
        ))}
      </svg>
      {/* Sports ball travelling the path via CSS Motion Path */}
      <motion.div
        animate={reduce ? undefined : { offsetDistance: ['0%', '100%'] }}
        transition={reduce ? undefined : { duration: 5.6, repeat: Infinity, ease: [0.45, 0.05, 0.55, 0.95] }}
        style={{
          offsetPath: `path('${BALL_PATH}')`,
          offsetRotate: '0deg',
          offsetDistance: '0%',
          position: 'absolute',
          top: 0, left: 0,
          width: 13, height: 13, borderRadius: '50%',
          background: 'radial-gradient(circle at 34% 30%, #b8f5cd, var(--accent-green) 62%)',
          boxShadow: '0 0 16px rgba(34,197,94,0.55)',
        }}
      />
    </div>
  );
}

/* ── Section ─────────────────────────────────────────────────────────────── */
export function BentoSection() {
  return (
    <motion.section className="landing-section" initial="hidden" whileInView="visible"
      viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
      <motion.div variants={REVEAL} className="section-head">
        <h2>Engineering-grade club infrastructure</h2>
        <p style={{ marginTop: 8 }}>The mechanics under the quiet surface.</p>
      </motion.div>

      <div className="bento-grid">
        <motion.div variants={REVEAL} className="bento-card bento-span-4">
          <span className="bento-kicker"><LayoutGrid size={11} style={{ verticalAlign: -1, marginRight: 6 }} />Scheduling engine</span>
          <div className="bento-title">Real-time virtualized multi-court timetables</div>
          <BentoTimetable />
          <p className="bento-body">
            Both grid axes are windowed with @tanstack/react-virtual, so a packed
            day across every court renders only what the viewport can see —
            smooth on the shabbiest front-desk machine, green-accented everywhere.
          </p>
        </motion.div>

        <motion.div variants={REVEAL} className="bento-card bento-span-2">
          <span className="bento-kicker"><Landmark size={11} style={{ verticalAlign: -1, marginRight: 6 }} />Payments</span>
          <div className="bento-title">Multi-tenant analytics & escrows</div>
          <EscrowSplit />
          <p className="bento-body">
            Automated 50% split deposits move bookings through a nine-state
            lifecycle, with per-club ledgers and owner-only financial analytics.
          </p>
        </motion.div>

        <motion.div variants={REVEAL} className="bento-card bento-span-6">
          <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="bento-kicker"><ShieldCheck size={11} style={{ verticalAlign: -1, marginRight: 6 }} />Concurrency controls</span>
              <div className="bento-title">Zero double-bookings, by construction</div>
              <p className="bento-body">
                Every booking request travels through Postgres advisory-lock
                checkpoints — court, slot and equipment locks acquired in a fixed
                global order. Two players sprinting for the same 8 PM slot can
                never both win it.
              </p>
            </div>
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <ConcurrencyPath />
            </div>
          </div>
        </motion.div>

        <motion.div variants={REVEAL} className="bento-card bento-span-6">
          <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="bento-kicker" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span><Smartphone size={11} style={{ verticalAlign: -1, marginRight: 6 }} />Member app</span>
                <span className="pill-green" style={{ letterSpacing: '0.08em', fontSize: 10 }}>
                  Coming soon
                </span>
              </span>
              <div className="bento-title">A native-feeling booking app, on the way</div>
              <p className="bento-body">
                The next extension of the CourtFlow ecosystem, now in development:
                members will browse live court availability, hold a slot and settle
                their 50% escrow deposit from their phone — the same real-time
                grid that powers the front desk, mirrored to their pocket.
              </p>
            </div>
            <div style={{ flex: '0 1 220px', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
              <TiltWrapper
                options={{ max: 14, reverse: true, glare: true, 'max-glare': 0.25, perspective: 900, speed: 400 }}
                style={{ borderRadius: 24, overflow: 'hidden', border: '1px solid var(--border-focus)', maxWidth: 200 }}
              >
                <Image
                  src="/images/mobile-app.png"
                  alt="CourtFlow member app — live court booking dashboard"
                  width={1024}
                  height={1536}
                  sizes="200px"
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                />
              </TiltWrapper>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
