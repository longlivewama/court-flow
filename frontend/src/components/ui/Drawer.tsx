'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Right-hand slide-over panel (New Booking / Booking Details).
 * Escape and backdrop-click both close; body scroll is locked while open.
 */
interface DrawerProps {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  subtitle?: string;
  children: React.ReactNode;
  footer?:  React.ReactNode;
  width?:   number;
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 460 }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="overlay-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            className="drawer"
            style={{ width }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <div className="drawer-header">
              <div>
                <h3 style={{ fontSize: 16 }}>{title}</h3>
                {subtitle && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {subtitle}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close panel">
                <X size={15} />
              </button>
            </div>
            <div className="drawer-body">{children}</div>
            {footer && <div className="drawer-footer">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
