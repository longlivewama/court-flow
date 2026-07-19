'use client';

/**
 * Automation stack — the three enterprise infrastructure layers, each with
 * kicker, detailed body copy, and check-pill spec chips.
 */
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { AUTOMATION_STACK } from '@/lib/landing-data';
import { REVEAL, REVEAL_GROUP } from './reveal';

export function AutomationStack() {
  return (
    <motion.section className="landing-section" initial="hidden" whileInView="visible"
      viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
      <motion.div variants={REVEAL} className="section-head">
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
  );
}
