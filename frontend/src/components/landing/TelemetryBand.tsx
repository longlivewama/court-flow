'use client';

/**
 * ROI telemetry band — each metric is an isolated micro-dashboard card:
 * glowing green hairline border, micro-grid texture, live pulse, and a
 * 12-point sparkline whose current period wears the accent.
 */
import { motion } from 'motion/react';
import { TELEMETRY } from '@/lib/landing-data';
import { REVEAL, REVEAL_GROUP } from './reveal';

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

export function TelemetryBand() {
  return (
    <motion.section className="landing-section" style={{ paddingTop: 0 }}
      initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
      <motion.p variants={REVEAL} className="metric-eyebrow">
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
  );
}
