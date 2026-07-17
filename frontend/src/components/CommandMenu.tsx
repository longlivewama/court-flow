'use client';

/**
 * CommandMenu – Cmd+K command palette with Emil Kowalski elastic spring animations.
 * Full keyboard navigation for Receptionist and Owner workflows.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  Search, UserCheck, CreditCard, Calendar, BarChart2,
  Users, Settings, FileText, LogOut, Moon, Zap,
} from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth.store';

interface Command {
  id:        string;
  label:     string;
  icon:      React.ReactNode;
  shortcut?: string;
  group:     string;
  roles:     string[];
  action:    () => void;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };
const FADE_IN = { opacity: [0, 1], transition: { duration: 0.12 } };

interface CommandMenuProps {
  open:    boolean;
  onClose: () => void;
}

export function CommandMenu({ open, onClose }: CommandMenuProps) {
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback((path: string) => {
    router.push(path);
    onClose();
  }, [router, onClose]);

  const allCommands: Command[] = [
    {
      id: 'schedule', label: 'View Today\'s Schedule', icon: <Calendar size={16} />,
      shortcut: 'S', group: 'Navigation', roles: ['owner', 'receptionist'],
      action: () => navigate('/dashboard/schedule'),
    },
    {
      id: 'checkin', label: 'Check In Customer', icon: <UserCheck size={16} />,
      shortcut: 'C', group: 'Quick Actions', roles: ['receptionist'],
      action: () => navigate('/receptionist/checkin'),
    },
    {
      id: 'verify', label: 'Verify Deposit', icon: <CreditCard size={16} />,
      shortcut: 'V', group: 'Quick Actions', roles: ['receptionist'],
      action: () => navigate('/receptionist/verify'),
    },
    {
      id: 'new-booking', label: 'Create New Booking', icon: <Zap size={16} />,
      shortcut: 'N', group: 'Quick Actions', roles: ['owner', 'receptionist'],
      action: () => navigate('/dashboard/book'),
    },
    {
      id: 'bookings', label: 'All Bookings', icon: <Calendar size={16} />,
      group: 'Navigation', roles: ['owner', 'receptionist'],
      action: () => navigate('/bookings'),
    },
    {
      id: 'report-revenue', label: 'Export Revenue Report', icon: <BarChart2 size={16} />,
      shortcut: 'R', group: 'Reports', roles: ['owner'],
      action: () => navigate('/admin/reports?type=monthly_revenue'),
    },
    {
      id: 'report-pdf', label: 'Export Booking History PDF', icon: <FileText size={16} />,
      group: 'Reports', roles: ['owner'],
      action: () => navigate('/admin/reports?type=booking_history&format=pdf'),
    },
    {
      id: 'report-excel', label: 'Export Bookings Excel', icon: <FileText size={16} />,
      group: 'Reports', roles: ['owner'],
      action: () => navigate('/admin/reports?type=booking_history&format=excel'),
    },
    {
      id: 'customers', label: 'Customer List', icon: <Users size={16} />,
      group: 'Navigation', roles: ['owner', 'receptionist'],
      action: () => navigate('/customers'),
    },
    {
      id: 'courts', label: 'Manage Courts', icon: <Settings size={16} />,
      group: 'Admin', roles: ['owner'],
      action: () => navigate('/admin/courts'),
    },
    {
      id: 'settings', label: 'Club Settings', icon: <Settings size={16} />,
      shortcut: ',', group: 'Admin', roles: ['owner'],
      action: () => navigate('/admin/settings'),
    },
    {
      id: 'audit', label: 'Audit Log', icon: <FileText size={16} />,
      group: 'Admin', roles: ['owner'],
      action: () => navigate('/admin/audit'),
    },
    {
      id: 'logout', label: 'Sign Out', icon: <LogOut size={16} />,
      group: 'Account', roles: ['owner', 'receptionist', 'customer'],
      action: () => { clearAuth(); router.replace('/login'); onClose(); },
    },
  ];

  const filtered = allCommands.filter((cmd) => {
    if (!user?.role || !cmd.roles.includes(user.role)) return false;
    if (!query) return true;
    return cmd.label.toLowerCase().includes(query.toLowerCase());
  });

  // Group commands
  const groups = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {});

  const flatFiltered = Object.values(groups).flat();

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flatFiltered[selected]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="cmdk-wrapper"
            initial={{ opacity: 0, scale: 0.95, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={SPRING}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div className="cmdk-input-wrap">
              <Search size={16} color="var(--text-tertiary)" />
              <input
                ref={inputRef}
                placeholder="Search commands…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Command search"
              />
              <kbd style={{
                fontSize: 11, color: 'var(--text-tertiary)',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)',
              }}>ESC</kbd>
            </div>

            {/* Results */}
            <div className="cmdk-list" role="listbox" aria-label="Commands">
              {flatFiltered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  No commands found
                </div>
              )}

              {Object.entries(groups).map(([group, cmds]) => (
                <div key={group}>
                  <div className="cmdk-group-label">{group}</div>
                  {cmds.map((cmd) => {
                    const idx = flatFiltered.indexOf(cmd);
                    return (
                      <motion.div
                        key={cmd.id}
                        className="cmdk-item"
                        data-selected={idx === selected}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelected(idx)}
                        whileHover={{ x: 2 }}
                        transition={{ duration: 0.1 }}
                        role="option"
                        aria-selected={idx === selected}
                      >
                        <span style={{ color: 'var(--text-tertiary)' }}>{cmd.icon}</span>
                        <span style={{ flex: 1 }}>{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd className="cmdk-item-shortcut">⌘ {cmd.shortcut}</kbd>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
              padding: '10px 16px', borderTop: '1px solid var(--border)',
              fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
            }}>
              <span>↑↓ navigate</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>↵ select</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>ESC close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
