/**
 * Chart + calendar categorical palette.
 *
 * Validated against the dark chart surface (#15171C) with the dataviz
 * six-checks validator: lightness band, chroma floor, adjacent-pair CVD
 * separation, and 3:1 contrast all PASS for this exact order.
 *
 * Rules of use:
 *   · Identity only — a court/series keeps its color across every screen;
 *     never repaint after filtering, never cycle extra hues.
 *   · Status colors (success/warning/error tokens) are never used as series.
 *   · A 6th+ category folds into "Other" (var --text-tertiary gray).
 */
export const CAT_COLORS = ['#3B82F6', '#0D9488', '#8B5CF6', '#EA580C', '#DB2777'] as const;

/** Single-series accent (bookings trend, revenue line) — the brand green. */
export const SERIES_GREEN = '#22C55E';

export const OTHER_GRAY = '#6B6F78';

/** Stable identity color for the nth court (sorted by court number). */
export function catColor(index: number): string {
  return index < CAT_COLORS.length ? CAT_COLORS[index] : OTHER_GRAY;
}

/** Translucent fill + solid text pair for calendar event blocks. */
export function calendarBlockStyle(index: number): { background: string; borderColor: string; color: string } {
  const c = catColor(index);
  return { background: `${c}26`, borderColor: `${c}59`, color: mixToText(c) };
}

/** Lighten a hex color toward white for legible text on tinted fills. */
function mixToText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const lift = (v: number) => Math.round(v + (255 - v) * 0.45);
  return `#${[lift(r), lift(g), lift(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
