'use client';

/**
 * Repeat / Subscription switch for the booking flow.
 * When on, the slot repeats weekly for the chosen term (1 or 3 months)
 * and is created through POST /api/subscriptions instead of a one-off booking.
 */
import { Repeat } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';

export type SubscriptionTerm = 1 | 3;

interface SubscriptionToggleProps {
  enabled:   boolean;
  term:      SubscriptionTerm;
  onEnable:  (enabled: boolean) => void;
  onTerm:    (term: SubscriptionTerm) => void;
  weeklyPrice: number;
}

export function SubscriptionToggle({ enabled, term, onEnable, onTerm, weeklyPrice }: SubscriptionToggleProps) {
  return (
    <div
      className="card-sm"
      style={{
        background: enabled ? 'var(--accent-green-bg)' : 'var(--surface-2)',
        borderColor: enabled ? 'var(--success-border)' : 'var(--border)',
        transition: 'background 200ms, border-color 200ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Repeat size={15} style={{ color: enabled ? 'var(--accent-green-text)' : 'var(--text-tertiary)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            Repeat weekly
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            Reserve this exact slot every week — VIP fixed booking
          </div>
        </div>
        <Toggle checked={enabled} onChange={onEnable} label="Repeat weekly" />
      </div>

      {enabled && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="seg-control" style={{ alignSelf: 'flex-start' }}>
            {([1, 3] as SubscriptionTerm[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`seg-item ${term === t ? 'active' : ''}`}
                onClick={() => onTerm(t)}
              >
                Weekly for {t} month{t > 1 ? 's' : ''}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {term * 4} sessions · EGP {(weeklyPrice * 4).toFixed(0)}/month
            <span style={{ color: 'var(--text-tertiary)' }}> · billed at the club</span>
          </div>
        </div>
      )}
    </div>
  );
}
