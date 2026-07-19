/**
 * Landing page data models — single source for the marketing sections in
 * src/components/landing/. Pure data + types (icons are component refs);
 * imported only by the client section islands, so nothing here crosses a
 * server→client serialization boundary.
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import {
  TrendingUp, Timer, Activity, Server, MessageCircle, BarChart3,
} from 'lucide-react';

/* ── Live Court Viewport — curated photographic art direction ────────────── */
/**
 * Each tile is a curated Unsplash photograph (hotlinked via their CDN, which
 * Unsplash's license permits; hostname allow-listed in next.config.ts).
 * The comment above each entry is the standing art-direction brief — to swap
 * in commissioned photography later, replace the src (or drop a file in
 * frontend/public/images/ and point src back at it). Interim local captures
 * of the previous stylized art still exist there as offline fallbacks.
 */
export interface ViewportTile {
  src:   string;
  alt:   string;
  title: string;
  sub:   string;
  span:  string;   // masonry placement classes
  wide:  boolean;  // spans 2 columns → larger responsive size
}

export const VIEWPORT_TILES: ViewportTile[] = [
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

/* ── ROI telemetry band — micro-dashboard stat cards ─────────────────────── */
export interface TelemetryMetric {
  icon:  ComponentType<{ size?: number }>;
  value: string;
  unit:  string;
  label: string;
  sub:   ReactNode;
  spark: number[];   // 12-point decorative series; last point = current period
}

export const TELEMETRY: TelemetryMetric[] = [
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

/* ── Automation stack — the three enterprise infrastructure layers ───────── */
export interface StackLayer {
  icon:   ComponentType<{ size?: number; style?: CSSProperties }>;
  index:  string;
  kicker: string;
  title:  string;
  body:   string;
  points: string[];
}

export const AUTOMATION_STACK: StackLayer[] = [
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

/* ── Commercial subscription matrix ──────────────────────────────────────── */
export const TIER_BASE = [
  'Up to 3 courts',
  'Core virtualized grid mechanics',
  'Standard admin desk viewport',
  'Member booking app & deposit ledger',
  'Email verification & RBAC accounts',
];

export const TIER_PRO = [
  'Unlimited courts',
  'Automated 50% escrow deposits',
  'Advanced Coaching / Training management',
  'Full Tournament Bracket automation',
  'Multi-tenant analytics & finance suite',
  'Priority onboarding & migrations',
];
