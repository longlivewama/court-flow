'use client';

/**
 * Landing hero — staggered copy reveal over a radial green wash, with the
 * premium court photograph on a pointer/gyro 3D tilt stage.
 */
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { EASE_STANDARD } from '@/lib/motion-tokens';
import { TiltWrapper } from '@/components/ui/TiltWrapper';
import { SpringButton } from './SpringButton';
import { REVEAL, REVEAL_GROUP } from './reveal';

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

export function HeroSection() {
  return (
    <section className="landing-hero landing-hero-radial">
      <motion.div variants={REVEAL_GROUP} initial="hidden" animate="visible"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <motion.span variants={REVEAL} className="landing-eyebrow">
          <span className="eyebrow-dot" />
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
        <motion.div variants={REVEAL} className="cta-row">
          <SpringButton>
            <Link href="/register-club" className="btn btn-primary btn-lg">
              Register Club · Start Free Trial
              <ArrowRight size={15} />
            </Link>
          </SpringButton>
          <SpringButton>
            <Link href="/register" className="btn btn-secondary btn-lg">
              Join as a member
            </Link>
          </SpringButton>
        </motion.div>
      </motion.div>

      {/* Interactive court photograph — tilts toward the cursor */}
      <HeroCourtStage />
    </section>
  );
}
