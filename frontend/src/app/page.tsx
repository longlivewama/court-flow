'use client';

/**
 * Marketing landing (screen 5.1) — SaaS conversion funnel.
 *
 * Quiet-luxury tone: near-black canvas, hairline borders, one green accent.
 *   · Hero: pointer-parallax 3D isometric padel court wireframe (pure SVG)
 *   · Feature bento: live timetable morphs, escrow split, advisory-lock ball
 *   · Live Court Viewport masonry with native CSS slow hover-zoom
 *   · ROI telemetry band — glowing micro-dashboard stat cards + sparklines
 *   · Automation stack — the three enterprise infrastructure layers
 *   · Commercial subscription matrix (Base Club / Pro Club Elite)
 */
import Link from 'next/link';
import Image from 'next/image';
import {
  useEffect, useState,
  type ComponentType, type CSSProperties, type ReactNode,
} from 'react';
import {
  motion, AnimatePresence, type Variants,
} from 'motion/react';
import {
  ArrowRight, Check, ShieldCheck, Lock, Landmark, LayoutGrid,
  Trophy, GraduationCap, Building2, Smartphone,
  TrendingUp, Timer, Activity, Server, MessageCircle, BarChart3,
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
    // Brief · Centre Court — vibrant, prestigious, crystal-clear championship
    // court read from above: immaculate surface, razor-sharp line geometry,
    // long raking light, a lone player mid-serve. Grand-slam prestige, the
    // court itself as the hero graphic.
    // Selected: elevated aerial of a tournament clay court at the moment of
    // serve — crisp lines, raking sun, editorial sports-magazine grade.
    // (Prior brief asked for a golf-course asset here; rejected off-brief.)
    src: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?q=80&w=1600&auto=format&fit=crop',
    alt: 'Aerial view of a championship clay court during a serve',
    title: 'Centre Court',
    sub: 'Championship-grade surface · prime-time blocks booked solid',
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
    // Brief · Members' night — elite country-club clubhouse after dark,
    // explicitly over luxury club facilities: an open glass pavilion glowing
    // warm against a dusk sky, illuminated water and terrace seating below.
    // Editorial hospitality photography, not a generic restaurant interior.
    // Selected: night clubhouse pavilion over the illuminated club pool —
    // warm lamplight against deep dusk blue, terrace umbrellas beyond.
    src: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=1600&auto=format&fit=crop',
    alt: 'Illuminated clubhouse pavilion over the club pool at night',
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
    // Brief · Tournament mode — real championship-night atmosphere in place
    // of the financial-style LED ticker wall: a floodlit stadium bowl, packed
    // stands, brilliant green field of play. Finals-night scale and energy.
    // Selected: floodlit stadium on a championship night — vibrant green
    // pitch under the lights, the brand accent shot as an arena.
    // (Originally requested asset ID 404s on Unsplash; replaced in-brief.)
    src: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?q=80&w=1000&auto=format&fit=crop',
    alt: 'Floodlit stadium bowl packed for a championship night',
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

/* ── ROI telemetry band — micro-dashboard stat cards ─────────────────────── */
interface TelemetryMetric {
  icon:  ComponentType<{ size?: number }>;
  value: string;
  unit:  string;
  label: string;
  sub:   ReactNode;
  spark: number[];   // 12-point decorative series; last point = current period
}

const TELEMETRY: TelemetryMetric[] = [
  {
    icon: TrendingUp,
    value: '38', unit: '%',
    label: 'More bookings in prime hours',
    sub: <>Utilization lift inside <em>engineered pricing windows</em> — rolling 90-day tenant cohort</>,
    spark: [52, 55, 54, 58, 61, 63, 62, 66, 70, 73, 77, 82],
  },
  {
    icon: Timer,
    value: '4.2', unit: 'h',
    label: 'Front-desk admin saved weekly',
    sub: <>Confirmations, deposits &amp; reminders run <em>fully automated</em> per club workspace</>,
    spark: [1.1, 1.4, 1.8, 2.1, 2.4, 2.6, 3.0, 3.2, 3.5, 3.8, 4.0, 4.2],
  },
  {
    icon: Activity,
    value: '99.9', unit: '%',
    label: 'Uptime — matches on schedule',
    sub: <>Advisory-lock booking integrity under a <em>rolling 90-day SLA</em>, fleet-wide</>,
    spark: [99.95, 99.92, 99.98, 99.96, 99.99, 99.97, 99.94, 99.98, 99.99, 99.96, 99.98, 99.99],
  },
];

/** Decorative single-series micro-bars: muted green history, accent "now". */
function MetricSpark({ points }: { points: number[] }) {
  const W = 120, H = 26, GAP = 2;
  const max = Math.max(...points);
  const bw  = (W - GAP * (points.length - 1)) / points.length;
  return (
    <svg className="metric-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {points.map((p, i) => {
        const h = Math.max(2.5, (p / max) * H);
        return (
          <rect
            key={i}
            x={i * (bw + GAP)} y={H - h} width={bw} height={h} rx={1.5}
            fill={i === points.length - 1 ? 'var(--accent-green)' : 'rgba(74, 222, 128, 0.18)'}
          />
        );
      })}
    </svg>
  );
}

