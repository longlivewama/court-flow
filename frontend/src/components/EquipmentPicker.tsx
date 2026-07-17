'use client';

/**
 * Add-ons / Equipment section for the booking flow.
 *
 * Renders the live rental catalogue as quiet dark cards with a − / +
 * stepper per item. Every change reports the selected lines and the
 * computed add-on subtotal upward so the booking total updates live.
 * Line totals expand fluidly as quantities change, and the add-ons
 * subtotal cross-fades on every numeric change.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '@/lib/api';
import { Stepper } from '@/components/ui/Stepper';
import { EASE_STANDARD } from '@/lib/motion-tokens';

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

const EXPAND = { duration: 0.18, ease: EASE_STANDARD };

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

  const subtotal = subtotalFor(quantities, items);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item) => {
          const qty = quantities[item.id] ?? 0;
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={EXPAND}
              className={`addon-card ${qty > 0 ? 'selected' : ''}`}
            >
              <div className="addon-thumb" aria-hidden>
                {CATEGORY_ICON[item.category] ?? '🎒'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }} className="truncate">
                  {item.name}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                  EGP {Number(item.hourly_price).toFixed(0)}/hr
                </div>
                {/* Line total expands in when the item is added */}
                <AnimatePresence initial={false}>
                  {qty > 0 && (
                    <motion.div
                      key="line-total"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={EXPAND}
                      style={{ overflow: 'hidden' }}
                    >
                      <span style={{ fontSize: 11.5, color: 'var(--accent-green-text)' }}>
                        + EGP {(qty * Number(item.hourly_price) * hours).toFixed(0)}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <Stepper
                value={qty}
                min={0}
                max={item.stock_qty}
                onChange={(v) => setQty(item.id, v)}
                ariaLabel={`${item.name} quantity`}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Add-ons subtotal — layout-aware, cross-fades on numeric change */}
      <AnimatePresence initial={false}>
        {subtotal > 0 && (
          <motion.div
            key="price-total-row"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={EXPAND}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderTop: '1px solid var(--border)',
              fontSize: 12.5, color: 'var(--text-secondary)',
            }}>
              <span>Add-ons subtotal</span>
              <motion.span layout className="price-total" style={{ display: 'inline-flex' }}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={subtotal}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={EXPAND}
                    style={{
                      fontWeight: 600, color: 'var(--accent-green-text)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    EGP {subtotal.toFixed(0)}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
