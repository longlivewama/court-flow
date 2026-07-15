'use client';

/**
 * Staff (screen 5.13) — teammates & permissions manager.
 * Owner can suspend / reactivate teammates with a functional toggle;
 * a suspended account loses API access at its next token refresh.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserRound, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Toggle } from '@/components/ui/Toggle';

interface StaffMember {
  id:             string;
  first_name:     string;
  last_name:      string;
  email:          string;
  phone:          string | null;
  role:           'owner' | 'receptionist';
  is_active:      boolean;
  email_verified: boolean;
  is_locked:      boolean;
  created_at:     string;
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['Full club settings', 'Financial reports & analytics', 'Refund approval', 'Staff management'],
  receptionist: ['Bookings & check-in', 'Deposit verification', 'Payments ledger', 'Refund requests'],
};

export default function StaffPage() {
  const { user } = useAuthStore();
  const [staff, setStaff]     = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState<string | null>(null);
  const [notice, setNotice]   = useState('');

  const load = useCallback(() => {
    api.get('/users/staff')
      .then(({ data }) => setStaff(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load teammates.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function toggleActive(member: StaffMember, next: boolean) {
    setSaving(member.id);
    setError('');
    setNotice('');
    // Optimistic flip; rolled back on failure
    setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, is_active: next } : s));
    try {
      await api.patch(`/users/${member.id}/status`, { isActive: next });
      setNotice(`${member.first_name} ${member.last_name} ${next ? 'reactivated' : 'suspended'}.`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Update failed.');
      setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, is_active: !next } : s));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">Teammates, roles and access control</p>
        </div>
      </div>

      {notice && (
        <div role="status" style={{
          background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
          color: 'var(--accent-green-text)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 16,
        }}>
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 220, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {staff.map((member) => {
            const isSelf = member.id === user?.id;
            return (
              <div key={member.id} className="card" style={{ opacity: member.is_active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: member.role === 'owner' ? 'var(--accent-green-bg)' : 'var(--surface-2)',
                    border: `1px solid ${member.role === 'owner' ? 'var(--success-border)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: member.role === 'owner' ? 'var(--accent-green-text)' : 'var(--text-secondary)',
                  }}>
                    {member.role === 'owner' ? <ShieldCheck size={18} /> : <UserRound size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {member.first_name} {member.last_name}
                      </span>
                      {isSelf && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 7px' }}>
                          you
                        </span>
                      )}
                      {member.is_locked && (
                        <Lock size={12} style={{ color: 'var(--warning)' }} aria-label="Temporarily locked out" />
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }} className="truncate">
                      {member.email}
                    </div>
                  </div>
                  <span className={`badge ${member.role === 'owner' ? 'badge-active' : 'badge-checked_in'}`}>
                    {member.role}
                  </span>
                </div>

                {/* Permission list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
                  {(ROLE_PERMISSIONS[member.role] ?? []).map((p) => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent-green)', flexShrink: 0 }} />
                      {p}
                    </div>
                  ))}
                </div>

                <div className="divider" />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {member.is_active ? 'Active' : 'Suspended'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {isSelf
                        ? 'You cannot change your own status'
                        : member.is_active
                          ? 'Has full access for their role'
                          : 'Sign-in and API access disabled'}
                    </div>
                  </div>
                  <Toggle
                    checked={member.is_active}
                    disabled={isSelf || saving === member.id}
                    onChange={(next) => toggleActive(member, next)}
                    label={`${member.first_name} account status`}
                  />
                </div>
              </div>
            );
          })}
          {staff.length === 0 && (
            <div className="empty-state">
              <UserRound size={28} className="empty-state-icon" />
              <span className="empty-state-title">No teammates yet</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
