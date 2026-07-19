'use client';

/**
 * Closing CTA — provision-your-workspace card with the trust row.
 */
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Check } from 'lucide-react';
import { SpringButton } from './SpringButton';
import { REVEAL } from './reveal';

export function ClosingCta() {
  return (
    <motion.section className="landing-section" style={{ paddingBottom: 96 }}
      initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-70px' }} variants={REVEAL}>
      <div className="card" style={{ textAlign: 'center', padding: '56px 32px', background: 'var(--surface)' }}>
        <h2 style={{ marginBottom: 10 }}>Your courts, fully booked.</h2>
        <p style={{ maxWidth: 460, margin: '0 auto 24px' }}>
          Provision your club&apos;s isolated workspace in minutes — courts, staff
          roles and the booking grid come pre-wired.
        </p>
        <div className="cta-row">
          <SpringButton>
            <Link href="/register-club" className="btn btn-primary btn-lg">
              Create your club workspace
              <ArrowRight size={15} />
            </Link>
          </SpringButton>
        </div>
        <div className="cta-trust">
          {['No credit card required', 'Free onboarding', 'Cancel anytime'].map((t) => (
            <span key={t}>
              <Check size={12} style={{ color: 'var(--accent-green-text)' }} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
