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
import { useEffect, useState } from 'react';
import {
  motion, useMotionValue, useSpring, useTransform,
  AnimatePresence, type Variants,
} from 'motion/react';
import {
  ArrowRight, Check, ShieldCheck, Lock, Landmark, LayoutGrid,
  Trophy, GraduationCap, Building2,
} from 'lucide-react';
import { EASE_STANDARD, SPRING_GRID } from '@/lib/motion-tokens';

/* ── Shared entrance variants ────────────────────────────────────────────── */
const REVEAL: Variants = {
  hidden:  { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_STANDARD } },
};
const REVEAL_GROUP: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

/* ── 3D isometric padel court (hand-projected wireframe) ─────────────────── */
// Isometric projection of a 20m × 10m padel court with 4m glass walls.
// All geometry is precomputed at module scope — deterministic, SSR-safe.
const S  = 12.6;           // px per metre
const OX = 300;            // viewBox origin offsets
const OY = 88;
function iso(x: number, y: number, z = 0): [number, number] {
  return [
    +(OX + (x - y) * 0.866 * S - 56).toFixed(1),
    +(OY + (x + y) * 0.5 * S - z * 0.92 * S).toFixed(1),
  ];
}
const pt   = (x: number, y: number, z = 0) => iso(x, y, z).join(',');
const FLOOR = `${pt(0, 0)} ${pt(20, 0)} ${pt(20, 10)} ${pt(0, 10)}`;
// Wall panels: (edge start, edge end) extruded to z=4 (glass 3m + mesh 1m)
const WALLS: string[] = [
  `${pt(0, 0)} ${pt(20, 0)} ${pt(20, 0, 4)} ${pt(0, 0, 4)}`,     // back-left run
  `${pt(20, 0)} ${pt(20, 10)} ${pt(20, 10, 4)} ${pt(20, 0, 4)}`, // right back wall
  `${pt(0, 0)} ${pt(0, 10)} ${pt(0, 10, 4)} ${pt(0, 0, 4)}`,     // left back wall
];
// Structural mesh verticals along the two long walls, every 2 metres
const MESH_V: string[] = [];
for (let x = 2; x < 20; x += 2) {
  MESH_V.push(`M ${pt(x, 0).replace(',', ' ')} L ${pt(x, 0, 4).replace(',', ' ')}`);
}
for (let y = 2; y < 10; y += 2) {
  MESH_V.push(`M ${pt(20, y).replace(',', ' ')} L ${pt(20, y, 4).replace(',', ' ')}`);
  MESH_V.push(`M ${pt(0, y).replace(',', ' ')} L ${pt(0, y, 4).replace(',', ' ')}`);
}
// Glass seam (z=3) around the three drawn walls
const GLASS_SEAM = [
  `M ${pt(0, 0, 3).replace(',', ' ')} L ${pt(20, 0, 3).replace(',', ' ')}`,
  `M ${pt(20, 0, 3).replace(',', ' ')} L ${pt(20, 10, 3).replace(',', ' ')}`,
  `M ${pt(0, 0, 3).replace(',', ' ')} L ${pt(0, 10, 3).replace(',', ' ')}`,
].join(' ');
// Net across the middle (x=10), 1m high, with posts
const NET_TOP  = `M ${pt(10, 0, 1).replace(',', ' ')} L ${pt(10, 10, 1).replace(',', ' ')}`;
const NET_BASE = `M ${pt(10, 0).replace(',', ' ')} L ${pt(10, 10).replace(',', ' ')}`;
const NET_MESH: string[] = [];
for (let y = 1; y < 10; y += 1) {
  NET_MESH.push(`M ${pt(10, y).replace(',', ' ')} L ${pt(10, y, 1).replace(',', ' ')}`);
}
// Service lines (x = 3 / 17) + centre service line
const SERVICE = [
  `M ${pt(3, 0).replace(',', ' ')} L ${pt(3, 10).replace(',', ' ')}`,
  `M ${pt(17, 0).replace(',', ' ')} L ${pt(17, 10).replace(',', ' ')}`,
  `M ${pt(3, 5).replace(',', ' ')} L ${pt(17, 5).replace(',', ' ')}`,
].join(' ');

