'use client';

/**
 * BookingSheet – elastic spring slide-in panel for booking actions.
 * Opens from the right edge with tactile spring animation.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';

const SHEET_SPRING = { type: 'spring' as const, stiffness: 380, damping: 32 };

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

          {/* Sheet panel */}
          <motion.div
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width, background: 'var(--bg-elevated)',
              borderLeft: '1px solid var(--border-focus)',
              zIndex: 201, display: 'flex', flexDirection: 'column',
              overflowY: 'auto',
            }}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={SHEET_SPRING}
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
              <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px' }}>{title}</h3>
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