/* ── Automation stack — the three enterprise infrastructure layers ───────── */
interface StackLayer {
  icon:   ComponentType<{ size?: number; style?: CSSProperties }>;
  index:  string;
  kicker: string;
  title:  string;
  body:   string;
  points: string[];
}

const AUTOMATION_STACK: StackLayer[] = [
  {
    icon: Server,
    index: '01',
    kicker: 'Tenant infrastructure',
    title: 'Multi-tenant workspace security',
    body: 'Every club is provisioned as a fully isolated workspace — its own '
        + 'custom subdomain, its own database boundary, its own staff hierarchy. '
        + 'JWT clubId claims scope every request at the API edge, so one '
        + 'tenant’s data is unreachable from another’s by construction, '
        + 'not by convention.',
    points: [
      'Custom club subdomains',
      'Isolated per-club databases',
      'JWT-scoped tenancy on every request',
      'Owner / desk / coach / member RBAC',
    ],
  },
  {
    icon: MessageCircle,
    index: '02',
    kicker: 'Messaging & POS core',
    title: 'Native serverless WhatsApp POS core',
    body: 'A deterministic, logic-based messaging engine — state machines, not '
        + 'LLM bloat — living where your members already are. It confirms '
        + 'bookings instantly, tracks client threads against the tenant ledger, '
        + 'and chases the 50% escrow deposit with precisely timed reminders '
        + 'until the slot is secured.',
    points: [
      'Instant booking confirmations',
      'Automated 50% escrow deposit reminders',
      'Client data & thread tracking',
      'Zero-latency logic replies — no LLM cost',
    ],
  },
  {
    icon: BarChart3,
    index: '03',
    kicker: 'Finance & inventory',
    title: 'Live financial analytics & inventory controls',
    body: 'Owner-only revenue grids consolidate courts, coaches and deposits in '
        + 'real time across every club you operate. Gear rentals decrement live '
        + 'stock at the desk, so a racket never leaves the rail unaccounted for '
        + 'and quiet hours never hide a leaking ledger.',
    points: [
      'Real-time court booking ledgers',
      'Multi-club revenue reporting grids',
      'Live stock tracking for gear rentals',
      'Owner-scoped exports & audit trails',
    ],
  },
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

      {/* ── ROI telemetry band — live ops micro-dashboards ── */}
      <motion.section className="landing-section" style={{ paddingTop: 0 }}
        initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
        <motion.p variants={REVEAL} style={{
          textAlign: 'center', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 20,
        }}>
          Live fleet telemetry · aggregated across active club workspaces
        </motion.p>
        <div className="metric-grid">
          {TELEMETRY.map((m) => {
            const Icon = m.icon;
            return (
              <motion.div variants={REVEAL} key={m.label} className="metric-card">
                <div className="metric-head">
                  <span className="metric-chip"><Icon size={13} /></span>
                  <span className="metric-live"><span className="metric-live-dot" />Live</span>
                </div>
                <div className="metric-value">{m.value}<small>{m.unit}</small></div>
                <div className="metric-label">{m.label}</div>
                <p className="metric-sub">{m.sub}</p>
                <MetricSpark points={m.spark} />
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* ── Automation stack — enterprise infrastructure layers ── */}
      <motion.section className="landing-section" initial="hidden" whileInView="visible"
        viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
        <motion.div variants={REVEAL} style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2>Three automation layers. Zero desk chaos.</h2>
          <p style={{ marginTop: 8 }}>The infrastructure that puts CourtFlow in the enterprise class.</p>
        </motion.div>
        <div className="stack-rail">
          {AUTOMATION_STACK.map((layer) => {
            const Icon = layer.icon;
            return (
              <motion.article variants={REVEAL} key={layer.index} className="stack-layer">
                <div className="stack-index" aria-hidden>{layer.index}</div>
                <div className="stack-main">
                  <span className="bento-kicker">
                    <Icon size={11} style={{ verticalAlign: -1, marginRight: 6 }} />
                    {layer.kicker}
                  </span>
                  <div className="bento-title">{layer.title}</div>
                  <p className="bento-body">{layer.body}</p>
                  <div className="stack-points">
                    {layer.points.map((pt) => (
                      <span key={pt} className="stack-point">
                        <Check size={11} style={{ color: 'var(--accent-green-text)', flexShrink: 0 }} />
                        {pt}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.article>
            );
          })}
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