function IsoPadelCourt() {
  return (
    <svg className="hero-court" viewBox="0 0 560 300" fill="none" aria-hidden>
      {/* Floor plane */}
      <polygon points={FLOOR} fill="rgba(34,197,94,0.05)" stroke="var(--accent-green)" strokeOpacity="0.55" strokeWidth="1.6" />
      {/* Glass wall panels */}
      {WALLS.map((w) => (
        <polygon key={w} points={w} fill="rgba(255,255,255,0.015)" stroke="var(--border-focus)" strokeWidth="1.1" />
      ))}
      {/* Structural mesh lines */}
      <path d={MESH_V.join(' ')} stroke="var(--border)" strokeWidth="0.8" opacity="0.85" />
      {/* Glass/mesh seam */}
      <path d={GLASS_SEAM} stroke="var(--border-focus)" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.8" />
      {/* Service geometry */}
      <path d={SERVICE} stroke="var(--accent-green)" strokeOpacity="0.35" strokeWidth="1.1" />
      {/* Net */}
      <path d={NET_MESH.join(' ')} stroke="var(--accent-green)" strokeOpacity="0.28" strokeWidth="0.8" />
      <path d={NET_BASE} stroke="var(--accent-green)" strokeOpacity="0.4" strokeWidth="1" />
      <path d={NET_TOP} stroke="var(--accent-green-text)" strokeOpacity="0.85" strokeWidth="1.6" />
      {/* Net posts */}
      <path d={`M ${pt(10, 0).replace(',', ' ')} L ${pt(10, 0, 1).replace(',', ' ')} M ${pt(10, 10).replace(',', ' ')} L ${pt(10, 10, 1).replace(',', ' ')}`}
        stroke="var(--accent-green-text)" strokeWidth="1.6" strokeOpacity="0.85" />
    </svg>
  );
}

function HeroCourtStage() {
  // Pointer parallax: raw pointer position → springs → rotation, all outside
  // React state (motion values mutate the transform directly).
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 110, damping: 22, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 110, damping: 22, mass: 0.6 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-11, 11]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [9, -7]);

  return (
    <div
      className="hero-stage"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { px.set(0); py.set(0); }}
    >
      <motion.div
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE_STANDARD, delay: 0.15 }}
      >
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        >
          <IsoPadelCourt />
        </motion.div>
      </motion.div>
    </div>
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

