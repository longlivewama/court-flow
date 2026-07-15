'use client';

/**
 * Accessible toggle switch. Styled by the `.switch` class in globals.css —
 * a quiet track that fills with the single green accent when on.
 */
interface ToggleProps {
  checked:   boolean;
  onChange:  (checked: boolean) => void;
  disabled?: boolean;
  label?:    string;
  id?:       string;
}

export function Toggle({ checked, onChange, disabled, label, id }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}
