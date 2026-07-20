'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { CommandMenu } from './CommandMenu';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Command } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
}

// Coarse client-side zoning (defense in depth — the API enforces real RBAC).
// These top-level segments are staff areas; a customer/coach who navigates
// straight to one is bounced to their own home instead of briefly rendering
// protected chrome while the first API call 401/403s.
const STAFF_ONLY_SEGMENTS = ['admin', 'receptionist', 'bookings'];

function homeFor(role: string): string {
  if (role === 'coach') return '/dashboard/coaching';
  if (role === 'customer') return '/dashboard/availability';
  return '/dashboard';
}

export function AppShell({ children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  // Wait for the persisted auth store to rehydrate on the client before judging
  // the session, so we neither mismatch SSR nor redirect on a transient null.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const segment = (pathname ?? '').split('/')[1] ?? '';
  const roleBlocked =
    !!user &&
    (user.role === 'customer' || user.role === 'coach') &&
    STAFF_ONLY_SEGMENTS.includes(segment);

  // Auth + role gate.
  useEffect(() => {
    if (!mounted) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (roleBlocked) {
      router.replace(homeFor(user.role));
    }
  }, [mounted, user, roleBlocked, router]);

  // Cmd+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Hold back the protected chrome until we know the session is present and
  // permitted for this route (a redirect is already in flight otherwise).
  if (!mounted || !user || roleBlocked) {
    return <div style={{ minHeight: '100vh' }} aria-hidden />;
  }

  return (
    <div className="app-shell">
      <Sidebar />

      {/* Header */}
      <header className="main-header">
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {/* Breadcrumb placeholder */}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setCmdOpen(true)}
          aria-label="Open command menu"
          aria-keyshortcuts="Control+K Meta+K"
          id="cmd-trigger"
        >
          <Command size={13} />
          Command Menu
          <kbd style={{
            fontSize: 10, background: 'var(--bg)',
            border: '1px solid var(--border)', borderRadius: 3,
            padding: '1px 5px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)',
          }}>⌘K</kbd>
        </button>
      </header>

      {/* Page content */}
      <main className="main-content" role="main" id="main-content">
        {children}
      </main>

      {/* Command menu overlay */}
      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
