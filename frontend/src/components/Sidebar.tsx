'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Calendar, CalendarCheck, Users, BarChart2,
  Settings, Shield, CreditCard, LogOut, Zap, CalendarDays,
  LineChart, Package, UserCog, Component, Smartphone,
  Wallet, Trophy, Dumbbell, PackageSearch,
} from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth.store';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface NavItem {
  href:  string;
  label: string;
  icon:  React.ReactNode;
  roles: string[];
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  // Common
  { href: '/dashboard',          label: 'Dashboard',    icon: <LayoutDashboard size={15} />, roles: ['owner','receptionist'], group: 'Main' },
  { href: '/dashboard/calendar', label: 'Calendar',     icon: <CalendarDays size={15} />,    roles: ['owner','receptionist'], group: 'Main' },
  { href: '/dashboard/schedule', label: 'Schedule',     icon: <Calendar size={15} />,        roles: ['owner','receptionist'], group: 'Main' },
  { href: '/bookings',           label: 'Bookings',     icon: <CalendarCheck size={15} />,   roles: ['owner','receptionist'], group: 'Main' },

  // Receptionist + Owner operations
  { href: '/receptionist/checkin', label: 'Check In',    icon: <Zap size={15} />,          roles: ['receptionist'], group: 'Operations' },
  { href: '/receptionist/verify',  label: 'Verify Deposits', icon: <CreditCard size={15} />, roles: ['receptionist', 'owner'], group: 'Operations' },
  { href: '/admin/payments',       label: 'Payments',    icon: <CreditCard size={15} />,   roles: ['owner', 'receptionist'], group: 'Operations' },
  { href: '/admin/customers',      label: 'Customers',   icon: <Users size={15} />,        roles: ['owner', 'receptionist'], group: 'Operations' },
  { href: '/admin/coaching',       label: 'Coaching',    icon: <Dumbbell size={15} />,     roles: ['owner', 'receptionist'], group: 'Operations' },
  { href: '/admin/lost-found',     label: 'Lost & Found', icon: <PackageSearch size={15} />, roles: ['owner', 'receptionist'], group: 'Operations' },

  // Customer
  { href: '/dashboard/availability', label: 'Availability', icon: <LayoutDashboard size={15} />, roles: ['customer'], group: 'Main' },
  { href: '/dashboard/my-bookings', label: 'My Bookings',  icon: <CalendarCheck size={15} />, roles: ['customer'], group: 'Main' },
  { href: '/dashboard/book',        label: 'Book a Court', icon: <Calendar size={15} />,      roles: ['customer'], group: 'Main' },
  { href: '/dashboard/tournaments', label: 'Tournaments',  icon: <Trophy size={15} />,        roles: ['customer'], group: 'Main' },
  { href: '/dashboard/lost-found',  label: 'Lost & Found', icon: <PackageSearch size={15} />, roles: ['customer'], group: 'Main' },

  // Owner
  { href: '/admin/analytics',    label: 'Analytics',    icon: <LineChart size={15} />,      roles: ['owner'], group: 'Admin' },
  { href: '/admin/finance',      label: 'Finance',      icon: <Wallet size={15} />,         roles: ['owner'], group: 'Admin' },
  { href: '/admin/tournaments',  label: 'Tournaments',  icon: <Trophy size={15} />,         roles: ['owner'], group: 'Admin' },
  { href: '/admin/inventory',    label: 'Rental & VIP', icon: <Package size={15} />,        roles: ['owner'], group: 'Admin' },
  { href: '/admin/staff',        label: 'Staff',        icon: <UserCog size={15} />,        roles: ['owner'], group: 'Admin' },
  { href: '/admin/courts',       label: 'Courts',       icon: <Settings size={15} />,       roles: ['owner'], group: 'Admin' },
  { href: '/admin/reports',      label: 'Reports',      icon: <BarChart2 size={15} />,      roles: ['owner'], group: 'Admin' },
  { href: '/admin/audit',        label: 'Audit Log',    icon: <Shield size={15} />,         roles: ['owner'], group: 'Admin' },
  { href: '/admin/settings',     label: 'Settings',     icon: <Settings size={15} />,       roles: ['owner'], group: 'Admin' },

  // Design system
  { href: '/showcase/components', label: 'Components',  icon: <Component size={15} />,      roles: ['owner'], group: 'Design' },
  { href: '/showcase/mobile',     label: 'Mobile App',  icon: <Smartphone size={15} />,     roles: ['owner'], group: 'Design' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, clearAuth } = useAuthStore();
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);

  const canVerify = user?.role === 'receptionist' || user?.role === 'owner';

  // Refetch on every navigation so the badge stays in sync as staff
  // approve/reject deposits on the verify page.
  useEffect(() => {
    if (!canVerify) return;
    let cancelled = false;
    api.get('/bookings?status=pending_verification&limit=50')
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data.data ?? data;
        setPendingCount(Array.isArray(rows) ? rows.length : 0);
      })
      .catch(() => { /* badge is best-effort; never block navigation */ });
    return () => { cancelled = true; };
  }, [canVerify, pathname]);

  const visible = NAV_ITEMS.filter(
    (item) => user?.role && item.roles.includes(user.role)
  );

  const groups = visible.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  async function handleLogout() {
    try { await api.post('/auth/logout'); } catch {}
    clearAuth();
    router.replace('/login');
  }

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="nav-logo">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="5" fill="#22C55E" />
          <path d="M5 10h10M10 5v10" stroke="#06170C" strokeWidth="2" strokeLinecap="round" />
        </svg>
        CourtFlow
      </div>

      {/* Nav groups */}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          {Object.keys(groups).length > 1 && (
            <div className="nav-section-label">{group}</div>
          )}
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              <span style={{ opacity: 0.7 }}>{item.icon}</span>
              {item.label}
              {item.href === '/receptionist/verify' && pendingCount > 0 && (
                <span
                  aria-label={`${pendingCount} bookings awaiting verification`}
                  style={{
                    marginLeft: 8,
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pendingCount === 1 ? '1' : `+${pendingCount}`}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}

      {/* User section at bottom */}
      <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        {user && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
              {user.firstName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
              {user.role}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
          aria-label="Sign out"
        >
          <LogOut size={13} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
