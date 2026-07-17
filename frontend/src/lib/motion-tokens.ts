/**
 * Motion token bridge — exposes the design-system's native CSS custom
 * properties (durations, easings) to the Motion (motion/react) runtime.
 * globals.css stays the Single Source of Truth; JS only reads from it.
 */
import type { Transition } from 'motion/react';

/** Read a CSS duration token (e.g. '--dur-fast') as seconds for Motion. */
export const getDur = (name: string): number => {
  if (typeof window === 'undefined') return 0.2;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) / 1000 || 0.2;
};

/** Tight, snappy spring for grid cell morphs (schedule slot cells). */
export const SPRING_GRID: Transition = { type: 'spring', stiffness: 500, damping: 40, mass: 0.9 };

/** Heavier spring for the full-height booking sheet drawer. */
export const SPRING_SHEET: Transition = { type: 'spring', stiffness: 380, damping: 38, mass: 1 };

/** Mirrors the Material standard curve used across globals.css. */
export const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];

/** Symmetric ease for SVG stroke draw-ins (confirmation checkmark). */
export const EASE_DRAW: [number, number, number, number] = [0.65, 0, 0.35, 1];
