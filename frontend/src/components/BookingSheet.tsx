'use client';

/**
 * BookingSheet – elastic spring drawer for booking actions.
 * Rises from the bottom edge (y: 100% → 0) on a heavy, tactile spring,
 * with a padel-court blueprint graphic scaling in beside the title.
 */
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { SPRING_SHEET } from '@/lib/motion-tokens';

/**
 * Minimal padel/tennis court blueprint — outer walls, centre net and
 * service boxes as low-opacity wireframe strokes. Reused next to court
 * detail line items across the booking flow.
 */
export function CourtBlueprint({ width = 56, animate = false }: { width?: number; animate?: boolean }) {
  const height = Math.round(width * 0.55);
  return (
    <motion.svg
      width={width} height={height} viewBox="0 0 56 31"
      fill="none" aria-hidden
      initial={animate ? { opacity: 0, scale: 0.82 } : false}
      animate={animate ? { opacity: 1, scale: 1 } : undefined}
      transition={SPRING_SHEET}
      style={{ flexShrink: 0, display: 'block' }}
    >
      {/* Outer court / glass walls */}
      <rect x="1.5" y="1.5" width="53" height="28" rx="2.5"
        stroke="var(--border-focus)" strokeWidth="1.5" opacity="0.9" />
      {/* Centre net */}
      <line x1="28" y1="1.5" x2="28" y2="29.5"
        stroke="var(--accent-green)" strokeWidth="1" strokeDasharray="2 2.5" opacity="0.55" />
      {/* Service lines */}
      <line x1="10" y1="1.5" x2="10" y2="29.5" stroke="var(--border)" strokeWidth="1" />
      <line x1="46" y1="1.5" x2="46" y2="29.5" stroke="var(--border)" strokeWidth="1" />
      {/* Centre service lines splitting the boxes */}
      <line x1="10" y1="15.5" x2="46" y2="15.5" stroke="var(--border)" strokeWidth="1" />
      {/* Glass mesh hints in the corners */}
      <line x1="1.5" y1="8" x2="6" y2="1.5" stroke="var(--border)" strokeWidth="0.75" opacity="0.7" />
      <line x1="50" y1="29.5" x2="54.5" y2="23" stroke="var(--border)" strokeWidth="0.75" opacity="0.7" />
    </motion.svg>
  );
}

interface BookingSheetProps {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  children: React.ReactNode;
  width?:   number;
}

export function BookingSheet({
  open, onClose, title, children, width = 480,
}: BookingSheetProps) {
  // Trap focus and handle ESC
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)', zIndex: 200,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet panel — rises from the bottom edge */}
          <motion.div
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width, background: 'var(--bg-elevated)',
              borderLeft: '1px solid var(--border-focus)',
              zIndex: 201, display: 'flex', flexDirection: 'column',
              overflowY: 'auto',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING_SHEET}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {/* Sheet header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px', borderBottom: '1px solid var(--border)',
              position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <CourtBlueprint width={44} animate />
                <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px' }}>{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="btn btn-ghost btn-sm"
                aria-label="Close panel"
                style={{ padding: '6px', borderRadius: 6 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: 24, flex: 1 }}>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
