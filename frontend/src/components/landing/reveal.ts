/**
 * Shared entrance variants for the landing sections — one fade-rise unit,
 * one stagger group. Inert variant objects; safe to import anywhere.
 */
import type { Variants } from 'motion/react';
import { EASE_STANDARD } from '@/lib/motion-tokens';

export const REVEAL: Variants = {
  hidden:  { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_STANDARD } },
};

export const REVEAL_GROUP: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
