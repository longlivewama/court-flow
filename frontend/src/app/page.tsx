'use client';

/**
 * Marketing landing (screen 5.1) — SaaS conversion funnel.
 *
 * Quiet-luxury tone: near-black canvas, hairline borders, one green accent.
 *   · Hero: pointer-parallax 3D isometric padel court wireframe (pure SVG)
 *   · Feature bento: live timetable morphs, escrow split, advisory-lock ball
 *   · Live Court Viewport masonry with native CSS slow hover-zoom
 *   · Commercial subscription matrix (Base Club / Pro Club Elite)
 */
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import {
  motion, AnimatePresence, type Variants,
} from 'motion/react';
import {
  ArrowRight, Check, ShieldCheck, Lock, Landmark, LayoutGrid,
  Trophy, GraduationCap, Building2, Smartphone,
} from 'lucide-react';
import { EASE_STANDARD, SPRING_GRID } from '@/lib/motion-tokens';
import { TiltWrapper } from '@/components/ui/TiltWrapper';

/* ── Shared entrance variants ────────────────────────────────────────────── */
const REVEAL: Variants = {
  hidden:  { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_STANDARD } },
};
const REVEAL_GROUP: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

/* ── Hero visual: premium court photograph with pointer/gyro 3D tilt ─────── */
function HeroCourtStage() {
  return (
    <motion.div
      className="hero-stage"
      style={{ maxWidth: '100%' }}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE_STANDARD, delay: 0.15 }}
    >
      <TiltWrapper
        className="hero-tilt"
        options={{ max: 10, glare: true, 'max-glare': 0.3, perspective: 1000, speed: 400 }}
        style={{
          position: 'relative', aspectRatio: '16 / 9', borderRadius: 20,
          overflow: 'hidden', border: '1px solid var(--border-focus)',
          boxShadow: '0 40px 80px rgba(34,197,94,0.10)',
        }}
      >
        <Image
          src="/images/landing-page.png"
          alt="CourtFlow padel court, live booking grid overlay"
          fill
          priority
          sizes="(max-width: 940px) 92vw, 852px"
          style={{ objectFit: 'cover', objectPosition: 'center 42%' }}
        />
      </TiltWrapper>
    </motion.div>
  );
}

/* ── Bento 1 · virtualized timetable with state-shifting slot ────────────── */
const BOOKED_SLOTS = new Set([1, 4, 6, 9, 14]);
const CURSOR_PATH  = [2, 7, 11, 12, 5, 10];

