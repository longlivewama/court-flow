'use client';

import { Minus, Plus } from 'lucide-react';

/**
 * − / + counter stepper used by the equipment add-ons section.
 * Live-updates the parent on every click so totals recompute instantly.
 */
interface StepperProps {
  value:     number;
  onChange:  (value: number) => void;
  min?:      number;
  max?:      number;
  ariaLabel?: string;
}

export function Stepper({ value, onChange, min = 0, max = 99, ariaLabel }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus size={13} />
      </button>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
