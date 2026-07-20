'use client';

/**
 * Commercial subscription matrix — Base Club vs the glow-bordered
 * Pro Club Elite tier.
 */
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight, Check, Trophy, Building2, GraduationCap,
} from 'lucide-react';
import { TIER_BASE, TIER_PRO } from '@/lib/landing-data';
import { SpringButton } from './SpringButton';
import { REVEAL, REVEAL_GROUP } from './reveal';

export function PricingMatrix() {
  return (
    <motion.section className="landing-section" initial="hidden" whileInView="visible"
      viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
      <motion.div variants={REVEAL} className="section-head">
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
          <SpringButton style={{ display: 'flex', marginTop: 'auto' }}>
            <Link href="/register-club" className="btn btn-primary" style={{ justifyContent: 'center', flex: 1 }}>
              Go Pro Elite
              <ArrowRight size={14} />
            </Link>
          </SpringButton>
        </motion.div>
      </div>
      <motion.p variants={REVEAL} style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 20 }}>
        <GraduationCap size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
        Owner, desk staff, coach and member roles included on both tiers.
      </motion.p>
    </motion.section>
  );
}
