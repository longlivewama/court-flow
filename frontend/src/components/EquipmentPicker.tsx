'use client';

/**
 * Add-ons / Equipment section for the booking flow.
 *
 * Renders the live rental catalogue as quiet dark cards with a − / +
 * stepper per item. Every change reports the selected lines and the
 * computed add-on subtotal upward so the booking total updates live.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Stepper } from '@/components/ui/Stepper';

export interface EquipmentItem {
  id:           string;
  name:         string;
  category:     string;
  description:  string | null;
  hourly_price: string | number;
  stock_qty:    number;
}

export interface EquipmentSelection {
  equipmentId: string;
  quantity:    number;
}

const CATEGORY_ICON: Record<string, string> = {
  racket: '🏓',
  balls:  '🎾',
  gear:   '🧤',
};

interface EquipmentPickerProps {
  /** Booked hours — add-on lines are priced per hour × quantity × hours */
  hours:        number;
  quantities:   Record<string, number>;
  onChange:     (quantities: Record<string, number>, subtotal: number, items: EquipmentItem[]) => void;
}

export function EquipmentPicker({ hours, quantities, onChange }: EquipmentPickerProps) {
  const [items, setItems]     = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/equipment')
      .then(({ data }) => { if (!cancelled) setItems(data.data ?? []); })
      .catch(() => { /* add-ons are optional; booking still works without them */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function subtotalFor(next: Record<string, number>, list: EquipmentItem[]): number {
    return list.reduce((sum, item) => {
      const qty = next[item.id] ?? 0;
      return sum + qty * Number(item.hourly_price) * hours;
    }, 0);
  }

  function setQty(id: string, qty: number) {
    const next = { ...quantities, [id]: qty };
    if (qty === 0) delete next[id];
    onChange(next, subtotalFor(next, items), items);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 58 }} />)}
      </div>
    );
  }
  if (!items.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item) => {
        const qty = quantities[item.id] ?? 0;
        return (
          <div key={item.id} className={`addon-card ${qty > 0 ? 'selected' : ''}`}>
            <div className="addon-thumb" aria-hidden>
              {CATEGORY_ICON[item.category] ?? '🎒'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }} className="truncate">
                {item.name}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                EGP {Number(item.hourly_price).toFixed(0)}/hr
                {qty > 0 && (
                  <span style={{ color: 'var(--accent-green-text)', marginLeft: 8 }}>
                    + EGP {(qty * Number(item.hourly_price) * hours).toFixed(0)}
                  </span>
                )}
              </div>
            </div>
            <Stepper
              value={qty}
              min={0}
              max={item.stock_qty}
              onChange={(v) => setQty(item.id, v)}
              ariaLabel={`${item.name} quantity`}
            />
          </div>
        );
      })}
    </div>
  );
}