/* ── Live Court Viewport tiles (pure CSS/SVG renders) ────────────────────── */
function TileCourtTopView() {
  return (
    <div className="tile-art" style={{ background: 'linear-gradient(160deg, #0E2318, #071109 70%)' }}>
      <svg viewBox="0 0 200 130" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        <rect x="30" y="18" width="140" height="94" rx="3" fill="rgba(34,197,94,0.13)" stroke="rgba(74,222,128,0.55)" strokeWidth="1.4" />
        <line x1="100" y1="18" x2="100" y2="112" stroke="rgba(244,245,246,0.5)" strokeWidth="1.2" strokeDasharray="4 3" />
        <line x1="55" y1="18" x2="55" y2="112" stroke="rgba(244,245,246,0.28)" strokeWidth="1" />
        <line x1="145" y1="18" x2="145" y2="112" stroke="rgba(244,245,246,0.28)" strokeWidth="1" />
        <line x1="55" y1="65" x2="145" y2="65" stroke="rgba(244,245,246,0.28)" strokeWidth="1" />
        <circle cx="128" cy="46" r="4" fill="#b8f5cd" opacity="0.9" />
      </svg>
    </div>
  );
}
function TileGlassArena() {
  return (
    <div className="tile-art" style={{ background: 'linear-gradient(200deg, #101826, #070B12 75%)' }}>
      <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        <polygon points="30,120 100,85 170,120 100,155" fill="rgba(96,165,250,0.07)" stroke="rgba(96,165,250,0.45)" strokeWidth="1.2" />
        <path d="M30 120 L30 74 L100 39 L170 74 L170 120 M100 85 L100 39" stroke="rgba(148,180,225,0.35)" strokeWidth="1" />
        <path d="M48 111 L48 66 M65 102 L65 57 M135 102 L135 57 M152 111 L152 66" stroke="rgba(148,180,225,0.22)" strokeWidth="0.8" />
        <path d="M65 137 L65 172 M135 137 L135 172" stroke="rgba(148,180,225,0.18)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}
function TileFloodlights() {
  return (
    <div className="tile-art" style={{ background: 'linear-gradient(180deg, #0B0D13, #05060A 80%)' }}>
      <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        <polygon points="60,14 20,190 108,190" fill="rgba(242,232,180,0.06)" />
        <polygon points="140,14 92,190 186,190" fill="rgba(242,232,180,0.05)" />
        <circle cx="60" cy="14" r="5" fill="rgba(255,246,200,0.85)" />
        <circle cx="140" cy="14" r="5" fill="rgba(255,246,200,0.75)" />
        <line x1="14" y1="176" x2="186" y2="176" stroke="rgba(74,222,128,0.35)" strokeWidth="1.2" />
      </svg>
    </div>
  );
}
function TileRacketRoom() {
  return (
    <div className="tile-art" style={{ background: 'linear-gradient(140deg, #1A130C, #0B0704 75%)' }}>
      <svg viewBox="0 0 200 130" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        {[36, 76, 116, 156].map((x, i) => (
          <g key={x} opacity={0.75 - i * 0.1}>
            <ellipse cx={x} cy="52" rx="15" ry="20" stroke="rgba(226,197,146,0.55)" strokeWidth="1.4" />
            <path d={`M ${x} 72 L ${x} 96`} stroke="rgba(226,197,146,0.5)" strokeWidth="2.4" strokeLinecap="round" />
            <path d={`M ${x - 8} 44 h 16 M ${x - 9} 52 h 18 M ${x - 8} 60 h 16 M ${x - 4} 36 v 30 M ${x + 4} 36 v 30 M ${x} 34 v 34`}
              stroke="rgba(226,197,146,0.25)" strokeWidth="0.7" />
          </g>
        ))}
      </svg>
    </div>
  );
}
function TileNightSession() {
  return (
    <div className="tile-art" style={{ background: 'radial-gradient(140% 120% at 20% 0%, #14231A 0%, #08100B 55%, #050807 100%)' }}>
      <svg viewBox="0 0 200 130" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        <path d="M0 96 Q 60 70 100 88 T 200 84 L 200 130 L 0 130 Z" fill="rgba(34,197,94,0.10)" />
        <path d="M0 96 Q 60 70 100 88 T 200 84" stroke="rgba(74,222,128,0.4)" strokeWidth="1.2" />
        <circle cx="152" cy="34" r="13" stroke="rgba(244,245,246,0.35)" strokeWidth="1" />
        <circle cx="152" cy="34" r="13" fill="rgba(244,245,246,0.04)" />
      </svg>
    </div>
  );
}
function TileScoreboard() {
  return (
    <div className="tile-art" style={{ background: 'linear-gradient(170deg, #10131B, #06080D 80%)' }}>
      <svg viewBox="0 0 200 130" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
        <rect x="36" y="26" width="128" height="66" rx="6" stroke="rgba(154,158,166,0.4)" strokeWidth="1.2" fill="rgba(255,255,255,0.02)" />
        <text x="66" y="70" fill="rgba(74,222,128,0.9)" fontSize="30" fontFamily="var(--font-mono)" fontWeight="600">6</text>
        <text x="120" y="70" fill="rgba(154,158,166,0.75)" fontSize="30" fontFamily="var(--font-mono)" fontWeight="600">4</text>
        <line x1="100" y1="38" x2="100" y2="80" stroke="rgba(154,158,166,0.3)" strokeWidth="1" />
      </svg>
    </div>
  );
}

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
          <div className="viewport-tile tile-c2 tile-r3">
            <TileCourtTopView />
            <div className="tile-caption"><strong>Centre Court</strong><span>Night league · fully booked 18–23h</span></div>
          </div>
          <div className="viewport-tile tile-r3">
            <TileGlassArena />
            <div className="tile-caption"><strong>Glass arena</strong><span>Panoramic padel · 4 courts</span></div>
          </div>
          <div className="viewport-tile tile-r3">
            <TileFloodlights />
            <div className="tile-caption"><strong>Floodlit sessions</strong><span>Prime-time pricing windows</span></div>
          </div>
          <div className="viewport-tile tile-c2 tile-r2">
            <TileNightSession />
            <div className="tile-caption"><strong>Members&apos; night sessions</strong><span>VIP weekly fixed slots</span></div>
          </div>
          <div className="viewport-tile tile-r2">
            <TileRacketRoom />
            <div className="tile-caption"><strong>Gear rental</strong><span>Priced add-ons, live stock</span></div>
          </div>
          <div className="viewport-tile tile-r2">
            <TileScoreboard />
            <div className="tile-caption"><strong>Tournament mode</strong><span>Automated brackets & seeds</span></div>
          </div>
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
