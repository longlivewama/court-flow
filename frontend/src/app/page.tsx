/**
 * Marketing landing (screen 5.1) — SaaS conversion funnel.
 *
 * Server-composed: the page itself is a server component (statically
 * prerendered, owns the marketing metadata); each section is an independent
 * client island under src/components/landing/ that hydrates separately, and
 * the shared copy/data models live in src/lib/landing-data.tsx.
 *
 * Quiet-luxury tone: near-black canvas, hairline borders, one green accent.
 *   · Hero: pointer-parallax 3D tilt court photograph
 *   · Feature bento: live timetable morphs, escrow split, advisory-lock ball
 *   · Live Court Viewport masonry with native CSS slow hover-zoom
 *   · ROI telemetry band — glowing micro-dashboard stat cards + sparklines
 *   · Automation stack — the three enterprise infrastructure layers
 *   · Commercial subscription matrix (Base Club / Pro Club Elite)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { TiltWrapper } from '@/components/ui/TiltWrapper';
import { NavAuthActions } from '@/components/landing/NavAuthActions';
import { HeroSection } from '@/components/landing/HeroSection';
import { BentoSection } from '@/components/landing/BentoSection';
import { ViewportMasonry } from '@/components/landing/ViewportMasonry';
import { TelemetryBand } from '@/components/landing/TelemetryBand';
import { AutomationStack } from '@/components/landing/AutomationStack';
import { PricingMatrix } from '@/components/landing/PricingMatrix';
import { ClosingCta } from '@/components/landing/ClosingCta';

export const metadata: Metadata = {
  title: { absolute: 'CourtFlow — Premium Multi-Tenant Club Management' },
  description:
    'Virtualized multi-tenant scheduling, escrowed 50% deposits, WhatsApp-native '
    + 'automation and tournament brackets — every club on its own isolated workspace.',
};

export default function LandingPage() {
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
        <NavAuthActions />
      </nav>

      <HeroSection />
      <BentoSection />
      <ViewportMasonry />
      <TelemetryBand />
      <AutomationStack />
      <PricingMatrix />
      <ClosingCta />

      {/* Footer */}
      <footer className="landing-footer">
        <span className="landing-footer-copy">
          © {new Date().getFullYear()} CourtFlow — premium multi-tenant club management
        </span>
        <div className="landing-footer-links">
          <Link href="/login">Sign in</Link>
          <Link href="/register-club">Register club</Link>
          <Link href="/register">Join a club</Link>
        </div>
      </footer>
    </div>
  );
}
