'use client';

import { useEffect, useState } from 'react';
import { CommandMenu } from './CommandMenu';
import { Sidebar } from './Sidebar';
import { Command } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);

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
