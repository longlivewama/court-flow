'use client';

/**
 * Hover-stretch spring shell for CTA links — squashes wide and low like a
 * pressed ball. One spec for every landing CTA so they all feel identical.
 */
import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

export function SpringButton({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <motion.div
      whileHover={{ scaleX: 1.05, scaleY: 0.97 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      style={{ display: 'inline-flex', ...style }}
    >
      {children}
    </motion.div>
  );
}