function BentoTimetable() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => s + 1), 1700);
    return () => clearInterval(t);
  }, []);
  const cursorAt = CURSOR_PATH[step % CURSOR_PATH.length];
  const state    = step % 2 === 0 ? 'Hold · 50% deposit' : 'Confirmed';

  return (
    <div className="bento-timetable" aria-hidden>
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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE_STANDARD }}
            style={{
              fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
              color: 'var(--accent-green-text)', background: 'var(--accent-green-bg)',
              border: '1px solid var(--success-border)', borderRadius: 999,
              padding: '3px 10px',
            }}
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
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', height: 30, borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)', background: 'var(--surface-2)',
      }}>
        <motion.div
          animate={{ width: ['30%', '50%', '50%', '30%'] }}
          transition={{ duration: 5, times: [0, 0.35, 0.65, 1], repeat: Infinity, ease: EASE_STANDARD }}
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
  return (
    <div aria-hidden style={{ position: 'relative', height: 110 }}>
      <svg viewBox="0 0 416 110" style={{ width: '100%', height: '100%', display: 'block' }} fill="none">
        {/* Booking request path — dashes flow via stroke-dashoffset */}
        <motion.path
          d={BALL_PATH}
          stroke="var(--border-focus)"
          strokeWidth="1.5"
          strokeDasharray="5 7"
          animate={{ strokeDashoffset: [0, -144] }}
          transition={{ duration: 5.6, repeat: Infinity, ease: 'linear' }}
        />
        {/* Advisory-lock checkpoints */}
        {CHECKPOINTS.map(([cx, cy, delay]) => (
          <g key={`${cx}-${cy}`}>
            <motion.circle
              cx={cx} cy={cy} r="9"
              stroke="var(--accent-green)" strokeWidth="1"
              initial={{ opacity: 0.15, scale: 0.7 }}
              animate={{ opacity: [0.15, 0.7, 0.15], scale: [0.7, 1.25, 0.7] }}
              transition={{ duration: 3.3, repeat: Infinity, delay, ease: 'easeInOut' }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
            <circle cx={cx} cy={cy} r="3" fill="var(--accent-green)" opacity="0.85" />
          </g>
        ))}
      </svg>
      {/* Sports ball travelling the path via CSS Motion Path */}
      <motion.div
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={{ duration: 5.6, repeat: Infinity, ease: [0.45, 0.05, 0.55, 0.95] }}
        style={{
          offsetPath: `path('${BALL_PATH}')`,
          offsetRotate: '0deg',
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

/* ── Live Court Viewport — curated photographic art direction ────────────── */
/**
 * Each tile is a curated Unsplash photograph (hotlinked via their CDN, which
 * Unsplash's license permits; hostname allow-listed in next.config.ts).
 * The comment above each entry is the standing art-direction brief — to swap
 * in commissioned photography later, replace the src (or drop a file in
 * frontend/public/images/ and point src back at it). Interim local captures
 * of the previous stylized art still exist there as offline fallbacks.
 */
interface ViewportTile {
  src:   string;
  alt:   string;
  title: string;
  sub:   string;
  span:  string;   // masonry placement classes
  wide:  boolean;  // spans 2 columns → larger responsive size
}

const VIEWPORT_TILES: ViewportTile[] = [
  {
    // Brief · Centre Court — elevated three-quarter view of an indoor
    // championship hard court at night: deep-green acrylic surface, crisp
    // white lines, black surround drapes. Twin floodlight banks leave
    // symmetrical pools of light on the surface; one lit ball rests at the
    // service line. Empty, pristine — US Open night-session mood.
    // Selected: forest-green hard court dissolving into black — the CourtFlow
    // palette shot as a photograph.
    src: 'https://images.unsplash.com/photo-1508129214940-7b2223ae0a08?q=80&w=1600&auto=format&fit=crop',
    alt: 'Championship indoor centre court under night-league floodlights',
    title: 'Centre Court',
    sub: 'Championship-grade surface · night league booked 18–23h',
    span: 'tile-c2 tile-r3',
    wide: true,
  },
  {
    // Brief · Glass arena — panoramic padel court behind floor-to-ceiling
    // structural glass, shot from the lounge side: warm lounge reflections
    // ghosted on the glass, cool blue court beyond, polished concrete floor.
    // Private-members'-club-looking-onto-the-arena energy.
    // Selected: panoramic structural-glass padel court at golden hour.
    src: 'https://images.unsplash.com/photo-1709587825415-814c2d7cfce7?q=80&w=1000&auto=format&fit=crop',
    alt: 'Panoramic glass padel arena seen from the members’ lounge',
    title: 'Glass arena',
    sub: 'Panoramic padel · four-court arena',
    span: 'tile-r3',
    wide: false,
  },
  {
    // Brief · Floodlit sessions — dusk exterior, low angle up at twin
    // stadium masts: volumetric beams cutting through evening haze, long
    // net-and-racket shadows raking the court. Teal-and-amber cinematic
    // grade, lens flare kept subtle.
    // Selected: floodlight rig cutting volumetric beams through night mist.
    src: 'https://images.unsplash.com/photo-1509928015542-fcc9b3bcd048?q=80&w=1000&auto=format&fit=crop',
    alt: 'Stadium floodlights casting volumetric beams over a court at dusk',
    title: 'Floodlit sessions',
    sub: 'Prime-time lighting & engineered pricing windows',
    span: 'tile-r3',
    wide: false,
  },
  {
    // Brief · Members' night — courtside VIP lounge after dark: leather
    // armchairs, low brass table, string lights and warm bokeh, the
    // floodlit court soft-focus beyond. Editorial hospitality photography.
    // Selected: arched fireside lounge, velvet seating, warm low-key glow.
    src: 'https://images.unsplash.com/photo-1558368417-57d31049c609?q=80&w=1600&auto=format&fit=crop',
    alt: 'Courtside VIP lounge at night with the floodlit court beyond',
    title: 'Members’ night sessions',
    sub: 'Reserved weekly fixtures for VIP members',
    span: 'tile-c2 tile-r2',
    wide: true,
  },
  {
    // Brief · Gear rental — editorial still-life: three pro carbon padel
    // rackets on a walnut display rail, fresh ball tubes, folded club
    // towels, one overhead spot. Dark field, warm metallic highlights —
    // watch-advert lighting.
    // Selected: pro padel racket in raking editorial side-light.
    src: 'https://images.unsplash.com/photo-1612534847738-b3af9bc31f0c?q=80&w=1000&auto=format&fit=crop',
    alt: 'Pro padel rackets and club inventory on a lit display rail',
    title: 'Gear rental',
    sub: 'Curated pro equipment · live inventory',
    span: 'tile-r2',
    wide: false,
  },
  {
    // Brief · Tournament mode — close crop of a wall-mounted display in a
    // dark club hallway: a glowing green champion line advancing through a
    // dark-glass bracket UI, shallow depth of field, screen-glow as the
    // only light source. Sleek and executive.
    // Selected: glowing LED standings board shot close in the dark.
    src: 'https://images.unsplash.com/photo-1533237264985-ee62f6d342bb?q=80&w=1000&auto=format&fit=crop',
    alt: 'Digital championship bracket display glowing in a dark hallway',
    title: 'Tournament mode',
    sub: 'Automated brackets, seeds & standings',
    span: 'tile-r2',
    wide: false,
  },
];

/* ── Pricing data ────────────────────────────────────────────────────────── */
const TIER_BASE = [
  'Up to 3 courts',
  'Core virtualized grid mechanics',
  'Standard admin desk viewport',
  'Member booking app & deposit ledger',
  'Email verification & RBAC accounts',
];
const TIER_PRO = [
  'Unlimited courts',
  'Automated 50% escrow deposits',
  'Advanced Coaching / Training management',
  'Full Tournament Bracket automation',
  'Multi-tenant analytics & finance suite',
  'Priority onboarding & migrations',
];

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // The access token is memory-only (XSS-hardened); "logged in" derives from
    // the persisted profile and self-corrects via the refresh interceptor.
    setAuthed(!!localStorage.getItem('cf_user'));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav className="landing-nav">
        <div className="nav-logo" style={{ padding: 0 }}>
          <TiltWrapper
            options={{ max: 3, glare: false, speed: 300 }}
            style={{ display: 'inline-flex' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <rect width="20" height="20" rx="5" fill="#22C55E" />
              <path d="M5 10h10M10 5v10" stroke="#06170C" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </TiltWrapper>
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
              <Link href="/register-club" className="btn btn-primary btn-sm">Register club</Link>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero: 3D radial immersion ── */}
      <section
        className="landing-hero"
        style={{
          maxWidth: 900,
          background: 'radial-gradient(60% 55% at 50% 38%, rgba(34,197,94,0.07), transparent 75%)',
        }}
      >
        <motion.div variants={REVEAL_GROUP} initial="hidden" animate="visible"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <motion.span variants={REVEAL} className="landing-eyebrow">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent-green)' }} />
            Multi-tenant club SaaS
          </motion.span>
          <motion.h1 variants={REVEAL} style={{ maxWidth: 860 }}>
            The Next-Generation Premium
            <br />
            Club Management <span style={{ color: 'var(--accent-green-text)' }}>Ecosystem</span>
          </motion.h1>
          <motion.p variants={REVEAL} style={{ fontSize: 17, maxWidth: 620, lineHeight: 1.65 }}>
            Virtualized multi-tenant scheduling, escrowed deposits and tournament
            automation — every club on its own isolated workspace, every court on
            one quiet, precise grid.
          </motion.p>
          <motion.div variants={REVEAL} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* 2D hover-stretching CTAs */}
            <motion.div whileHover={{ scaleX: 1.05, scaleY: 0.97 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }} style={{ display: 'inline-flex' }}>
              <Link href="/register-club" className="btn btn-primary btn-lg">
                Register Club · Start Free Trial
                <ArrowRight size={15} />
              </Link>
            </motion.div>
            <motion.div whileHover={{ scaleX: 1.05, scaleY: 0.97 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }} style={{ display: 'inline-flex' }}>
              <Link href="/register" className="btn btn-secondary btn-lg">
                Join as a member
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Interactive isometric court — tilts toward the cursor */}
        <HeroCourtStage />
      </section>

      {/* ── Feature bento grid ── */}
      <motion.section className="landing-section" initial="hidden" whileInView="visible"
        viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
        <motion.div variants={REVEAL} style={{ textAlign: 'center', marginBottom: 40 }}>
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
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                      color: 'var(--accent-green-text)', background: 'var(--accent-green-bg)',
                      border: '1px solid var(--success-border)', borderRadius: 999,
                      padding: '2px 9px', whiteSpace: 'nowrap',
                    }}
                  >
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

      {/* ── Live Court Viewport masonry ── */}
      <motion.section className="landing-section" initial="hidden" whileInView="visible"
        viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
        <motion.div variants={REVEAL} style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2>The Live Court Viewport</h2>
          <p style={{ marginTop: 8 }}>Purpose-built for padel and tennis clubs that feel like members-only lounges.</p>
        </motion.div>
        <motion.div variants={REVEAL} className="viewport-masonry">
          {VIEWPORT_TILES.map((tile) => (
            <div key={tile.src} className={`viewport-tile ${tile.span}`}>
              <div className="tile-art">
                <Image
                  src={tile.src}
                  alt={tile.alt}
                  fill
                  loading="lazy"
                  sizes={tile.wide ? '(max-width: 880px) 100vw, 560px' : '(max-width: 880px) 50vw, 270px'}
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div className="tile-caption"><strong>{tile.title}</strong><span>{tile.sub}</span></div>
            </div>
          ))}
        </motion.div>
      </motion.section>

      {/* ── Metrics band ── */}
      <motion.section className="landing-section" style={{ paddingTop: 0 }}
        initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-70px' }} variants={REVEAL}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 1, background: 'var(--border)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}
        >
          {[
            { value: '38%', label: 'more bookings in prime hours' },
            { value: '4.2h', label: 'front-desk admin saved weekly' },
            { value: '99.9%', label: 'uptime — matches on schedule' },
          ].map((m) => (
            <div key={m.label} style={{ background: 'var(--surface)', padding: '28px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>{m.value}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ── Commercial subscription matrix ── */}
      <motion.section className="landing-section" initial="hidden" whileInView="visible"
        viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
        <motion.div variants={REVEAL} style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2>One workspace per club. One plan per ambition.</h2>
          <p style={{ marginTop: 8 }}>Every tier includes ironclad tenant isolation and role-based access control.</p>
        </motion.div>
        <div className="pricing-grid">
          <motion.div variants={REVEAL} className="pricing-card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={14} /> Base Club
              </span>
              <div className="pricing-price">EGP 1,999<small> /month</small></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TIER_BASE.map((f) => (
                <div key={f} className="pricing-feature">
                  <Check size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  {f}
                </div>
              ))}
            </div>
            <Link href="/register-club" className="btn btn-secondary" style={{ justifyContent: 'center', marginTop: 'auto' }}>
              Start with Base
            </Link>
          </motion.div>

          <motion.div variants={REVEAL} className="pricing-card pricing-pro">
            <span className="pricing-tag">Pro Club Elite</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-green-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trophy size={14} /> Pro Club Elite
              </span>
              <div className="pricing-price">EGP 3,999<small> /month</small></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TIER_PRO.map((f) => (
                <div key={f} className="pricing-feature" style={{ color: 'var(--text-primary)' }}>
                  <Check size={13} style={{ color: 'var(--accent-green-text)', flexShrink: 0, marginTop: 2 }} />
                  {f}
                </div>
              ))}
            </div>
            <motion.div whileHover={{ scaleX: 1.03, scaleY: 0.98 }} whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }} style={{ display: 'flex', marginTop: 'auto' }}>
              <Link href="/register-club" className="btn btn-primary" style={{ justifyContent: 'center', flex: 1 }}>
                Go Pro Elite
                <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>
        </div>
        <motion.p variants={REVEAL} style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 20 }}>
          <GraduationCap size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
          Owner, desk staff, coach and member roles included on both tiers.
        </motion.p>
      </motion.section>

      {/* ── Closing CTA ── */}
      <motion.section className="landing-section" style={{ paddingBottom: 96 }}
        initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-70px' }} variants={REVEAL}>
        <div className="card" style={{ textAlign: 'center', padding: '56px 32px', background: 'var(--surface)' }}>
          <h2 style={{ marginBottom: 10 }}>Your courts, fully booked.</h2>
          <p style={{ maxWidth: 460, margin: '0 auto 24px' }}>
            Provision your club&apos;s isolated workspace in minutes — courts, staff
            roles and the booking grid come pre-wired.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <motion.div whileHover={{ scaleX: 1.05, scaleY: 0.97 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }} style={{ display: 'inline-flex' }}>
              <Link href="/register-club" className="btn btn-primary btn-lg">
                Create your club workspace
                <ArrowRight size={15} />
              </Link>
            </motion.div>
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
      </motion.section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)', padding: '24px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        maxWidth: 1120, margin: '0 auto', width: '100%', flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          © {new Date().getFullYear()} CourtFlow — premium multi-tenant club management
        </span>
        <div style={{ display: 'flex', gap: 20, fontSize: 12.5 }}>
          <Link href="/login" style={{ color: 'var(--text-secondary)' }}>Sign in</Link>
          <Link href="/register-club" style={{ color: 'var(--text-secondary)' }}>Register club</Link>
          <Link href="/register" style={{ color: 'var(--text-secondary)' }}>Join a club</Link>
        </div>
      </footer>
    </div>
  );
}
